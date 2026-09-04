/**
 * Read models.
 *
 * Assembly happens in JS rather than as SQL joins: the chain is small enough that
 * clarity is worth more than the round trips, and every shape here has to match the
 * shared types exactly so the web app and the API agree field for field.
 */

import { asc, eq } from 'drizzle-orm';
import { deriveStatus, EVENT_FAMILY } from '@breadcrumbs/shared';
import type {
  Contract,
  ContractAmendment,
  ContractSignature,
  ContractStatus,
  Currency,
  EventFamily,
  Factory,
  FactoryTrust,
  Invoice,
  InvoiceLineItem,
  InvoiceStatus,
  InventoryBalance,
  InventoryItem,
  InventoryItemView,
  LedgerRecord,
  Payment,
  PaymentMethod,
  PaymentStatus,
  RecordStatus,
  ReviewStatus,
  Role,
  SubmitterRole,
} from '@breadcrumbs/shared';

import { getDb } from '../db/client.ts';
import {
  blocks,
  factories,
  inventoryItems,
  pContracts,
  pInventoryBalances,
  pInvoices,
  pPayments,
  pRecords,
} from '../db/schema.ts';
import { rowToBlock } from './rows.ts';

/* --------------------------------------------------------------- helpers */

async function factoryNameMap(): Promise<Map<string, string>> {
  const rows = await getDb().select().from(factories);
  return new Map(rows.map((f) => [f.id, f.name]));
}

/* --------------------------------------------------------------- records */

export interface RecordFilter {
  family?: EventFamily;
  factoryId?: string;
  status?: RecordStatus;
  eventType?: string;
  flaggedOnly?: boolean;
  limit?: number;
}

export async function listRecords(filter: RecordFilter = {}): Promise<LedgerRecord[]> {
  const db = getDb();

  const [blockRows, recordRows, names] = await Promise.all([
    db.select().from(blocks).orderBy(asc(blocks.blockIndex)),
    db.select().from(pRecords),
    factoryNameMap(),
  ]);

  const reviews = new Map(recordRows.map((r) => [r.eventId, r]));

  let records = blockRows
    .filter((row) => row.eventType !== 'genesis')
    .map((row) => toLedgerRecord(row, reviews.get(row.eventId), names));

  if (filter.family) records = records.filter((r) => r.event_family === filter.family);
  if (filter.factoryId) records = records.filter((r) => r.factory_id === filter.factoryId);
  if (filter.status) records = records.filter((r) => r.status === filter.status);
  if (filter.eventType) records = records.filter((r) => r.event_type === filter.eventType);
  if (filter.flaggedOnly) {
    records = records.filter((r) => r.ai_flag && r.human_review_status === 'none');
  }

  records.sort((a, b) => b.block_index - a.block_index);
  return filter.limit ? records.slice(0, filter.limit) : records;
}

export async function getRecord(eventId: string): Promise<LedgerRecord | null> {
  const db = getDb();
  const [row] = await db.select().from(blocks).where(eq(blocks.eventId, eventId));
  if (!row) return null;

  const [review] = await db.select().from(pRecords).where(eq(pRecords.eventId, eventId));
  const names = await factoryNameMap();
  return toLedgerRecord(row, review, names);
}

type BlockRowShape = typeof blocks.$inferSelect;
type ReviewRowShape = typeof pRecords.$inferSelect;

function toLedgerRecord(
  row: BlockRowShape,
  review: ReviewRowShape | undefined,
  factoryNames: Map<string, string>,
): LedgerRecord {
  const block = rowToBlock(row);
  const humanReviewStatus = (review?.humanReviewStatus ?? 'none') as ReviewStatus;

  return {
    event_id: block.record.event_id,
    factory_id: block.record.factory_id,
    factory_name: factoryNames.get(block.record.factory_id) ?? block.record.factory_id,
    event_type: block.record.event_type,
    event_family: EVENT_FAMILY[block.record.event_type],
    timestamp: block.record.timestamp,
    submitter_id: block.record.submitter_id,
    submitter_name: block.record.submitter_name,
    submitter_role: block.record.submitter_role as SubmitterRole,
    data_fields: block.record.data_fields,
    ref_id: block.record.ref_id,

    ai_flag: block.ai_flag,
    ai_flag_reason: block.ai_flag_reason,
    ai_score: block.ai_score,
    ai_rule: block.ai_rule,

    human_review_status: humanReviewStatus,
    reviewer_name: review?.reviewerName ?? null,
    reviewed_at: review?.reviewedAt ?? null,
    review_note: review?.reviewNote ?? null,

    block_index: block.index,
    block_hash: block.block_hash,
    previous_block_hash: block.previous_block_hash,
    signature: block.signature,

    status: deriveStatus({ ai_flag: block.ai_flag, human_review_status: humanReviewStatus }),
  };
}

