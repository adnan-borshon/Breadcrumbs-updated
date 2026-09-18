/**
 * Client-side chain verification engine.
 *
 * Uses window.crypto.subtle exclusively — nothing leaves the browser and the server
 * is never asked whether it is honest. This is the proof that the system does not
 * require trusting the API endpoint.
 *
 * Directly executes the shared WebCrypto verification engine (`@breadcrumbs/shared`),
 * computing SHA-256 block hashes and ECDSA P-256 signatures locally in the visitor's browser.
 */

import {
  verifyChain,
  verifyBlock,
  publicKeyFingerprint,
  fromBase64Url,
  type Block,
  type BlockCheck,
  type ChainReport,
} from '@breadcrumbs/shared';

export type LocalBlockResult = BlockCheck;

export interface LocalVerifyReport extends ChainReport {
  durationMs: number;
  verifiedAt: string;
}

export type RawBlock = Block;

/* ----------------------------------------------------------------- helpers */

/** Convert a Base64-URL string to Uint8Array. */
export function b64urlToBytes(b64: string): Uint8Array {
  return fromBase64Url(b64);
}

/** Derive a short fingerprint from a public key JWK for display. */
export async function jwkFingerprint(jwk: JsonWebKey): Promise<string> {
  const fp = await publicKeyFingerprint(jwk);
  return `SHA256:${fp}`;
}

/** Compute SHA-256 of a File or Blob, returned as lowercase hex. */
export async function sha256File(file: File | Blob): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Format bytes count as human-readable. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/* ------------------------------------------------------------- public API */

/**
 * Verify the entire chain client-side in the browser.
 * Executes WebCrypto SHA-256 and ECDSA P-256 signature verification over every block.
 */
export async function verifyChainLocally(blocks: Block[]): Promise<LocalVerifyReport> {
  const start = performance.now();
  const report = await verifyChain(blocks);
  const durationMs = Math.round(performance.now() - start);

  return {
    ...report,
    durationMs,
    verifiedAt: report.checkedAt,
  };
}

export { verifyBlock };
