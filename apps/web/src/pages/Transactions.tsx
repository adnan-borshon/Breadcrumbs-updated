import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Download, Search } from 'lucide-react';
import { EVENT_FAMILIES, FAMILY_LABEL } from '@breadcrumbs/shared';
import type { Currency, EventFamily, LedgerRecord } from '@breadcrumbs/shared';

import { api } from '../lib/api.ts';
import { dateTimeOf, eventLabel, money } from '../lib/format.ts';
import { useSession } from '../store/session.ts';
import { EmptyState, ErrorNote, Input, Spinner, cx } from '../components/ui/primitives.tsx';
import { HashText } from '../components/ledger/Crypto.tsx';
import { StatusBadgeLink } from '../components/ledger/StatusBadge.tsx';

/**
 * The unified feed: every state-changing event across every module, in one stream.
 *
 * The explorer shows the same blocks as cryptographic objects; this shows them as
 * business events. Same chain, two readings.
 */
export function Transactions() {
  const { identity } = useSession();
  const [families, setFamilies] = useState<EventFamily[]>([]);
  const [term, setTerm] = useState('');

  const factory = identity?.role === 'factory' ? (identity.factory_id ?? undefined) : undefined;

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['transactions', { families, term, factory }],
    queryFn: () =>
      api.transactions({
        family: families.length ? families.join(',') : undefined,
        q: term.trim() || undefined,
        factory,
        limit: 300,
      }),
  });

  const toggle = (family: EventFamily) =>
    setFamilies((current) =>
      current.includes(family) ? current.filter((f) => f !== family) : [...current, family],
    );

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-[1.6rem] text-navy">Transactions</h1>
        <p className="mt-1.5 max-w-2xl text-[0.88rem] leading-relaxed text-ink-muted">
          Every entry across audit, inventory, contracts, invoices and payments — one stream, in
          the order it was written to the chain.
        </p>
      </header>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint"
            aria-hidden
          />
          <Input
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Search by reference, factory, person or value"
            className="pl-9"
            aria-label="Search transactions"
          />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <p className="text-[0.78rem] text-ink-muted">
            {data ? `${data.total} matching` : ''}
          </p>
          <button
            type="button"
            onClick={() =>
              void api.exportTransactions({
                family: families.length ? families.join(',') : undefined,
                factory,
                q: term.trim() || undefined,
                format: 'csv',
              })
            }
            className="inline-flex items-center gap-1.5 rounded-md border border-hairline bg-surface px-2.5 py-1 text-[0.78rem] font-medium text-navy shadow-xs transition-colors hover:border-navy"
            title="Export filtered transactions as CSV spreadsheet"
          >
            <Download size={13} aria-hidden />
            Export CSV
          </button>
          <button
            type="button"
            onClick={() =>
              void api.exportTransactions({
                family: families.length ? families.join(',') : undefined,
                factory,
                q: term.trim() || undefined,
                format: 'json',
              })
            }
            className="inline-flex items-center gap-1.5 rounded-md border border-hairline bg-surface px-2.5 py-1 text-[0.78rem] font-medium text-navy shadow-xs transition-colors hover:border-navy"
            title="Export filtered transactions as verifiable JSON"
          >
            <Download size={13} aria-hidden />
            Export JSON
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {EVENT_FAMILIES.map((family) => {
          const active = families.includes(family);
          return (
            <button
              key={family}
              type="button"
              onClick={() => toggle(family)}
              aria-pressed={active}
              className={cx(
                'rounded-[var(--radius-pill)] border px-3 py-1 text-[0.76rem] transition-colors',
                active
                  ? 'border-navy bg-navy text-parchment'
                  : 'border-hairline bg-surface text-ink-muted hover:border-hairline-strong hover:text-navy',
              )}
            >
              {FAMILY_LABEL[family]}
            </button>
          );
        })}
        {families.length > 0 ? (
          <button
            type="button"
            onClick={() => setFamilies([])}
            className="rounded-[var(--radius-pill)] px-3 py-1 text-[0.76rem] text-ink-muted underline decoration-hairline-strong underline-offset-4 hover:text-navy"
          >
            Clear
          </button>
        ) : null}
      </div>

      {isPending ? (
        <Spinner label="Loading transactions" />
      ) : isError ? (
        <ErrorNote message={(error as Error).message} />
      ) : data.transactions.length === 0 ? (
        <EmptyState title="Nothing matches" description="Try clearing the filters or the search." />
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-card)] border border-hairline bg-surface">
          <table className="w-full min-w-[50rem] text-left text-[0.82rem]">
            <thead>
              <tr>
                {['#', 'When', 'Event', 'Reference', 'Factory', 'By', 'Value', 'Status'].map((heading) => (
                  <th
                    key={heading}
                    scope="col"
                    className="border-b border-hairline px-3 py-2.5 text-[0.68rem] font-semibold uppercase tracking-wide text-ink-muted"
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.transactions.map((record) => (
                <tr key={record.event_id} className="transition-colors hover:bg-parchment/60">
                  <td className="border-b border-hairline/60 px-3 py-2.5 tabular text-ink-faint">
                    {record.block_index}
                  </td>
                  <td className="border-b border-hairline/60 px-3 py-2.5 whitespace-nowrap text-ink-muted">
                    {dateTimeOf(record.timestamp)}
                  </td>
                  <td className="border-b border-hairline/60 px-3 py-2.5">
                    <Link
                      to={`/record/${encodeURIComponent(record.event_id)}`}
                      viewTransition
                      className="font-medium text-navy hover:underline"
                    >
                      {eventLabel(record.event_type)}
                    </Link>
                    <p className="text-[0.68rem] uppercase tracking-wide text-ink-faint">
                      {FAMILY_LABEL[record.event_family]}
                    </p>
                  </td>
                  <td className="border-b border-hairline/60 px-3 py-2.5">
                    <ReferenceCell record={record} />
                  </td>
                  <td className="border-b border-hairline/60 px-3 py-2.5 text-ink-muted">
                    {record.factory_name}
                  </td>
                  <td className="border-b border-hairline/60 px-3 py-2.5 text-ink-muted">
                    {record.submitter_name}
                  </td>
                  <td className="border-b border-hairline/60 px-3 py-2.5 tabular whitespace-nowrap">
                    <ValueCell record={record} />
                  </td>
                  <td className="border-b border-hairline/60 px-3 py-2.5">
                    <StatusBadgeLink status={record.status} eventId={record.event_id} size="sm" compact />
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

/** Shows whichever business reference this event actually carries. */
function ReferenceCell({ record }: { record: LedgerRecord }) {
  const fields = record.data_fields;
  const candidates: [string, string][] = [
    ['contract_id', '/app/contracts/'],
    ['invoice_id', '/app/invoices/'],
    ['payment_id', '/app/payments/'],
  ];

  for (const [key, base] of candidates) {
    const value = fields[key];
    if (typeof value === 'string' && value) {
      return (
        <Link
          to={`${base}${value}`}
          viewTransition
          className="font-mono text-[0.76rem] text-navy hover:underline"
        >
          {value}
        </Link>
      );
    }
  }

  const sku = fields['sku'];
  if (typeof sku === 'string' && sku) {
    return (
      <Link
        to={`/app/inventory/${record.factory_id}/${sku}`}
        viewTransition
        className="font-mono text-[0.76rem] text-navy hover:underline"
      >
        {sku}
      </Link>
    );
  }

  const orderRef = fields['order_ref'] ?? fields['shipment_ref'] ?? fields['certificate_no'];
  if (typeof orderRef === 'string' && orderRef) {
    return <span className="font-mono text-[0.76rem] text-ink-muted">{orderRef}</span>;
  }

  return <HashText value={record.block_hash} label="Block hash" lead={6} tail={4} />;
}

/** Money where there is money, quantity where there is quantity, nothing otherwise. */
function ValueCell({ record }: { record: LedgerRecord }) {
  const fields = record.data_fields;
  const currency = (fields['currency'] as Currency) ?? 'USD';

  const monetary = ['total_minor', 'amount_minor', 'value_minor'].find(
    (key) => typeof fields[key] === 'number',
  );
  if (monetary) {
    return <span className="font-medium text-navy">{money(fields[monetary] as number, currency)}</span>;
  }

  if (typeof fields['quantity'] === 'number') {
    return <span className="text-ink">{(fields['quantity'] as number).toLocaleString('en-US')}</span>;
  }
  if (typeof fields['units_produced'] === 'number') {
    return (
      <span className="text-ink">
        {(fields['units_produced'] as number).toLocaleString('en-US')} units
      </span>
    );
  }

  return <span className="text-ink-faint">—</span>;
}
