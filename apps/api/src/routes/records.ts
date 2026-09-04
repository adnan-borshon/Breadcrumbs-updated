import { Hono } from 'hono';
import type { EventFamily, RecordStatus } from '@breadcrumbs/shared';

import { getRecord, listRecords } from '../chain/queries.ts';
import { LedgerError } from '../chain/ledger.ts';
import type { AppEnv } from '../middleware/auth.ts';

export const recordRoutes = new Hono<AppEnv>();

/**
 * The auditor's review queue: AI-flagged records with no human decision yet.
 *
 * There is deliberately no `POST /records/:id/review` endpoint. A review is a signed
 * chain event committed from the auditor's own browser via `/chain/commit` — if the
 * server could record a decision on their behalf, the auditor's signature would prove
 * nothing.
 */
recordRoutes.get('/flagged', async (c) => {
  return c.json({ records: await listRecords({ flaggedOnly: true }) });
});

recordRoutes.get('/', async (c) => {
  const family = c.req.query('family') as EventFamily | undefined;
  const status = c.req.query('status') as RecordStatus | undefined;
  const limitRaw = c.req.query('limit');

  return c.json({
    records: await listRecords({
      family: family || undefined,
      status: status || undefined,
      factoryId: c.req.query('factory') || undefined,
      eventType: c.req.query('event_type') || undefined,
      limit: limitRaw ? Number(limitRaw) : undefined,
    }),
  });
});

recordRoutes.get('/:eventId', async (c) => {
  const record = await getRecord(c.req.param('eventId'));
  if (!record) throw new LedgerError(404, 'no_such_record', 'No record with that id.');
  return c.json({ record });
});
