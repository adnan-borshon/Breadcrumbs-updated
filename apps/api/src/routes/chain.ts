import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { commitRequestSchema } from '@breadcrumbs/shared';
import type { EventFamily } from '@breadcrumbs/shared';

import { getDb } from '../db/client.ts';
import { blocks } from '../db/schema.ts';
import { commit, getHead, getHeight, LedgerError, verifyLedger } from '../chain/ledger.ts';
import { listBlockSummaries, getRecord } from '../chain/queries.ts';
import { rowToBlock } from '../chain/rows.ts';
import { requireAuth, type AppEnv } from '../middleware/auth.ts';

export const chainRoutes = new Hono<AppEnv>();

/* Reads are public — transparency is the point of the system, not a paid tier. */

chainRoutes.get('/head', async (c) => {
  const head = await getHead();
  return c.json({ head, height: await getHeight() });
});

chainRoutes.get('/blocks', async (c) => {
  const family = c.req.query('family') as EventFamily | undefined;
  const factoryId = c.req.query('factory');

  return c.json({
    blocks: await listBlockSummaries({
      family: family || undefined,
      factoryId: factoryId || undefined,
    }),
  });
});

chainRoutes.get('/blocks/:index', async (c) => {
  const index = Number(c.req.param('index'));
  if (!Number.isInteger(index)) {
    throw new LedgerError(400, 'bad_index', 'Block index must be an integer.');
  }

  const [row] = await getDb().select().from(blocks).where(eq(blocks.blockIndex, index));
  if (!row) throw new LedgerError(404, 'no_such_block', `No block at index ${index}.`);

  const block = rowToBlock(row);
  return c.json({ block, record: await getRecord(block.record.event_id) });
});

/**
 * Full-chain verification: recompute every hash, re-check every previous-hash link, and
 * re-verify every signature. Public, because a claim nobody can independently check is
 * not worth much.
 */
chainRoutes.get('/verify', async (c) => c.json(await verifyLedger()));

/**
 * The only write path into the system. Every module goes through here.
 */
chainRoutes.post('/commit', requireAuth, async (c) => {
  const actor = c.get('actor');
  const body = commitRequestSchema.parse(await c.req.json());

  const result = await commit({
    record: body.record,
    signature: body.signature,
    keyFingerprint: body.key_fingerprint,
    actor,
  });

  return c.json(
    {
      block: result.block,
      anomaly: result.anomaly,
      record: await getRecord(result.block.record.event_id),
    },
    201,
  );
});
