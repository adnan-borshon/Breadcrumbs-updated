/**
 * The signing path.
 *
 * Every write in this application — an audit record, a stock movement, a contract
 * signature, an invoice, a payment, an auditor's decision — goes through here. The record
 * is normalised, canonicalised, signed with the non-extractable device key, and posted.
 *
 * The four stages below are the ones surfaced in the submit UI. They are real stages of
 * real work, not a decorative progress bar.
 */

import { canonicalJson, dataSchemaFor, signRecord, DEFAULT_CHAIN_ID, GENESIS_PREV_HASH } from '@breadcrumbs/shared';
import type { EventType, SignedRecord } from '@breadcrumbs/shared';

import { api, type CommitResponse } from './api.ts';
import { useSession } from '../store/session.ts';

export type CommitStage = 'validating' | 'signing' | 'committing' | 'done';

export interface CommitEventInput {
  eventType: EventType;
  factoryId: string;
  dataFields: Record<string, unknown>;
  refId?: string | null;
  eventId?: string;
  /** Called as each stage begins, so the UI can show what is actually happening. */
  onStage?: (stage: CommitStage) => void;
}

export class NotSignedInError extends Error {
  constructor() {
    super('You need to be signed in with a registered signing key to submit records.');
    this.name = 'NotSignedInError';
  }
}

/** Human-readable, collision-resistant enough for a ledger of this size. */
export function makeEventId(prefix: string): string {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(2, 12);
  const random = crypto.randomUUID().slice(0, 4).toUpperCase();
  return `${prefix}-${stamp}-${random}`;
}

export async function commitEvent(input: CommitEventInput): Promise<CommitResponse> {
  const { identity, deviceKey } = useSession.getState();
  if (!identity || !deviceKey) throw new NotSignedInError();

  input.onStage?.('validating');

  const [headRes, nonceRes] = await Promise.all([
    api.head().catch(() => ({ head: null, height: 0 })),
    api.nonce(identity.id).catch(() => ({ submitter_id: identity.id, next_nonce: 0 })),
  ]);

  const prevHash = headRes.head ? headRes.head.block_hash : GENESIS_PREV_HASH;
  const nonce = nonceRes.next_nonce;

  /*
    Normalise before signing, not after. The server refuses a record whose data_fields
    change under schema parsing, because the signature would then cover something other
    than what gets stored. Parsing here with the *same* shared schema guarantees the two
    sides see identical bytes.
  */
  const dataFields = dataSchemaFor(input.eventType).parse(input.dataFields) as Record<string, unknown>;

  const record: SignedRecord = {
    chain_id: DEFAULT_CHAIN_ID,
    previous_block_hash: prevHash,
    nonce,
    event_id: input.eventId ?? makeEventId('EVT'),
    factory_id: input.factoryId,
    event_type: input.eventType,
    timestamp: new Date().toISOString(),
    submitter_id: identity.id,
    submitter_name: identity.name,
    submitter_role: identity.role,
    data_fields: dataFields,
    ref_id: input.refId ?? null,
  };

  input.onStage?.('signing');
  const signature = await signRecord(record, deviceKey.privateKey);

  input.onStage?.('committing');
  const response = await api.commit({
    record,
    signature,
    key_fingerprint: deviceKey.fingerprint,
  });

  input.onStage?.('done');
  return response;
}

/** Exposed so the record detail page can show exactly what bytes were signed. */
export function signedPayloadOf(record: SignedRecord): string {
  return canonicalJson(record);
}
