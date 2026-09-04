/**
 * Real cryptography — SHA-256 and ECDSA P-256 via the Web Crypto API.
 *
 * `globalThis.crypto.subtle` is present and identical in Node 20+ and in every modern
 * browser, so this module has no environment branching at all. That is deliberate: the
 * client and the server run *the same code* to hash and verify, which removes the
 * possibility of the two sides disagreeing about what a block hashes to.
 */

const subtle: SubtleCrypto = globalThis.crypto.subtle;

export const ECDSA_KEY_PARAMS: EcKeyGenParams = { name: 'ECDSA', namedCurve: 'P-256' };
export const ECDSA_SIGN_PARAMS: EcdsaParams = { name: 'ECDSA', hash: 'SHA-256' };

const encoder = new TextEncoder();

/* ------------------------------------------------------------------ hashing */

export async function sha256Hex(input: string): Promise<string> {
  const digest = await subtle.digest('SHA-256', encoder.encode(input));
  return toHex(digest);
}

export function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

/* ------------------------------------------------------------- base64url */

export function toBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  // Chunked so a large signature can't blow the argument limit of fromCharCode.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/* ------------------------------------------------------------------- keys */

/**
 * Generates an ECDSA P-256 keypair.
 *
 * `extractable: false` (the default here) makes the *private* key non-serialisable — it
 * cannot be exported, logged, or sent anywhere, even by our own code. Per the Web Crypto
 * spec the public key of a generated pair is always extractable regardless, so the public
 * JWK can still be registered with the server.
 *
 * The browser uses the default. The seeder passes `true` because it has to sign historical
 * fixtures on behalf of seeded identities; those private keys are discarded the moment
 * seeding finishes and are never persisted.
 */
export async function generateKeyPair(extractable = false): Promise<CryptoKeyPair> {
  return subtle.generateKey(ECDSA_KEY_PARAMS, extractable, ['sign', 'verify']);
}

export async function exportPublicJwk(key: CryptoKey): Promise<JsonWebKey> {
  const jwk = await subtle.exportKey('jwk', key);
  // Strip fields that vary by engine so the same key always fingerprints the same way.
  delete jwk.key_ops;
  delete jwk.ext;
  return jwk;
}

const importCache = new Map<string, Promise<CryptoKey>>();

export async function importPublicKey(jwk: JsonWebKey): Promise<CryptoKey> {
  const cacheKey = `${jwk.crv ?? ''}.${jwk.x ?? ''}.${jwk.y ?? ''}`;
  let pending = importCache.get(cacheKey);
  if (!pending) {
    // key_ops/ext are stripped on export; re-import cleanly as a verify-only key.
    pending = subtle.importKey(
      'jwk',
      { ...jwk, key_ops: ['verify'], ext: true },
      ECDSA_KEY_PARAMS,
      true,
      ['verify'],
    );
    importCache.set(cacheKey, pending);
  }
  return pending;
}

/** A short, stable identifier for a public key — used to label devices in the UI. */
export async function publicKeyFingerprint(jwk: JsonWebKey): Promise<string> {
  const material = `${jwk.crv ?? ''}.${jwk.x ?? ''}.${jwk.y ?? ''}`;
  const hash = await sha256Hex(material);
  return hash.slice(0, 16);
}

/* -------------------------------------------------------------- signatures */

export async function signPayload(privateKey: CryptoKey, payload: string): Promise<string> {
  const signature = await subtle.sign(ECDSA_SIGN_PARAMS, privateKey, encoder.encode(payload));
  return toBase64Url(signature);
}

export async function verifyPayload(
  publicJwk: JsonWebKey,
  payload: string,
  signature: string,
): Promise<boolean> {
  try {
    const key = await importPublicKey(publicJwk);
    const bytes = fromBase64Url(signature);
    // Copy into a fresh ArrayBuffer so the view's byteOffset can't confuse subtle.verify.
    const sig = bytes.slice().buffer;
    return await subtle.verify(ECDSA_SIGN_PARAMS, key, sig, encoder.encode(payload));
  } catch {
    // A malformed key or signature is a failed verification, not a crash.
    return false;
  }
}
