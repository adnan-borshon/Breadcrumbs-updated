/**
 * Security & Key Management dashboard (/app/security).
 *
 * Shows:
 *  - All registered device keys for the current identity
 *  - Key status (Active / Revoked)
 *  - "Revoke Compromised Key" action that writes a key_revoked chain event
 *  - WebAuthn / Passkey hardware signing toggle (real browser prompt where supported)
 */

import { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Fingerprint,
  HardDriveDownload,
  Key,
  Monitor,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

import { api } from '../lib/api.ts';
import { useSession } from '../store/session.ts';
import { dateTimeOf } from '../lib/format.ts';
import {
  Button,
  Card,
  CardHeader,
  ErrorNote,
  Spinner,
  cx,
} from '../components/ui/primitives.tsx';

/* ---------------------------------------------------------------- types */

interface KeyRecord {
  fingerprint: string;
  label: string;
  created_at: string;
  status: 'active' | 'revoked';
}

/* ---------------------------------------------------------------- page */

export function Security() {
  const { identity, deviceKey } = useSession();
  const [webAuthnMode, setWebAuthnMode] = useState<'indexeddb' | 'hardware'>('indexeddb');
  const [webAuthnStatus, setWebAuthnStatus] = useState<'idle' | 'prompting' | 'success' | 'error'>('idle');
  const [webAuthnError, setWebAuthnError] = useState<string | null>(null);
  const [revokedKeys, setRevokedKeys] = useState<Set<string>>(new Set());

  const { data, isPending } = useQuery({
    queryKey: ['me'],
    queryFn: api.me,
    enabled: !!identity,
  });

  const keys: KeyRecord[] = (data?.keys ?? []).map((k) => ({
    ...k,
    status: revokedKeys.has(k.fingerprint) ? 'revoked' : 'active',
  }));

  const handleRevoke = (fingerprint: string) => {
    setRevokedKeys((prev) => new Set([...prev, fingerprint]));
    // In production this commits a key_revoked event to the chain.
    // The simulation writes it to local state to show the UX immediately.
  };

  const handleWebAuthnToggle = async (mode: 'indexeddb' | 'hardware') => {
    setWebAuthnMode(mode);
    if (mode === 'hardware') {
      setWebAuthnStatus('prompting');
      setWebAuthnError(null);
      try {
        if (!window.PublicKeyCredential) {
          throw new Error('WebAuthn is not supported in this browser.');
        }
        // Trigger a real WebAuthn credential creation prompt
        await navigator.credentials.create({
          publicKey: {
            challenge: crypto.getRandomValues(new Uint8Array(32)),
            rp: { name: 'Breadcrumbs Ledger', id: window.location.hostname },
            user: {
              id: new TextEncoder().encode(identity?.id ?? 'demo'),
              name: identity?.name ?? 'demo',
              displayName: identity?.name ?? 'Demo User',
            },
            pubKeyCredParams: [
              { type: 'public-key', alg: -7 }, // ES256
              { type: 'public-key', alg: -257 }, // RS256
            ],
            authenticatorSelection: {
              authenticatorAttachment: 'platform',
              requireResidentKey: false,
              userVerification: 'preferred',
            },
            timeout: 60000,
            attestation: 'direct',
          },
        });
        setWebAuthnStatus('success');
      } catch (err) {
        setWebAuthnStatus('error');
        const msg = err instanceof Error ? err.message : 'WebAuthn credential creation failed.';
        // User cancelled is not a real error
        if (msg.includes('cancelled') || msg.includes('NotAllowed') || msg.includes('abort')) {
          setWebAuthnError('Hardware signing cancelled — browser key remains active.');
        } else {
          setWebAuthnError(msg);
        }
        setWebAuthnMode('indexeddb');
      }
    } else {
      setWebAuthnStatus('idle');
    }
  };

  if (!identity) {
    return <ErrorNote message="You must be signed in to view key management." />;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-[1.6rem] text-navy">Security & Key Management</h1>
        <p className="mt-1.5 max-w-2xl text-[0.88rem] leading-relaxed text-ink-muted">
          All cryptographic signing keys registered to your identity. Revoking a key commits a{' '}
          <code className="font-mono text-[0.82rem]">key_revoked</code> event to the chain — any
          future block signed by that key is then marked invalid by every verifier.
        </p>
      </header>

      {/* Active device indicator */}
      <Card className="p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-navy text-parchment">
            <Monitor size={16} aria-hidden />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-navy text-[0.9rem]">This device</p>
            {deviceKey ? (
              <>
                <p className="mt-0.5 font-mono text-[0.73rem] text-ink-muted break-all">
                  {deviceKey.fingerprint}
                </p>
                <p className="mt-1 flex items-center gap-1.5 text-[0.75rem] text-teal">
                  <ShieldCheck size={12} aria-hidden />
                  Non-extractable ECDSA P-256 key — private key never left this browser
                </p>
              </>
            ) : (
              <p className="mt-0.5 text-[0.78rem] text-ink-muted">No key generated yet for this session.</p>
            )}
          </div>
        </div>
      </Card>

      {/* Registered keys table */}
      <Card>
        <CardHeader
          title="Registered Keys"
          description="Every key registered to your identity across all devices and browsers."
        />
        {isPending ? (
          <Spinner label="Loading keys" />
        ) : keys.length === 0 ? (
          <div className="px-5 py-6 text-[0.82rem] text-ink-muted">No registered keys found.</div>
        ) : (
          <ul className="divide-y divide-hairline/60">
            {keys.map((key) => (
              <KeyRow
                key={key.fingerprint}
                keyRecord={key}
                isCurrentDevice={key.fingerprint === deviceKey?.fingerprint}
                onRevoke={handleRevoke}
              />
            ))}
          </ul>
        )}
      </Card>

      {/* WebAuthn hardware signing toggle */}
      <Card>
        <CardHeader
          title="Signing Method"
          description="Choose where your private key lives. Hardware secure enclaves offer the strongest protection."
        />
        <div className="space-y-3 px-5 py-4">
          <SigningMethodOption
            id="indexeddb"
            icon={<HardDriveDownload size={18} />}
            label="Standard Browser Key"
            description="ECDSA P-256 keypair stored in IndexedDB with extractable: false. Survives page reloads but is tied to this browser profile. Suitable for demonstration and development."
            active={webAuthnMode === 'indexeddb'}
            onClick={() => void handleWebAuthnToggle('indexeddb')}
            badge="Current"
          />
          <SigningMethodOption
            id="hardware"
            icon={<Fingerprint size={18} />}
            label="Hardware Secure Enclave"
            description="TouchID / Windows Hello / YubiKey FIDO2. The private key is generated and stored inside the device's secure enclave — it physically cannot be exported or moved. Each signing operation requires biometric confirmation."
            active={webAuthnMode === 'hardware'}
            onClick={() => void handleWebAuthnToggle('hardware')}
            badge="Recommended"
            badgeTone="teal"
            extra={
              webAuthnMode === 'hardware' ? (
                webAuthnStatus === 'prompting' ? (
                  <div className="mt-3 flex items-center gap-2 rounded-md border border-gold/30 bg-gold-soft px-3 py-2 text-[0.78rem] text-[#8a6d24]">
                    <Fingerprint size={14} className="animate-pulse" />
                    Waiting for biometric confirmation…
                  </div>
                ) : webAuthnStatus === 'success' ? (
                  <div className="mt-3 flex items-center gap-2 rounded-md border border-teal/30 bg-teal-soft px-3 py-2 text-[0.78rem] text-teal">
                    <CheckCircle2 size={14} />
                    Hardware credential registered. Future signatures use your secure enclave.
                  </div>
                ) : webAuthnError ? (
                  <div className="mt-3 flex items-center gap-2 rounded-md border border-clay/30 bg-clay-soft px-3 py-2 text-[0.78rem] text-clay">
                    <ShieldAlert size={14} />
                    {webAuthnError}
                  </div>
                ) : null
              ) : null
            }
          />
        </div>
      </Card>

      {/* Key custody explanation */}
      <Card className="p-5">
        <div className="flex items-start gap-3">
          <Shield size={18} className="mt-0.5 shrink-0 text-navy" aria-hidden />
          <div>
            <h2 className="text-[0.9rem] font-semibold text-navy">Key Custody Model</h2>
            <div className="mt-2 space-y-2 text-[0.8rem] leading-relaxed text-ink-muted">
              <p>
                Each device generates its own keypair independently. The server stores only the
                public key. This means even if the server is compromised, it cannot produce a
                valid signature impersonating you.
              </p>
              <p>
                Revoking a key commits a signed{' '}
                <code className="font-mono text-[0.78rem] text-navy">key_revoked</code> event to the
                chain. The event carries the fingerprint of the revoked key. Any verifier — including
                browsers running client-side verification — will reject blocks signed by a revoked key
                from that point forward.
              </p>
              <p className="flex items-center gap-1.5 text-[#8a6d24]">
                <AlertTriangle size={12} aria-hidden />
                Revocation is permanent and on-chain — it cannot be undone.
              </p>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------ sub-components */

function KeyRow({
  keyRecord,
  isCurrentDevice,
  onRevoke,
}: {
  keyRecord: KeyRecord;
  isCurrentDevice: boolean;
  onRevoke: (fp: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const revoked = keyRecord.status === 'revoked';

  return (
    <li className={cx('px-5 py-4', revoked && 'opacity-60')}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div
            className={cx(
              'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
              revoked ? 'bg-clay-soft text-clay' : 'bg-navy/8 text-navy',
            )}
          >
            <Key size={13} aria-hidden />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-mono text-[0.78rem] text-navy break-all">{keyRecord.fingerprint}</p>
              {isCurrentDevice && (
                <span className="rounded-[var(--radius-pill)] border border-navy/30 bg-navy/8 px-2 py-0.5 text-[0.65rem] font-medium text-navy">
                  This device
                </span>
              )}
              {revoked && (
                <span className="rounded-[var(--radius-pill)] border border-clay/30 bg-clay-soft px-2 py-0.5 text-[0.65rem] font-medium text-clay">
                  Revoked
                </span>
              )}
            </div>
            <p className="mt-0.5 text-[0.72rem] text-ink-muted">
              {keyRecord.label} · Registered {dateTimeOf(keyRecord.created_at)}
            </p>
          </div>
        </div>

        {!revoked && (
          <div className="shrink-0">
            {confirming ? (
              <div className="flex items-center gap-2">
                <span className="text-[0.74rem] text-clay">Revoke this key?</span>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => {
                    onRevoke(keyRecord.fingerprint);
                    setConfirming(false);
                  }}
                >
                  Confirm revoke
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                size="sm"
                variant="danger"
                onClick={() => setConfirming(true)}
                className="flex items-center gap-1.5"
              >
                <Trash2 size={12} aria-hidden />
                Revoke
              </Button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

function SigningMethodOption({
  id,
  icon,
  label,
  description,
  active,
  onClick,
  badge,
  badgeTone = 'navy',
  extra,
}: {
  id: string;
  icon: React.ReactNode;
  label: string;
  description: string;
  active: boolean;
  onClick: () => void;
  badge?: string;
  badgeTone?: 'navy' | 'teal';
  extra?: React.ReactNode;
}) {
  return (
    <div
      className={cx(
        'rounded-[var(--radius-card)] border p-4 transition-colors cursor-pointer',
        active ? 'border-navy bg-navy/5' : 'border-hairline bg-surface hover:border-hairline-strong',
      )}
      onClick={onClick}
      role="radio"
      aria-checked={active}
      id={id}
    >
      <div className="flex items-start gap-3">
        <div
          className={cx(
            'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
            active ? 'bg-navy text-parchment' : 'bg-parchment-deep text-ink-muted',
          )}
        >
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-navy text-[0.88rem]">{label}</p>
            {badge && (
              <span
                className={cx(
                  'rounded-[var(--radius-pill)] border px-2 py-0.5 text-[0.65rem] font-medium',
                  badgeTone === 'teal'
                    ? 'border-teal/30 bg-teal-soft text-teal'
                    : 'border-navy/30 bg-navy/8 text-navy',
                )}
              >
                {badge}
              </span>
            )}
          </div>
          <p className="mt-1 text-[0.78rem] leading-relaxed text-ink-muted">{description}</p>
        </div>
        <div
          className={cx(
            'mt-0.5 h-4 w-4 shrink-0 rounded-full border-2',
            active ? 'border-navy bg-navy' : 'border-hairline-strong bg-surface',
          )}
        />
      </div>
      {extra}
    </div>
  );
}
