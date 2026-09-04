/**
 * A persistent, quiet integrity indicator.
 *
 * "Has this been tampered with?" is one of the three questions the interface must always
 * answer, so the answer lives in the header on every page rather than only on the
 * explorer. It turns loud only when it has something to be loud about.
 */

import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ShieldCheck } from 'lucide-react';

import { api } from '../../lib/api.ts';
import { cx } from '../ui/primitives.tsx';

export function useChainReport() {
  return useQuery({
    queryKey: ['chain', 'verify'],
    queryFn: api.verify,
    staleTime: 15_000,
    refetchInterval: 60_000,
  });
}

export function ChainStatusPill() {
  const { data, isPending, isError } = useChainReport();

  if (isPending || isError || !data) {
    return (
      <span className="hidden items-center gap-1.5 rounded-[var(--radius-pill)] border border-hairline px-2.5 py-1 text-[0.7rem] text-ink-faint sm:inline-flex">
        <span className="size-1.5 rounded-full bg-hairline-strong" aria-hidden />
        Ledger
      </span>
    );
  }

  const ok = data.ok;

  return (
    <Link
      to="/explorer"
      viewTransition
      className={cx(
        'inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] border px-2.5 py-1 text-[0.7rem] font-medium transition-colors',
        ok
          ? 'border-teal/30 bg-teal-soft text-teal hover:bg-teal/15'
          : 'border-clay/40 bg-clay-soft text-clay hover:bg-clay/15',
      )}
      title={
        ok
          ? `All ${data.height} blocks verified — every hash, link and signature checks out.`
          : `Chain integrity broken at block ${data.firstBreakIndex}.`
      }
    >
      {ok ? <ShieldCheck size={12} aria-hidden /> : <AlertTriangle size={12} aria-hidden />}
      <span className="hidden sm:inline">{ok ? 'Chain verified' : 'Chain broken'}</span>
      <span className="tabular opacity-70">{data.height}</span>
    </Link>
  );
}
