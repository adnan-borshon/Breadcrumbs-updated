/**
 * Export and receipt download routes.
 *
 * Provides:
 *  - /api/export/receipt/:eventId: Downloadable self-contained cryptographic proof receipt.
 *  - /api/export/transactions: Filtered CSV and JSON exports of ledger transactions with role-based scoping.
 */

import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import {
  canonicalJson,
  publicKeyFingerprint,
  recordPayload,
  sha256Hex,
} from '@breadcrumbs/shared';
import type { EventFamily, LedgerRecord, RecordStatus } from '@breadcrumbs/shared';

import { getDb } from '../db/client.ts';
import { blocks } from '../db/schema.ts';
import { getRecord, listRecords } from '../chain/queries.ts';
import { getHeight, LedgerError } from '../chain/ledger.ts';
import { rowToBlock } from '../chain/rows.ts';
import { optionalAuth, type AppEnv } from '../middleware/auth.ts';

export const exportRoutes = new Hono<AppEnv>();

/**
 * Download a standalone, offline-verifiable cryptographic receipt for a specific record.
 */
exportRoutes.get('/receipt/:eventId', async (c) => {
  const eventId = c.req.param('eventId');
  const db = getDb();

  const [row] = await db.select().from(blocks).where(eq(blocks.eventId, eventId));
  if (!row) {
    throw new LedgerError(404, 'no_such_record', `No ledger block found for event ${eventId}.`);
  }

  const block = rowToBlock(row);
  const hydratedRecord = await getRecord(eventId);
  const payloadStr = recordPayload(block.record);
  const payloadHash = await sha256Hex(payloadStr);

  const jwk = block.submitter_public_key;
  const keyFingerprint = jwk ? await publicKeyFingerprint(jwk) : null;

  const receipt = {
    receipt_version: 'breadcrumbs-receipt-v1',
    exported_at: new Date().toISOString(),
    event_id: block.record.event_id,
    block: {
      index: block.index,
      block_hash: block.block_hash,
      previous_block_hash: block.previous_block_hash,
      timestamp: block.timestamp,
    },
    record: block.record,
    attestation: {
      algorithm: 'ECDSA-P256-SHA256',
      submitter_id: block.record.submitter_id,
      submitter_name: block.record.submitter_name,
      submitter_role: block.record.submitter_role,
      public_key_jwk: jwk,
      key_fingerprint: keyFingerprint,
      signature: block.signature,
      signed_payload_sha256: payloadHash,
    },
    governance: {
      status: hydratedRecord?.status ?? (block.ai_flag ? 'flagged' : 'pending'),
      human_review_status: hydratedRecord?.human_review_status ?? 'none',
      reviewer_name: hydratedRecord?.reviewer_name ?? null,
      reviewed_at: hydratedRecord?.reviewed_at ?? null,
      ai_flag: block.ai_flag,
      ai_score: block.ai_score,
      ai_rule: block.ai_rule,
      ai_flag_reason: block.ai_flag_reason,
    },
    verification_guide: {
      description:
        'This receipt is verifiable completely offline using standard WebCrypto or OpenSSL.',
      steps: [
        '1. Recompute canonical JSON of the `record` object (keys sorted recursively, no whitespace).',
        '2. Verify `attestation.signature` against `attestation.public_key_jwk` over the canonical record bytes using ECDSA with SHA-256.',
        '3. Recompute block_hash using canonical JSON of { index, timestamp, previous_block_hash, record, submitter_public_key, signature, ai_flag, ai_score, ai_flag_reason, ai_rule } and SHA-256.',
      ],
    },
  };

  const filename = `${eventId}-receipt.json`;
  return new Response(JSON.stringify(receipt, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
});

/** Helper to escape values for CSV */
function escapeCsv(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Export filtered transactions as CSV or JSON with role-based data security.
 */
exportRoutes.get('/transactions', optionalAuth, async (c) => {
  const actor = c.get('actor');
  const format = (c.req.query('format') ?? 'json').toLowerCase();
  const family = c.req.query('family') as EventFamily | undefined;
  const status = c.req.query('status') as RecordStatus | undefined;
  const term = (c.req.query('q') ?? '').toLowerCase().trim();

  // Role-based visibility scoping: Factory users can only see/export their own factory records
  let factoryId = c.req.query('factory') || undefined;
  if (actor && actor.role === 'factory' && actor.factoryId) {
    factoryId = actor.factoryId;
  }

  const all = await listRecords({
    family: family || undefined,
    status: status || undefined,
    factoryId,
  });

  const matched = term
    ? all.filter((r) =>
        [r.event_id, r.factory_name, r.submitter_name, r.event_type, JSON.stringify(r.data_fields)]
          .join(' ')
          .toLowerCase()
          .includes(term),
      )
    : all;

  if (format === 'csv') {
    const headers = [
      'event_id',
      'block_index',
      'timestamp',
      'event_type',
      'event_family',
      'factory_id',
      'factory_name',
      'submitter_id',
      'submitter_name',
      'submitter_role',
      'status',
      'ai_flag',
      'ai_rule',
      'human_review_status',
      'reviewer_name',
      'block_hash',
      'previous_block_hash',
      'data_fields',
    ];

    const rows = matched.map((r) => [
      r.event_id,
      r.block_index,
      r.timestamp,
      r.event_type,
      r.event_family,
      r.factory_id,
      r.factory_name,
      r.submitter_id,
      r.submitter_name,
      r.submitter_role,
      r.status,
      r.ai_flag ? 'true' : 'false',
      r.ai_rule ?? '',
      r.human_review_status,
      r.reviewer_name ?? '',
      r.block_hash,
      r.previous_block_hash,
      r.data_fields,
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map((row) => row.map(escapeCsv).join(',')),
    ].join('\r\n');

    return new Response(csvContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="breadcrumbs-ledger-export.csv"',
      },
    });
  }

  // JSON format
  const exportPayload = {
    exported_at: new Date().toISOString(),
    total_records: matched.length,
    chain_height: await getHeight(),
    filters: {
      family: family ?? null,
      status: status ?? null,
      factory: factoryId ?? null,
      query: term || null,
    },
    transactions: matched,
  };

  return new Response(JSON.stringify(exportPayload, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': 'attachment; filename="breadcrumbs-ledger-export.json"',
    },
  });
});
