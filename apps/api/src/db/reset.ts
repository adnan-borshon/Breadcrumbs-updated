/** `npm run db:reset` — drops all data, recreates the schema, reseeds the demo ledger. */

import { closeDb } from './client.ts';
import { resetAndSeed } from './seed.ts';
import { verifyLedger } from '../chain/ledger.ts';
import { DB_FILE } from '../config.ts';

try {
  const result = await resetAndSeed();
  const report = await verifyLedger();

  console.log(`\n  ledger reset -> ${DB_FILE}`);
  console.log(`  ${result.blocks} blocks, ${result.flagged} flagged`);
  console.log(`  integrity: ${report.ok ? 'verified' : `BROKEN at block ${report.firstBreakIndex}`}`);
  if (result.skipped.length) {
    console.log(`\n  ${result.skipped.length} event(s) rejected:`);
    for (const s of result.skipped) console.log(`    - ${s.event_id}: ${s.reason}`);
  }
  console.log('');
  await closeDb();
} catch (error) {
  console.error('reset failed:', error);
  await closeDb();
  process.exit(1);
}
