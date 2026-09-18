/**
 * The commit pipeline — the only way anything enters the ledger.
 *
 * Every module (audit, inventory, contracts, invoices, payments, governance) writes
 * through this one function. There is no side door, so the checks below apply uniformly:
 *
 *   1. role may submit this event type          -> 403   (permissioned)
 *   2. signed identity matches the bearer token -> 403   (no impersonation)
 *   3. factory scoping                          -> 403
 *   4. data_fields match the schema, unchanged  -> 400
 *   5. the signing key is registered to them    -> 401
 *   6. the signature verifies                   -> 401   (non-repudiation)
 *   7. event_id is unused                       -> 409
 *   8. domain preconditions hold                -> 422
 *   9. AI check runs (flags, never blocks)
 *  10. block is hashed onto the head and appended
 *
 * Step 6 is the one that matters most: the server holds no private keys, so a record it
 * cannot verify is a record it cannot commit — and one it could never have forged.
 */

import { asc, desc, eq } from 'drizzle-orm';
import {
  buildBlock,
  buildGenesisBlock,
  canJsonEqual,
  canonicalJson,
  canSubmit,
  DEFAULT_CHAIN_ID,
  EVENT_FAMILY,
  GENESIS_PREV_HASH,
  recordPayload,
  runAnomalyCheck,
  validateDataFields,
  verifyChain,
  verifyPayload,
} from '@breadcrumbs/shared';
import type {
  AnomalyResult,
  Block,
  ChainReport,
  HistoricalRecord,
  Role,
  SignedRecord,
} from '@breadcrumbs/shared';

import { getDb } from '../db/client.ts';
import { blocks, deviceKeys, identities, pContracts, pInvoices, pPayments, pRecords } from '../db/schema.ts';
import { applyBlock, snapshotLookups } from './projections.ts';
import { blockToRow, rowToBlock, str } from './rows.ts';

export class LedgerError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'LedgerError';
    this.status = status;
    this.code = code;
    this.details = details ?? null;
  }
}

export interface ActorContext {
  id: string;
  name: string;
  role: Role;
  factoryId: string | null;
}

export interface CommitInput {
  record: SignedRecord;
  signature: string;
  keyFingerprint: string;
  actor: ActorContext;
  /** Server commit time. The seeder supplies historical values to lay down a real timeline. */
  committedAt?: string;
}

export interface CommitResult {
  block: Block;
  anomaly: AnomalyResult;
}

/* ------------------------------------------------------------------ lock */

/**
 * Appends must be strictly ordered — two concurrent commits reading the same head would
 * produce two blocks claiming the same predecessor. Single process, so a promise chain
 * is sufficient and avoids a database-level lock.
 */
let chainLock: Promise<unknown> = Promise.resolve();

function withChainLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = chainLock.then(fn, fn);
  chainLock = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/* ----------------------------------------------------------------- reads */

export async function getHead(): Promise<Block | null> {
  const db = getDb();
  const [row] = await db.select().from(blocks).orderBy(desc(blocks.blockIndex)).limit(1);
  return row ? rowToBlock(row) : null;
}

export async function getHeight(): Promise<number> {
  const db = getDb();
  const rows = await db.select({ i: blocks.blockIndex }).from(blocks);
  return rows.length;
}

/**
 * Sequential nonce tracking per submitter identity for replay and reorder protection.
 */
export async function getNextNonce(submitterId: string): Promise<number> {
  const db = getDb();
  const rows = await db
    .select({ i: blocks.blockIndex })
    .from(blocks)
    .where(eq(blocks.submitterId, submitterId));
  return rows.length;
}

export async function getAllBlocks(): Promise<Block[]> {
  const db = getDb();
  const rows = await db.select().from(blocks).orderBy(asc(blocks.blockIndex));
  return rows.map(rowToBlock);
}

export async function verifyLedger(): Promise<ChainReport> {
  return verifyChain(await getAllBlocks());
}

