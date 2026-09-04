/**
 * Cryptographic material, presented calmly.
 *
 * Hashes and signatures are shown middle-truncated in muted monospace by default. They
 * are available in full on demand, but the page should read as human-first rather than
 * as a raw ledger dump.
 */

import { useState } from 'react';
import { Check, Copy, Link2 } from 'lucide-react';
import { shortHash } from '@breadcrumbs/shared';

import { cx } from '../ui/primitives.tsx';

export function useCopy(): [boolean, (value: string) => void] {
  const [copied, setCopied] = useState(false);

  const copy = (value: string) => {
    const done = () => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    };

    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(value).then(done).catch(() => undefined);
      return;
    }

    // Older/locked-down browsers still get a working copy button.
    const area = document.createElement('textarea');
    area.value = value;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    try {
      document.execCommand('copy');
      done();
    } finally {
      document.body.removeChild(area);
    }
  };

  return [copied, copy];
}

export function HashText({
  value,
  label,
  lead = 8,
  tail = 8,
  className,
}: {
  value: string | null;
  label?: string;
  lead?: number;
  tail?: number;
  className?: string;
}) {
  const [copied, copy] = useCopy();
  if (!value) return <span className="crypto">—</span>;

  return (
    <button
      type="button"
      onClick={() => copy(value)}
      title={value}
      className={cx(
        'crypto inline-flex items-center gap-1.5 rounded px-1 py-0.5 transition-colors hover:bg-parchment-deep hover:text-navy',
        className,
      )}
      aria-label={`${label ?? 'Hash'} ${value}. Click to copy.`}
    >
      {shortHash(value, lead, tail)}
      {copied ? (
        <Check size={11} className="text-teal" aria-hidden />
      ) : (
        <Copy size={11} className="opacity-40" aria-hidden />
      )}
      <span className="sr-only">{copied ? 'Copied' : ''}</span>
    </button>
  );
}

/** A labelled hash row, used on the record and block detail views. */
export function HashRow({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | null;
  hint?: string;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-hairline/60 py-2 last:border-0">
      <div>
        <span className="text-[0.75rem] font-medium text-navy">{label}</span>
        {hint ? <p className="text-[0.7rem] text-ink-faint">{hint}</p> : null}
      </div>
      <HashText value={value} label={label} lead={10} tail={10} />
    </div>
  );
}

export function CopyVerificationLink({ eventId }: { eventId: string }) {
  const [copied, copy] = useCopy();
  const url = `${window.location.origin}/record/${encodeURIComponent(eventId)}`;

  return (
    <button
      type="button"
      onClick={() => copy(url)}
      className="inline-flex items-center gap-1.5 rounded-md border border-hairline-strong bg-surface px-2.5 py-1.5 text-[0.78rem] text-navy transition-colors hover:bg-parchment-deep"
    >
      {copied ? <Check size={13} className="text-teal" aria-hidden /> : <Link2 size={13} aria-hidden />}
      {copied ? 'Link copied' : 'Copy verification link'}
    </button>
  );
}

/**
 * Expandable technical detail. Collapsed by default everywhere it is used — the brief is
 * explicit that people should opt into cryptographic depth, not be handed it.
 */
export function TechnicalDetails({
  children,
  summary = 'Show technical details',
  defaultOpen = false,
}: {
  children: React.ReactNode;
  summary?: string;
  defaultOpen?: boolean;
}) {
  return (
    <details className="group" open={defaultOpen}>
      <summary className="cursor-pointer list-none text-[0.78rem] text-ink-muted underline decoration-hairline-strong underline-offset-4 transition-colors hover:text-navy">
        <span className="group-open:hidden">{summary}</span>
        <span className="hidden group-open:inline">Hide technical details</span>
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}
