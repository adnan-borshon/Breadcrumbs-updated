import { serve } from '@hono/node-server';

import { createApp } from './app.ts';
import { DB_FILE, PORT, SEED_ON_EMPTY } from './config.ts';
import { applySchema } from './db/client.ts';
import { ensureGenesis, getHeight, verifyLedger } from './chain/ledger.ts';

async function main() {
  await applySchema();
  await ensureGenesis();

  // An empty ledger is seeded once. An existing one is never touched — the chain is
  // append-only, and silently reseeding over real history would be the worst thing
  // this service could do.
  if (SEED_ON_EMPTY && (await getHeight()) <= 1) {
    console.log('  empty ledger — laying down the demo history…');
    const { seedDatabase } = await import('./db/seed.ts');
    const result = await seedDatabase();
    console.log(`  seeded ${result.blocks} blocks, ${result.flagged} flagged`);
  }

  const app = createApp();
  const height = await getHeight();
  const report = await verifyLedger();

  serve({ fetch: app.fetch, port: PORT }, (info) => {
    console.log(`\n  Breadcrumbs API  http://localhost:${info.port}`);
    console.log(`  database         ${DB_FILE}`);
    console.log(`  chain height     ${height} block${height === 1 ? '' : 's'}`);
    console.log(
      `  integrity        ${
        report.ok ? 'verified — every hash, link and signature checks out' : `BROKEN at block ${report.firstBreakIndex}`
      }\n`,
    );
    if (height <= 1) {
      console.log('  Ledger is empty. Run `npm run db:seed` for the demo history.\n');
    }
  });
}

main().catch((error) => {
  console.error('failed to start:', error);
  process.exit(1);
});