export async function ensureGenesis(timestamp?: string): Promise<void> {
  return withChainLock(async () => {
    const db = getDb();
    const [existing] = await db.select().from(blocks).where(eq(blocks.blockIndex, 0));
    if (existing) return;

    const genesis = await buildGenesisBlock(timestamp ?? new Date().toISOString());
    await db.insert(blocks).values(blockToRow(genesis));
  });
}

/* ------------------------------------------------------- domain guards */

async function assertPreconditions(record: SignedRecord, actor: ActorContext): Promise<void> {
  const db = getDb();
  const fields = record.data_fields;

  switch (record.event_type) {
    case 'contract_signed': {
      const id = str(fields, 'contract_id');
      const [contract] = await db.select().from(pContracts).where(eq(pContracts.contractId, id));
      if (!contract) throw new LedgerError(422, 'unknown_contract', `No contract ${id}.`);
      if (contract.status === 'closed') {
        throw new LedgerError(422, 'contract_closed', `Contract ${id} is closed.`);
      }
      const isParty =
        (actor.role === 'brand' && contract.brandId === actor.id) ||
        (actor.role === 'factory' && contract.factoryId === actor.factoryId);
      if (!isParty) {
        throw new LedgerError(403, 'not_a_party', `You are not a party to contract ${id}.`);
      }
      return;
    }

    case 'contract_amended':
    case 'contract_closed': {
      const id = str(fields, 'contract_id');
      const [contract] = await db.select().from(pContracts).where(eq(pContracts.contractId, id));
      if (!contract) throw new LedgerError(422, 'unknown_contract', `No contract ${id}.`);
      if (contract.status === 'closed') {
        throw new LedgerError(422, 'contract_closed', `Contract ${id} is already closed.`);
      }
      if (actor.role !== 'brand' || contract.brandId !== actor.id) {
        throw new LedgerError(
          403,
          'not_contract_owner',
          `Only the purchasing brand (${contract.brandId}) can amend or close contract ${id}.`,
        );
      }
      return;
    }

    case 'invoice_issued': {
      const contractId = str(fields, 'contract_id');
      const [contract] = await db
        .select()
        .from(pContracts)
        .where(eq(pContracts.contractId, contractId));
      if (!contract) throw new LedgerError(422, 'unknown_contract', `No contract ${contractId}.`);
      if (contract.status !== 'active') {
        throw new LedgerError(
          422,
          'contract_not_active',
          `Contract ${contractId} is ${contract.status.replace(/_/g, ' ')} — it must be signed by both parties before it can be invoiced against.`,
        );
      }
      if (contract.factoryId !== record.factory_id) {
        throw new LedgerError(
          403,
          'wrong_factory',
          `Contract ${contractId} does not belong to this factory.`,
        );
      }
      return;
    }

    case 'invoice_approved':
    case 'invoice_disputed':
    case 'invoice_settled': {
      const id = str(fields, 'invoice_id');
      const [invoice] = await db.select().from(pInvoices).where(eq(pInvoices.invoiceId, id));
      if (!invoice) throw new LedgerError(422, 'unknown_invoice', `No invoice ${id}.`);
      if (actor.role !== 'brand' || invoice.brandId !== actor.id) {
        throw new LedgerError(
          403,
          'not_invoice_buyer',
          `Only the purchasing brand (${invoice.brandId}) can approve, dispute, or settle invoice ${id}.`,
        );
      }
      return;
    }

    case 'payment_initiated': {
      const id = str(fields, 'invoice_id');
      const [invoice] = await db.select().from(pInvoices).where(eq(pInvoices.invoiceId, id));
      if (!invoice) throw new LedgerError(422, 'unknown_invoice', `No invoice ${id}.`);
      if (actor.role !== 'brand' || invoice.brandId !== actor.id) {
        throw new LedgerError(
          403,
          'not_invoice_buyer',
          `Only the purchasing brand (${invoice.brandId}) can initiate payments for invoice ${id}.`,
        );
      }
      return;
    }

    case 'payment_settled':
    case 'payment_failed': {
      const invoiceId = str(fields, 'invoice_id');
      const paymentId = str(fields, 'payment_id');
      const [invoice] = await db.select().from(pInvoices).where(eq(pInvoices.invoiceId, invoiceId));
      if (!invoice) throw new LedgerError(422, 'unknown_invoice', `No invoice ${invoiceId}.`);
      if (actor.role !== 'brand' || invoice.brandId !== actor.id) {
        throw new LedgerError(
          403,
          'not_invoice_buyer',
          `Only the purchasing brand (${invoice.brandId}) can settle or mark failed payments for invoice ${invoiceId}.`,
        );
      }
      const [payment] = await db.select().from(pPayments).where(eq(pPayments.paymentId, paymentId));
      if (!payment) {
        throw new LedgerError(422, 'unknown_payment', `No payment ${paymentId} found to update.`);
      }
      return;
    }

    case 'review_confirmed':
    case 'review_disputed': {
      const targetId = str(fields, 'target_event_id');
      const [target] = await db.select().from(pRecords).where(eq(pRecords.eventId, targetId));
      if (!target) throw new LedgerError(422, 'unknown_record', `No record ${targetId}.`);

      if (target.humanReviewStatus === 'disputed') {
        throw new LedgerError(
          409,
          'already_reviewed',
          `Record ${targetId} was already disputed.`,
        );
      }

      const priorReviews = await db
        .select()
        .from(blocks)
        .where(eq(blocks.refId, targetId));

      const hasVoted = priorReviews.some((b) => b.submitterId === actor.id) || target.reviewerId === actor.id;
      if (hasVoted) {
        throw new LedgerError(
          409,
          'already_reviewed',
          `You have already recorded a review for record ${targetId}.`,
        );
      }
      return;
    }

    default:
      return;
  }
}

