import { ZodError } from 'zod';
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';

import { LedgerError } from '../chain/ledger.ts';

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * One error shape for the whole API, so the web app can render a useful message
 * instead of a generic failure. Rejections are part of the product here — "signature
 * does not verify" is something a user should see stated plainly.
 */
export function onError(err: Error, c: Context): Response {
  if (err instanceof LedgerError) {
    return c.json<ApiError>(
      { error: { code: err.code, message: err.message, details: err.details } },
      err.status as 400,
    );
  }

  if (err instanceof ZodError) {
    return c.json<ApiError>(
      {
        error: {
          code: 'validation_failed',
          message: 'Request body failed validation.',
          details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
      },
      400,
    );
  }

  if (err instanceof HTTPException) {
    return c.json<ApiError>({ error: { code: 'http_error', message: err.message } }, err.status);
  }

  console.error('[api] unhandled error:', err);
  return c.json<ApiError>(
    { error: { code: 'internal_error', message: 'Something went wrong on the server.' } },
    500,
  );
}
