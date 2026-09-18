import {
  canonicalJson,
  DEFAULT_CHAIN_ID,
  exportPublicJwk,
  generateKeyPair,
  GENESIS_PREV_HASH,
  publicKeyFingerprint,
  signRecord,
} from '@breadcrumbs/shared';
import type { EventType, Role, SignedRecord } from '@breadcrumbs/shared';

import { useInMemoryDatabase, getDb } from '../src/db/client.ts';
import { deviceKeys, factories, identities } from '../src/db/schema.ts';
import { ensureGenesis, type ActorContext } from '../src/chain/ledger.ts';
import { resetAndSeed } from '../src/db/seed.ts';

export interface TestSigner {
  actor: ActorContext;
  privateKey: CryptoKey;
  fingerprint: string;
}

/** A throwaway in-memory ledger carrying the full demo history. */
export async function seededLedger(): Promise<void> {
  await useInMemoryDatabase();
  await resetAndSeed();
}

/** A bare in-memory ledger: genesis only, no seed data. */
export async function emptyLedger(): Promise<void> {
  await useInMemoryDatabase();
  await ensureGenesis('2026-06-01T00:00:00.000Z');
}

/** Creates an identity with a freshly generated, registered signing key. */
export async function makeSigner(
  id: string,
  name: string,
  role: Role,
  factoryId: string | null = null,
): Promise<TestSigner> {
  const db = getDb();
  const now = new Date().toISOString();

  await db
    .insert(identities)
    .values({ id, name, role, org: 'Test Org', factoryId, createdAt: now })
    .onConflictDoNothing();

  const pair = await generateKeyPair(true);
  const jwk = await exportPublicJwk(pair.publicKey);
  const fingerprint = await publicKeyFingerprint(jwk);

  await db.insert(deviceKeys).values({
    id: crypto.randomUUID(),
    identityId: id,
    publicKeyJson: canonicalJson(jwk),
    fingerprint,
    label: 'Test key',
    createdAt: now,
  });

  return { actor: { id, name, role, factoryId }, privateKey: pair.privateKey, fingerprint };
}

export async function makeFactory(id: string, name = 'Test Factory'): Promise<void> {
  await getDb()
    .insert(factories)
    .values({
      id,
      name,
      country: 'Bangladesh',
      city: 'Dhaka',
      certificationsJson: '[]',
      employeeCount: 100,
    })
    .onConflictDoNothing();
}

export function buildRecord(
  signer: TestSigner,
  eventType: EventType,
  factoryId: string,
  dataFields: Record<string, unknown>,
  overrides: Partial<SignedRecord> = {},
): SignedRecord {
  return {
    chain_id: DEFAULT_CHAIN_ID,
    event_id: `EVT-${crypto.randomUUID().slice(0, 8)}`,
    factory_id: factoryId,
    event_type: eventType,
    timestamp: new Date().toISOString(),
    submitter_id: signer.actor.id,
    submitter_name: signer.actor.name,
    submitter_role: signer.actor.role,
    data_fields: dataFields,
    ref_id: null,
    ...overrides,
  };
}

export async function sign(record: SignedRecord, signer: TestSigner): Promise<string> {
  return signRecord(record, signer.privateKey);
}
