import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Blocks, ExternalLink } from 'lucide-react';
import { EVENT_FAMILY, FAMILY_LABEL } from '@breadcrumbs/shared';
import type { Currency, LedgerRecord } from '@breadcrumbs/shared';

import { api } from '../lib/api.ts';
import { dateTimeOf, eventLabel, fieldLabel, fieldValue, money } from '../lib/format.ts';
import { commitEvent, makeEventId } from '../lib/signer.ts';
import { useSession } from '../store/session.ts';
import {
  Button,
  Card,
  CardHeader,
  ErrorNote,
  Spinner,
  Textarea,
  cx,
} from '../components/ui/primitives.tsx';
import {
  AiVerdict,
  ReviewOutcome,
  SignatureCard,
  Submitter,
} from '../components/ledger/Attribution.tsx';
import { CopyVerificationLink, HashRow, TechnicalDetails } from '../components/ledger/Crypto.tsx';
import { StatusBadge } from '../components/ledger/StatusBadge.tsx';

export function RecordDetail() {
  const { eventId = '' } = useParams();

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['record', eventId],
    queryFn: () => api.record(eventId),
    enabled: eventId.length > 0,
  });

  if (isPending) return <Spinner label="Loading record" />;
  if (isError) {
    return (
      <div className="mx-auto max-w-2xl py-8">
        <ErrorNote title="Record not found" message={(error as Error).message} />
        <div className="mt-4">
          <Link to="/explorer" viewTransition className="text-[0.85rem] text-navy hover:underline">
            ← Back to the explorer
          </Link>
        </div>
      </div>
    );
  }

  const record = data.record;

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <Link
        to="/explorer"
        viewTransition
        className="inline-flex items-center gap-1.5 text-[0.8rem] text-ink-muted transition-colors hover:text-navy"
      >
        <ArrowLeft size={14} aria-hidden />
        Explorer
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[0.75rem] uppercase tracking-wide text-ink-faint">
            {FAMILY_LABEL[EVENT_FAMILY[record.event_type]]}
          </p>
          <h1 className="mt-1 text-[1.6rem] text-navy">{eventLabel(record.event_type)}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[0.85rem] text-ink-muted">
            <span className="font-mono text-[0.8rem]">{record.event_id}</span>
            <span aria-hidden>·</span>
            <Link
              to={`/lookup/${record.factory_id}`}
              viewTransition
              className="hover:text-navy hover:underline"
            >
              {record.factory_name}
            </Link>
            <span aria-hidden>·</span>
            {dateTimeOf(record.timestamp)}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <StatusBadge status={record.status} />
          <CopyVerificationLink eventId={record.event_id} />
        </div>
      </header>

      {/* The three questions, in order. */}
      <div className="grid gap-3 lg:grid-cols-3">
        <div className="lg:col-span-3">
          <SignatureCard record={record} />
        </div>
        <div className="lg:col-span-3">
          <AiVerdict
            flagged={record.ai_flag}
            reason={record.ai_flag_reason}
            rule={record.ai_rule}
            score={record.ai_score}
          />
        </div>
        <div className="lg:col-span-3">
          <ReviewOutcome record={record} />
        </div>
      </div>

      <AuditorActions record={record} />

      {/* ----------------------------------------------------- the content */}
      <Card>
        <CardHeader
          title="Submitted values"
          description="Exactly as they were signed. Nothing here has been recomputed or normalised."
        />
        <dl className="divide-y divide-hairline/60">
          {Object.entries(record.data_fields).map(([key, value]) => (
            <DataRow key={key} field={key} value={value} record={record} />
          ))}
        </dl>
      </Card>

      <RelatedLinks record={record} />

      {/* ------------------------------------------------------ the crypto */}
      <Card>
        <CardHeader
          title="Position on the chain"
          description={`Block ${record.block_index}`}
          action={
            <Link
              to="/explorer"
              viewTransition
              className="inline-flex items-center gap-1.5 text-[0.78rem] text-navy hover:underline"
            >
              <Blocks size={13} aria-hidden />
              View in explorer
            </Link>
          }
        />
        <div className="px-5 py-3">
          <HashRow
            label="This block's hash"
            value={record.block_hash}
            hint="SHA-256 of this block's contents, including the AI verdict."
          />
          <HashRow
            label="Previous block's hash"
            value={record.previous_block_hash}
            hint="What links this record to everything before it."
          />
          <HashRow
            label="Signature"
            value={record.signature}
            hint="ECDSA P-256, produced on the submitter's device."
          />

          <div className="mt-4">
            <TechnicalDetails summary="Show the exact signed payload">
              <p className="mb-2 text-[0.76rem] text-ink-muted">
                These are the canonical bytes the signature covers. Keys are sorted so the same
                record always produces the same hash, whatever order the fields arrive in.
              </p>
              <pre className="crypto max-h-72 overflow-auto rounded-md border border-hairline bg-parchment/70 p-3 text-[0.7rem] leading-relaxed">
                {JSON.stringify(
                  {
                    event_id: record.event_id,
                    factory_id: record.factory_id,
                    event_type: record.event_type,
                    timestamp: record.timestamp,
                    submitter_id: record.submitter_id,
                    submitter_name: record.submitter_name,
                    submitter_role: record.submitter_role,
                    data_fields: record.data_fields,
                    ref_id: record.ref_id,
                  },
                  null,
                  2,
                )}
              </pre>
            </TechnicalDetails>
          </div>
        </div>
      </Card>

      <Card className="p-5">
        <Submitter
          name={record.submitter_name}
          role={record.submitter_role}
          timestamp={record.timestamp}
        />
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------ fragments */

