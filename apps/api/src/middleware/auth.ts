/**
 * Bearer-token auth.
 *
 * Login itself is mocked — pick an identity, no password — but everything downstream of
 * the token is enforced for real. The token is what the commit pipeline checks the signed
 * record against, so a caller cannot submit under someone else's name even with a valid
 * token of their own.
 */

import { SignJWT, jwtVerify } from 'jose';
import type { Context, MiddlewareHandler, Next } from 'hono';
import type { Role } from '@breadcrumbs/shared';

import { JWT_AUDIENCE, JWT_ISSUER, JWT_SECRET, TOKEN_TTL } from '../config.ts';
import { getIdentity, LedgerError, type ActorContext } from '../chain/ledger.ts';

export interface AppEnv {
  Variables: {
    actor: ActorContext;
  };
}

export async function issueToken(actor: ActorContext): Promise<string> {
  return new SignJWT({
    name: actor.name,
    role: actor.role,
    factory_id: actor.factoryId,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(actor.id)
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(TOKEN_TTL)
    .sign(JWT_SECRET);
}

function bearer(c: Context): string | null {
  const header = c.req.header('Authorization');
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice(7).trim() || null;
}

/**
 * Resolves the actor from the token if one is present, but does not require it.
 * Public pages (explorer, lookup, record detail) run through this.
 */
export const optionalAuth: MiddlewareHandler<AppEnv> = async (c, next: Next) => {
  const token = bearer(c);
  if (token) {
    try {
      const { payload } = await jwtVerify(token, JWT_SECRET, {
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
      });
      // The token carries a claim; the database is what actually decides the role.
      const identity = await getIdentity(String(payload.sub));
      if (identity) c.set('actor', identity);
    } catch {
      // An invalid token is treated as no token on public routes.
    }
  }
  await next();
};

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next: Next) => {
  if (!c.get('actor')) {
    throw new LedgerError(401, 'unauthenticated', 'Sign in to continue.');
  }
  await next();
};

export function requireRole(...roles: Role[]): MiddlewareHandler<AppEnv> {
  return async (c, next: Next) => {
    const actor = c.get('actor');
    if (!actor) throw new LedgerError(401, 'unauthenticated', 'Sign in to continue.');
    if (!roles.includes(actor.role)) {
      throw new LedgerError(
        403,
        'forbidden_role',
        `This action is limited to: ${roles.join(', ')}.`,
      );
    }
    await next();
  };
}
