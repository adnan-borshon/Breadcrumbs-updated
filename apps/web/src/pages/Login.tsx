import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { KeyRound, Loader2, ShieldCheck } from 'lucide-react';
import { ROLE_LABEL, ROLES } from '@breadcrumbs/shared';
import type { Role } from '@breadcrumbs/shared';

import { api, type Identity } from '../lib/api.ts';
import { useSession } from '../store/session.ts';
import { Card, ErrorNote, Spinner, cx } from '../components/ui/primitives.tsx';

export function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const signIn = useSession((state) => state.signIn);
  const currentIdentity = useSession((state) => state.identity);

  const [role, setRole] = useState<Role>('factory');
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data, isPending } = useQuery({ queryKey: ['identities'], queryFn: api.identities });

  const from = (location.state as { from?: string } | null)?.from;

  // If already authenticated, redirect straight to dashboard
  useEffect(() => {
    if (currentIdentity) {
      const target = from && from !== '/' && from !== '/login' ? from : '/app';
      navigate(target, { replace: true });
    }
  }, [currentIdentity, from, navigate]);

  const onSelect = async (identity: Identity) => {
    setPendingId(identity.id);
    setError(null);
    try {
      await signIn(identity.id);
      const target = from && from !== '/' && from !== '/login' ? from : '/app';
      navigate(target, { replace: true, viewTransition: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.');
      setPendingId(null);
    }
  };

  const identities = data?.identities.filter((identity) => identity.role === role) ?? [];

  return (
    <div className="mx-auto max-w-3xl py-4">
      <header className="max-w-xl">
        <h1 className="text-[1.75rem] text-navy">Sign in</h1>
        <p className="mt-2 text-[0.9rem] leading-relaxed text-ink-muted">
          Choose a role, then the person you are signing in as. Your role decides what you can
          commit to the ledger — not just what you can see.
        </p>
      </header>

      {/* role selection */}
      <div
        role="radiogroup"
        aria-label="Role"
        className="mt-7 grid gap-3 sm:grid-cols-3"
      >
        {ROLES.map((option) => {
          const selected = role === option;
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setRole(option)}
              className={cx(
                'rounded-[var(--radius-card)] border p-4 text-left transition-colors',
                selected
                  ? 'border-navy bg-navy/8'
                  : 'border-hairline bg-surface hover:border-hairline-strong',
              )}
            >
              <p className="font-display text-[1rem] text-navy">{ROLE_LABEL[option]}</p>
              <p className="mt-1 text-[0.76rem] leading-relaxed text-ink-muted">
                {option === 'factory'
                  ? 'Submits records, moves stock, issues invoices.'
                  : option === 'auditor'
                    ? 'Rules on records the automated check flagged.'
                    : 'Opens contracts, approves invoices, pays.'}
              </p>
            </button>
          );
        })}
      </div>

      {/* identity selection */}
      <Card className="mt-5">
        <div className="border-b border-hairline px-5 py-4">
          <h2 className="text-[0.95rem] font-semibold text-navy">
            Sign in as a {ROLE_LABEL[role].toLowerCase()}
          </h2>
          <p className="mt-0.5 text-[0.78rem] text-ink-muted">
            No password — this is a demonstration directory. Everything after sign-in is enforced
            for real.
          </p>
        </div>

        {isPending ? (
          <Spinner label="Loading the directory" />
        ) : (
          <ul className="divide-y divide-hairline">
            {identities.map((identity) => (
              <li key={identity.id}>
                <button
                  type="button"
                  onClick={() => void onSelect(identity)}
                  disabled={pendingId !== null}
                  className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left transition-colors hover:bg-parchment-deep disabled:opacity-60"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[0.88rem] font-medium text-navy">{identity.name}</p>
                    <p className="truncate text-[0.76rem] text-ink-muted">
                      {identity.org}
                      {identity.factory_id ? ` · ${identity.factory_id}` : ''}
                    </p>
                  </div>
                  {/* A span, not a button — this sits inside the row's own button. */}
                  <span
                    aria-hidden
                    className={cx(
                      'inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[0.78rem] font-medium',
                      pendingId === identity.id
                        ? 'bg-navy text-parchment'
                        : 'border border-hairline-strong bg-surface text-navy',
                    )}
                  >
                    {pendingId === identity.id ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : null}
                    {pendingId === identity.id ? 'Signing in' : 'Continue'}
                  </span>
                </button>
              </li>
            ))}
            {identities.length === 0 ? (
              <li className="px-5 py-6 text-[0.82rem] text-ink-muted">
                No identities available for this role.
              </li>
            ) : null}
          </ul>
        )}
      </Card>

      {error ? (
        <div className="mt-4">
          <ErrorNote title="Could not sign in" message={error} />
        </div>
      ) : null}

      {/* what happens on sign-in — the key ceremony, explained honestly */}
      <div className="mt-6 rounded-[var(--radius-card)] border border-hairline bg-surface p-5">
        <div className="flex items-start gap-2.5">
          <KeyRound size={16} className="mt-0.5 shrink-0 text-gold" aria-hidden />
          <div>
            <h3 className="text-[0.88rem] font-semibold text-navy">
              A signing key is created on this device
            </h3>
            <p className="mt-1.5 text-[0.8rem] leading-relaxed text-ink-muted">
              The first time you sign in, your browser generates an ECDSA P-256 keypair. The private
              half is marked non-extractable, which means it has no exportable form — this app
              could not send it anywhere even if it tried. Only the public half is registered with
              the server, which is what lets the server check your signatures without ever being
              able to produce one.
            </p>
            <p className="mt-2 flex items-center gap-1.5 text-[0.76rem] text-teal">
              <ShieldCheck size={13} aria-hidden />
              Signing in on another browser creates a second registered device key, exactly as real
              key management behaves.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
