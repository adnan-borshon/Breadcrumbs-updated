import { beforeEach, describe, expect, it } from 'vitest';
import { verifyPayload, canonicalJson } from '@breadcrumbs/shared';

import { createApp } from '../src/app.ts';
import { commit } from '../src/chain/ledger.ts';
import { issueToken } from '../src/middleware/auth.ts';
import { buildRecord, emptyLedger, makeFactory, makeSigner, sign, type TestSigner } from './helpers.ts';

const INSPECTION = {
  inspection_type: 'Social compliance audit',
  workers_present: 100,
  working_hours: 400,
  non_conformities: 0,
  passed: true,
  findings: '',
};

let factoryUserA: TestSigner;
let factoryUserB: TestSigner;

beforeEach(async () => {
  await emptyLedger();
  await makeFactory('FAC-A', 'Factory A');
  await makeFactory('FAC-B', 'Factory B');
  factoryUserA = await makeSigner('u-fac-a', 'Amina Rahman', 'factory', 'FAC-A');
  factoryUserB = await makeSigner('u-fac-b', 'Tanvir Hossain', 'factory', 'FAC-B');
});

describe('export & receipts', () => {
  it('generates a valid, self-contained cryptographic proof receipt', async () => {
    const app = createApp();
    const record = buildRecord(factoryUserA, 'inspection', 'FAC-A', INSPECTION);
    const commitResult = await commit({
      record,
      signature: await sign(record, factoryUserA),
      keyFingerprint: factoryUserA.fingerprint,
      actor: factoryUserA.actor,
    });

    const res = await app.request(`/api/export/receipt/${record.event_id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('application/json');

    const receipt = await res.json();
    expect(receipt.event_id).toBe(record.event_id);
    expect(receipt.block.index).toBe(commitResult.block.index);
    expect(receipt.attestation.submitter_id).toBe(factoryUserA.actor.id);
    expect(receipt.attestation.signature).toBe(commitResult.block.signature);

    // Verify the receipt's own ECDSA signature against its public key JWK
    const valid = await verifyPayload(
      receipt.attestation.public_key_jwk,
      canonicalJson(receipt.record),
      receipt.attestation.signature,
    );
    expect(valid).toBe(true);
  });

  it('exports transactions as CSV', async () => {
    const app = createApp();
    const record = buildRecord(factoryUserA, 'inspection', 'FAC-A', INSPECTION);
    await commit({
      record,
      signature: await sign(record, factoryUserA),
      keyFingerprint: factoryUserA.fingerprint,
      actor: factoryUserA.actor,
    });

    const res = await app.request('/api/export/transactions?format=csv');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/csv');

    const csv = await res.text();
    expect(csv).toContain('event_id,block_index,timestamp');
    expect(csv).toContain(record.event_id);
  });

  it('enforces role-based scoping when exporting transactions', async () => {
    const app = createApp();

    // Commit a record for Factory A
    const recordA = buildRecord(factoryUserA, 'inspection', 'FAC-A', INSPECTION);
    await commit({
      record: recordA,
      signature: await sign(recordA, factoryUserA),
      keyFingerprint: factoryUserA.fingerprint,
      actor: factoryUserA.actor,
    });

    // Commit a record for Factory B
    const recordB = buildRecord(factoryUserB, 'inspection', 'FAC-B', INSPECTION);
    await commit({
      record: recordB,
      signature: await sign(recordB, factoryUserB),
      keyFingerprint: factoryUserB.fingerprint,
      actor: factoryUserB.actor,
    });

    // Factory User A exports with their JWT
    const tokenA = await issueToken(factoryUserA.actor);
    const resA = await app.request('/api/export/transactions?format=json', {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    expect(resA.status).toBe(200);

    const dataA = await resA.json();
    const eventIdsA = dataA.transactions.map((t: { event_id: string }) => t.event_id);
    expect(eventIdsA).toContain(recordA.event_id);
    expect(eventIdsA).not.toContain(recordB.event_id); // Cannot see Factory B
  });

  it('supports pagination, status filtering, and sorting in /api/transactions', async () => {
    const app = createApp();

    const record1 = buildRecord(factoryUserA, 'inspection', 'FAC-A', INSPECTION);
    await commit({
      record: record1,
      signature: await sign(record1, factoryUserA),
      keyFingerprint: factoryUserA.fingerprint,
      actor: factoryUserA.actor,
    });

    const record2 = buildRecord(factoryUserA, 'production_report', 'FAC-A', {
      order_ref: 'PO-991',
      units_produced: 500,
      working_hours: 8,
      line_count: 2,
      defect_count: 2,
    });
    await commit({
      record: record2,
      signature: await sign(record2, factoryUserA),
      keyFingerprint: factoryUserA.fingerprint,
      actor: factoryUserA.actor,
    });

    // Test pagination & sorting
    const resPaged = await app.request('/api/transactions?page=1&limit=1&sortOrder=asc');
    expect(resPaged.status).toBe(200);
    const paged = await resPaged.json();
    expect(paged.transactions.length).toBe(1);
    expect(paged.total).toBe(2);
    expect(paged.page).toBe(1);
    expect(paged.totalPages).toBe(2);
    // Oldest first: record1 was committed first
    expect(paged.transactions[0].event_id).toBe(record1.event_id);

    // Test status filtering
    const resStatus = await app.request('/api/transactions?status=pending');
    expect(resStatus.status).toBe(200);
    const statusData = await resStatus.json();
    expect(statusData.transactions.length).toBe(2);
  });
});

