/**
 * The fold: chain events in, read models out.
 *
 * `applyBlock` is the only function that writes a projection table, and
 * `rebuildProjections` works by clearing the tables and replaying every block through
 * that same function. Incremental updates and a full rebuild therefore cannot drift
 * apart — there is one implementation, exercised two ways. `POST /api/admin/rebuild`
 * exists to prove it.
 */

import { asc, eq } from 'drizzle-orm';
import { deriveStatus, EVENT_FAMILY } from '@breadcrumbs/shared';
import type {
  Block,
  ContractAmendment,
  ContractSignature,
  InvoiceLineItem,
  InvoiceStatus,
  ReviewStatus,
  Role,
} from '@breadcrumbs/shared';

import { getDb } from '../db/client.ts';
import {
  blocks,
  pContracts,
  pInventoryBalances,
  pInvoices,
  pPayments,
  pRecords,
  PROJECTION_TABLES,
} from '../db/schema.ts';
import { getClient } from '../db/client.ts';
import { arr, num, rowToBlock, str, strOrNull } from './rows.ts';

const invKey = (factoryId: string, sku: string) => `${factoryId}:${sku}`;

/* --------------------------------------------------------------- records */

async function upsertRecordRow(block: Block): Promise<void> {
  const db = getDb();
  await db
    .insert(pRecords)
    .values({
      eventId: block.record.event_id,
      blockIndex: block.index,
      humanReviewStatus: 'none',
      status: deriveStatus({ ai_flag: block.ai_flag, human_review_status: 'none' }),
    })
    .onConflictDoNothing();
}

async function applyGovernance(block: Block): Promise<void> {
  const db = getDb();
  const targetId = str(block.record.data_fields, 'target_event_id');
  if (!targetId) return;

  const review: ReviewStatus =
    block.record.event_type === 'review_confirmed' ? 'confirmed' : 'disputed';

  const [target] = await db.select().from(pRecords).where(eq(pRecords.eventId, targetId));
  if (!target) return;

  const [targetBlock] = await db.select().from(blocks).where(eq(blocks.eventId, targetId));

  await db
    .update(pRecords)
    .set({
      humanReviewStatus: review,
      reviewerId: block.record.submitter_id,
      reviewerName: block.record.submitter_name,
      reviewedAt: block.record.timestamp,
      reviewNote: strOrNull(block.record.data_fields, 'note'),
      status: deriveStatus({
        ai_flag: targetBlock?.aiFlag ?? false,
        human_review_status: review,
      }),
    })
    .where(eq(pRecords.eventId, targetId));
}

/* ------------------------------------------------------------- contracts */

async function applyContract(block: Block): Promise<void> {
  const db = getDb();
  const fields = block.record.data_fields;
  const contractId = str(fields, 'contract_id');
  if (!contractId) return;

  switch (block.record.event_type) {
    case 'contract_created': {
      await db
        .insert(pContracts)
        .values({
          contractId,
          title: str(fields, 'title'),
          brandId: str(fields, 'brand_id'),
          factoryId: str(fields, 'factory_id'),
          valueMinor: num(fields, 'value_minor'),
          currency: str(fields, 'currency', 'USD'),
          incoterm: str(fields, 'incoterm'),
          orderQuantity: num(fields, 'order_quantity'),
          product: str(fields, 'product'),
          startDate: str(fields, 'start_date'),
          deliveryDate: str(fields, 'delivery_date'),
          status: 'awaiting_signatures',
          signaturesJson: '[]',
          amendmentsJson: '[]',
          invoicedMinor: 0,
          createdAt: block.record.timestamp,
          createdEventId: block.record.event_id,
        })
        .onConflictDoNothing();
      return;
    }

    case 'contract_signed': {
      const [contract] = await db
        .select()
        .from(pContracts)
        .where(eq(pContracts.contractId, contractId));
      if (!contract) return;

      const signatures = JSON.parse(contract.signaturesJson) as ContractSignature[];
      if (signatures.some((s) => s.identity_id === block.record.submitter_id)) return;

      signatures.push({
        identity_id: block.record.submitter_id,
        name: block.record.submitter_name,
        role: block.record.submitter_role as Role,
        signed_at: block.record.timestamp,
        event_id: block.record.event_id,
      });

      // A contract binds only once both sides have signed it.
      const hasBrand = signatures.some((s) => s.role === 'brand');
      const hasFactory = signatures.some((s) => s.role === 'factory');
      const status = hasBrand && hasFactory ? 'active' : 'awaiting_signatures';

      await db
        .update(pContracts)
        .set({ signaturesJson: JSON.stringify(signatures), status })
        .where(eq(pContracts.contractId, contractId));
      return;
    }

    case 'contract_amended': {
      const [contract] = await db
        .select()
        .from(pContracts)
        .where(eq(pContracts.contractId, contractId));
      if (!contract) return;

      const amendments = JSON.parse(contract.amendmentsJson) as ContractAmendment[];
      const delta = num(fields, 'value_minor_delta');
      amendments.push({
        event_id: block.record.event_id,
        at: block.record.timestamp,
        by: block.record.submitter_name,
        note: str(fields, 'note'),
        value_minor_delta: delta,
      });

      await db
        .update(pContracts)
        .set({
          amendmentsJson: JSON.stringify(amendments),
          valueMinor: contract.valueMinor + delta,
        })
        .where(eq(pContracts.contractId, contractId));
      return;
    }

    case 'contract_closed': {
      await db
        .update(pContracts)
        .set({ status: 'closed' })
        .where(eq(pContracts.contractId, contractId));
      return;
    }

    default:
      return;
  }
}

