import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { CHAIN_ID } from './config.ts';
import { getHeight } from './chain/ledger.ts';
import { optionalAuth, type AppEnv } from './middleware/auth.ts';
import { onError } from './middleware/error.ts';
import { authRoutes } from './routes/auth.ts';
import { chainRoutes } from './routes/chain.ts';
import { recordRoutes } from './routes/records.ts';
import {
  contractRoutes,
  inventoryRoutes,
  invoiceRoutes,
  paymentRoutes,
  transactionRoutes,
} from './routes/commerce.ts';
import { publicRoutes } from './routes/publicRoutes.ts';
import { adminRoutes } from './routes/admin.ts';
import { exportRoutes } from './routes/export.ts';
import { listFactories, listFactoryTrust } from './chain/queries.ts';

export function createApp() {
  const app = new Hono<AppEnv>();

  app.onError(onError);
  app.use('*', cors({ origin: (origin) => origin ?? '*', credentials: true }));
  app.use('/api/*', optionalAuth);

  app.get('/api/health', async (c) =>
    c.json({ ok: true, chain: CHAIN_ID, height: await getHeight() }),
  );

  app.get('/api/factories', async (c) => {
    const [factories, trust] = await Promise.all([listFactories(), listFactoryTrust()]);
    const trustById = new Map(trust.map((t) => [t.factory_id, t]));
    return c.json({ factories: factories.map((f) => ({ ...f, trust: trustById.get(f.id) ?? null })) });
  });

  app.route('/api/auth', authRoutes);
  app.route('/api/chain', chainRoutes);
  app.route('/api/records', recordRoutes);
  app.route('/api/inventory', inventoryRoutes);
  app.route('/api/contracts', contractRoutes);
  app.route('/api/invoices', invoiceRoutes);
  app.route('/api/payments', paymentRoutes);
  app.route('/api/transactions', transactionRoutes);
  app.route('/api/export', exportRoutes);
  app.route('/api/public', publicRoutes);
  app.route('/api/admin', adminRoutes);

  app.notFound((c) =>
    c.json({ error: { code: 'not_found', message: 'No such endpoint.' } }, 404),
  );

  return app;
}
