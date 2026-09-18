import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  FileText,
  Receipt,
  ScrollText,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import { ROLE_LABEL } from '@breadcrumbs/shared';
import type { LedgerRecord } from '@breadcrumbs/shared';

import { api } from '../lib/api.ts';
import { dateOf, eventLabel, money, relativeTime } from '../lib/format.ts';
import { useSession } from '../store/session.ts';
import {
  Card,
  CardHeader,
  EmptyState,
  LinkButton,
  Section,
  Spinner,
  Stat,
  cx,
} from '../components/ui/primitives.tsx';
import { StatusBadge, StatusBadgeLink } from '../components/ledger/StatusBadge.tsx';

export function Dashboard() {
  const { identity } = useSession();
  if (!identity) return <Spinner />;

  return (
    <div className="space-y-7">
      <header>
        <p className="text-[0.75rem] uppercase tracking-wide text-ink-faint">
          {ROLE_LABEL[identity.role]}
        </p>
        <h1 className="mt-1 text-[1.6rem] text-navy">{identity.name}</h1>
        <p className="mt-1 text-[0.88rem] text-ink-muted">{identity.org}</p>
      </header>

      {identity.role === 'factory' ? <FactoryDashboard factoryId={identity.factory_id} /> : null}
      {identity.role === 'auditor' ? <AuditorDashboard /> : null}
      {identity.role === 'brand' ? <BrandDashboard brandId={identity.id} /> : null}
    </div>
  );
}

/* ---------------------------------------------------------------- factory */

