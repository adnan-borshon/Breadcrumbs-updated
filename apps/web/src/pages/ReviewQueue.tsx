import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
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
} from '../components/ui/primitives.tsx';
import { StatusBadge } from '../components/ledger/StatusBadge.tsx';

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
          Only records the automated check flagged and nobody has ruled on yet. Whichever way you
          decide, the outcome is written to the chain as its own signed block — the record you are
          reviewing is never edited or removed.
        </p>
      </header>

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

  const review = useMutation({
    mutationFn: async (decision: 'confirm' | 'dispute') =>
      commitEvent({
        eventType: decision === 'confirm' ? 'review_confirmed' : 'review_disputed',
        factoryId: record.factory_id,
        eventId: makeEventId(decision === 'confirm' ? 'REV-OK' : 'REV-NO'),
        refId: record.event_id,
        dataFields: { target_event_id: record.event_id, note: note.trim() },
      }),
    onSuccess: () => queryClient.invalidateQueries({ predicate: () => true }),
  });

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-hairline px-5 py-4">
        <div className="min-w-0">
          <Link
            to={`/record/${encodeURIComponent(record.event_id)}`}
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

      <div className="space-y-3 px-5 py-4">
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
            Confirm
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
          <Link
            to={`/record/${encodeURIComponent(record.event_id)}`}
            viewTransition
            className="ml-1 text-[0.78rem] text-ink-muted underline decoration-hairline-strong underline-offset-4 hover:text-navy"
          >
            See the full record first
          </Link>
        </div>
      </div>
    </Card>
  );
}
