/**
 * Session state.
 *
 * Zustand holds only what the server cannot: who is signed in, the token, and a handle
 * to this device's signing key. Everything else — the chain, records, balances — is
 * server state and belongs to TanStack Query.
 */

import { create } from 'zustand';

import { api, ApiError, setAuthToken, type Identity } from '../lib/api.ts';
import { ensureDeviceKey, forgetDeviceKey, type DeviceKey } from '../lib/keystore.ts';

const STORAGE_KEY = 'breadcrumbs.session.v1';

interface Persisted {
  token: string;
  identity: Identity;
}

function readPersisted(): Persisted | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Persisted) : null;
  } catch {
    return null;
  }
}

function writePersisted(value: Persisted | null): void {
  try {
    if (value) localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* private browsing — the session simply won't survive a reload */
  }
}

export type SessionStatus = 'restoring' | 'anonymous' | 'ready';

interface SessionState {
  status: SessionStatus;
  identity: Identity | null;
  deviceKey: DeviceKey | null;
  keyError: string | null;
  restore: () => Promise<void>;
  signIn: (identityId: string) => Promise<Identity>;
  signOut: () => void;
}

/** Generates or loads the device key and registers its public half with the server. */
async function attachDeviceKey(identity: Identity): Promise<DeviceKey> {
  const key = await ensureDeviceKey(identity.id);
  await api.registerKey(key.publicJwk, `${navigator.platform || 'Browser'} · ${identity.name}`);
  return key;
}

export const useSession = create<SessionState>((set, getState) => ({
  status: 'restoring',
  identity: null,
  deviceKey: null,
  keyError: null,

  restore: async () => {
    const persisted = readPersisted();
    if (!persisted) {
      set({ status: 'anonymous', identity: null, deviceKey: null });
      return;
    }

    setAuthToken(persisted.token);

    try {
      // The token is only trusted as far as the server agrees with it.
      const { identity } = await api.me();
      const deviceKey = await attachDeviceKey(identity);
      set({ status: 'ready', identity, deviceKey, keyError: null });
      writePersisted({ token: persisted.token, identity });
    } catch (error) {
      if (error instanceof ApiError && error.status === 0) {
        // The API is down; keep the session rather than signing the user out.
        set({ status: 'anonymous', keyError: error.message });
        return;
      }
      setAuthToken(null);
      writePersisted(null);
      set({ status: 'anonymous', identity: null, deviceKey: null });
    }
  },

  signIn: async (identityId) => {
    const { token, identity } = await api.login(identityId);
    setAuthToken(token);
    writePersisted({ token, identity });

    try {
      const deviceKey = await attachDeviceKey(identity);
      set({ status: 'ready', identity, deviceKey, keyError: null });
    } catch (error) {
      set({
        status: 'ready',
        identity,
        deviceKey: null,
        keyError: error instanceof Error ? error.message : 'Could not register a signing key.',
      });
    }

    return identity;
  },

  signOut: () => {
    const { identity } = getState();
    // The device key stays in IndexedDB deliberately — it is this browser's identity,
    // not this session's, so signing back in reuses the same registered key.
    void identity;
    setAuthToken(null);
    writePersisted(null);
    set({ status: 'anonymous', identity: null, deviceKey: null, keyError: null });
  },
}));

/** Used by the "forget this device" action on the account panel. */
export async function forgetThisDevice(identityId: string): Promise<void> {
  await forgetDeviceKey(identityId);
}
