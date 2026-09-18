import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { publicKeyFingerprint, canonicalJson, verifyPayload } from '@breadcrumbs/shared';

import { getDb } from '../db/client.ts';
import { deviceKeys, identities } from '../db/schema.ts';
import { LedgerError } from '../chain/ledger.ts';
import { issueToken, requireAuth, type AppEnv } from '../middleware/auth.ts';

export const authRoutes = new Hono<AppEnv>();

/** Identities available to sign in as. Mocked auth, so this is the whole directory. */
authRoutes.get('/identities', async (c) => {
  const rows = await getDb().select().from(identities);
  return c.json({
    identities: rows.map((r) => ({
      id: r.id,
      name: r.name,
      role: r.role,
      org: r.org,
      factory_id: r.factoryId,
    })),
  });
});

const loginSchema = z.object({ identity_id: z.string().min(1) });

authRoutes.post('/login', async (c) => {
  const body = loginSchema.parse(await c.req.json());
  const [row] = await getDb()
    .select()
    .from(identities)
    .where(eq(identities.id, body.identity_id));

  if (!row) throw new LedgerError(404, 'unknown_identity', 'No such identity.');

  const actor = {
    id: row.id,
    name: row.name,
    role: row.role as 'factory' | 'auditor' | 'brand',
    factoryId: row.factoryId,
  };

  return c.json({
    token: await issueToken(actor),
    identity: {
      id: row.id,
      name: row.name,
      role: row.role,
      org: row.org,
      factory_id: row.factoryId,
    },
  });
});

const registerKeySchema = z.object({
  public_key_jwk: z.object({}).loose(),
  label: z.string().min(1).max(80).default('Browser device'),
  pop_signature: z.string().optional(),
});

/**
 * Binds a browser-generated public key to the signed-in identity.
 *
 * Only the public half ever arrives here — the private key is generated non-extractable
 * in the browser and cannot leave it. Registering the same key twice is a no-op, so a
 * returning device just re-announces itself.
 * If pop_signature is provided, it verifies proof-of-possession of the private key.
 */
authRoutes.post('/register-key', requireAuth, async (c) => {
  const actor = c.get('actor');
  const body = registerKeySchema.parse(await c.req.json());
  const jwk = body.public_key_jwk as JsonWebKey;

  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.x || !jwk.y) {
    throw new LedgerError(400, 'bad_key', 'Expected an EC P-256 public JWK.');
  }
  if ('d' in jwk) {
    throw new LedgerError(
      400,
      'private_key_submitted',
      'That JWK contains a private key. Only the public half may be registered.',
    );
  }

  // Optional Proof-of-Possession: verifies caller holds the private key
  if (body.pop_signature) {
    const challenge = canonicalJson({ action: 'register-key', identity_id: actor.id });
    const popValid = await verifyPayload(jwk, challenge, body.pop_signature);
    if (!popValid) {
      throw new LedgerError(401, 'bad_pop_signature', 'Proof-of-possession signature failed to verify.');
    }
  }

  const fingerprint = await publicKeyFingerprint(jwk);
  const db = getDb();

  const [existing] = await db
    .select()
    .from(deviceKeys)
    .where(eq(deviceKeys.fingerprint, fingerprint));

  if (existing) {
    if (existing.identityId !== actor.id) {
      throw new LedgerError(409, 'key_in_use', 'That key is registered to another identity.');
    }
    return c.json({ fingerprint, label: existing.label, reused: true });
  }

  await db.insert(deviceKeys).values({
    id: crypto.randomUUID(),
    identityId: actor.id,
    publicKeyJson: canonicalJson(jwk),
    fingerprint,
    label: body.label,
    createdAt: new Date().toISOString(),
    revokedAt: null,
  });

  return c.json({ fingerprint, label: body.label, reused: false }, 201);
});

const revokeKeySchema = z.object({
  fingerprint: z.string().min(1),
});

/**
 * Revokes a registered key so it can no longer sign on-chain transactions.
 */
authRoutes.post('/revoke-key', requireAuth, async (c) => {
  const actor = c.get('actor');
  const body = revokeKeySchema.parse(await c.req.json());
  const db = getDb();

  const [key] = await db
    .select()
    .from(deviceKeys)
    .where(eq(deviceKeys.fingerprint, body.fingerprint));

  if (!key) {
    throw new LedgerError(404, 'unknown_key', 'That signing key is not registered.');
  }
  if (key.identityId !== actor.id) {
    throw new LedgerError(403, 'not_key_owner', 'You do not own that key.');
  }
  if (key.revokedAt) {
    return c.json({ fingerprint: key.fingerprint, revoked: true, already_revoked: true });
  }

  const now = new Date().toISOString();
  await db
    .update(deviceKeys)
    .set({ revokedAt: now })
    .where(eq(deviceKeys.fingerprint, body.fingerprint));

  return c.json({ fingerprint: key.fingerprint, revoked: true, revoked_at: now });
});

authRoutes.get('/me', requireAuth, async (c) => {
  const actor = c.get('actor');
  const keys = await getDb()
    .select()
    .from(deviceKeys)
    .where(eq(deviceKeys.identityId, actor.id));

  return c.json({
    identity: {
      id: actor.id,
      name: actor.name,
      role: actor.role,
      factory_id: actor.factoryId,
    },
    keys: keys.map((k) => ({
      fingerprint: k.fingerprint,
      label: k.label,
      created_at: k.createdAt,
      status: k.revokedAt ? ('revoked' as const) : ('active' as const),
      revoked_at: k.revokedAt ?? null,
    })),
  });
});
