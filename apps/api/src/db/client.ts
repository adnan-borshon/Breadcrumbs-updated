import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createClient, type Client } from '@libsql/client';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';

import { DB_FILE } from '../config.ts';
import * as schema from './schema.ts';

export type Database = LibSQLDatabase<typeof schema>;

let client: Client | null = null;
let database: Database | null = null;

function fileUrl(path: string): string {
  // libsql wants a URL. `file:` plus an absolute path works on Windows and POSIX alike.
  return `file:${path.replace(/\\/g, '/')}`;
}

export function getClient(): Client {
  if (!client) {
    if (DB_FILE !== ':memory:') mkdirSync(dirname(DB_FILE), { recursive: true });
    client = createClient({
      url: DB_FILE === ':memory:' ? 'file::memory:' : fileUrl(DB_FILE),
    });
  }
  return client;
}

export function getDb(): Database {
  if (!database) database = drizzle(getClient(), { schema });
  return database;
}

/** Applies the DDL. Idempotent — every statement is CREATE ... IF NOT EXISTS. */
export async function applySchema(): Promise<void> {
  const raw = getClient();
  await raw.execute('PRAGMA foreign_keys = ON');
  for (const statement of schema.DDL) {
    await raw.execute(statement);
  }
}

export async function closeDb(): Promise<void> {
  client?.close();
  client = null;
  database = null;
}

/**
 * Used by the test suite to point at a throwaway in-memory database.
 * Not reachable from the server, which always reads DB_FILE from config.
 */
export async function useInMemoryDatabase(): Promise<void> {
  await closeDb();
  client = createClient({ url: 'file::memory:' });
  database = drizzle(client, { schema });
  await applySchema();
}
