/** `npm run db:migrate` — creates the schema if it isn't there yet. */

import { applySchema, closeDb } from './client.ts';
import { DB_FILE } from '../config.ts';

const isEntrypoint = process.argv[1]?.replace(/\\/g, '/').endsWith('db/migrate.ts');

export async function migrate(): Promise<void> {
  await applySchema();
}

if (isEntrypoint) {
  migrate()
    .then(async () => {
      console.log(`schema applied -> ${DB_FILE}`);
      await closeDb();
    })
    .catch(async (error) => {
      console.error('migration failed:', error);
      await closeDb();
      process.exit(1);
    });
}