/* --------------------------------------------------------------- blocks */

export interface BlockSummary {
  index: number;
  timestamp: string;
  block_hash: string;
  previous_block_hash: string;
  event_id: string;
  event_type: string;
  event_family: EventFamily;
  factory_id: string;
  factory_name: string;
  submitter_name: string;
  submitter_role: SubmitterRole;
  ai_flag: boolean;
  status: RecordStatus | 'system';
}

export async function listBlockSummaries(filter: {
  family?: EventFamily;
  factoryId?: string;
} = {}): Promise<BlockSummary[]> {
  const db = getDb();
  const [rows, recordRows, names] = await Promise.all([
    db.select().from(blocks).orderBy(asc(blocks.blockIndex)),
    db.select().from(pRecords),
    factoryNameMap(),
  ]);

  const reviews = new Map(recordRows.map((r) => [r.eventId, r]));

  return rows
    .filter((row) => (filter.family ? row.eventFamily === filter.family : true))
    .filter((row) => (filter.factoryId ? row.factoryId === filter.factoryId : true))
    .map((row) => {
      const block = rowToBlock(row);
      const review = reviews.get(row.eventId);
      const isGenesis = row.eventType === 'genesis';

      return {
        index: block.index,
        timestamp: block.timestamp,
        block_hash: block.block_hash,
        previous_block_hash: block.previous_block_hash,
        event_id: block.record.event_id,
        event_type: block.record.event_type,
        event_family: EVENT_FAMILY[block.record.event_type],
        factory_id: block.record.factory_id,
        factory_name: names.get(block.record.factory_id) ?? block.record.factory_id,
        submitter_name: block.record.submitter_name,
        submitter_role: block.record.submitter_role as SubmitterRole,
        ai_flag: block.ai_flag,
        status: isGenesis
          ? ('system' as const)
          : deriveStatus({
              ai_flag: block.ai_flag,
              human_review_status: (review?.humanReviewStatus ?? 'none') as ReviewStatus,
            }),
      };
    });
}

/* ------------------------------------------------------------- contracts */

function hydrateContract(
  row: typeof pContracts.$inferSelect,
  factoryNames: Map<string, string>,
  brandNames: Map<string, string>,
): Contract {
  const value = row.valueMinor;
  return {
    contract_id: row.contractId,
    title: row.title,
    brand_id: row.brandId,
    brand_name: brandNames.get(row.brandId) ?? row.brandId,
    factory_id: row.factoryId,
    factory_name: factoryNames.get(row.factoryId) ?? row.factoryId,
    value_minor: value,
    currency: row.currency as Currency,
    incoterm: row.incoterm,
    order_quantity: row.orderQuantity,
    product: row.product,
    start_date: row.startDate,
    delivery_date: row.deliveryDate,
    status: row.status as ContractStatus,
    signatures: JSON.parse(row.signaturesJson) as ContractSignature[],
    amendments: JSON.parse(row.amendmentsJson) as ContractAmendment[],
    created_at: row.createdAt,
    created_event_id: row.createdEventId,
    invoiced_minor: row.invoicedMinor,
    remaining_minor: value - row.invoicedMinor,
  };
}

