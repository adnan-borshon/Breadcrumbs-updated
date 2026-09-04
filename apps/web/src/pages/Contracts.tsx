import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { FileText } from 'lucide-react';

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
import { ContractStatusChip } from './Dashboard.tsx';

export function Contracts() {
  const { identity } = useSession();

  const filter =
    identity?.role === 'factory'
      ? { factory: identity.factory_id ?? undefined }
      : identity?.role === 'brand'
        ? { brand: identity.id }
        : {};

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['contracts', filter],
    queryFn: () => api.contracts(filter),
  });

  const contracts = data?.contracts ?? [];
  const active = contracts.filter((c) => c.status === 'active');
  const totalValue = contracts.reduce((sum, c) => sum + c.value_minor, 0);
  const totalInvoiced = contracts.reduce((sum, c) => sum + c.invoiced_minor, 0);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[1.6rem] text-navy">Contracts</h1>
          <p className="mt-1.5 max-w-2xl text-[0.88rem] leading-relaxed text-ink-muted">
            A purchase agreement binds only once both parties have signed it — each signature is
            its own block, made with that party&rsquo;s own key.
          </p>
        </div>
        {identity?.role === 'brand' ? (
          <LinkButton to="/app/contracts/new" variant="primary">
            <FileText size={15} aria-hidden />
            New contract
          </LinkButton>
        ) : null}
      </header>

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Contracts" value={contracts.length} />
        <Stat label="Active" value={active.length} tone="teal" />
        <Stat label="Agreed value" value={money(totalValue)} />
        <Stat
          label="Invoiced to date"
          value={money(totalInvoiced)}
          tone={totalInvoiced > totalValue ? 'clay' : 'default'}
        />
      </div>

      {isPending ? (
        <Spinner label="Loading contracts" />
      ) : isError ? (
        <ErrorNote message={(error as Error).message} />
      ) : contracts.length === 0 ? (
        <EmptyState
          title="No contracts yet"
          description="Contracts appear here once a brand opens one."
        />
      ) : (
        <div className="grid gap-3">
          {contracts.map((contract) => {
            const overBilled = contract.remaining_minor < 0;
            const usedPercent =
              contract.value_minor > 0
                ? Math.min(150, (contract.invoiced_minor / contract.value_minor) * 100)
                : 0;

            return (
              <Link
                key={contract.contract_id}
                to={`/app/contracts/${contract.contract_id}`}
                viewTransition
                className={cx(
                  'block rounded-[var(--radius-card)] border bg-surface p-5 transition-colors',
                  overBilled
                    ? 'border-clay/30 hover:border-clay/50'
                    : 'border-hairline hover:border-hairline-strong',
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[0.98rem] font-medium text-navy">{contract.title}</p>
                    <p className="mt-0.5 text-[0.78rem] text-ink-muted">
                      <span className="font-mono">{contract.contract_id}</span> ·{' '}
                      {contract.factory_name} · {contract.brand_name}
                    </p>
                  </div>
                  <ContractStatusChip status={contract.status} />
                </div>

                <div className="mt-4 grid gap-4 sm:grid-cols-4">
                  <MiniStat label="Value" value={money(contract.value_minor, contract.currency)} />
                  <MiniStat
                    label="Invoiced"
                    value={money(contract.invoiced_minor, contract.currency)}
                    tone={overBilled ? 'clay' : undefined}
                  />
                  <MiniStat
                    label="Remaining"
                    value={money(contract.remaining_minor, contract.currency)}
                    tone={overBilled ? 'clay' : undefined}
                  />
                  <MiniStat label="Delivery" value={dateOf(contract.delivery_date)} />
                </div>

                {/* Billing against the agreed value, shown as a bar rather than a claim. */}
                <div className="mt-3">
                  <div className="h-1.5 overflow-hidden rounded-full bg-parchment-deep">
                    <div
                      className={cx(
                        'h-full rounded-full transition-[width]',
                        overBilled ? 'bg-clay' : 'bg-teal',
                      )}
                      style={{ width: `${Math.min(100, usedPercent)}%` }}
                    />
                  </div>
                  {overBilled ? (
                    <p className="mt-1.5 text-[0.74rem] font-medium text-clay">
                      Invoiced {Math.round((contract.invoiced_minor / contract.value_minor) * 100)}%
                      of the agreed value
                    </p>
                  ) : (
                    <p className="mt-1.5 text-[0.74rem] text-ink-muted">
                      {Math.round(usedPercent)}% invoiced · {contract.signatures.length} of 2
                      signatures
                    </p>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MiniStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'clay';
}) {
  return (
    <div>
      <p className="text-[0.68rem] uppercase tracking-wide text-ink-faint">{label}</p>
      <p className={cx('tabular text-[0.88rem]', tone === 'clay' ? 'text-clay' : 'text-navy')}>
        {value}
      </p>
    </div>
  );
}
