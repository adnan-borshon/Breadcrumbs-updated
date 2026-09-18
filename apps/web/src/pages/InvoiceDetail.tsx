import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Wallet } from 'lucide-react';
import type { Invoice } from '@breadcrumbs/shared';

import { api } from '../lib/api.ts';
import { dateOf, money } from '../lib/format.ts';
import { commitEvent, makeEventId } from '../lib/signer.ts';
import { useSession } from '../store/session.ts';
import {
  Button,
  Card,
  CardHeader,
  ErrorNote,
  Field,
  Input,
  Select,
  Spinner,
  Stat,
  Textarea,
  cx,
} from '../components/ui/primitives.tsx';
import { EntityAuditTimeline } from '../components/ledger/EntityAuditTimeline.tsx';
import { InvoiceStatusChip } from './Invoices.tsx';
import { PaymentStatusChip } from './Payments.tsx';

export function InvoiceDetail() {
  const { invoiceId = '' } = useParams();

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['invoice', invoiceId],
    queryFn: () => api.invoice(invoiceId),
  });

  if (isPending) return <Spinner label="Loading invoice" />;
  if (isError) return <ErrorNote title="Invoice not found" message={(error as Error).message} />;

  const { invoice, payments, contract, events } = data;

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <Link
        to="/app/invoices"
        viewTransition
        className="inline-flex items-center gap-1.5 text-[0.8rem] text-ink-muted transition-colors hover:text-navy"
      >
        <ArrowLeft size={14} aria-hidden />
        Invoices
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-mono text-[1.5rem] text-navy">{invoice.invoice_id}</h1>
          <p className="mt-1 text-[0.85rem] text-ink-muted">
            {invoice.factory_name} → {invoice.brand_name} · against{' '}
            <Link
              to={`/app/contracts/${invoice.contract_id}`}
              viewTransition
              className="font-mono hover:text-navy hover:underline"
            >
              {invoice.contract_id}
            </Link>
          </p>
        </div>
        <InvoiceStatusChip status={invoice.status} />
      </header>

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Total" value={money(invoice.total_minor, invoice.currency)} />
        <Stat label="Settled" value={money(invoice.paid_minor, invoice.currency)} tone="teal" />
        <Stat
          label="In flight"
          value={money(invoice.pending_minor, invoice.currency)}
          hint="initiated, not settled"
        />
        <Stat
          label="Balance"
          value={money(invoice.balance_minor, invoice.currency)}
          tone={invoice.balance_minor > 0 ? 'gold' : 'teal'}
        />
      </div>

      {invoice.status === 'disputed' && invoice.dispute_reason ? (
        <div className="rounded-[var(--radius-card)] border border-clay/30 bg-clay-soft p-4">
          <div className="flex items-start gap-2.5">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-clay" aria-hidden />
            <div>
              <p className="text-[0.86rem] font-semibold text-clay">Disputed by the buyer</p>
              <p className="mt-1 text-[0.82rem] leading-relaxed text-ink">{invoice.dispute_reason}</p>
              <p className="mt-2 text-[0.74rem] text-ink-muted">
                The invoice stays on the ledger. A dispute is an entry against it, not a deletion.
              </p>
            </div>
          </div>
        </div>
      ) : null}

      <Card>
        <CardHeader title="Line items" />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] text-[0.83rem]">
            <thead>
              <tr className="text-[0.68rem] uppercase tracking-wide text-ink-muted">
                <th scope="col" className="border-b border-hairline px-5 py-2.5 text-left font-semibold">
                  Description
                </th>
                <th scope="col" className="border-b border-hairline px-3 py-2.5 text-right font-semibold">
                  Qty
                </th>
                <th scope="col" className="border-b border-hairline px-3 py-2.5 text-right font-semibold">
                  Unit
                </th>
                <th scope="col" className="border-b border-hairline px-5 py-2.5 text-right font-semibold">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              {invoice.line_items.map((line, index) => (
                <tr key={index}>
                  <td className="border-b border-hairline/60 px-5 py-2.5">{line.description}</td>
                  <td className="border-b border-hairline/60 px-3 py-2.5 text-right tabular">
                    {line.quantity.toLocaleString('en-US')}
                  </td>
                  <td className="border-b border-hairline/60 px-3 py-2.5 text-right tabular">
                    {money(line.unit_price_minor, invoice.currency)}
                  </td>
                  <td className="border-b border-hairline/60 px-5 py-2.5 text-right tabular">
                    {money(line.amount_minor, invoice.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="text-[0.83rem]">
              <tr>
                <td colSpan={3} className="px-5 py-2 text-right text-ink-muted">
                  Subtotal
                </td>
                <td className="px-5 py-2 text-right tabular">
                  {money(invoice.subtotal_minor, invoice.currency)}
                </td>
              </tr>
              <tr>
                <td colSpan={3} className="px-5 py-2 text-right text-ink-muted">
                  Tax
                </td>
                <td className="px-5 py-2 text-right tabular">
                  {money(invoice.tax_minor, invoice.currency)}
                </td>
              </tr>
              <tr>
                <td colSpan={3} className="px-5 py-2.5 text-right font-medium text-navy">
                  Total
                </td>
                <td className="px-5 py-2.5 text-right tabular font-semibold text-navy">
                  {money(invoice.total_minor, invoice.currency)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="border-t border-hairline px-5 py-3 text-[0.76rem] text-ink-muted">
          Issued {dateOf(invoice.issued_at)} · due {dateOf(invoice.due_date)}
          {contract ? ` · contract value ${money(contract.value_minor, contract.currency)}` : ''}
        </div>
      </Card>

      <BuyerActions invoice={invoice} />

      <Card>
        <CardHeader
          title="Payments"
          description={`${payments.length} recorded against this invoice.`}
        />
        {payments.length === 0 ? (
          <p className="px-5 py-6 text-[0.84rem] text-ink-muted">No payments yet.</p>
        ) : (
          <ul className="divide-y divide-hairline/60">
            {payments.map((payment) => (
              <li key={payment.payment_id}>
                <Link
                  to={`/app/payments/${payment.payment_id}`}
                  viewTransition
                  className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-parchment-deep"
                >
                  <div>
                    <p className="font-mono text-[0.82rem] text-navy">{payment.payment_id}</p>
                    <p className="text-[0.74rem] text-ink-muted">
                      {payment.reference} · {dateOf(payment.initiated_at)}
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    <span
                      className={cx(
                        'tabular text-[0.85rem]',
                        payment.status === 'failed' ? 'text-ink-faint line-through' : 'text-navy',
                      )}
                    >
                      {money(payment.amount_minor, payment.currency)}
                    </span>
                    <PaymentStatusChip status={payment.status} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <EntityAuditTimeline
        events={events}
        entityType="invoice"
        title="Invoice lifecycle audit trail"
        description="Every cryptographic block that issued, approved, disputed, or settled this invoice."
      />
    </div>
  );
}

/** Approve, dispute, or pay — all of which are signed chain events, not status toggles. */
function BuyerActions({ invoice }: { invoice: Invoice }) {
  const { identity } = useSession();
  const queryClient = useQueryClient();

  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('bank_transfer');
  const [reference, setReference] = useState('');

  const invalidate = () => queryClient.invalidateQueries({ predicate: () => true });

  const approve = useMutation({
    mutationFn: async () =>
      commitEvent({
        eventType: 'invoice_approved',
        factoryId: invoice.factory_id,
        eventId: makeEventId('APPR'),
        refId: invoice.invoice_id,
        dataFields: { invoice_id: invoice.invoice_id },
      }),
    onSuccess: invalidate,
  });

  const dispute = useMutation({
    mutationFn: async () =>
      commitEvent({
        eventType: 'invoice_disputed',
        factoryId: invoice.factory_id,
        eventId: makeEventId('DISP'),
        refId: invoice.invoice_id,
        dataFields: { invoice_id: invoice.invoice_id, reason: reason.trim() },
      }),
    onSuccess: () => {
      setReason('');
      invalidate();
    },
  });

  const pay = useMutation({
    mutationFn: async () => {
      const paymentId = makeEventId('PAY');
      const amountMinor = Math.round(Number(amount) * 100);

      await commitEvent({
        eventType: 'payment_initiated',
        factoryId: invoice.factory_id,
        eventId: `${paymentId}-INIT`,
        refId: invoice.invoice_id,
        dataFields: {
          payment_id: paymentId,
          invoice_id: invoice.invoice_id,
          amount_minor: amountMinor,
          currency: invoice.currency,
          method,
          reference: reference.trim() || paymentId,
        },
      });

      // Settlement is a second, separate entry — money in flight and money received are
      // different facts, and the ledger records them as such.
      return commitEvent({
        eventType: 'payment_settled',
        factoryId: invoice.factory_id,
        eventId: `${paymentId}-SETTLE`,
        refId: invoice.invoice_id,
        dataFields: {
          payment_id: paymentId,
          invoice_id: invoice.invoice_id,
          amount_minor: amountMinor,
        },
      });
    },
    onSuccess: () => {
      setAmount('');
      setReference('');
      invalidate();
    },
  });

  if (identity?.role !== 'brand' || invoice.brand_id !== identity.id) return null;

  const canApprove = invoice.status === 'issued';
  const canDispute = invoice.status !== 'settled' && invoice.status !== 'disputed';
  const canPay = invoice.balance_minor > 0 && invoice.status !== 'disputed';

  return (
    <Card>
      <CardHeader
        title="Your actions"
        description="Each of these is a signed block on the same chain as the invoice itself."
      />
      <div className="space-y-5 px-5 py-4">
        {canApprove || canDispute ? (
          <div className="space-y-3">
            {canDispute ? (
              <Textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Reason, if you are disputing this invoice"
                aria-label="Dispute reason"
              />
            ) : null}
            <div className="flex flex-wrap gap-2">
              {canApprove ? (
                <Button variant="primary" onClick={() => approve.mutate()} loading={approve.isPending}>
                  Approve invoice
                </Button>
              ) : null}
              {canDispute ? (
                <Button
                  variant="danger"
                  onClick={() => dispute.mutate()}
                  loading={dispute.isPending}
                  disabled={reason.trim().length === 0}
                >
                  Dispute
                </Button>
              ) : null}
            </div>
            {approve.error ? <ErrorNote message={(approve.error as Error).message} /> : null}
            {dispute.error ? <ErrorNote message={(dispute.error as Error).message} /> : null}
          </div>
        ) : null}

        {canPay ? (
          <form
            className="space-y-3 border-t border-hairline pt-4"
            onSubmit={(event) => {
              event.preventDefault();
              pay.mutate();
            }}
          >
            <p className="text-[0.82rem] font-medium text-navy">Record a payment</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label={`Amount (${invoice.currency})`} required>
                <Input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  placeholder={(invoice.balance_minor / 100).toFixed(2)}
                />
              </Field>
              <Field label="Method">
                <Select value={method} onChange={(event) => setMethod(event.target.value)}>
                  <option value="bank_transfer">Bank transfer</option>
                  <option value="letter_of_credit">Letter of credit</option>
                  <option value="telegraphic_transfer">Telegraphic transfer</option>
                </Select>
              </Field>
              <Field label="Reference">
                <Input
                  value={reference}
                  onChange={(event) => setReference(event.target.value)}
                  placeholder="BT-HSBC-33108"
                />
              </Field>
            </div>

            {pay.error ? <ErrorNote message={(pay.error as Error).message} /> : null}

            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" variant="primary" loading={pay.isPending}>
                <Wallet size={15} aria-hidden />
                Pay and settle
              </Button>
              <p className="text-[0.75rem] text-ink-muted">
                Outstanding {money(invoice.balance_minor, invoice.currency)}. Paying more than is
                owed is flagged automatically.
              </p>
            </div>
          </form>
        ) : null}
      </div>
    </Card>
  );
}
