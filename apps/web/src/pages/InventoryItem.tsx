import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, PackagePlus, Search, SlidersHorizontal, X } from 'lucide-react';
import type { EventType } from '@breadcrumbs/shared';

import { api } from '../lib/api.ts';
import { dateTimeOf, eventLabel } from '../lib/format.ts';
import { commitEvent, makeEventId } from '../lib/signer.ts';
import { useSession } from '../store/session.ts';
import {
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  Select,
  Spinner,
  Stat,
  cx,
} from '../components/ui/primitives.tsx';
import { StatusBadgeLink } from '../components/ledger/StatusBadge.tsx';
import { PaginationBar } from '../components/ui/PaginationBar.tsx';

const MOVEMENTS: { type: EventType; label: string; kinds: ('material' | 'chemical')[] }[] = [
  { type: 'material_receipt', label: 'Receive material', kinds: ['material'] },
  { type: 'material_issue', label: 'Issue to production', kinds: ['material'] },
  { type: 'chemical_receipt', label: 'Receive chemical', kinds: ['chemical'] },
  { type: 'chemical_consumption', label: 'Record consumption', kinds: ['chemical'] },
  { type: 'chemical_disposal', label: 'Record disposal', kinds: ['chemical'] },
  { type: 'stock_adjustment', label: 'Stock correction', kinds: ['material', 'chemical'] },
];

