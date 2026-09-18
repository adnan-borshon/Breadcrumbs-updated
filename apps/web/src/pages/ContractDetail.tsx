import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, PenLine, Receipt, ShieldCheck } from 'lucide-react';
import { ROLE_LABEL } from '@breadcrumbs/shared';
import type { Contract } from '@breadcrumbs/shared';

import { api } from '../lib/api.ts';
import { dateOf, dateTimeOf, money } from '../lib/format.ts';
import { commitEvent, makeEventId } from '../lib/signer.ts';
import { useSession } from '../store/session.ts';
import {
  Button,
  Card,
  CardHeader,
  ErrorNote,
  LinkButton,
  Spinner,
  Stat,
  cx,
} from '../components/ui/primitives.tsx';
import { EntityAuditTimeline } from '../components/ledger/EntityAuditTimeline.tsx';
import { InvoiceStatusChip } from './Invoices.tsx';
import { ContractStatusChip } from './Dashboard.tsx';

export function ContractDetail() {
  const { contractId = '' } = useParams();

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['contract', contractId],
    queryFn: () => api.contract(contractId),
  });

  if (isPending) return <Spinner label="Loading contract" />;
  if (isError) return <ErrorNote title="Contract not found" message={(error as Error).message} />;

  const { contract, invoices, events } = data;
  const overBilled = contract.remaining_minor < 0;

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <Link
        to="/app/contracts"
        viewTransition
        className="inline-flex items-center gap-1.5 text-[0.8rem] text-ink-muted transition-colors hover:text-navy"
      >
        <ArrowLeft size={14} aria-hidden />
        Contracts
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[1.6rem] text-navy">{contract.title}</h1>
          <p className="mt-1 text-[0.85rem] text-ink-muted">
            <span className="font-mono">{contract.contract_id}</span> · {contract.brand_name} →{' '}
            {contract.factory_name}
          </p>
        </div>
        <ContractStatusChip status={contract.status} />
      </header>

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Agreed value" value={money(contract.value_minor, contract.currency)} />
        <Stat
          label="Invoiced"
          value={money(contract.invoiced_minor, contract.currency)}
          tone={overBilled ? 'clay' : 'default'}
        />
        <Stat
          label="Remaining"
          value={money(contract.remaining_minor, contract.currency)}
          tone={overBilled ? 'clay' : 'default'}
        />
        <Stat label="Order quantity" value={contract.order_quantity.toLocaleString('en-US')} />
      </div>

      {overBilled ? (
        <div className="rounded-[var(--radius-card)] border border-clay/30 bg-clay-soft p-4">
          <div className="flex items-start gap-2.5">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-clay" aria-hidden />
            <p className="text-[0.84rem] leading-relaxed text-ink">
              Invoicing against this contract has passed the agreed value by{' '}
              <span className="font-medium">
                {money(Math.abs(contract.remaining_minor), contract.currency)}
              </span>
              . Raising a further invoice here is flagged automatically — the ledger will still
              accept it, but it goes to an auditor.
            </p>
          </div>
        </div>
      ) : null}

      <SignaturePanel contract={contract} />

      <Card>
        <CardHeader title="Terms" />
        <dl className="divide-y divide-hairline/60">
          <Row label="Product" value={contract.product} />
          <Row label="Incoterm" value={contract.incoterm} />
          <Row label="Start date" value={dateOf(contract.start_date)} />
          <Row label="Delivery date" value={dateOf(contract.delivery_date)} />
          <Row label="Currency" value={contract.currency} />
          <Row label="Opened" value={dateTimeOf(contract.created_at)} />
        </dl>
      </Card>

      {contract.amendments.length > 0 ? (
        <Card>
          <CardHeader
            title="Amendments"
            description="Changes to value or terms, each one a signed block of its own."
          />
          <ul className="divide-y divide-hairline/60">
            {contract.amendments.map((amendment) => (
              <li key={amendment.event_id} className="px-5 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-[0.85rem] text-ink">{amendment.note}</p>
                  <span className="tabular text-[0.82rem] font-medium text-navy">
                    {amendment.value_minor_delta >= 0 ? '+' : '−'}
                    {money(Math.abs(amendment.value_minor_delta), contract.currency)}
                  </span>
                </div>
                <p className="mt-0.5 text-[0.72rem] text-ink-muted">
                  {amendment.by} · {dateTimeOf(amendment.at)}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title="Invoices"
          description={`${invoices.length} raised against this contract.`}
          action={
            <LinkButton to={`/app/invoices?contract=${contract.contract_id}`} size="sm">
              <Receipt size={13} aria-hidden />
              All invoices
            </LinkButton>
          }
        />
        {invoices.length === 0 ? (
          <p className="px-5 py-6 text-[0.84rem] text-ink-muted">Nothing invoiced yet.</p>
        ) : (
          <ul className="divide-y divide-hairline/60">
            {invoices.map((invoice) => (
              <li key={invoice.invoice_id}>
                <Link
                  to={`/app/invoices/${invoice.invoice_id}`}
                  viewTransition
                  className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-parchment-deep"
                >
                  <div>
                    <p className="font-mono text-[0.84rem] text-navy">{invoice.invoice_id}</p>
                    <p className="text-[0.74rem] text-ink-muted">
                      Issued {dateOf(invoice.issued_at)} · due {dateOf(invoice.due_date)}
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="tabular text-[0.85rem] text-navy">
                      {money(invoice.total_minor, invoice.currency)}
                    </span>
                    <InvoiceStatusChip status={invoice.status} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <EntityAuditTimeline
        events={events}
        entityType="contract"
        title="Contract lifecycle audit trail"
        description="Every cryptographic block that opened, signed, amended, or settled this purchase agreement."
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

/**
 * Multi-party signing.
 *
 * The contract does not become active on a status change — it becomes active because two
 * signatures from two different keys exist on the chain. Both are independently verifiable.
 */
function SignaturePanel({ contract }: { contract: Contract }) {
  const { identity } = useSession();
  const queryClient = useQueryClient();

  const sign = useMutation({
    mutationFn: async () =>
      commitEvent({
        eventType: 'contract_signed',
        factoryId: contract.factory_id,
        eventId: makeEventId('SIGN'),
        refId: contract.contract_id,
        dataFields: { contract_id: contract.contract_id },
      }),
    onSuccess: () => queryClient.invalidateQueries({ predicate: () => true }),
  });

  const alreadySigned = contract.signatures.some((s) => s.identity_id === identity?.id);
  const isParty =
    (identity?.role === 'brand' && contract.brand_id === identity.id) ||
    (identity?.role === 'factory' && contract.factory_id === identity.factory_id);
  const canSign = isParty && !alreadySigned && contract.status !== 'closed';

  const parties = [
    { role: 'brand' as const, name: contract.brand_name },
    { role: 'factory' as const, name: contract.factory_name },
  ];

  return (
    <Card>
      <CardHeader
        title="Signatures"
        description="Both parties must sign before this contract can be invoiced against."
      />
      <ul className="divide-y divide-hairline/60">
        {parties.map((party) => {
          const signature = contract.signatures.find((s) => s.role === party.role);

          return (
            <li
              key={party.role}
              className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5"
            >
              <div className="flex items-center gap-2.5">
                <span
                  className={cx(
                    'grid size-7 shrink-0 place-items-center rounded-full',
                    signature ? 'bg-teal-soft text-teal' : 'bg-parchment-deep text-ink-faint',
                  )}
                  aria-hidden
                >
                  {signature ? <ShieldCheck size={14} /> : <PenLine size={14} />}
                </span>
                <div>
                  <p className="text-[0.85rem] font-medium text-navy">{party.name}</p>
                  <p className="text-[0.72rem] text-ink-muted">{ROLE_LABEL[party.role]}</p>
                </div>
              </div>

              {signature ? (
                <Link
                  to={`/record/${encodeURIComponent(signature.event_id)}`}
                  viewTransition
                  className="text-right text-[0.76rem] text-ink-muted hover:text-navy"
                >
                  <span className="block font-medium text-teal">Signed</span>
                  {dateTimeOf(signature.signed_at)}
                </Link>
              ) : (
                <span className="text-[0.76rem] text-ink-faint">Not signed</span>
              )}
            </li>
          );
        })}
      </ul>

      {canSign ? (
        <div className="space-y-3 border-t border-hairline px-5 py-4">
          {sign.error ? <ErrorNote message={(sign.error as Error).message} /> : null}
          <Button variant="primary" onClick={() => sign.mutate()} loading={sign.isPending}>
            <PenLine size={15} aria-hidden />
            Sign this contract
          </Button>
          <p className="text-[0.75rem] text-ink-muted">
            Signing writes a block with your key. It cannot be withdrawn, only amended by a further
            entry.
          </p>
        </div>
      ) : null}
    </Card>
  );
}
