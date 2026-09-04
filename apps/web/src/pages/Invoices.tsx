import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Receipt } from 'lucide-react';

import { api } from '../lib/api.ts';
import { dateOf, money } from '../lib/format.ts';
import { useSession } from '../store/session.ts';
import {
  EmptyState,
  ErrorNote,
  LinkButton,
  Spinner,
  Stat,
  cx,
} from '../components/ui/primitives.tsx';

export function InvoiceStatusChip({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    issued: { label: 'Issued', className: 'border-hairline-strong bg-parchment-deep text-ink-muted' },
    approved: { label: 'Approved', className: 'border-gold/40 bg-gold-soft text-[#8a6d24]' },
    part_paid: { label: 'Part paid', className: 'border-navy/25 bg-navy/8 text-navy' },
    settled: { label: 'Settled', className: 'border-teal/30 bg-teal-soft text-teal' },
    disputed: { label: 'Disputed', className: 'border-clay/30 bg-clay-soft text-clay' },
  };
  const config = map[status] ?? map.issued!;

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

export function Invoices() {
  const { identity } = useSession();
  const [params] = useSearchParams();
  const contract = params.get('contract') ?? undefined;

  const filter = {
    contract,
    ...(identity?.role === 'factory'
      ? { factory: identity.factory_id ?? undefined }
      : identity?.role === 'brand'
        ? { brand: identity.id }
        : {}),
  };

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['invoices', filter],
    queryFn: () => api.invoices(filter),
  });

  const invoices = data?.invoices ?? [];
  const outstanding = invoices.reduce((sum, i) => sum + i.balance_minor, 0);
  const inFlight = invoices.reduce((sum, i) => sum + i.pending_minor, 0);
  const disputed = invoices.filter((i) => i.status === 'disputed').length;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[1.6rem] text-navy">Invoices</h1>
          <p className="mt-1.5 max-w-2xl text-[0.88rem] leading-relaxed text-ink-muted">
            Raised against signed contracts. Balances are folded from settled payments on the
            chain, not stored and edited.
          </p>
        </div>
        {identity?.role === 'factory' ? (
          <LinkButton to="/app/invoices/new" variant="primary">
            <Receipt size={15} aria-hidden />
            Raise an invoice
          </LinkButton>
        ) : null}
      </header>

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Invoices" value={invoices.length} />
        <Stat label="Outstanding" value={money(outstanding)} tone={outstanding > 0 ? 'gold' : 'teal'} />
        <Stat label="In flight" value={money(inFlight)} hint="initiated, not yet settled" />
        <Stat label="Disputed" value={disputed} tone={disputed > 0 ? 'clay' : 'default'} />
      </div>

      {isPending ? (
        <Spinner label="Loading invoices" />
      ) : isError ? (
        <ErrorNote message={(error as Error).message} />
      ) : invoices.length === 0 ? (
        <EmptyState title="No invoices" description="Nothing has been raised yet." />
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-card)] border border-hairline bg-surface">
          <table className="w-full min-w-[48rem] text-left text-[0.82rem]">
            <thead>
              <tr>
                {['Invoice', 'Contract', 'Factory', 'Issued', 'Due', 'Total', 'Paid', 'Balance', 'Status'].map(
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
              {invoices.map((invoice) => (
                <tr key={invoice.invoice_id} className="transition-colors hover:bg-parchment/60">
                  <td className="border-b border-hairline/60 px-3 py-2.5">
                    <Link
                      to={`/app/invoices/${invoice.invoice_id}`}
                      viewTransition
                      className="font-mono text-[0.8rem] font-medium text-navy hover:underline"
                    >
                      {invoice.invoice_id}
                    </Link>
                  </td>
                  <td className="border-b border-hairline/60 px-3 py-2.5">
                    <Link
                      to={`/app/contracts/${invoice.contract_id}`}
                      viewTransition
                      className="font-mono text-[0.76rem] text-ink-muted hover:text-navy hover:underline"
                    >
                      {invoice.contract_id}
                    </Link>
                  </td>
                  <td className="border-b border-hairline/60 px-3 py-2.5 text-ink-muted">
                    {invoice.factory_name}
                  </td>
                  <td className="border-b border-hairline/60 px-3 py-2.5 whitespace-nowrap text-ink-muted">
                    {dateOf(invoice.issued_at)}
                  </td>
                  <td className="border-b border-hairline/60 px-3 py-2.5 whitespace-nowrap text-ink-muted">
                    {dateOf(invoice.due_date)}
                  </td>
                  <td className="border-b border-hairline/60 px-3 py-2.5 tabular whitespace-nowrap">
                    {money(invoice.total_minor, invoice.currency)}
                  </td>
                  <td className="border-b border-hairline/60 px-3 py-2.5 tabular whitespace-nowrap text-teal">
                    {money(invoice.paid_minor, invoice.currency)}
                  </td>
                  <td
                    className={cx(
                      'border-b border-hairline/60 px-3 py-2.5 tabular whitespace-nowrap font-medium',
                      invoice.balance_minor > 0 ? 'text-navy' : 'text-ink-faint',
                    )}
                  >
                    {money(invoice.balance_minor, invoice.currency)}
                  </td>
                  <td className="border-b border-hairline/60 px-3 py-2.5">
                    <InvoiceStatusChip status={invoice.status} />
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
