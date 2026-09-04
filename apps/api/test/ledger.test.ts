/** The commit pipeline: permissions, non-repudiation, and immutability. */

import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { generateKeyPair, signRecord } from '@breadcrumbs/shared';

import { commit, getHeight, LedgerError, verifyLedger } from '../src/chain/ledger.ts';
import { getDb } from '../src/db/client.ts';
import { blocks, pRecords } from '../src/db/schema.ts';
import { buildRecord, emptyLedger, makeFactory, makeSigner, sign, type TestSigner } from './helpers.ts';

const INSPECTION = {
  inspection_type: 'Social compliance audit',
  workers_present: 100,
  working_hours: 400,
  non_conformities: 0,
  passed: true,
  findings: '',
};

let factoryUser: TestSigner;
let auditor: TestSigner;
let brand: TestSigner;

beforeEach(async () => {
  await emptyLedger();
  await makeFactory('FAC-A', 'Factory A');
  await makeFactory('FAC-B', 'Factory B');
  factoryUser = await makeSigner('u-fac', 'Amina Rahman', 'factory', 'FAC-A');
  auditor = await makeSigner('u-aud', 'Farhana Chowdhury', 'auditor');
  brand = await makeSigner('u-brand', 'Lena Bergström', 'brand');
});

async function commitAs(signer: TestSigner, record = buildRecord(signer, 'inspection', 'FAC-A', INSPECTION)) {
  return commit({
    record,
    signature: await sign(record, signer),
    keyFingerprint: signer.fingerprint,
    actor: signer.actor,
  });
}

describe('a well-formed commit', () => {
  it('appends a verifiable block', async () => {
    const before = await getHeight();
    const { block } = await commitAs(factoryUser);

    expect(block.index).toBe(before);
    expect(await getHeight()).toBe(before + 1);
    expect((await verifyLedger()).ok).toBe(true);
  });
});

describe('permissions', () => {
  it('refuses an event type outside the role', async () => {
    // A factory cannot settle payments.
    const record = buildRecord(factoryUser, 'payment_settled', 'FAC-A', {
      payment_id: 'P1',
      invoice_id: 'I1',
      amount_minor: 1000,
    });

    await expect(commitAs(factoryUser, record)).rejects.toMatchObject({
      status: 403,
      code: 'forbidden_event_type',
    });
  });

  it('refuses an auditor issuing an invoice', async () => {
    const record = buildRecord(auditor, 'invoice_issued', 'FAC-A', {
      invoice_id: 'I1',
      contract_id: 'C1',
      currency: 'USD',
      line_items: [{ description: 'x', quantity: 1, unit_price_minor: 100, amount_minor: 100 }],
      subtotal_minor: 100,
      tax_minor: 0,
      total_minor: 100,
      due_date: '2026-12-01',
    });

    await expect(commitAs(auditor, record)).rejects.toMatchObject({ status: 403 });
  });

  it('confines a factory user to their own factory', async () => {
    const record = buildRecord(factoryUser, 'inspection', 'FAC-B', INSPECTION);
    await expect(commitAs(factoryUser, record)).rejects.toMatchObject({
      status: 403,
      code: 'wrong_factory',
    });
  });

  it('refuses a genesis block submitted through the commit endpoint', async () => {
    const record = buildRecord(factoryUser, 'genesis', 'FAC-A', { note: 'x', chain: 'y' });
    await expect(commitAs(factoryUser, record)).rejects.toMatchObject({ status: 403 });
  });
});

describe('non-repudiation', () => {
  it('rejects a signature produced by a different key', async () => {
    const record = buildRecord(factoryUser, 'inspection', 'FAC-A', INSPECTION);
    const impostor = await generateKeyPair(true);

    await expect(
      commit({
        record,
        signature: await signRecord(record, impostor.privateKey),
        keyFingerprint: factoryUser.fingerprint,
        actor: factoryUser.actor,
      }),
    ).rejects.toMatchObject({ status: 401, code: 'bad_signature' });

    // Nothing was written.
    expect(await getHeight()).toBe(1);
  });

  it('rejects a record altered after signing', async () => {
    const record = buildRecord(factoryUser, 'inspection', 'FAC-A', INSPECTION);
    const signature = await sign(record, factoryUser);

    const altered = { ...record, data_fields: { ...INSPECTION, non_conformities: 99 } };

    await expect(
      commit({
        record: altered,
        signature,
        keyFingerprint: factoryUser.fingerprint,
        actor: factoryUser.actor,
      }),
    ).rejects.toMatchObject({ status: 401, code: 'bad_signature' });
  });

  it('refuses a record claiming an identity other than the caller', async () => {
    const record = buildRecord(factoryUser, 'inspection', 'FAC-A', INSPECTION, {
      submitter_name: 'Someone Else',
    });

    await expect(commitAs(factoryUser, record)).rejects.toMatchObject({
      status: 403,
      code: 'identity_mismatch',
    });
  });

  it('refuses a key registered to another identity', async () => {
    const record = buildRecord(factoryUser, 'inspection', 'FAC-A', INSPECTION);

    await expect(
      commit({
        record,
        signature: await sign(record, factoryUser),
        keyFingerprint: auditor.fingerprint,
        actor: factoryUser.actor,
      }),
    ).rejects.toMatchObject({ status: 401, code: 'key_owner_mismatch' });
  });

  it('refuses an unregistered key', async () => {
    const record = buildRecord(factoryUser, 'inspection', 'FAC-A', INSPECTION);
    await expect(
      commit({
        record,
        signature: await sign(record, factoryUser),
        keyFingerprint: 'deadbeefdeadbeef',
        actor: factoryUser.actor,
      }),
    ).rejects.toMatchObject({ status: 401, code: 'unknown_key' });
  });
});

