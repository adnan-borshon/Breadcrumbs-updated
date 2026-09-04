import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** apps/api */
export const APP_ROOT = resolve(here, '..');

export const DATA_DIR = resolve(APP_ROOT, 'data');

export const DB_FILE = process.env.BREADCRUMBS_DB ?? resolve(DATA_DIR, 'breadcrumbs.db');

export const PORT = Number(process.env.PORT ?? 3001);

/**
 * Demo secret. Real deployments must set BREADCRUMBS_JWT_SECRET — the login flow is
 * mocked (pick an identity, no password), so the token is the only thing standing
 * between a caller and a role.
 */
export const JWT_SECRET = new TextEncoder().encode(
  process.env.BREADCRUMBS_JWT_SECRET ?? 'breadcrumbs-dev-secret-do-not-use-in-production',
);

export const JWT_ISSUER = 'breadcrumbs';
export const JWT_AUDIENCE = 'breadcrumbs-web';
export const TOKEN_TTL = '12h';

export const CHAIN_ID = 'breadcrumbs-garments-v1';

/** Demo-only endpoints (tamper / restore / rebuild) can be switched off. */
export const ENABLE_ADMIN_TOOLS = process.env.BREADCRUMBS_ADMIN_TOOLS !== 'false';

/**
 * Lay down the demo history when the ledger is empty, so a fresh clone or a fresh
 * container has something to show. Never touches a ledger that already has blocks.
 */
export const SEED_ON_EMPTY = process.env.BREADCRUMBS_SEED_ON_EMPTY !== 'false';
