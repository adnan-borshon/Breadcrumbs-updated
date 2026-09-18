/**
 * Client-side chain verification engine.
 *
 * Uses window.crypto.subtle exclusively — nothing leaves the browser and the server
 * is never asked whether it is honest. This is the proof that the system does not
 * require trusting the API endpoint.
 *
 * Algorithm:
 *  1. Canonicalise each block's content fields (sorted keys, no whitespace).
 *  2. SHA-256 digest → compare with stored block_hash.
 *  3. Confirm each block's previous_block_hash matches the prior block's hash.
 *  4. For blocks that carry a signature and a public key JWK, import the key and
 *     verify the ECDSA P-256 signature over the canonical signed payload.
 */

export interface LocalBlockResult {
  index: number;
  hashValid: boolean;
  linkValid: boolean;
  signatureValid: boolean | null; // null = no signature data available
  invalidatedByEarlierBreak: boolean;
}

export interface LocalVerifyReport {
  ok: boolean;
  height: number;
  blocks: LocalBlockResult[];
  firstBreakIndex: number | null;
  brokenCount: number;
  durationMs: number;
  verifiedAt: string;
}

/** A raw block as returned by GET /api/chain/blocks (extended form). */
export interface RawBlock {
  index: number;
  block_hash: string;
  previous_block_hash: string;
  event_id: string;
  event_type: string;
  factory_id: string;
  timestamp: string;
  submitter_id: string;
  submitter_name: string;
  submitter_role: string;
  data_fields: Record<string, unknown>;
  ref_id: string | null;
  ai_flag: boolean;
  ai_score: number | null;
  ai_rule: string | null;
  ai_flag_reason: string | null;
  signature: string | null;
  public_key_jwk: JsonWebKey | null;
}

/* ----------------------------------------------------------------- helpers */

/** Convert a Base64-URL string to Uint8Array. */
export function b64urlToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const padded = b64.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Stable JSON — keys sorted recursively, no extra whitespace. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const sorted = Object.keys(value as object)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`);
    return `{${sorted.join(',')}}`;
  }
  return JSON.stringify(value);
}

/** SHA-256 of a string, returned as lowercase hex. */
async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * The exact payload the submitter signed.
 * Must match `canonicalJson` in packages/shared exactly.
 */
function signedPayload(block: RawBlock): string {
  return canonicalJson({
    event_id: block.event_id,
    factory_id: block.factory_id,
    event_type: block.event_type,
    timestamp: block.timestamp,
    submitter_id: block.submitter_id,
    submitter_name: block.submitter_name,
    submitter_role: block.submitter_role,
    data_fields: block.data_fields,
    ref_id: block.ref_id,
  });
}

/**
 * The exact content that was hashed into block_hash.
 * Must match the server's hashing logic in packages/shared.
 */
function blockContent(block: RawBlock): string {
  return canonicalJson({
    index: block.index,
    previous_block_hash: block.previous_block_hash,
    event_id: block.event_id,
    factory_id: block.factory_id,
    event_type: block.event_type,
    timestamp: block.timestamp,
    submitter_id: block.submitter_id,
    submitter_name: block.submitter_name,
    submitter_role: block.submitter_role,
    data_fields: block.data_fields,
    ref_id: block.ref_id,
    ai_flag: block.ai_flag,
    ai_score: block.ai_score,
    ai_rule: block.ai_rule,
    ai_flag_reason: block.ai_flag_reason,
    signature: block.signature,
  });
}

/** Verify one ECDSA P-256 signature. Returns null if key/sig data is missing. */
async function verifySignature(block: RawBlock): Promise<boolean | null> {
  if (!block.signature || !block.public_key_jwk) return null;

  try {
    const key = await crypto.subtle.importKey(
      'jwk',
      block.public_key_jwk,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );

    const sigBytes = b64urlToBytes(block.signature);
    const payload = new TextEncoder().encode(signedPayload(block));

    return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, sigBytes.buffer.slice(sigBytes.byteOffset, sigBytes.byteOffset + sigBytes.byteLength), payload);
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------- public API */

/**
 * Verify the entire chain client-side in the browser.
 * Blocks should be ordered by index ascending (as returned from the server).
 */
export async function verifyChainLocally(blocks: RawBlock[]): Promise<LocalVerifyReport> {
  const start = performance.now();
  const results: LocalBlockResult[] = [];
  let firstBreakIndex: number | null = null;

  for (const block of blocks) {
    const computedHash = await sha256Hex(blockContent(block));
    const hashValid = computedHash === block.block_hash;

    const prevBlock = blocks[block.index - 1];
    const expectedPrev = prevBlock?.block_hash ?? '0'.repeat(64);
    const linkValid = block.previous_block_hash === expectedPrev;

    const signatureValid = await verifySignature(block);

    const directFailure = !hashValid || !linkValid || signatureValid === false;
    if (directFailure && firstBreakIndex === null) {
      firstBreakIndex = block.index;
    }

    results.push({
      index: block.index,
      hashValid,
      linkValid,
      signatureValid,
      invalidatedByEarlierBreak: false,
    });
  }

  // Mark downstream blocks invalidated by an earlier break
  if (firstBreakIndex !== null) {
    for (const r of results) {
      if (r.index > firstBreakIndex) {
        r.invalidatedByEarlierBreak = true;
      }
    }
  }

  const brokenCount = results.filter(
    (r) => !r.hashValid || !r.linkValid || r.signatureValid === false,
  ).length;

  const durationMs = Math.round(performance.now() - start);

  return {
    ok: firstBreakIndex === null,
    height: blocks.length,
    blocks: results,
    firstBreakIndex,
    brokenCount,
    durationMs,
    verifiedAt: new Date().toISOString(),
  };
}

/** Derive a short fingerprint from a public key JWK for display. */
export async function jwkFingerprint(jwk: JsonWebKey): Promise<string> {
  const canonical = canonicalJson({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y });
  const bytes = new TextEncoder().encode(canonical);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `SHA256:${hex.slice(0, 16)}`;
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