export function InventoryItemPage() {
  const { factoryId = '', sku = '' } = useParams();

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['inventory', 'item', factoryId, sku],
    queryFn: () => api.inventoryItem(factoryId, sku),
  });

  if (isPending) return <Spinner label="Loading item" />;
  if (isError) return <ErrorNote title="Item not found" message={(error as Error).message} />;

  const { item, ledger } = data;
  const { balance } = item;

  const [directionFilter, setDirectionFilter] = useState<'all' | 'inflow' | 'outflow' | 'adjustment'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);

  const movementsWithBalance = useMemo(() => {
    let cumulative = 0;
    return [...ledger]
      .sort((a, b) => a.block_index - b.block_index)
      .map((record) => {
        const quantity = (record.data_fields['quantity'] as number) ?? 0;
        const isInflow =
          record.event_type === 'material_receipt' || record.event_type === 'chemical_receipt';
        const isStockAdj = record.event_type === 'stock_adjustment';

        let delta = 0;
        if (isInflow) {
          delta = Math.abs(quantity);
        } else if (isStockAdj) {
          delta = quantity;
        } else {
          delta = -Math.abs(quantity);
        }

        cumulative += delta;
        return {
          record,
          delta,
          quantity,
          balanceAfter: cumulative,
          isInflow,
          isStockAdj,
        };
      });
  }, [ledger]);

  const filteredMovements = useMemo(() => {
    return movementsWithBalance.filter(({ record, isInflow, isStockAdj }) => {
      if (directionFilter === 'inflow' && !isInflow) return false;
      if (directionFilter === 'outflow' && (isInflow || isStockAdj)) return false;
      if (directionFilter === 'adjustment' && !isStockAdj) return false;

      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const match =
          record.block_index.toString().includes(q) ||
          record.event_id.toLowerCase().includes(q) ||
          record.event_type.toLowerCase().includes(q) ||
          record.submitter_name.toLowerCase().includes(q) ||
          JSON.stringify(record.data_fields).toLowerCase().includes(q);
        if (!match) return false;
      }

      return true;
    });
  }, [movementsWithBalance, directionFilter, searchTerm]);

  const sortedMovements = useMemo(() => {
    return [...filteredMovements].sort((a, b) => {
      const diff = a.record.block_index - b.record.block_index;
      return sortOrder === 'asc' ? diff : -diff;
    });
  }, [filteredMovements, sortOrder]);

  const totalPages = Math.ceil(sortedMovements.length / pageSize) || 1;
  const pagedMovements = sortedMovements.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <Link
        to={`/app/inventory/${item.kind === 'chemical' ? 'chemicals' : 'materials'}`}
        viewTransition
        className="inline-flex items-center gap-1.5 text-[0.8rem] text-ink-muted transition-colors hover:text-navy"
      >
        <ArrowLeft size={14} aria-hidden />
        {item.kind === 'chemical' ? 'Chemicals' : 'Materials'}
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[1.6rem] text-navy">{item.name}</h1>
          <p className="mt-1 font-mono text-[0.82rem] text-ink-muted">
            {item.sku} · {item.factory_id}
          </p>
        </div>
        {item.mrsl_restricted ? (
          <span className="inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] border border-clay/30 bg-clay-soft px-3 py-1 text-[0.74rem] font-medium text-clay">
            <AlertTriangle size={12} aria-hidden />
            ZDHC MRSL restricted
          </span>
        ) : null}
      </header>

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat
          label="On hand"
          value={`${balance.on_hand.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${item.unit}`}
          tone={item.below_reorder ? 'clay' : 'default'}
          hint={item.below_reorder ? `below reorder level of ${item.reorder_level}` : undefined}
        />
        <Stat label="Received" value={balance.received.toLocaleString('en-US')} />
        <Stat
          label={item.kind === 'chemical' ? 'Consumed' : 'Issued'}
          value={(item.kind === 'chemical' ? balance.consumed : balance.issued).toLocaleString('en-US')}
        />
        <Stat label="Movements" value={balance.movement_count} />
      </div>

      {/* the arithmetic, shown rather than asserted */}
      <Card className="p-4">
        <p className="text-[0.72rem] font-medium uppercase tracking-wide text-ink-muted">
          How this balance is calculated
        </p>
        <p className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1 font-mono text-[0.8rem] text-ink">
          <span className="text-teal">{balance.received.toLocaleString('en-US')} received</span>
          <span className="text-ink-faint">−</span>
          <span>{balance.issued.toLocaleString('en-US')} issued</span>
          <span className="text-ink-faint">−</span>
          <span>{balance.consumed.toLocaleString('en-US')} consumed</span>
          <span className="text-ink-faint">−</span>
          <span>{balance.disposed.toLocaleString('en-US')} disposed</span>
          <span className="text-ink-faint">+</span>
          <span>{balance.adjusted.toLocaleString('en-US')} adjusted</span>
          <span className="text-ink-faint">=</span>
          <span className="font-semibold text-navy">
            {balance.on_hand.toLocaleString('en-US')} {item.unit}
          </span>
        </p>
      </Card>

      {(item.cas_number || item.hazard_class || item.supplier) && (
        <Card>
          <CardHeader title="Substance details" />
          <dl className="divide-y divide-hairline/60">
            {item.cas_number ? <DetailRow label="CAS number" value={item.cas_number} /> : null}
            {item.hazard_class ? <DetailRow label="Hazard class" value={item.hazard_class} /> : null}
            {item.supplier ? <DetailRow label="Supplier" value={item.supplier} /> : null}
            <DetailRow label="Unit" value={item.unit} />
            <DetailRow label="Reorder level" value={item.reorder_level.toLocaleString('en-US')} />
          </dl>
        </Card>
      )}

      <MovementForm item={item} />

      <Card>
        <CardHeader
          title="Movement ledger"
          description="Every block that touched this SKU. Sequential running balance calculated from the immutable chain."
          action={
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search
                  size={13}
                  className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint"
                  aria-hidden
                />
                <Input
                  value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value);
                    setPage(1);
                  }}
                  placeholder="Filter SKU movements…"
                  className="h-7 w-36 pl-7 text-[0.74rem] sm:w-44"
                />
                {searchTerm && (
                  <button
                    type="button"
                    onClick={() => setSearchTerm('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-faint hover:text-navy"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'))}
                className="inline-flex items-center gap-1 rounded border border-hairline bg-surface px-2 py-1 text-[0.74rem] font-medium text-navy hover:border-navy"
                title="Toggle chronological order"
              >
                <SlidersHorizontal size={11} />
                {sortOrder === 'desc' ? 'Newest first' : 'Oldest first'}
              </button>
            </div>
          }
        />

        {/* Direction filter tabs */}
        <div className="flex flex-wrap items-center gap-1.5 border-b border-hairline/60 bg-parchment/40 px-5 py-2.5">
          <span className="text-[0.72rem] font-semibold uppercase tracking-wide text-ink-faint mr-1">
            Movement Type:
          </span>
          {(
            [
              { id: 'all', label: `All (${movementsWithBalance.length})` },
              { id: 'inflow', label: 'Inflows (+ Receipts)' },
              { id: 'outflow', label: 'Outflows (− Usage)' },
              { id: 'adjustment', label: 'Corrections (⚠ Adjustments)' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setDirectionFilter(tab.id);
                setPage(1);
              }}
              className={cx(
                'rounded-[var(--radius-pill)] border px-2.5 py-0.5 text-[0.74rem] transition-colors',
                directionFilter === tab.id
                  ? 'border-navy bg-navy text-parchment font-medium'
                  : 'border-hairline bg-surface text-ink-muted hover:border-hairline-strong hover:text-navy',
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {ledger.length === 0 ? (
          <div className="p-5">
            <EmptyState title="No movements yet" />
          </div>
        ) : sortedMovements.length === 0 ? (
          <div className="p-5">
            <EmptyState
              title="No movements match filter"
              description="Try broadening your search term or selecting All movements."
            />
          </div>
        ) : (
          <div className="space-y-1">
            <ul className="divide-y divide-hairline/60">
              {pagedMovements.map(({ record, delta, quantity, balanceAfter, isInflow, isStockAdj }) => {
                return (
                  <li
                    key={record.event_id}
                    className={cx(
                      'px-5 py-3.5 transition-colors hover:bg-parchment/40',
                      isStockAdj ? 'bg-gold-soft/25' : '',
                    )}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="rounded bg-parchment-deep px-1.5 py-0.5 font-mono text-[0.68rem] text-ink-muted">
                            #{record.block_index}
                          </span>
                          <Link
                            to={`/record/${encodeURIComponent(record.event_id)}`}
                            viewTransition
                            className="text-[0.88rem] font-medium text-navy hover:underline"
                          >
                            {eventLabel(record.event_type)}
                          </Link>
                        </div>
                        <p className="mt-0.5 text-[0.74rem] text-ink-muted">
                          {dateTimeOf(record.timestamp)} · {record.submitter_name}
                        </p>
                      </div>

                      {/* Movement quantity & Running balance indicators */}
                      <div className="flex items-center gap-5">
                        <div className="text-right">
                          <p
                            className={cx(
                              'tabular text-[0.88rem] font-semibold',
                              isInflow
                                ? 'text-teal'
                                : isStockAdj
                                  ? delta >= 0
                                    ? 'text-[#8a6d24]'
                                    : 'text-clay'
                                  : 'text-ink',
                            )}
                          >
                            {delta > 0 ? '+' : ''}
                            {delta.toLocaleString('en-US')} {item.unit}
                          </p>
                          <p className="text-[0.72rem] text-ink-faint">
                            Balance after:{' '}
                            <span className="font-medium text-navy">
                              {balanceAfter.toLocaleString('en-US')} {item.unit}
                            </span>
                          </p>
                        </div>

                        <StatusBadgeLink status={record.status} eventId={record.event_id} size="sm" compact />
                      </div>
                    </div>

                    {isStockAdj && (
                      <div className="mt-2.5 flex items-start gap-2 rounded-md border border-gold/40 bg-gold-soft px-3 py-2 text-[0.73rem]">
                        <AlertTriangle size={13} className="mt-0.5 shrink-0 text-[#8a6d24]" aria-hidden />
                        <div>
                          <p className="font-semibold text-[#8a6d24]">
                            ⚠ Manual Stock Adjustment
                            {typeof quantity === 'number'
                              ? `: ${quantity > 0 ? '+' : ''}${quantity.toLocaleString('en-US')} ${item.unit}`
                              : ''}
                          </p>
                          <p className="mt-0.5 text-[#8a6d24]/90">
                            Requires physical inventory count reconciliation. Manual overrides bypass
                            the normal supply chain flow and must be independently audited.
                            {record.data_fields['reason']
                              ? ` Stated reason: "${String(record.data_fields['reason'])}."`
                              : ' No reason was provided.'}
                          </p>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>

            <div className="px-5 pb-2">
              <PaginationBar
                page={page}
                totalPages={totalPages}
                totalItems={sortedMovements.length}
                pageSize={pageSize}
                onPageChange={setPage}
                onPageSizeChange={setPageSize}
              />
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-3 px-5 py-3">
      <dt className="text-[0.78rem] font-medium text-navy">{label}</dt>
      <dd className="text-[0.82rem] text-ink">{value}</dd>
    </div>
  );
}

/** Records a stock movement — a signed chain event like everything else. */
function MovementForm({ item }: { item: { sku: string; factory_id: string; kind: string; unit: string } }) {
  const { identity } = useSession();
  const queryClient = useQueryClient();

  const options = MOVEMENTS.filter((movement) =>
    movement.kinds.includes(item.kind as 'material' | 'chemical'),
  );

  const [type, setType] = useState<EventType>(options[0]?.type ?? 'stock_adjustment');
  const [values, setValues] = useState<Record<string, string>>({});

  const set = (key: string, value: string) =>
    setValues((current) => ({ ...current, [key]: value }));

  const commit = useMutation({
    mutationFn: async () => {
      const quantity = Number(values['quantity'] ?? 0);
      const base: Record<string, unknown> = { sku: item.sku, quantity };

      switch (type) {
        case 'material_receipt':
          Object.assign(base, {
            unit_cost_minor: Math.round(Number(values['unit_cost'] ?? 0) * 100),
            supplier: values['supplier']?.trim() ?? '',
            grn_ref: values['grn_ref']?.trim() ?? '',
            lot_no: values['lot_no']?.trim() ?? '',
          });
          break;
        case 'material_issue':
          Object.assign(base, {
            order_ref: values['order_ref']?.trim() ?? '',
            line: values['line']?.trim() ?? '',
          });
          break;
        case 'chemical_receipt':
          Object.assign(base, {
            supplier: values['supplier']?.trim() ?? '',
            lot_no: values['lot_no']?.trim() ?? '',
            msds_ref: values['msds_ref']?.trim() ?? '',
            expiry_date: values['expiry_date'] ?? '',
          });
          break;
        case 'chemical_consumption':
          Object.assign(base, {
            units_processed: Number(values['units_processed'] ?? 0),
            process: values['process']?.trim() ?? '',
          });
          break;
        case 'chemical_disposal':
          Object.assign(base, {
            disposal_method: values['disposal_method']?.trim() ?? '',
            permit_ref: values['permit_ref']?.trim() ?? '',
          });
          break;
        case 'stock_adjustment':
          Object.assign(base, { reason: values['reason']?.trim() ?? '' });
          break;
        default:
          break;
      }

      return commitEvent({
        eventType: type,
        factoryId: item.factory_id,
        eventId: makeEventId('MOV'),
        dataFields: base,
      });
    },
    onSuccess: () => {
      setValues({});
      void queryClient.invalidateQueries({ predicate: () => true });
    },
  });

  if (identity?.role !== 'factory' || identity.factory_id !== item.factory_id) return null;

  const extras: { name: string; label: string; type?: string; step?: string }[] =
    type === 'material_receipt'
      ? [
          { name: 'supplier', label: 'Supplier' },
          { name: 'grn_ref', label: 'GRN reference' },
          { name: 'unit_cost', label: 'Unit cost', type: 'number', step: '0.01' },
          { name: 'lot_no', label: 'Lot number' },
        ]
      : type === 'material_issue'
        ? [
            { name: 'order_ref', label: 'Order reference' },
            { name: 'line', label: 'Line' },
          ]
        : type === 'chemical_receipt'
          ? [
              { name: 'supplier', label: 'Supplier' },
              { name: 'lot_no', label: 'Lot number' },
              { name: 'expiry_date', label: 'Expiry date', type: 'date' },
              { name: 'msds_ref', label: 'Safety data sheet ref' },
            ]
          : type === 'chemical_consumption'
            ? [
                { name: 'units_processed', label: 'Units processed', type: 'number' },
                { name: 'process', label: 'Process' },
              ]
            : type === 'chemical_disposal'
              ? [
                  { name: 'disposal_method', label: 'Disposal method' },
                  { name: 'permit_ref', label: 'Permit reference' },
                ]
              : [{ name: 'reason', label: 'Reason' }];

  return (
    <Card>
      <CardHeader
        title="Record a movement"
        description="Signed on this device and appended to the chain. The balance above recalculates from it."
      />
      <form
        className="space-y-4 px-5 py-4"
        onSubmit={(event) => {
          event.preventDefault();
          commit.mutate();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Movement" required>
            <Select
              value={type}
              onChange={(event) => {
                setType(event.target.value as EventType);
                setValues({});
              }}
            >
              {options.map((option) => (
                <option key={option.type} value={option.type}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label={`Quantity (${item.unit})`}
            required
            hint={
              type === 'stock_adjustment'
                ? 'Negative to reduce, positive to increase.'
                : type === 'material_issue' || type === 'chemical_consumption'
                  ? 'More than the ledger shows in stock will be flagged.'
                  : undefined
            }
          >
            <Input
              type="number"
              step="any"
              required
              value={values['quantity'] ?? ''}
              onChange={(event) => set('quantity', event.target.value)}
            />
          </Field>

          {extras.map((extra) => (
            <Field key={extra.name} label={extra.label}>
              <Input
                type={extra.type ?? 'text'}
                step={extra.step}
                value={values[extra.name] ?? ''}
                onChange={(event) => set(extra.name, event.target.value)}
              />
            </Field>
          ))}
        </div>

        {commit.error ? <ErrorNote message={(commit.error as Error).message} /> : null}

        {commit.data?.anomaly.flagged ? (
          <ErrorNote
            title="Committed, and flagged for review"
            message={commit.data.anomaly.reason ?? 'The automated check raised this record.'}
          />
        ) : null}

        <Button type="submit" variant="primary" loading={commit.isPending}>
          <PackagePlus size={15} aria-hidden />
          Sign and record
        </Button>
      </form>
    </Card>
  );
}
