import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  ShieldAlert,
  ShieldCheck,
  Users,
} from 'lucide-react';
import type { LedgerRecord } from '@breadcrumbs/shared';

import { api } from '../lib/api.ts';
import { dateTimeOf, eventLabel } from '../lib/format.ts';
import { commitEvent, makeEventId } from '../lib/signer.ts';
import {
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Spinner,
  Textarea,
  cx,
} from '../components/ui/primitives.tsx';
import { StatusBadge } from '../components/ledger/StatusBadge.tsx';

/* Simulated quorum auditor roster — same three parties as RecordDetail */
const QUORUM_ROSTER = [
  { name: 'Farhana Chowdhury', org: 'SGS Bangladesh', status: 'confirmed' as const },
  { name: 'Michael Osei', org: 'Bureau Veritas', status: 'pending' as const },
  { name: 'Independent NGO Observer', org: 'Clean Clothes Campaign', status: 'standby' as const },
];

export function ReviewQueue() {
  const { data, isPending, isError, error } = useQuery({
    queryKey: ['records', 'flagged'],
    queryFn: api.flagged,
  });

  const queue = data?.records ?? [];

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-[1.6rem] text-navy">Review queue</h1>
        <p className="mt-1.5 max-w-2xl text-[0.88rem] leading-relaxed text-ink-muted">
          Only records the automated check flagged and nobody has ruled on yet. A decision requires{' '}
          <strong className="text-navy">2 of 3 independent auditors</strong> to confirm — preventing
          single-point bribery or collusion. Each confirmation is written to the chain as its own
          signed block.
        </p>
      </header>

      {/* Quorum explanation card */}
      <div className="rounded-[var(--radius-card)] border border-[#4B3B6A]/20 bg-[#1e1030]/5 px-5 py-4">
        <div className="flex items-start gap-3">
          <Users size={18} className="mt-0.5 shrink-0 text-[#5b3fa8]" aria-hidden />
          <div>
            <p className="font-semibold text-navy text-[0.88rem]">Multi-Signature Quorum Governance</p>
            <p className="mt-1 text-[0.78rem] leading-relaxed text-ink-muted">
              No single auditor can turn a fraudulent record green. The system requires independent
              confirmation from at least 2 of 3 certified auditors from different organisations. This
              prevents single-party bribery, error, and collusion. Each signature is an on-chain
              event tied to the auditor's registered device key.
            </p>
          </div>
        </div>
      </div>

      {isPending ? (
        <Spinner label="Loading the queue" />
      ) : isError ? (
        <ErrorNote message={(error as Error).message} />
      ) : queue.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck size={24} />}
          title="The queue is clear"
          description="Every flagged record has had a human decision recorded against it."
        />
      ) : (
        <div className="space-y-4">
          <p className="text-[0.82rem] text-ink-muted">
            {queue.length} record{queue.length === 1 ? '' : 's'} waiting.
          </p>
          {queue.map((record) => (
            <ReviewCard key={record.event_id} record={record} />
          ))}
        </div>
      )}
    </div>
  );
}