export async function listContracts(filter: { factoryId?: string; brandId?: string } = {}) {
  const db = getDb();
  const [rows, factoryNames, brandNames] = await Promise.all([
    db.select().from(pContracts),
    factoryNameMap(),
    identityDisplayNames(),
  ]);

  return rows
    .filter((r) => (filter.factoryId ? r.factoryId === filter.factoryId : true))
    .filter((r) => (filter.brandId ? r.brandId === filter.brandId : true))
    .map((r) => hydrateContract(r, factoryNames, brandNames))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function getContract(contractId: string): Promise<Contract | null> {
  const db = getDb();
  const [row] = await db.select().from(pContracts).where(eq(pContracts.contractId, contractId));
  if (!row) return null;
  const [factoryNames, brandNames] = await Promise.all([factoryNameMap(), identityDisplayNames()]);
  return hydrateContract(row, factoryNames, brandNames);
}

/* --------------------------------------------------------------- invoices */

function hydrateInvoice(
  row: typeof pInvoices.$inferSelect,
  factoryNames: Map<string, string>,
  brandNames: Map<string, string>,
): Invoice {
  return {
    invoice_id: row.invoiceId,
    contract_id: row.contractId,
    factory_id: row.factoryId,
    factory_name: factoryNames.get(row.factoryId) ?? row.factoryId,
    brand_id: row.brandId,
    brand_name: brandNames.get(row.brandId) ?? row.brandId,
    currency: row.currency as Currency,
    line_items: JSON.parse(row.lineItemsJson) as InvoiceLineItem[],
    subtotal_minor: row.subtotalMinor,
    tax_minor: row.taxMinor,
    total_minor: row.totalMinor,
    paid_minor: row.paidMinor,
    pending_minor: row.pendingMinor,
    balance_minor: row.totalMinor - row.paidMinor,
    status: row.status as InvoiceStatus,
    issued_at: row.issuedAt,
    due_date: row.dueDate,
    issued_event_id: row.issuedEventId,
    dispute_reason: row.disputeReason,
  };
}

export async function listInvoices(
  filter: { factoryId?: string; brandId?: string; contractId?: string; status?: InvoiceStatus } = {},
) {
  const db = getDb();
  const [rows, factoryNames, brandNames] = await Promise.all([
    db.select().from(pInvoices),
    factoryNameMap(),
    identityDisplayNames(),
  ]);

  return rows
    .filter((r) => (filter.factoryId ? r.factoryId === filter.factoryId : true))
    .filter((r) => (filter.brandId ? r.brandId === filter.brandId : true))
    .filter((r) => (filter.contractId ? r.contractId === filter.contractId : true))
    .filter((r) => (filter.status ? r.status === filter.status : true))
    .map((r) => hydrateInvoice(r, factoryNames, brandNames))
    .sort((a, b) => b.issued_at.localeCompare(a.issued_at));
}

export async function getInvoice(invoiceId: string): Promise<Invoice | null> {
  const db = getDb();
  const [row] = await db.select().from(pInvoices).where(eq(pInvoices.invoiceId, invoiceId));
  if (!row) return null;
  const [factoryNames, brandNames] = await Promise.all([factoryNameMap(), identityDisplayNames()]);
  return hydrateInvoice(row, factoryNames, brandNames);
}

/* --------------------------------------------------------------- payments */

function hydratePayment(row: typeof pPayments.$inferSelect): Payment {
  return {
    payment_id: row.paymentId,
    invoice_id: row.invoiceId,
    contract_id: row.contractId,
    factory_id: row.factoryId,
    brand_id: row.brandId,
    amount_minor: row.amountMinor,
    currency: row.currency as Currency,
    method: row.method as PaymentMethod,
    reference: row.reference,
    status: row.status as PaymentStatus,
    initiated_at: row.initiatedAt,
    settled_at: row.settledAt,
    failure_reason: row.failureReason,
    initiated_event_id: row.initiatedEventId,
  };
}

export async function listPayments(
  filter: { invoiceId?: string; factoryId?: string; brandId?: string } = {},
): Promise<Payment[]> {
  const db = getDb();
  const rows = await db.select().from(pPayments);
  return rows
    .filter((r) => (filter.invoiceId ? r.invoiceId === filter.invoiceId : true))
    .filter((r) => (filter.factoryId ? r.factoryId === filter.factoryId : true))
    .filter((r) => (filter.brandId ? r.brandId === filter.brandId : true))
    .map(hydratePayment)
    .sort((a, b) => b.initiated_at.localeCompare(a.initiated_at));
}

export async function getPayment(paymentId: string): Promise<Payment | null> {
  const db = getDb();
  const [row] = await db.select().from(pPayments).where(eq(pPayments.paymentId, paymentId));
  return row ? hydratePayment(row) : null;
}

/* -------------------------------------------------------------- inventory */

function emptyBalance(factoryId: string, sku: string): InventoryBalance {
  return {
    sku,
    factory_id: factoryId,
    received: 0,
    issued: 0,
    consumed: 0,
    disposed: 0,
    adjusted: 0,
    on_hand: 0,
    last_movement_at: null,
    movement_count: 0,
  };
}

export async function listInventory(filter: {
  factoryId?: string;
  kind?: 'material' | 'chemical';
}): Promise<InventoryItemView[]> {
  const db = getDb();
  const [items, balances] = await Promise.all([
    db.select().from(inventoryItems),
    db.select().from(pInventoryBalances),
  ]);

  const balanceMap = new Map(balances.map((b) => [b.id, b]));

  return items
    .filter((i) => (filter.factoryId ? i.factoryId === filter.factoryId : true))
    .filter((i) => (filter.kind ? i.kind === filter.kind : true))
    .map((item) => {
      const raw = balanceMap.get(item.id);
      const balance: InventoryBalance = raw
        ? {
            sku: raw.sku,
            factory_id: raw.factoryId,
            received: raw.received,
            issued: raw.issued,
            consumed: raw.consumed,
            disposed: raw.disposed,
            adjusted: raw.adjusted,
            on_hand: raw.onHand,
            last_movement_at: raw.lastMovementAt,
            movement_count: raw.movementCount,
          }
        : emptyBalance(item.factoryId, item.sku);

      const view: InventoryItemView = {
        sku: item.sku,
        factory_id: item.factoryId,
        name: item.name,
        kind: item.kind as InventoryItem['kind'],
        unit: item.unit,
        reorder_level: item.reorderLevel,
        cas_number: item.casNumber,
        hazard_class: item.hazardClass,
        mrsl_restricted: item.mrslRestricted,
        supplier: item.supplier,
        balance,
        below_reorder: balance.on_hand < item.reorderLevel,
      };
      return view;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function getInventoryItem(
  factoryId: string,
  sku: string,
): Promise<InventoryItemView | null> {
  const all = await listInventory({ factoryId });
  return all.find((i) => i.sku === sku) ?? null;
}

/** Every ledger event that moved this SKU, newest first. */
export async function getInventoryLedger(factoryId: string, sku: string): Promise<LedgerRecord[]> {
  const records = await listRecords({ family: 'inventory', factoryId });
  return records.filter((r) => r.data_fields['sku'] === sku);
}

/* -------------------------------------------------------------- factories */

export async function listFactories(): Promise<Factory[]> {
  const rows = await getDb().select().from(factories);
  return rows.map((f) => ({
    id: f.id,
    name: f.name,
    country: f.country,
    city: f.city,
    certifications: JSON.parse(f.certificationsJson) as string[],
    employee_count: f.employeeCount,
  }));
}

export async function getFactory(id: string): Promise<Factory | null> {
  const all = await listFactories();
  return all.find((f) => f.id === id) ?? null;
}

async function identityDisplayNames(): Promise<Map<string, string>> {
  const { identities } = await import('../db/schema.ts');
  const rows = await getDb().select().from(identities);
  return new Map(rows.map((i) => [i.id, i.name]));
}

/**
 * Trust score per factory: verified records lift it, open flags and disputes pull it
 * down. Deliberately simple and explainable — an auditor should be able to see why a
 * number moved, which a black box would not allow.
 */
export async function listFactoryTrust(): Promise<FactoryTrust[]> {
  const [records, allFactories] = await Promise.all([listRecords(), listFactories()]);

  return allFactories.map((factory) => {
    const own = records.filter((r) => r.factory_id === factory.id);
    const verified = own.filter((r) => r.status === 'verified').length;
    const pending = own.filter((r) => r.status === 'pending').length;
    const flagged = own.filter((r) => r.status === 'flagged').length;
    const disputed = own.filter((r) => r.status === 'disputed').length;
    const total = own.length;

    const score =
      total === 0
        ? 100
        : Math.max(
            0,
            Math.round(((verified + pending * 0.6 - flagged * 0.5 - disputed * 1.5) / total) * 100),
          );

    const lastActivity = own.reduce<string | null>(
      (latest, r) => (latest === null || r.timestamp > latest ? r.timestamp : latest),
      null,
    );

    return {
      factory_id: factory.id,
      factory_name: factory.name,
      total_records: total,
      verified,
      pending,
      flagged,
      disputed,
      score,
      last_activity_at: lastActivity,
    };
  });
}

export { identityDisplayNames };
export type { Role };