function FactoryDashboard({ factoryId }: { factoryId: string | null }) {
  const factory = factoryId ?? undefined;

  const records = useQuery({
    queryKey: ['records', { factory }],
    queryFn: () => api.records({ factory }),
  });
  const materials = useQuery({
    queryKey: ['inventory', 'materials', factory],
    queryFn: () => api.materials(factory),
  });
  const chemicals = useQuery({
    queryKey: ['inventory', 'chemicals', factory],
    queryFn: () => api.chemicals(factory),
  });
  const invoices = useQuery({
    queryKey: ['invoices', { factory }],
    queryFn: () => api.invoices({ factory }),
  });

  const all = records.data?.records ?? [];
  const lowStock = [
    ...(materials.data?.items ?? []),
    ...(chemicals.data?.items ?? []),
  ].filter((item) => item.below_reorder);

  const outstanding = (invoices.data?.invoices ?? []).filter((i) => i.balance_minor > 0);
  const owed = outstanding.reduce((sum, i) => sum + i.balance_minor, 0);

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Records on chain" value={all.length} hint="everything you have committed" />
        <Stat
          label="Awaiting review"
          value={all.filter((r) => r.status === 'flagged').length}
          tone={all.some((r) => r.status === 'flagged') ? 'clay' : 'default'}
        />
        <Stat label="Outstanding invoices" value={outstanding.length} />
        <Stat label="Owed to you" value={money(owed)} tone="gold" />
      </div>

      <Section
        title="Submit a record"
        description="Anything you record is signed on this device before it leaves the browser."
        action={
          <LinkButton to="/app/submit" variant="primary">
            <ScrollText size={15} aria-hidden />
            New audit record
          </LinkButton>
        }
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <QuickLink to="/app/inventory/materials" icon={Boxes} title="Materials" body="Receive stock, issue to line." />
          <QuickLink to="/app/inventory/chemicals" icon={Boxes} title="Chemicals" body="Log consumption and disposal." />
          <QuickLink to="/app/invoices/new" icon={Receipt} title="Raise an invoice" body="Against a signed contract." />
        </div>
      </Section>

      {lowStock.length > 0 ? (
        <Card>
          <CardHeader
            title="Below reorder level"
            description="Derived from the ledger — receipts minus everything issued, consumed or disposed."
          />
          <ul className="divide-y divide-hairline/60">
            {lowStock.slice(0, 5).map((item) => (
              <li key={`${item.factory_id}-${item.sku}`}>
                <Link
                  to={`/app/inventory/${item.factory_id}/${item.sku}`}
                  viewTransition
                  className="flex items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-parchment-deep"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[0.85rem] font-medium text-navy">{item.name}</p>
                    <p className="font-mono text-[0.72rem] text-ink-faint">{item.sku}</p>
                  </div>
                  <p className="shrink-0 tabular text-[0.82rem] text-clay">
                    {item.balance.on_hand.toLocaleString('en-US')} {item.unit}
                    <span className="ml-1 text-ink-faint">/ {item.reorder_level.toLocaleString('en-US')}</span>
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <RecordList
        title="Your recent records"
        description="Every entry you have committed, newest first."
        records={all.slice(0, 12)}
        loading={records.isPending}
      />
    </>
  );
}

/* ---------------------------------------------------------------- auditor */

function AuditorDashboard() {
  const flagged = useQuery({ queryKey: ['records', 'flagged'], queryFn: api.flagged });
  const recent = useQuery({ queryKey: ['records', 'recent'], queryFn: () => api.records({ limit: 10 }) });
  const factories = useQuery({ queryKey: ['factories'], queryFn: api.factories });

  const queue = flagged.data?.records ?? [];
  const trust = factories.data?.factories ?? [];

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Awaiting your decision"
          value={queue.length}
          tone={queue.length > 0 ? 'clay' : 'teal'}
        />
        <Stat
          label="Factories monitored"
          value={trust.length}
        />
        <Stat
          label="Verified records"
          value={trust.reduce((sum, f) => sum + (f.trust?.verified ?? 0), 0)}
          tone="teal"
        />
        <Stat
          label="Disputed"
          value={trust.reduce((sum, f) => sum + (f.trust?.disputed ?? 0), 0)}
        />
      </div>

      <Section
        title="Review queue"
        description="Only records the automated check flagged. Everything else stays out of your way."
        action={
          <LinkButton to="/app/review" variant="primary">
            Open the queue
            <ArrowRight size={15} aria-hidden />
          </LinkButton>
        }
      >
        {flagged.isPending ? (
          <Spinner />
        ) : queue.length === 0 ? (
          <EmptyState
            icon={<ShieldCheck size={22} />}
            title="Nothing waiting"
            description="No flagged record is currently without a human decision."
          />
        ) : (
          <div className="grid gap-3">
            {queue.slice(0, 4).map((record) => (
              <FlaggedCard key={record.event_id} record={record} />
            ))}
          </div>
        )}
      </Section>

      <Section title="Factory standing" description="Verified records lift the score; open flags and disputes pull it down.">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {trust.map((factory) => (
            <Card key={factory.id} className="p-4">
              <p className="font-display text-[0.95rem] text-navy">{factory.name}</p>
              <p className="mt-0.5 text-[0.72rem] text-ink-muted">{factory.city}</p>
              {factory.trust ? (
                <>
                  <p
                    className={cx(
                      'mt-3 font-display text-2xl tabular',
                      factory.trust.score >= 80
                        ? 'text-teal'
                        : factory.trust.score >= 50
                          ? 'text-gold'
                          : 'text-clay',
                    )}
                  >
                    {factory.trust.score}
                  </p>
                  <p className="text-[0.72rem] text-ink-muted">
                    {factory.trust.verified} verified · {factory.trust.flagged} flagged ·{' '}
                    {factory.trust.disputed} disputed
                  </p>
                </>
              ) : null}
            </Card>
          ))}
        </div>
      </Section>

      <RecordList
        title="Latest across all factories"
        description="The full ledger feed, newest first."
        records={recent.data?.records ?? []}
        loading={recent.isPending}
      />
    </>
  );
}

/* ------------------------------------------------------------------ brand */

function BrandDashboard({ brandId }: { brandId: string }) {
  const contracts = useQuery({
    queryKey: ['contracts', { brand: brandId }],
    queryFn: () => api.contracts({ brand: brandId }),
  });
  const invoices = useQuery({
    queryKey: ['invoices', { brand: brandId }],
    queryFn: () => api.invoices({ brand: brandId }),
  });
  const factories = useQuery({ queryKey: ['factories'], queryFn: api.factories });

  const allContracts = contracts.data?.contracts ?? [];
  const allInvoices = invoices.data?.invoices ?? [];
  const awaitingApproval = allInvoices.filter((i) => i.status === 'issued');
  const outstanding = allInvoices.reduce((sum, i) => sum + i.balance_minor, 0);
  const overCommitted = allContracts.filter((c) => c.remaining_minor < 0);

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Active contracts" value={allContracts.filter((c) => c.status === 'active').length} />
        <Stat
          label="Invoices to approve"
          value={awaitingApproval.length}
          tone={awaitingApproval.length > 0 ? 'gold' : 'default'}
        />
        <Stat label="Outstanding balance" value={money(outstanding)} />
        <Stat
          label="Contracts over-billed"
          value={overCommitted.length}
          tone={overCommitted.length > 0 ? 'clay' : 'teal'}
        />
      </div>

      {overCommitted.length > 0 ? (
        <Card className="border-clay/30 bg-clay-soft">
          <div className="flex items-start gap-2.5 p-5">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-clay" aria-hidden />
            <div>
              <p className="text-[0.88rem] font-semibold text-clay">
                Billing has passed the agreed value on{' '}
                {overCommitted.length === 1 ? 'a contract' : `${overCommitted.length} contracts`}
              </p>
              <ul className="mt-2 space-y-1">
                {overCommitted.map((contract) => (
                  <li key={contract.contract_id} className="text-[0.8rem] text-ink">
                    <Link
                      to={`/app/contracts/${contract.contract_id}`}
                      viewTransition
                      className="font-medium text-navy hover:underline"
                    >
                      {contract.contract_id}
                    </Link>{' '}
                    — invoiced {money(contract.invoiced_minor, contract.currency)} against{' '}
                    {money(contract.value_minor, contract.currency)} agreed
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Card>
      ) : null}

      <Section
        title="Your factories"
        description="Compliance standing across everyone you buy from."
        action={
          <LinkButton to="/lookup">
            Public view
            <ArrowRight size={15} aria-hidden />
          </LinkButton>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {(factories.data?.factories ?? []).map((factory) => (
            <Link
              key={factory.id}
              to={`/lookup/${factory.id}`}
              viewTransition
              className="rounded-[var(--radius-card)] border border-hairline bg-surface p-4 transition-colors hover:border-hairline-strong"
            >
              <p className="font-display text-[0.95rem] text-navy">{factory.name}</p>
              <p className="mt-0.5 text-[0.72rem] text-ink-muted">
                {factory.city}, {factory.country}
              </p>
              {factory.trust ? (
                <div className="mt-3 flex items-baseline gap-2">
                  <span
                    className={cx(
                      'font-display text-xl tabular',
                      factory.trust.score >= 80 ? 'text-teal' : factory.trust.score >= 50 ? 'text-gold' : 'text-clay',
                    )}
                  >
                    {factory.trust.score}
                  </span>
                  <span className="text-[0.72rem] text-ink-muted">
                    {factory.trust.total_records} records
                  </span>
                </div>
              ) : null}
            </Link>
          ))}
        </div>
      </Section>

      <Section
        title="Contracts"
        description="Both parties must sign before a contract can be invoiced against."
        action={
          <LinkButton to="/app/contracts/new" variant="primary">
            <FileText size={15} aria-hidden />
            New contract
          </LinkButton>
        }
      >
        <div className="grid gap-3">
          {allContracts.slice(0, 4).map((contract) => (
            <Link
              key={contract.contract_id}
              to={`/app/contracts/${contract.contract_id}`}
              viewTransition
              className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-hairline bg-surface px-5 py-4 transition-colors hover:border-hairline-strong"
            >
              <div className="min-w-0">
                <p className="truncate text-[0.9rem] font-medium text-navy">{contract.title}</p>
                <p className="text-[0.75rem] text-ink-muted">
                  {contract.factory_name} · delivery {dateOf(contract.delivery_date)}
                </p>
              </div>
              <div className="flex items-center gap-4">
                <span className="tabular text-[0.85rem] text-navy">
                  {money(contract.value_minor, contract.currency)}
                </span>
                <ContractStatusChip status={contract.status} />
              </div>
            </Link>
          ))}
        </div>
      </Section>

      {awaitingApproval.length > 0 ? (
        <Section title="Invoices awaiting your approval" description="Raised against your contracts.">
          <div className="grid gap-3">
            {awaitingApproval.slice(0, 5).map((invoice) => (
              <Link
                key={invoice.invoice_id}
                to={`/app/invoices/${invoice.invoice_id}`}
                viewTransition
                className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-hairline bg-surface px-5 py-4 transition-colors hover:border-hairline-strong"
              >
                <div>
                  <p className="font-mono text-[0.85rem] text-navy">{invoice.invoice_id}</p>
                  <p className="text-[0.75rem] text-ink-muted">
                    {invoice.factory_name} · due {dateOf(invoice.due_date)}
                  </p>
                </div>
                <span className="tabular text-[0.9rem] font-medium text-navy">
                  {money(invoice.total_minor, invoice.currency)}
                </span>
              </Link>
            ))}
          </div>
        </Section>
      ) : null}

      <Section title="Money" description="Every payment is a signed entry on the same chain.">
        <div className="grid gap-3 sm:grid-cols-2">
          <QuickLink to="/app/invoices" icon={Receipt} title="Invoices" body="Approve, dispute, review balances." />
          <QuickLink to="/app/payments" icon={Wallet} title="Payments" body="Initiate and settle against invoices." />
        </div>
      </Section>
    </>
  );
}

/* ------------------------------------------------------------ fragments */

function QuickLink({
  to,
  icon: Icon,
  title,
  body,
}: {
  to: string;
  icon: typeof Boxes;
  title: string;
  body: string;
}) {
  return (
    <Link
      to={to}
      viewTransition
      className="group rounded-[var(--radius-card)] border border-hairline bg-surface p-4 transition-colors hover:border-hairline-strong"
    >
      <div className="flex items-center gap-2">
        <Icon size={15} className="text-navy-300" aria-hidden />
        <p className="text-[0.88rem] font-semibold text-navy group-hover:underline">{title}</p>
      </div>
      <p className="mt-1 text-[0.78rem] text-ink-muted">{body}</p>
    </Link>
  );
}

function FlaggedCard({ record }: { record: LedgerRecord }) {
  return (
    <Link
      to={`/record/${encodeURIComponent(record.event_id)}`}
      viewTransition
      className="block rounded-[var(--radius-card)] border border-clay/30 bg-clay-soft p-4 transition-colors hover:border-clay/50"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[0.88rem] font-medium text-navy">{eventLabel(record.event_type)}</p>
          <p className="text-[0.75rem] text-ink-muted">
            {record.factory_name} · {relativeTime(record.timestamp)}
          </p>
        </div>
        <StatusBadge status={record.status} size="sm" />
      </div>
      <p className="mt-2.5 text-[0.8rem] leading-relaxed text-ink">{record.ai_flag_reason}</p>
    </Link>
  );
}

function RecordList({
  title,
  description,
  records,
  loading,
}: {
  title: string;
  description: string;
  records: LedgerRecord[];
  loading: boolean;
}) {
  const [filter, setFilter] = useState<'all' | 'verified' | 'flagged' | 'commercial'>('all');

  const filtered = records.filter((r) => {
    if (filter === 'verified') return r.status === 'verified';
    if (filter === 'flagged') return r.status === 'flagged' || r.ai_flag;
    if (filter === 'commercial') {
      return (
        r.event_family === 'contract' ||
        r.event_family === 'invoice' ||
        r.event_family === 'payment'
      );
    }
    return true;
  });

  return (
    <Section
      title={title}
      description={description}
      action={
        <Link
          to="/app/transactions"
          viewTransition
          className="text-[0.8rem] font-medium text-navy hover:underline"
        >
          View all transactions →
        </Link>
      }
    >
      <div className="flex flex-wrap items-center gap-1.5 pb-1">
        {(
          [
            { id: 'all', label: `All (${records.length})` },
            { id: 'verified', label: 'Verified' },
            { id: 'flagged', label: 'Flagged / Review' },
            { id: 'commercial', label: 'Commercial' },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setFilter(tab.id)}
            className={cx(
              'rounded-[var(--radius-pill)] border px-2.5 py-0.5 text-[0.74rem] transition-colors',
              filter === tab.id
                ? 'border-navy bg-navy text-parchment font-medium'
                : 'border-hairline bg-surface text-ink-muted hover:border-hairline-strong hover:text-navy',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading ? (
        <Spinner />
      ) : filtered.length === 0 ? (
        <EmptyState title="Nothing here yet" description="Records matching this filter will appear as they are committed." />
      ) : (
        <div className="grid gap-3">
          {filtered.map((record) => (
            <div
              key={record.event_id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-hairline bg-surface px-5 py-4"
            >
              <div className="min-w-0">
                <Link
                  to={`/record/${encodeURIComponent(record.event_id)}`}
                  state={{ from: '/app', label: 'Dashboard' }}
                  viewTransition
                  className="text-[0.88rem] font-medium text-navy hover:underline"
                >
                  {eventLabel(record.event_type)}
                </Link>
                <p className="text-[0.75rem] text-ink-muted">
                  {record.factory_name} · {record.submitter_name} · {relativeTime(record.timestamp)}
                </p>
              </div>
              <StatusBadgeLink status={record.status} eventId={record.event_id} size="sm" />
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

export function ContractStatusChip({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    active: { label: 'Active', className: 'border-teal/30 bg-teal-soft text-teal' },
    awaiting_signatures: {
      label: 'Awaiting signature',
      className: 'border-gold/40 bg-gold-soft text-[#8a6d24]',
    },
    closed: { label: 'Closed', className: 'border-hairline-strong bg-parchment-deep text-ink-muted' },
  };
  const config = map[status] ?? map.closed!;

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
