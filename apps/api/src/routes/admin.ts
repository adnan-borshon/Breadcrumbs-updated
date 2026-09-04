/**
 * Demo controls.
 *
 * These exist so the trust layer can be *seen* working. In particular `/tamper` is the
 * only code in the app that mutates a committed block — it edits a record's data in place
 * and deliberately leaves the stored hash alone, which is exactly what an attacker with
 * database access would do. Verification then has something real to catch.
 *
 * Set BREADCRUMBS_ADMIN_TOOLS=false to switch the whole group off.
 */

import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { canonicalJson } from '@breadcrumbs/shared';
import type { SignedRecord } from '@breadcrumbs/shared';

import { ENABLE_ADMIN_TOOLS } from '../config.ts';
import { getDb } from '../db/client.ts';
import { blocks } from '../db/schema.ts';
import { LedgerError, verifyLedger } from '../chain/ledger.ts';
import { rebuildProjections } from '../chain/projections.ts';
import { resetAndSeed } from '../db/seed.ts';
import type { AppEnv } from '../middleware/auth.ts';

export const adminRoutes = new Hono<AppEnv>();

adminRoutes.use('*', async (c, next) => {
  if (!ENABLE_ADMIN_TOOLS) {
    throw new LedgerError(404, 'admin_disabled', 'Demo controls are disabled.');
  }
  await next();
});

const tamperSchema = z.object({
  block_index: z.number().int().min(1),
});

/** Rewrites a committed record without recomputing its hash. */
adminRoutes.post('/tamper', async (c) => {
  const body = tamperSchema.parse(await c.req.json());
  const db = getDb();

  const [row] = await db.select().from(blocks).where(eq(blocks.blockIndex, body.block_index));
  if (!row) {
    throw new LedgerError(404, 'no_such_block', `No block at index ${body.block_index}.`);
  }

  const record = JSON.parse(row.recordJson) as SignedRecord;
  const fields = { ...record.data_fields };

  const isNumber = (k: string) => typeof fields[k] === 'number' && Number.isFinite(fields[k] as number);

  /* Prefer a field that actually drives a projection: altering a quantity or an amount
     corrupts the derived stock level or invoice balance as well as the hash, which shows
     that tampering does not stay contained to the one row it touched. */
  const HIGH_SIGNAL = [
    'quantity',
    'units_produced',
    'total_minor',
    'amount_minor',
    'value_minor',
    'units_processed',
    'subtotal_minor',
    'cartons',
  ];

  const numericKey =
    HIGH_SIGNAL.find((k) => k in fields && isNumber(k)) ?? Object.keys(fields).find(isNumber);
  const stringKey = Object.keys(fields).find((k) => typeof fields[k] === 'string');

  let field: string;
  let before: unknown;
  let after: unknown;

  if (numericKey) {
    field = numericKey;
    before = fields[numericKey];
    after = (before as number) * 10;
    fields[numericKey] = after;
  } else if (stringKey) {
    field = stringKey;
    before = fields[stringKey];
    after = `${before as string} (altered)`;
    fields[stringKey] = after;
  } else {
    throw new LedgerError(422, 'nothing_to_tamper', 'That block has no alterable data fields.');
  }

  const tampered: SignedRecord = { ...record, data_fields: fields };

  // Only record_json changes. block_hash and signature are left exactly as they were,
  // which is what makes the tampering detectable.
  await db
    .update(blocks)
    .set({ recordJson: canonicalJson(tampered) })
    .where(eq(blocks.blockIndex, body.block_index));

  await rebuildProjections();

  return c.json({
    tampered: {
      block_index: body.block_index,
      event_id: record.event_id,
      field,
      before,
      after,
    },
    report: await verifyLedger(),
  });
});

/** Wipes everything and lays the demo ledger down again from scratch. */
adminRoutes.post('/restore', async (c) => {
  const result = await resetAndSeed();
  return c.json({ restored: true, ...result, report: await verifyLedger() });
});

/**
 * Drops every projection and recomputes it from the blocks alone.
 *
 * If the numbers on screen change after calling this, the projections had drifted from
 * the chain and were not, in fact, derived from it.
 */
adminRoutes.post('/rebuild', async (c) => {
  const result = await rebuildProjections();
  return c.json({ rebuilt: true, ...result });
});