/* -------------------------------------------------------------- invoices */

function deriveInvoiceStatus(
  current: InvoiceStatus,
  paidMinor: number,
  totalMinor: number,
): InvoiceStatus {
  if (paidMinor >= totalMinor && totalMinor > 0) return 'settled';
  if (paidMinor > 0) return 'part_paid';
  return current;
}

async function applyInvoice(block: Block): Promise<void> {
  const db = getDb();
  const fields = block.record.data_fields;
  const invoiceId = str(fields, 'invoice_id');
  if (!invoiceId) return;

  switch (block.record.event_type) {
    case 'invoice_issued': {
      const contractId = str(fields, 'contract_id');
      const [contract] = await db
        .select()
        .from(pContracts)
        .where(eq(pContracts.contractId, contractId));

      const total = num(fields, 'total_minor');

      await db
        .insert(pInvoices)
        .values({
          invoiceId,
          contractId,
          factoryId: block.record.factory_id,
          brandId: contract?.brandId ?? '',
          currency: str(fields, 'currency', 'USD'),
          lineItemsJson: JSON.stringify(arr<InvoiceLineItem>(fields, 'line_items')),
          subtotalMinor: num(fields, 'subtotal_minor'),
          taxMinor: num(fields, 'tax_minor'),
          totalMinor: total,
          paidMinor: 0,
          pendingMinor: 0,
          status: 'issued',
          issuedAt: block.record.timestamp,
          dueDate: str(fields, 'due_date'),
          issuedEventId: block.record.event_id,
        })
        .onConflictDoNothing();

      if (contract) {
        await db
          .update(pContracts)
          .set({ invoicedMinor: contract.invoicedMinor + total })
          .where(eq(pContracts.contractId, contractId));
      }
      return;
    }

    case 'invoice_approved': {
      await db
        .update(pInvoices)
        .set({ status: 'approved' })
        .where(eq(pInvoices.invoiceId, invoiceId));
      return;
    }

    case 'invoice_disputed': {
      await db
        .update(pInvoices)
        .set({ status: 'disputed', disputeReason: str(fields, 'reason') })
        .where(eq(pInvoices.invoiceId, invoiceId));
      return;
    }

    case 'invoice_settled': {
      await db
        .update(pInvoices)
        .set({ status: 'settled' })
        .where(eq(pInvoices.invoiceId, invoiceId));
      return;
    }

    default:
      return;
  }
}

/* -------------------------------------------------------------- payments */

