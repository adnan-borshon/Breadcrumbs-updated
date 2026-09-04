import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, Receipt, Trash2 } from 'lucide-react';
import type { Currency } from '@breadcrumbs/shared';

import { api } from '../lib/api.ts';
import { money } from '../lib/format.ts';
import { commitEvent } from '../lib/signer.ts';
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
  cx,
} from '../components/ui/primitives.tsx';

interface DraftLine {
  description: string;
  quantity: string;
  unitPrice: string;
}

const emptyLine: DraftLine = { description: '', quantity: '', unitPrice: '' };

function invoiceId(): string {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(2, 12);
  return `INV-${stamp}`;
}

function isoDate(offsetDays = 0): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

export function NewInvoice() {
  const { identity } = useSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const factory = identity?.factory_id ?? undefined;

  const { data, isPending } = useQuery({
    queryKey: ['contracts', { factory }],
    queryFn: () => api.contracts({ factory }),
  });

  // Only a contract both parties have signed can be invoiced against — the server
  // enforces this too, but there is no reason to offer an option that will be refused.
  const contracts = (data?.contracts ?? []).filter((c) => c.status === 'active');

  const [contractId, setContractId] = useState('');
  const [dueDate, setDueDate] = useState(isoDate(45));
  const [taxRate, setTaxRate] = useState('0');
  const [lines, setLines] = useState<DraftLine[]>([{ ...emptyLine }]);

  const contract = contracts.find((c) => c.contract_id === contractId);
  const currency = (contract?.currency ?? 'USD') as Currency;

  const totals = useMemo(() => {
    const items = lines.map((line) => {
      const quantity = Number(line.quantity) || 0;
      const unitMinor = Math.round((Number(line.unitPrice) || 0) * 100);
      return {
        description: line.description.trim(),
        quantity,
        unit_price_minor: unitMinor,
        amount_minor: Math.round(unitMinor * quantity),
      };
    });

    const subtotal = items.reduce((sum, item) => sum + item.amount_minor, 0);
    const tax = Math.round(subtotal * ((Number(taxRate) || 0) / 100));
    return { items, subtotal, tax, total: subtotal + tax };
  }, [lines, taxRate]);

  const overCeiling =
    contract !== undefined && contract.invoiced_minor + totals.total > contract.value_minor * 1.05;

  const create = useMutation({
    mutationFn: async () => {
      const id = invoiceId();

      const result = await commitEvent({
        eventType: 'invoice_issued',
        factoryId: identity!.factory_id!,
        eventId: `${id}-ISSUE`,
        refId: id,
        dataFields: {
          invoice_id: id,
          contract_id: contractId,
          currency,
          line_items: totals.items,
          subtotal_minor: totals.subtotal,
          tax_minor: totals.tax,
          total_minor: totals.total,
          due_date: dueDate,
        },
      });

      return { id, result };
    },
    onSuccess: async ({ id }) => {
      await queryClient.invalidateQueries({ predicate: () => true });
      navigate(`/app/invoices/${id}`, { viewTransition: true });
    },
  });

  const setLine = (index: number, key: keyof DraftLine, value: string) =>
    setLines((current) =>
      current.map((line, i) => (i === index ? { ...line, [key]: value } : line)),
    );

  const valid =
    contractId.length > 0 &&
    totals.total > 0 &&
    totals.items.every((item) => item.description.length > 0 && item.quantity > 0);

  if (isPending) return <Spinner label="Loading contracts" />;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link
        to="/app/invoices"
        viewTransition
        className="inline-flex items-center gap-1.5 text-[0.8rem] text-ink-muted transition-colors hover:text-navy"
      >
        <ArrowLeft size={14} aria-hidden />
        Invoices
      </Link>

      <header>
        <h1 className="text-[1.6rem] text-navy">Raise an invoice</h1>
        <p className="mt-1.5 text-[0.88rem] leading-relaxed text-ink-muted">
          Against a contract both parties have signed. The invoice is signed on this device and
          committed to the chain like any other record.
        </p>
      </header>

      {contracts.length === 0 ? (
        <EmptyState
          title="No active contracts"
          description="A contract must be signed by both the brand and this factory before it can be invoiced against."
        />
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate();
          }}
        >
          <Card>
            <CardHeader title="Invoice" />
            <div className="grid gap-4 px-5 py-5 sm:grid-cols-2">
              <Field label="Contract" required>
                <Select
                  required
                  value={contractId}
                  onChange={(event) => setContractId(event.target.value)}
                >
                  <option value="">Select a contract…</option>
                  {contracts.map((option) => (
                    <option key={option.contract_id} value={option.contract_id}>
                      {option.contract_id} — {option.title}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Due date" required>
                <Input
                  required
                  type="date"
                  value={dueDate}
                  onChange={(event) => setDueDate(event.target.value)}
                />
              </Field>
            </div>

            {contract ? (
              <div className="border-y border-hairline bg-parchment/60 px-5 py-3 text-[0.8rem]">
                <div className="flex flex-wrap justify-between gap-3 text-ink-muted">
                  <span>
                    Contract value{' '}
                    <span className="tabular font-medium text-navy">
                      {money(contract.value_minor, currency)}
                    </span>
                  </span>
                  <span>
                    Already invoiced{' '}
                    <span className="tabular font-medium text-navy">
                      {money(contract.invoiced_minor, currency)}
                    </span>
                  </span>
                  <span>
                    Remaining{' '}
                    <span
                      className={cx(
                        'tabular font-medium',
                        contract.remaining_minor < 0 ? 'text-clay' : 'text-navy',
                      )}
                    >
                      {money(contract.remaining_minor, currency)}
                    </span>
                  </span>
                </div>
              </div>
            ) : null}

            <div className="space-y-3 px-5 py-5">
              <p className="text-[0.82rem] font-medium text-navy">Line items</p>

              {lines.map((line, index) => (
                <div key={index} className="grid gap-3 sm:grid-cols-[1fr_6rem_8rem_auto]">
                  <Input
                    placeholder="Description"
                    value={line.description}
                    onChange={(event) => setLine(index, 'description', event.target.value)}
                    aria-label={`Line ${index + 1} description`}
                  />
                  <Input
                    type="number"
                    step="any"
                    min="0"
                    placeholder="Qty"
                    value={line.quantity}
                    onChange={(event) => setLine(index, 'quantity', event.target.value)}
                    aria-label={`Line ${index + 1} quantity`}
                  />
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="Unit price"
                    value={line.unitPrice}
                    onChange={(event) => setLine(index, 'unitPrice', event.target.value)}
                    aria-label={`Line ${index + 1} unit price`}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setLines((current) => current.filter((_, i) => i !== index))}
                    disabled={lines.length === 1}
                    aria-label={`Remove line ${index + 1}`}
                  >
                    <Trash2 size={14} aria-hidden />
                  </Button>
                </div>
              ))}

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setLines((current) => [...current, { ...emptyLine }])}
              >
                <Plus size={14} aria-hidden />
                Add line
              </Button>
            </div>

            <div className="border-t border-hairline px-5 py-4">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <Field label="Tax rate (%)">
                  <Input
                    type="number"
                    step="0.1"
                    min="0"
                    value={taxRate}
                    onChange={(event) => setTaxRate(event.target.value)}
                    className="w-28"
                  />
                </Field>

                <dl className="min-w-[12rem] space-y-1 text-[0.83rem]">
                  <div className="flex justify-between gap-6">
                    <dt className="text-ink-muted">Subtotal</dt>
                    <dd className="tabular">{money(totals.subtotal, currency)}</dd>
                  </div>
                  <div className="flex justify-between gap-6">
                    <dt className="text-ink-muted">Tax</dt>
                    <dd className="tabular">{money(totals.tax, currency)}</dd>
                  </div>
                  <div className="flex justify-between gap-6 border-t border-hairline pt-1">
                    <dt className="font-medium text-navy">Total</dt>
                    <dd className="tabular font-semibold text-navy">
                      {money(totals.total, currency)}
                    </dd>
                  </div>
                </dl>
              </div>
            </div>

            <div className="space-y-3 border-t border-hairline px-5 py-4">
              {overCeiling ? (
                <div className="rounded-md border border-gold/40 bg-gold-soft px-4 py-3 text-[0.8rem] text-[#8a6d24]">
                  This would take cumulative billing past the agreed contract value. The ledger will
                  still accept it — it will be flagged and sent to an auditor rather than blocked.
                </div>
              ) : null}

              {create.error ? <ErrorNote message={(create.error as Error).message} /> : null}

              <Button type="submit" variant="primary" loading={create.isPending} disabled={!valid}>
                <Receipt size={15} aria-hidden />
                Sign and issue
              </Button>
            </div>
          </Card>
        </form>
      )}
    </div>
  );
}