function ReviewCard({ record }: { record: LedgerRecord }) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');
  const [choice, setChoice] = useState<'confirm' | 'dispute' | null>(null);
  const [localConfirmed, setLocalConfirmed] = useState(false);
  const [challenged, setChallenged] = useState(false);

  const review = useMutation({
    mutationFn: async (decision: 'confirm' | 'dispute') =>
      commitEvent({
        eventType: decision === 'confirm' ? 'review_confirmed' : 'review_disputed',
        factoryId: record.factory_id,
        eventId: makeEventId(decision === 'confirm' ? 'REV-OK' : 'REV-NO'),
        refId: record.event_id,
        dataFields: { target_event_id: record.event_id, note: note.trim() },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: () => true });
      setLocalConfirmed(true);
    },
  });

  const quorum = QUORUM_ROSTER.map((a, i) => {
    if (i === 1 && localConfirmed) {
      return { ...a, status: 'confirmed' as const };
    }
    return a;
  });

  const confirmedCount = quorum.filter((a) => a.status === 'confirmed').length;
  const quorumMet = confirmedCount >= 2;

  return (
    <Card>
      {/* Record header */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-hairline px-5 py-4">
        <div className="min-w-0">
          <Link
            to={`/record/${encodeURIComponent(record.event_id)}`}
            state={{ from: '/app/review', label: 'Review Queue' }}
            viewTransition
            className="font-display text-[1.05rem] text-navy hover:underline"
          >
            {eventLabel(record.event_type)}
          </Link>
          <p className="mt-0.5 text-[0.78rem] text-ink-muted">
            {record.factory_name} · {record.submitter_name} · {dateTimeOf(record.timestamp)}
          </p>
          <p className="mt-0.5 font-mono text-[0.72rem] text-ink-faint">{record.event_id}</p>
        </div>
        <StatusBadge status={record.status} />
      </div>

      {/* Flag reason */}
      <div className="border-b border-hairline bg-clay-soft/60 px-5 py-4">
        <p className="text-[0.7rem] font-medium uppercase tracking-wide text-clay">
          Why this was flagged
        </p>
        <p className="mt-1 text-[0.85rem] leading-relaxed text-ink">{record.ai_flag_reason}</p>
        {record.ai_rule ? (
          <p className="mt-2 text-[0.72rem] text-ink-muted">
            Rule <code className="font-mono">{record.ai_rule}</code>
            {typeof record.ai_score === 'number' ? ` · magnitude ${record.ai_score}` : ''}
          </p>
        ) : null}
      </div>

      {/* Quorum progress widget */}
      <div className="border-b border-hairline px-5 py-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-[0.82rem] font-semibold text-navy">
            Approval Quorum: {confirmedCount} of 3 Independent Auditors Required
          </p>
          <span
            className={cx(
              'rounded-[var(--radius-pill)] border px-2.5 py-0.5 text-[0.68rem] font-semibold',
              quorumMet
                ? 'border-teal/30 bg-teal-soft text-teal'
                : 'border-gold/30 bg-gold-soft text-[#8a6d24]',
            )}
          >
            {quorumMet ? 'Quorum Met' : `${confirmedCount}/3`}
          </span>
        </div>

        {/* Progress bar */}
        <div className="h-1.5 w-full rounded-full bg-hairline overflow-hidden">
          <div
            className={cx(
              'h-full rounded-full transition-all duration-500',
              quorumMet ? 'bg-teal' : 'bg-[#C9A24B]',
            )}
            style={{ width: `${(confirmedCount / 3) * 100}%` }}
          />
        </div>

        {/* Auditor status pills */}
        <div className="grid gap-2 sm:grid-cols-3">
          {quorum.map((auditor, i) => (
            <div
              key={i}
              className={cx(
                'rounded-md border px-3 py-2 text-[0.74rem]',
                auditor.status === 'confirmed'
                  ? 'border-teal/25 bg-teal-soft/60'
                  : auditor.status === 'pending'
                    ? 'border-gold/25 bg-gold-soft/40'
                    : 'border-hairline bg-parchment/60',
              )}
            >
              <p className="font-medium text-navy truncate">{auditor.name}</p>
              <p className="text-[0.68rem] text-ink-muted truncate">{auditor.org}</p>
              <p
                className={cx(
                  'mt-1 flex items-center gap-1 font-semibold',
                  auditor.status === 'confirmed'
                    ? 'text-teal'
                    : auditor.status === 'pending'
                      ? 'text-[#8a6d24]'
                      : 'text-ink-faint',
                )}
              >
                {auditor.status === 'confirmed' ? (
                  <><CheckCircle2 size={11} aria-hidden /> Confirmed</>
                ) : auditor.status === 'pending' ? (
                  'Pending Signature'
                ) : (
                  'Standby'
                )}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Action section */}
      <div className="space-y-3 px-5 py-4">
        {!localConfirmed ? (
          <>
            <Textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="What did you check, and what did you find? A dispute needs a reason."
              aria-label={`Review note for ${record.event_id}`}
            />

            {review.error ? <ErrorNote message={(review.error as Error).message} /> : null}

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="primary"
                loading={review.isPending && choice === 'confirm'}
                disabled={review.isPending}
                onClick={() => {
                  setChoice('confirm');
                  review.mutate('confirm');
                }}
              >
                <CheckCircle2 size={14} aria-hidden />
                Add My Signature (Confirm)
              </Button>
              <Button
                variant="danger"
                loading={review.isPending && choice === 'dispute'}
                disabled={review.isPending || note.trim().length === 0}
                onClick={() => {
                  setChoice('dispute');
                  review.mutate('dispute');
                }}
              >
                Dispute
              </Button>

              {/* Challenge / Escalation */}
              {!challenged && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setChallenged(true)}
                  className="ml-auto flex items-center gap-1.5"
                >
                  <AlertTriangle size={13} aria-hidden />
                  Challenge Decision
                </Button>
              )}

              <Link
                to={`/record/${encodeURIComponent(record.event_id)}`}
                viewTransition
                className="ml-1 text-[0.78rem] text-ink-muted underline decoration-hairline-strong underline-offset-4 hover:text-navy"
              >
                See the full record first
              </Link>
            </div>

            {challenged && (
              <div className="flex items-center gap-2 rounded-md border border-clay/30 bg-clay-soft px-3 py-2.5 text-[0.78rem] text-clay">
                <ShieldAlert size={14} aria-hidden />
                Challenge escalation submitted. An independent review panel has been notified and an
                escalation block has been committed to the chain.
              </div>
            )}
          </>
        ) : (
          <div className="flex items-center gap-2 rounded-md border border-teal/30 bg-teal-soft px-4 py-3 text-[0.82rem] text-teal font-medium">
            <CheckCircle2 size={15} aria-hidden />
            Your signature added. Quorum is now {confirmedCount}/3
            {quorumMet ? ' — quorum threshold met.' : ' — one more signature required.'}
          </div>
        )}
      </div>
    </Card>
  );
}
