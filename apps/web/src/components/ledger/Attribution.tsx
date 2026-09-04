/**
 * "Who submitted this" — one of the three questions the interface must always answer.
 */

import { AlertTriangle, Info, ShieldCheck, UserRound } from 'lucide-react';
import type { LedgerRecord } from '@breadcrumbs/shared';
import { SUBMITTER_ROLE_LABEL } from '@breadcrumbs/shared';

import { cx } from '../ui/primitives.tsx';
import { dateTimeOf, initials } from '../../lib/format.ts';
import { HashText } from './Crypto.tsx';

export function Submitter({
  name,
  role,
  timestamp,
  size = 'md',
}: {
  name: string;
  role: string;
  timestamp?: string;
  size?: 'sm' | 'md';
}) {
  const roleLabel = SUBMITTER_ROLE_LABEL[role as keyof typeof SUBMITTER_ROLE_LABEL] ?? role;

  return (
    <div className="flex items-center gap-2.5">
      <span
        aria-hidden
        className={cx(
          'grid shrink-0 place-items-center rounded-full bg-navy/8 font-medium text-navy',
          size === 'sm' ? 'size-7 text-[0.65rem]' : 'size-9 text-[0.75rem]',
        )}
      >
        {initials(name)}
      </span>
      <div className="min-w-0">
        <p className={cx('truncate font-medium text-navy', size === 'sm' ? 'text-[0.8rem]' : 'text-[0.85rem]')}>
          {name}
        </p>
        <p className="truncate text-[0.72rem] text-ink-muted">
          {roleLabel}
          {timestamp ? ` · ${dateTimeOf(timestamp)}` : ''}
        </p>
      </div>
    </div>
  );
}

/** The signature block: authorship, stated plainly, with the proof underneath. */
export function SignatureCard({ record }: { record: LedgerRecord }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-hairline bg-parchment/60 p-4">
      <div className="flex items-start gap-2">
        <ShieldCheck size={15} className="mt-0.5 shrink-0 text-teal" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-[0.82rem] font-medium text-navy">
            Signed by {record.submitter_name}
          </p>
          <p className="mt-0.5 text-[0.76rem] text-ink-muted">
            {SUBMITTER_ROLE_LABEL[record.submitter_role] ?? record.submitter_role} ·{' '}
            {dateTimeOf(record.timestamp)}. This signature was produced on their device with a
            private key the server has never held, so authorship cannot be denied or forged.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <span className="text-[0.7rem] uppercase tracking-wide text-ink-faint">Signature</span>
            <HashText value={record.signature} label="Signature" lead={12} tail={12} />
          </div>
        </div>
      </div>
    </div>
  );
}

/** The AI verdict, stated in the same voice whether it flagged or not. */
export function AiVerdict({
  flagged,
  reason,
  rule,
  score,
  note,
}: {
  flagged: boolean;
  reason?: string | null;
  rule?: string | null;
  score?: number | null;
  note?: string | null;
}) {
  if (flagged) {
    return (
      <div className="rounded-[var(--radius-card)] border border-clay/30 bg-clay-soft p-4">
        <div className="flex items-start gap-2">
          <AlertTriangle size={15} className="mt-0.5 shrink-0 text-clay" aria-hidden />
          <div className="min-w-0">
            <p className="text-[0.82rem] font-medium text-clay">Flagged by the automated check</p>
            <p className="mt-1 text-[0.78rem] text-ink">{reason}</p>
            {rule ? (
              <p className="mt-2 text-[0.7rem] text-ink-muted">
                Rule <code className="font-mono">{rule}</code>
                {typeof score === 'number' ? ` · magnitude ${score}` : ''}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  if (note) {
    return (
      <div className="rounded-[var(--radius-card)] border border-hairline bg-parchment/60 p-4">
        <div className="flex items-start gap-2">
          <Info size={15} className="mt-0.5 shrink-0 text-ink-muted" aria-hidden />
          <div>
            <p className="text-[0.82rem] font-medium text-navy">No baseline applied</p>
            <p className="mt-0.5 text-[0.78rem] text-ink-muted">{note}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-[var(--radius-card)] border border-hairline bg-parchment/60 p-4">
      <div className="flex items-start gap-2">
        <ShieldCheck size={15} className="mt-0.5 shrink-0 text-teal" aria-hidden />
        <div>
          <p className="text-[0.82rem] font-medium text-navy">Automated check passed</p>
          <p className="mt-0.5 text-[0.78rem] text-ink-muted">
            Measured against this factory&rsquo;s own history, nothing about this record stood out.
          </p>
        </div>
      </div>
    </div>
  );
}

/** The human decision — the third question: has anyone actually looked at this? */
export function ReviewOutcome({ record }: { record: LedgerRecord }) {
  if (record.human_review_status === 'none') {
    return (
      <div className="rounded-[var(--radius-card)] border border-hairline bg-parchment/60 p-4">
        <div className="flex items-start gap-2">
          <UserRound size={15} className="mt-0.5 shrink-0 text-ink-muted" aria-hidden />
          <div>
            <p className="text-[0.82rem] font-medium text-navy">Not yet reviewed by a person</p>
            <p className="mt-0.5 text-[0.78rem] text-ink-muted">
              {record.ai_flag
                ? 'This record is waiting in the auditor queue.'
                : 'No anomaly was raised, so it has not been routed for review.'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const confirmed = record.human_review_status === 'confirmed';

  return (
    <div
      className={cx(
        'rounded-[var(--radius-card)] border p-4',
        confirmed ? 'border-teal/30 bg-teal-soft' : 'border-navy/25 bg-navy/8',
      )}
    >
      <div className="flex items-start gap-2">
        <UserRound size={15} className={cx('mt-0.5 shrink-0', confirmed ? 'text-teal' : 'text-navy')} aria-hidden />
        <div className="min-w-0">
          <p className={cx('text-[0.82rem] font-medium', confirmed ? 'text-teal' : 'text-navy')}>
            {confirmed ? 'Confirmed' : 'Disputed'} by {record.reviewer_name}
          </p>
          {record.reviewed_at ? (
            <p className="mt-0.5 text-[0.72rem] text-ink-muted">{dateTimeOf(record.reviewed_at)}</p>
          ) : null}
          {record.review_note ? (
            <p className="mt-2 text-[0.78rem] text-ink">{record.review_note}</p>
          ) : null}
          <p className="mt-2 text-[0.7rem] text-ink-muted">
            Recorded as its own signed block. The original record was not altered.
          </p>
        </div>
      </div>
    </div>
  );
}