async function applyPayment(block: Block): Promise<void> {
  const db = getDb();
  const fields = block.record.data_fields;
  const paymentId = str(fields, 'payment_id');
  const invoiceId = str(fields, 'invoice_id');
  if (!paymentId) return;

  const [invoice] = await db.select().from(pInvoices).where(eq(pInvoices.invoiceId, invoiceId));

  switch (block.record.event_type) {
    case 'payment_initiated': {
      const amount = num(fields, 'amount_minor');
      await db
        .insert(pPayments)
        .values({
          paymentId,
          invoiceId,
          contractId: invoice?.contractId ?? '',
          factoryId: invoice?.factoryId ?? '',
          brandId: invoice?.brandId ?? block.record.submitter_id,
          amountMinor: amount,
          currency: str(fields, 'currency', invoice?.currency ?? 'USD'),
          method: str(fields, 'method', 'bank_transfer'),
          reference: str(fields, 'reference'),
          status: 'initiated',
          initiatedAt: block.record.timestamp,
          initiatedEventId: block.record.event_id,
        })
        .onConflictDoNothing();

      // Money in flight is tracked separately from money received.
      if (invoice) {
        await db
          .update(pInvoices)
          .set({ pendingMinor: invoice.pendingMinor + amount })
          .where(eq(pInvoices.invoiceId, invoiceId));
      }
      return;
    }

    case 'payment_settled': {
      const [payment] = await db
        .select()
        .from(pPayments)
        .where(eq(pPayments.paymentId, paymentId));
      if (!payment || payment.status === 'settled') return;

      await db
        .update(pPayments)
        .set({ status: 'settled', settledAt: block.record.timestamp })
        .where(eq(pPayments.paymentId, paymentId));

      if (invoice) {
        const paid = invoice.paidMinor + payment.amountMinor;
        const pending = Math.max(0, invoice.pendingMinor - payment.amountMinor);
        await db
          .update(pInvoices)
          .set({
            paidMinor: paid,
            pendingMinor: pending,
            status: deriveInvoiceStatus(invoice.status as InvoiceStatus, paid, invoice.totalMinor),
          })
          .where(eq(pInvoices.invoiceId, invoiceId));
      }
      return;
    }

    case 'payment_failed': {
      const [payment] = await db
        .select()
        .from(pPayments)
        .where(eq(pPayments.paymentId, paymentId));
      if (!payment || payment.status === 'failed') return;

      await db
        .update(pPayments)
        .set({ status: 'failed', failureReason: str(fields, 'reason') })
        .where(eq(pPayments.paymentId, paymentId));

      if (invoice && payment.status === 'initiated') {
        await db
          .update(pInvoices)
          .set({ pendingMinor: Math.max(0, invoice.pendingMinor - payment.amountMinor) })
          .where(eq(pInvoices.invoiceId, invoiceId));
      }
      return;
    }

    default:
      return;
  }
}

/* ------------------------------------------------------------- inventory */

async function applyInventory(block: Block): Promise<void> {
  const db = getDb();
  const fields = block.record.data_fields;
  const sku = str(fields, 'sku');
  if (!sku) return;

  const factoryId = block.record.factory_id;
  const id = invKey(factoryId, sku);
  const quantity = num(fields, 'quantity');

  const [existing] = await db
    .select()
    .from(pInventoryBalances)
    .where(eq(pInventoryBalances.id, id));

  const balance = existing ?? {
    id,
    sku,
    factoryId,
    received: 0,
    issued: 0,
    consumed: 0,
    disposed: 0,
    adjusted: 0,
    onHand: 0,
    movementCount: 0,
    lastMovementAt: null as string | null,
  };

  switch (block.record.event_type) {
    case 'material_receipt':
    case 'chemical_receipt':
      balance.received += quantity;
      break;
    case 'material_issue':
      balance.issued += quantity;
      break;
    case 'chemical_consumption':
      balance.consumed += quantity;
      break;
    case 'chemical_disposal':
      balance.disposed += quantity;
      break;
    case 'stock_adjustment':
      // Signed: a correction can go either way.
      balance.adjusted += quantity;
      break;
    default:
      return;
  }

  balance.onHand =
    balance.received - balance.issued - balance.consumed - balance.disposed + balance.adjusted;
  balance.movementCount += 1;
  balance.lastMovementAt = block.record.timestamp;

  if (existing) {
    await db
      .update(pInventoryBalances)
      .set({
        received: balance.received,
        issued: balance.issued,
        consumed: balance.consumed,
        disposed: balance.disposed,
        adjusted: balance.adjusted,
        onHand: balance.onHand,
        movementCount: balance.movementCount,
        lastMovementAt: balance.lastMovementAt,
      })
      .where(eq(pInventoryBalances.id, id));
  } else {
    await db.insert(pInventoryBalances).values(balance);
  }
}

