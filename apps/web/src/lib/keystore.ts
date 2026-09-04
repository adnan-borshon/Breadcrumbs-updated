/**
 * Device key custody.
 *
 * The keypair is generated in the browser with `extractable: false`, which means the
 * private key has no serialisable form — it cannot be exported, printed, or posted to a
 * server even by this code. IndexedDB can still store the `CryptoKey` object itself
 * (structured clone handles it), so it survives a reload without ever becoming bytes.
 *
 * Only the public JWK is ever sent anywhere. That is what makes the signature on a record
 * mean something: the server can check it, and cannot produce it.
 */

import { exportPublicJwk, generateKeyPair, publicKeyFingerprint } from '@breadcrumbs/shared';

const DB_NAME = 'breadcrumbs-keys';
const DB_VERSION = 1;
const STORE = 'device-keys';

export interface DeviceKey {
  identityId: string;
  privateKey: CryptoKey;
  publicJwk: JsonWebKey;
  fingerprint: string;
  createdAt: string;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: 'identityId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transact<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>) {
  return openDatabase().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = run(tx.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        tx.oncomplete = () => db.close();
      }),
  );
}

export async function loadDeviceKey(identityId: string): Promise<DeviceKey | null> {
  try {
    const found = await transact<DeviceKey | undefined>('readonly', (store) =>
      store.get(identityId),
    );
    return found ?? null;
  } catch {
    // A browser with storage blocked should fall back to generating a session key
    // rather than failing to load the app.
    return null;
  }
}

/**
 * Returns this identity's key, generating one on first use.
 *
 * A key is per identity *and* per browser: signing in as the same person on another
 * machine produces a second registered device key, which is how real key management
 * behaves and why blocks store the public key that signed them.
 */
export async function ensureDeviceKey(identityId: string): Promise<DeviceKey> {
  const existing = await loadDeviceKey(identityId);
  if (existing) return existing;

  const pair = await generateKeyPair(false);
  const publicJwk = await exportPublicJwk(pair.publicKey);

  const key: DeviceKey = {
    identityId,
    privateKey: pair.privateKey,
    publicJwk,
    fingerprint: await publicKeyFingerprint(publicJwk),
    createdAt: new Date().toISOString(),
  };

  try {
    await transact('readwrite', (store) => store.put(key));
  } catch {
    // Unstorable: the key still works for this session, it just won't persist.
  }

  return key;
}

export async function forgetDeviceKey(identityId: string): Promise<void> {
  try {
    await transact('readwrite', (store) => store.delete(identityId));
  } catch {
    /* nothing to clean up */
  }
}