function DataRow({
  field,
  value,
  record,
}: {
  field: string;
  value: unknown;
  record: LedgerRecord;
}) {
  const currency = (record.data_fields['currency'] as Currency) ?? 'USD';

  // Invoice line items deserve a real table, not a "4 items" summary.
  if (field === 'line_items' && Array.isArray(value)) {
    return (
      <div className="px-5 py-3">
        <dt className="text-[0.78rem] font-medium text-navy">Line items</dt>
        <dd className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[24rem] text-[0.78rem]">
            <thead>
              <tr className="text-[0.68rem] uppercase tracking-wide text-ink-faint">
                <th scope="col" className="pb-1.5 text-left font-medium">Description</th>
                <th scope="col" className="pb-1.5 text-right font-medium">Qty</th>
                <th scope="col" className="pb-1.5 text-right font-medium">Unit</th>
                <th scope="col" className="pb-1.5 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {(value as { description: string; quantity: number; unit_price_minor: number; amount_minor: number }[]).map(
                (item, index) => (
                  <tr key={index} className="border-t border-hairline/60">
                    <td className="py-1.5 pr-3">{item.description}</td>
                    <td className="py-1.5 text-right tabular">{item.quantity.toLocaleString('en-US')}</td>
                    <td className="py-1.5 text-right tabular">{money(item.unit_price_minor, currency)}</td>
                    <td className="py-1.5 text-right tabular font-medium">
                      {money(item.amount_minor, currency)}
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </dd>
      </div>
    );
  }

  const isLong = typeof value === 'string' && value.length > 70;

  return (
    <div
      className={cx(
        'gap-3 px-5 py-3',
        isLong ? 'block' : 'flex flex-wrap items-baseline justify-between',
      )}
    >
      <dt className="text-[0.78rem] font-medium text-navy">{fieldLabel(field)}</dt>
      <dd
        className={cx(
          'text-[0.82rem] text-ink',
          isLong ? 'mt-1 leading-relaxed' : 'tabular text-right',
        )}
      >
        {fieldValue(field, value, currency)}
      </dd>
    </div>
  );
}

/** Links a record back to the entity it acts on, so the ledger doesn't read as silos. */
function RelatedLinks({ record }: { record: LedgerRecord }) {
  const fields = record.data_fields;
  const links: { label: string; to: string; value: string }[] = [];

  const contractId = fields['contract_id'];
  const invoiceId = fields['invoice_id'];
  const paymentId = fields['payment_id'];
  const targetEventId = fields['target_event_id'];
  const sku = fields['sku'];

  if (typeof contractId === 'string' && contractId) {
    links.push({ label: 'Contract', to: `/app/contracts/${contractId}`, value: contractId });
  }
  if (typeof invoiceId === 'string' && invoiceId) {
    links.push({ label: 'Invoice', to: `/app/invoices/${invoiceId}`, value: invoiceId });
  }
  if (typeof paymentId === 'string' && paymentId) {
    links.push({ label: 'Payment', to: `/app/payments/${paymentId}`, value: paymentId });
  }
  if (typeof targetEventId === 'string' && targetEventId) {
    links.push({ label: 'Reviewed record', to: `/record/${targetEventId}`, value: targetEventId });
  }
  if (typeof sku === 'string' && sku) {
    links.push({
      label: 'Inventory item',
      to: `/app/inventory/${record.factory_id}/${sku}`,
      value: sku,
    });
  }

  if (links.length === 0) return null;

  return (
    <Card>
      <CardHeader title="Related" description="Where this record sits in the wider picture." />
      <ul className="divide-y divide-hairline/60">
        {links.map((link) => (
          <li key={`${link.label}-${link.value}`}>
            <Link
              to={link.to}
              viewTransition
              className="flex items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-parchment-deep"
            >
              <span className="text-[0.78rem] text-ink-muted">{link.label}</span>
              <span className="inline-flex items-center gap-1.5 font-mono text-[0.8rem] text-navy">
                {link.value}
                <ExternalLink size={12} className="opacity-50" aria-hidden />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/**
 * Confirm / dispute, available to auditors on any record still awaiting a decision.
 *
 * Both outcomes write a *new* signed block. Neither edits or removes the record being
 * reviewed — which is why there is no "delete" here and never will be.
 */
function AuditorActions({ record }: { record: LedgerRecord }) {
  const { identity } = useSession();
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
    onSuccess: () => {
      setChoice(null);
      setNote('');
      void queryClient.invalidateQueries({ predicate: () => true });
    },
  });

  if (identity?.role !== 'auditor' || record.human_review_status !== 'none') return null;

  return (
    <Card>
      <CardHeader
        title="Your decision"
        description="Both outcomes are written to the chain as a new signed block. The record below is never altered."
      />
      <div className="space-y-3 px-5 py-4">
        <Textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="What did you check, and what did you conclude? A dispute requires a reason."
          aria-label="Review note"
        />

        {review.error ? <ErrorNote message={(review.error as Error).message} /> : null}

        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            loading={review.isPending && choice === 'confirm'}
            disabled={review.isPending}
            onClick={() => {
              setChoice('confirm');
              review.mutate('confirm');
            }}
          >
            Confirm this record
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
          {note.trim().length === 0 ? (
            <p className="self-center text-[0.74rem] text-ink-faint">
              A dispute needs a written reason.
            </p>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