describe('validation', () => {
  it('rejects data_fields that do not match the event schema', async () => {
    const record = buildRecord(factoryUser, 'inspection', 'FAC-A', { nonsense: true });
    await expect(commitAs(factoryUser, record)).rejects.toMatchObject({
      status: 400,
      code: 'invalid_data_fields',
    });
  });

  it('rejects data_fields that schema defaults would change, since the signature would not cover the stored value', async () => {
    // `findings` has a default of ''. Omitting it means the parsed value differs from
    // the signed one, which the pipeline must refuse rather than silently normalise.
    const { findings, ...withoutFindings } = INSPECTION;
    const record = buildRecord(factoryUser, 'inspection', 'FAC-A', withoutFindings);

    await expect(commitAs(factoryUser, record)).rejects.toMatchObject({
      status: 400,
      code: 'unnormalised_data_fields',
    });
  });

  it('rejects a duplicate event id', async () => {
    const record = buildRecord(factoryUser, 'inspection', 'FAC-A', INSPECTION);
    await commitAs(factoryUser, record);
    await expect(commitAs(factoryUser, record)).rejects.toMatchObject({
      status: 409,
      code: 'duplicate_event',
    });
  });
});

describe('governance is append-only', () => {
  it('records a review as a new block, leaving the original untouched', async () => {
    const target = buildRecord(factoryUser, 'inspection', 'FAC-A', INSPECTION);
    await commitAs(factoryUser, target);

    const db = getDb();
    const [originalRow] = await db.select().from(blocks).where(eq(blocks.eventId, target.event_id));
    const originalHash = originalRow!.blockHash;
    const originalJson = originalRow!.recordJson;
    const heightBefore = await getHeight();

    const review = buildRecord(auditor, 'review_confirmed', 'FAC-A', {
      target_event_id: target.event_id,
      note: 'Checked against dispatch notes.',
    });
    await commitAs(auditor, review);

    // A new block, not a mutation.
    expect(await getHeight()).toBe(heightBefore + 1);

    const [afterRow] = await db.select().from(blocks).where(eq(blocks.eventId, target.event_id));
    expect(afterRow!.blockHash).toBe(originalHash);
    expect(afterRow!.recordJson).toBe(originalJson);

    // The projection reflects the decision.
    const [projected] = await db.select().from(pRecords).where(eq(pRecords.eventId, target.event_id));
    expect(projected!.humanReviewStatus).toBe('confirmed');
    expect(projected!.status).toBe('verified');
    expect(projected!.reviewerName).toBe('Farhana Chowdhury');

    expect((await verifyLedger()).ok).toBe(true);
  });

  it('refuses to review the same record twice', async () => {
    const target = buildRecord(factoryUser, 'inspection', 'FAC-A', INSPECTION);
    await commitAs(factoryUser, target);

    await commitAs(
      auditor,
      buildRecord(auditor, 'review_confirmed', 'FAC-A', { target_event_id: target.event_id, note: '' }),
    );

    await expect(
      commitAs(
        auditor,
        buildRecord(auditor, 'review_disputed', 'FAC-A', {
          target_event_id: target.event_id,
          note: 'changed my mind',
        }),
      ),
    ).rejects.toMatchObject({ status: 409, code: 'already_reviewed' });
  });
});

describe('domain preconditions', () => {
  it('refuses to invoice against a contract that both parties have not signed', async () => {
    const contractId = 'C-TEST-1';
    await commitAs(
      brand,
      buildRecord(brand, 'contract_created', 'FAC-A', {
        contract_id: contractId,
        title: 'Test',
        brand_id: brand.actor.id,
        factory_id: 'FAC-A',
        value_minor: 100_000,
        currency: 'USD',
        incoterm: 'FOB',
        order_quantity: 10,
        product: 'Tee',
        start_date: '2026-01-01',
        delivery_date: '2026-06-01',
      }),
    );

    const invoice = buildRecord(factoryUser, 'invoice_issued', 'FAC-A', {
      invoice_id: 'I-1',
      contract_id: contractId,
      currency: 'USD',
      line_items: [{ description: 'Tee', quantity: 10, unit_price_minor: 1000, amount_minor: 10_000 }],
      subtotal_minor: 10_000,
      tax_minor: 0,
      total_minor: 10_000,
      due_date: '2026-07-01',
    });

    await expect(commitAs(factoryUser, invoice)).rejects.toMatchObject({
      status: 422,
      code: 'contract_not_active',
    });

    // Both signatures, then it goes through.
    await commitAs(brand, buildRecord(brand, 'contract_signed', 'FAC-A', { contract_id: contractId }));
    await commitAs(
      factoryUser,
      buildRecord(factoryUser, 'contract_signed', 'FAC-A', { contract_id: contractId }),
    );

    const { block } = await commitAs(factoryUser, invoice);
    expect(block.record.event_id).toBe(invoice.event_id);
  });

  it('refuses a payment against an unknown invoice', async () => {
    const record = buildRecord(brand, 'payment_initiated', 'FAC-A', {
      payment_id: 'P-X',
      invoice_id: 'NOPE',
      amount_minor: 500,
      currency: 'USD',
      method: 'bank_transfer',
      reference: 'R1',
    });

    await expect(commitAs(brand, record)).rejects.toBeInstanceOf(LedgerError);
  });
});
