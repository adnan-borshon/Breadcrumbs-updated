import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Beaker, Boxes, Search } from 'lucide-react';
import type { InventoryItemView } from '@breadcrumbs/shared';

import { api } from '../lib/api.ts';
import { dateOf } from '../lib/format.ts';
import { useSession } from '../store/session.ts';
import {
  Card,
  EmptyState,
  ErrorNote,
  Input,
  Spinner,
  Stat,
  cx,
} from '../components/ui/primitives.tsx';

export function Inventory() {
  const { kind = 'materials' } = useParams();
  const { identity } = useSession();
  const [term, setTerm] = useState('');

  const isChemicals = kind === 'chemicals';
  const factory = identity?.role === 'factory' ? (identity.factory_id ?? undefined) : undefined;

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['inventory', kind, factory],
    queryFn: () => (isChemicals ? api.chemicals(factory) : api.materials(factory)),
  });

  const items = (data?.items ?? []).filter((item) =>
    `${item.name} ${item.sku} ${item.supplier ?? ''}`.toLowerCase().includes(term.toLowerCase().trim()),
  );

  const lowCount = items.filter((item) => item.below_reorder).length;
  const restricted = items.filter((item) => item.mrsl_restricted);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="flex items-center gap-2.5 text-[1.6rem] text-navy">
          {isChemicals ? <Beaker size={22} aria-hidden /> : <Boxes size={22} aria-hidden />}
          {isChemicals ? 'Chemicals' : 'Materials'}
        </h1>
        <p className="mt-1.5 max-w-2xl text-[0.88rem] leading-relaxed text-ink-muted">
          Stock levels here are not stored figures. They are calculated by replaying every receipt,
          issue, consumption and disposal on the chain, which is why they cannot silently disagree
          with the ledger.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label={isChemicals ? 'Chemicals tracked' : 'Materials tracked'} value={items.length} />
        <Stat label="Below reorder level" value={lowCount} tone={lowCount > 0 ? 'clay' : 'teal'} />
        {isChemicals ? (
          <Stat
            label="MRSL restricted"
            value={restricted.length}
            tone={restricted.length > 0 ? 'clay' : 'teal'}
            hint="ZDHC restricted substances"
          />
        ) : (
          <Stat
            label="Movements recorded"
            value={items.reduce((sum, item) => sum + item.balance.movement_count, 0)}
          />
        )}
      </div>

      {isChemicals && restricted.length > 0 ? (
        <Card className="border-clay/30 bg-clay-soft">
          <div className="flex items-start gap-2.5 p-4">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-clay" aria-hidden />
            <div>
              <p className="text-[0.86rem] font-semibold text-clay">
                Restricted substances present
              </p>
              <p className="mt-1 text-[0.8rem] leading-relaxed text-ink">
                {restricted.map((item) => item.name).join(', ')} — listed on the ZDHC Manufacturing
                Restricted Substances List. Any remaining stock and its disposal should be
                evidenced on the ledger.
              </p>
            </div>
          </div>
        </Card>
      ) : null}

      <div className="relative max-w-md">
        <Search
          size={15}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint"
          aria-hidden
        />
        <Input
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Search by name, SKU or supplier"
          className="pl-9"
          aria-label="Search inventory"
        />
      </div>

      {isPending ? (
        <Spinner label="Loading stock" />
      ) : isError ? (
        <ErrorNote message={(error as Error).message} />
      ) : items.length === 0 ? (
        <EmptyState title="Nothing to show" description="No item matches that search." />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <ItemCard key={`${item.factory_id}-${item.sku}`} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}

function ItemCard({ item }: { item: InventoryItemView }) {
  const { balance } = item;

  return (
    <Link
      to={`/app/inventory/${item.factory_id}/${item.sku}`}
      viewTransition
      className={cx(
        'block rounded-[var(--radius-card)] border bg-surface p-4 transition-colors',
        item.below_reorder
          ? 'border-clay/30 hover:border-clay/50'
          : 'border-hairline hover:border-hairline-strong',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[0.9rem] font-medium text-navy">{item.name}</p>
          <p className="font-mono text-[0.72rem] text-ink-faint">{item.sku}</p>
        </div>
        {item.mrsl_restricted ? (
          <span className="shrink-0 rounded-[var(--radius-pill)] border border-clay/30 bg-clay-soft px-2 py-0.5 text-[0.66rem] font-medium text-clay">
            MRSL
          </span>
        ) : null}
      </div>

      <div className="mt-3 flex items-baseline gap-1.5">
        <span
          className={cx(
            'font-display text-2xl tabular',
            item.below_reorder ? 'text-clay' : 'text-navy',
          )}
        >
          {balance.on_hand.toLocaleString('en-US', { maximumFractionDigits: 2 })}
        </span>
        <span className="text-[0.78rem] text-ink-muted">{item.unit}</span>
        {item.below_reorder ? (
          <span className="ml-auto inline-flex items-center gap-1 text-[0.72rem] font-medium text-clay">
            <AlertTriangle size={11} aria-hidden />
            below {item.reorder_level.toLocaleString('en-US')}
          </span>
        ) : null}
      </div>

      <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-hairline pt-3 text-[0.72rem]">
        <div>
          <dt className="text-ink-faint">Received</dt>
          <dd className="tabular text-ink">{balance.received.toLocaleString('en-US')}</dd>
        </div>
        <div>
          <dt className="text-ink-faint">{item.kind === 'chemical' ? 'Consumed' : 'Issued'}</dt>
          <dd className="tabular text-ink">
            {(item.kind === 'chemical' ? balance.consumed : balance.issued).toLocaleString('en-US')}
          </dd>
        </div>
        <div>
          <dt className="text-ink-faint">Movements</dt>
          <dd className="tabular text-ink">{balance.movement_count}</dd>
        </div>
      </dl>

      {item.cas_number || item.hazard_class ? (
        <p className="mt-2.5 text-[0.72rem] text-ink-muted">
          {item.cas_number ? `CAS ${item.cas_number}` : null}
          {item.cas_number && item.hazard_class ? ' · ' : null}
          {item.hazard_class}
        </p>
      ) : null}

      {balance.last_movement_at ? (
        <p className="mt-1 text-[0.7rem] text-ink-faint">
          Last movement {dateOf(balance.last_movement_at)}
        </p>
      ) : null}
    </Link>
  );
}
