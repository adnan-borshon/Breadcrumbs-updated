import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { BackLink } from '../components/ui/BackLink.tsx';
import { PAYMENT_METHOD_LABEL } from '@breadcrumbs/shared';
import type { PaymentMethod } from '@breadcrumbs/shared';

import { api } from '../lib/api.ts';
import { dateTimeOf, money } from '../lib/format.ts';
import { Card, CardHeader, ErrorNote, Spinner, Stat } from '../components/ui/primitives.tsx';
import { EntityAuditTimeline } from '../components/ledger/EntityAuditTimeline.tsx';
import { PaymentStatusChip } from './Payments.tsx';

export function PaymentDetail() {
  const { paymentId = '' } = useParams();

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['payment', paymentId],
    queryFn: () => api.payment(paymentId),
  });

  if (isPending) return <Spinner label="Loading payment" />;
  if (isError) return <ErrorNote title="Payment not found" message={(error as Error).message} />;

  const { payment, invoice, events } = data;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <BackLink defaultTo="/app/payments" defaultLabel="Payments" />

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-mono text-[1.5rem] text-navy">{payment.payment_id}</h1>
          <p className="mt-1 text-[0.85rem] text-ink-muted">
            Against{' '}
            <Link
              to={`/app/invoices/${payment.invoice_id}`}
              viewTransition
              className="font-mono hover:text-navy hover:underline"
            >
              {payment.invoice_id}
            </Link>
          </p>
        </div>
        <PaymentStatusChip status={payment.status} />
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Amount" value={money(payment.amount_minor, payment.currency)} />
        <Stat
          label="Invoice total"
          value={invoice ? money(invoice.total_minor, invoice.currency) : '—'}
        />
        <Stat
          label="Invoice balance"
          value={invoice ? money(invoice.balance_minor, invoice.currency) : '—'}
          tone={invoice && invoice.balance_minor > 0 ? 'gold' : 'teal'}
        />
      </div>

      {payment.status === 'failed' && payment.failure_reason ? (
        <div className="rounded-[var(--radius-card)] border border-clay/30 bg-clay-soft p-4">
          <div className="flex items-start gap-2.5">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-clay" aria-hidden />
            <div>
              <p className="text-[0.86rem] font-semibold text-clay">Payment failed</p>
              <p className="mt-1 text-[0.82rem] leading-relaxed text-ink">{payment.failure_reason}</p>
              <p className="mt-2 text-[0.74rem] text-ink-muted">
                The failed attempt stays on the ledger. It was reversed out of the invoice balance,
                not deleted from the record.
              </p>
            </div>
          </div>
        </div>
      ) : null}

      <Card>
        <CardHeader title="Details" />
        <dl className="divide-y divide-hairline/60">
          <Row
            label="Method"
            value={PAYMENT_METHOD_LABEL[payment.method as PaymentMethod] ?? payment.method}
          />
          <Row label="Reference" value={payment.reference} />
          <Row label="Initiated" value={dateTimeOf(payment.initiated_at)} />
          <Row label="Settled" value={payment.settled_at ? dateTimeOf(payment.settled_at) : 'Not settled'} />
          <Row label="Contract" value={payment.contract_id || '—'} />
        </dl>
      </Card>

      <EntityAuditTimeline
        events={events}
        entityType="payment"
        title="Payment lifecycle audit trail"
        description="Initiation, settlement, and verification are individual blocks written to the ledger."
      />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-3 px-5 py-3">
      <dt className="text-[0.78rem] font-medium text-navy">{label}</dt>
      <dd className="text-[0.82rem] text-ink">{value}</dd>
    </div>
  );
}