/* ---------------------------------------------------------- AI context */

async function buildAnomalyContext(record: SignedRecord) {
  const db = getDb();
  const lookups = await snapshotLookups();

  // Only this factory's own past behaviour forms the baseline — one factory's spike
  // should never be normalised away by another's volume.
  const rows = await db
    .select()
    .from(blocks)
    .where(eq(blocks.factoryId, record.factory_id))
    .orderBy(asc(blocks.blockIndex));

  const history: HistoricalRecord[] = rows
    .map(rowToBlock)
    .filter((b) => b.record.event_type !== 'genesis')
    .map((b) => ({
      event_id: b.record.event_id,
      event_type: b.record.event_type,
      factory_id: b.record.factory_id,
      timestamp: b.record.timestamp,
      data_fields: b.record.data_fields,
    }));

  return { history, ...lookups };
}

/* ---------------------------------------------------------------- commit */

export async function commit(input: CommitInput): Promise<CommitResult> {
  const { record, signature, keyFingerprint, actor } = input;
  const db = getDb();

  /* 1 — permissioned: may this role commit this event type at all? */
  if (!canSubmit(actor.role, record.event_type)) {
    throw new LedgerError(
      403,
      'forbidden_event_type',
      `A ${actor.role} may not submit ${record.event_type} events.`,
    );
  }

  /* 2 — the signed payload must claim the same identity as the bearer token. */
  if (
    record.submitter_id !== actor.id ||
    record.submitter_role !== actor.role ||
    record.submitter_name !== actor.name
  ) {
    throw new LedgerError(
      403,
      'identity_mismatch',
      'The signed record claims a different identity from the authenticated one.',
    );
  }

  /* 3 — a factory user may only write against their own factory. */
  if (actor.role === 'factory' && actor.factoryId && record.factory_id !== actor.factoryId) {
    throw new LedgerError(
      403,
      'wrong_factory',
      `You may only submit records for ${actor.factoryId}.`,
    );
  }

  /* 4 — data_fields must match the schema for this event type, and must already be
         normalised: the signature covers the exact bytes submitted, so the server can
         never substitute a parsed value without invalidating it. */
  const validation = validateDataFields(record.event_type, record.data_fields);
  if (!validation.ok) {
    throw new LedgerError(400, 'invalid_data_fields', 'data_fields failed validation.', validation.issues);
  }
  if (!canJsonEqual(validation.value, record.data_fields)) {
    throw new LedgerError(
      400,
      'unnormalised_data_fields',
      'data_fields must be normalised before signing — schema defaults changed the value, so the signature would not cover what was stored.',
    );
  }

  /* 5 — the signing key must be registered to this identity and not revoked. */
  const [key] = await db.select().from(deviceKeys).where(eq(deviceKeys.fingerprint, keyFingerprint));
  if (!key) {
    throw new LedgerError(401, 'unknown_key', 'That signing key is not registered.');
  }
  if (key.identityId !== actor.id) {
    throw new LedgerError(401, 'key_owner_mismatch', 'That signing key belongs to another identity.');
  }
  if (key.revokedAt) {
    throw new LedgerError(401, 'key_revoked', 'That signing key has been revoked.');
  }

  /* 6 — the signature must verify. Nothing reaches the chain unverified. */
  const publicJwk = JSON.parse(key.publicKeyJson) as JsonWebKey;
  const signatureValid = await verifyPayload(publicJwk, recordPayload(record), signature);
  if (!signatureValid) {
    throw new LedgerError(
      401,
      'bad_signature',
      'Signature does not verify against the registered key for this identity.',
    );
  }

  /* 7 — event ids are unique across the chain. */
  const [duplicate] = await db.select().from(blocks).where(eq(blocks.eventId, record.event_id));
  if (duplicate) {
    throw new LedgerError(409, 'duplicate_event', `Event ${record.event_id} is already on the chain.`);
  }

  /* 7b — cryptographic replay and ordering protection */
  if (record.chain_id && record.chain_id !== DEFAULT_CHAIN_ID) {
    throw new LedgerError(
      400,
      'wrong_chain_id',
      `Transaction targeted chain ${record.chain_id}, expected ${DEFAULT_CHAIN_ID}.`,
    );
  }

  const expectedNonce = await getNextNonce(record.submitter_id);
  if (typeof record.nonce === 'number' && record.nonce !== expectedNonce) {
    throw new LedgerError(
      400,
      'invalid_nonce',
      `Invalid transaction nonce: expected ${expectedNonce}, received ${record.nonce}.`,
    );
  }

  const currentHead = await getHead();
  const expectedPrevHash = currentHead ? currentHead.block_hash : GENESIS_PREV_HASH;
  if (record.previous_block_hash && record.previous_block_hash !== expectedPrevHash) {
    throw new LedgerError(
      409,
      'stale_block_anchor',
      `Transaction is anchored to stale block hash ${record.previous_block_hash.slice(0, 10)}... Current head is ${expectedPrevHash.slice(0, 10)}...`,
    );
  }

  /* 8 — domain rules for this event family. */
  await assertPreconditions(record, actor);

  /* 9 — AI check. It flags; it never blocks. A suspicious record still goes on the
         chain and is routed to an auditor, because dropping records would defeat the
         point of an immutable ledger. */
  const context = await buildAnomalyContext(record);
  const anomaly = runAnomalyCheck(
    {
      event_type: record.event_type,
      factory_id: record.factory_id,
      timestamp: record.timestamp,
      data_fields: record.data_fields,
      ref_id: record.ref_id,
    },
    context,
  );

  /* 10 — hash onto the head and append. */
  return withChainLock(async () => {
    const head = await getHead();
    const block = await buildBlock({
      index: head ? head.index + 1 : 0,
      previous_block_hash: head ? head.block_hash : GENESIS_PREV_HASH,
      record,
      submitter_public_key: publicJwk,
      signature,
      ai_flag: anomaly.flagged,
      ai_score: anomaly.score,
      ai_flag_reason: anomaly.reason,
      ai_rule: anomaly.rule,
      timestamp: input.committedAt ?? new Date().toISOString(),
    });

    await db.insert(blocks).values(blockToRow(block));
    await applyBlock(block);

    return { block, anomaly };
  });
}

/* ------------------------------------------------------------ identities */

export async function getIdentity(id: string): Promise<ActorContext | null> {
  const db = getDb();
  const [row] = await db.select().from(identities).where(eq(identities.id, id));
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    role: row.role as Role,
    factoryId: row.factoryId,
  };
}

export { EVENT_FAMILY, canonicalJson };
