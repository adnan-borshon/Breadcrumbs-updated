import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { PAYMENT_METHOD_LABEL } from '@breadcrumbs/shared';
import type { PaymentMethod } from '@breadcrumbs/shared';

import { api } from '../lib/api.ts';
import { dateOf, money } from '../lib/format.ts';
import { useSession } from '../store/session.ts';
import { EmptyState, ErrorNote, Spinner, Stat, cx } from '../components/ui/primitives.tsx';

export function PaymentStatusChip({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    initiated: { label: 'In flight', className: 'border-gold/40 bg-gold-soft text-[#8a6d24]' },
    settled: { label: 'Settled', className: 'border-teal/30 bg-teal-soft text-teal' },
    failed: { label: 'Failed', className: 'border-clay/30 bg-clay-soft text-clay' },
  };
  const config = map[status] ?? map.initiated!;

  return (
    <span
      className={cx(
        'inline-flex whitespace-nowrap rounded-[var(--radius-pill)] border px-2.5 py-1 text-[0.72rem] font-medium',
        config.className,
      )}
    >
      {config.label}
    </span>
  );
}

export function Payments() {
  const { identity } = useSession();

  const filter =
    identity?.role === 'factory'
      ? { factory: identity.factory_id ?? undefined }
      : identity?.role === 'brand'
        ? { brand: identity.id }
        : {};

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['payments', filter],
    queryFn: () => api.payments(filter),
  });

  const payments = data?.payments ?? [];
  const settled = payments.filter((p) => p.status === 'settled');
  const inFlight = payments.filter((p) => p.status === 'initiated');
  const failed = payments.filter((p) => p.status === 'failed');

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-[1.6rem] text-navy">Payments</h1>
        <p className="mt-1.5 max-w-2xl text-[0.88rem] leading-relaxed text-ink-muted">
          Money moves in two steps on this ledger: initiating a payment and settling it are separate
          signed entries, because they are separate facts. A failed payment stays on the record.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Payments" value={payments.length} />
        <Stat
          label="Settled"
          value={money(settled.reduce((sum, p) => sum + p.amount_minor, 0))}
          tone="teal"
        />
        <Stat
          label="In flight"
          value={money(inFlight.reduce((sum, p) => sum + p.amount_minor, 0))}
          tone={inFlight.length > 0 ? 'gold' : 'default'}
        />
        <Stat label="Failed" value={failed.length} tone={failed.length > 0 ? 'clay' : 'default'} />
      </div>

      {isPending ? (
        <Spinner label="Loading payments" />
      ) : isError ? (
        <ErrorNote message={(error as Error).message} />
      ) : payments.length === 0 ? (
        <EmptyState
          title="No payments"
          description="Payments appear here once a buyer raises one against an invoice."
        />
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-card)] border border-hairline bg-surface">
          <table className="w-full min-w-[46rem] text-left text-[0.82rem]">
            <thead>
              <tr>
                {['Payment', 'Invoice', 'Method', 'Reference', 'Initiated', 'Settled', 'Amount', 'Status'].map(
                  (heading) => (
                    <th
                      key={heading}
                      scope="col"
                      className="border-b border-hairline px-3 py-2.5 text-[0.68rem] font-semibold uppercase tracking-wide text-ink-muted"
                    >
                      {heading}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {payments.map((payment) => (
                <tr key={payment.payment_id} className="transition-colors hover:bg-parchment/60">
                  <td className="border-b border-hairline/60 px-3 py-2.5">
                    <Link
                      to={`/app/payments/${payment.payment_id}`}
                      viewTransition
                      className="font-mono text-[0.78rem] font-medium text-navy hover:underline"
                    >
                      {payment.payment_id}
                    </Link>
                  </td>
                  <td className="border-b border-hairline/60 px-3 py-2.5">
                    <Link
                      to={`/app/invoices/${payment.invoice_id}`}
                      viewTransition
                      className="font-mono text-[0.76rem] text-ink-muted hover:text-navy hover:underline"
                    >
                      {payment.invoice_id}
                    </Link>
                  </td>
                  <td className="border-b border-hairline/60 px-3 py-2.5 whitespace-nowrap text-ink-muted">
                    {PAYMENT_METHOD_LABEL[payment.method as PaymentMethod] ?? payment.method}
                  </td>
                  <td className="border-b border-hairline/60 px-3 py-2.5 font-mono text-[0.76rem] text-ink-muted">
                    {payment.reference}
                  </td>
                  <td className="border-b border-hairline/60 px-3 py-2.5 whitespace-nowrap text-ink-muted">
                    {dateOf(payment.initiated_at)}
                  </td>
                  <td className="border-b border-hairline/60 px-3 py-2.5 whitespace-nowrap text-ink-muted">
                    {payment.settled_at ? dateOf(payment.settled_at) : '—'}
                  </td>
                  <td
                    className={cx(
                      'border-b border-hairline/60 px-3 py-2.5 tabular whitespace-nowrap font-medium',
                      payment.status === 'failed' ? 'text-ink-faint line-through' : 'text-navy',
                    )}
                  >
                    {money(payment.amount_minor, payment.currency)}
                  </td>
                  <td className="border-b border-hairline/60 px-3 py-2.5">
                    <PaymentStatusChip status={payment.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