/* ------------------------------------------------------------ entrypoint */

/** Applies one block to every projection it touches. The single write path. */
export async function applyBlock(block: Block): Promise<void> {
  if (block.record.event_type === 'genesis') return;

  await upsertRecordRow(block);

  switch (EVENT_FAMILY[block.record.event_type]) {
    case 'governance':
      await applyGovernance(block);
      return;
    case 'contract':
      await applyContract(block);
      return;
    case 'invoice':
      await applyInvoice(block);
      return;
    case 'payment':
      await applyPayment(block);
      return;
    case 'inventory':
      await applyInventory(block);
      return;
    default:
      return;
  }
}

/**
 * Throws every projection away and rebuilds it from the chain alone.
 *
 * If this produces different numbers from the incremental path, the projections were
 * lying — which is exactly what the `/api/admin/rebuild` check is for.
 */
export async function rebuildProjections(): Promise<{ replayed: number }> {
  const db = getDb();
  const raw = getClient();

  for (const table of PROJECTION_TABLES) {
    await raw.execute(`DELETE FROM ${table}`);
  }

  const rows = await db.select().from(blocks).orderBy(asc(blocks.blockIndex));
  for (const row of rows) {
    await applyBlock(rowToBlock(row));
  }

  return { replayed: rows.length };
}

/* ------------------------------------------------------------ AI context */

export interface ProjectionLookups {
  contractValueMinor: (contractId: string) => number | null;
  invoicedToDateMinor: (contractId: string) => number;
  invoiceBalanceMinor: (invoiceId: string) => number | null;
  invoiceStatus: (invoiceId: string) => string | null;
  paymentAmountMinor: (paymentId: string) => number | null;
  paymentStatus: (paymentId: string) => string | null;
  stockOnHand: (factoryId: string, sku: string) => number;
}

/**
 * Snapshots the projections the AI rules need into plain maps.
 *
 * Taken *before* the candidate block is appended, so the rules judge a record against
 * the state that existed when it was submitted.
 */
export async function snapshotLookups(): Promise<ProjectionLookups> {
  const db = getDb();

  const [contractRows, invoiceRows, balanceRows, paymentRows] = await Promise.all([
    db.select().from(pContracts),
    db.select().from(pInvoices),
    db.select().from(pInventoryBalances),
    db.select().from(pPayments),
  ]);

  const contractValues = new Map(contractRows.map((c) => [c.contractId, c.valueMinor]));
  const contractInvoiced = new Map(contractRows.map((c) => [c.contractId, c.invoicedMinor]));
  const invoiceMap = new Map(invoiceRows.map((i) => [i.invoiceId, i]));
  const stock = new Map(balanceRows.map((b) => [b.id, b.onHand]));
  const paymentMap = new Map(paymentRows.map((p) => [p.paymentId, p]));

  return {
    contractValueMinor: (id) => contractValues.get(id) ?? null,
    invoicedToDateMinor: (id) => contractInvoiced.get(id) ?? 0,
    invoiceBalanceMinor: (id) => {
      const invoice = invoiceMap.get(id);
      if (!invoice) return null;
      // Money already in flight counts as committed, so a second payment for the
      // full amount is caught rather than waiting for settlement.
      return invoice.totalMinor - invoice.paidMinor - invoice.pendingMinor;
    },
    invoiceStatus: (id) => invoiceMap.get(id)?.status ?? null,
    paymentAmountMinor: (id) => paymentMap.get(id)?.amountMinor ?? null,
    paymentStatus: (id) => paymentMap.get(id)?.status ?? null,
    stockOnHand: (factoryId, sku) => stock.get(invKey(factoryId, sku)) ?? 0,
  };
}

export { invKey };
