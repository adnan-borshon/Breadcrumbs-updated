/**
 * Database schema.
 *
 * Two tiers, and the distinction matters:
 *
 *   SOURCE OF TRUTH — `blocks`, plus the reference tables (`identities`, `device_keys`,
 *   `factories`, `inventory_items`). `blocks` is strictly append-only; no code path in
 *   this app issues an UPDATE or DELETE against it except the deliberate tamper endpoint,
 *   which exists precisely so verification can be seen catching it.
 *
 *   PROJECTIONS — every `p_*` table. These are derived by replaying blocks in order and
 *   can be dropped and rebuilt at any time without losing information. They exist so the
 *   API can answer queries with SQL instead of folding the whole chain per request.
 */

import { sql } from 'drizzle-orm';
import { integer, real, sqliteTable, text, uniqueIndex, index } from 'drizzle-orm/sqlite-core';

/* ------------------------------------------------------- source of truth */

export const blocks = sqliteTable(
  'blocks',
  {
    blockIndex: integer('block_index').primaryKey(),
    timestamp: text('timestamp').notNull(),
    previousBlockHash: text('previous_block_hash').notNull(),
    blockHash: text('block_hash').notNull(),

    /** Canonical JSON of the SignedRecord — the exact bytes that were signed. */
    recordJson: text('record_json').notNull(),
    /** Canonical JSON of the submitter's public JWK. Null on genesis. */
    publicKeyJson: text('public_key_json'),
    signature: text('signature'),

    aiFlag: integer('ai_flag', { mode: 'boolean' }).notNull().default(false),
    aiScore: real('ai_score'),
    aiFlagReason: text('ai_flag_reason'),
    aiRule: text('ai_rule'),

    /* Denormalised from the record purely so the explorer can filter without
       parsing every row. The record JSON above stays authoritative. */
    eventId: text('event_id').notNull(),
    eventType: text('event_type').notNull(),
    eventFamily: text('event_family').notNull(),
    factoryId: text('factory_id').notNull(),
    submitterId: text('submitter_id').notNull(),
    submitterRole: text('submitter_role').notNull(),
    refId: text('ref_id'),
  },
  (table) => [
    uniqueIndex('blocks_event_id_idx').on(table.eventId),
    uniqueIndex('blocks_hash_idx').on(table.blockHash),
    index('blocks_family_idx').on(table.eventFamily),
    index('blocks_factory_idx').on(table.factoryId),
    index('blocks_ref_idx').on(table.refId),
  ],
);

export const identities = sqliteTable('identities', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  role: text('role').notNull(),
  org: text('org').notNull(),
  factoryId: text('factory_id'),
  createdAt: text('created_at').notNull(),
});

export const deviceKeys = sqliteTable(
  'device_keys',
  {
    id: text('id').primaryKey(),
    identityId: text('identity_id')
      .notNull()
      .references(() => identities.id),
    publicKeyJson: text('public_key_json').notNull(),
    fingerprint: text('fingerprint').notNull(),
    label: text('label').notNull(),
    createdAt: text('created_at').notNull(),
    revokedAt: text('revoked_at'),
  },
  (table) => [
    uniqueIndex('device_keys_fingerprint_idx').on(table.fingerprint),
    index('device_keys_identity_idx').on(table.identityId),
  ],
);

export const factories = sqliteTable('factories', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  country: text('country').notNull(),
  city: text('city').notNull(),
  certificationsJson: text('certifications_json').notNull().default('[]'),
  employeeCount: integer('employee_count').notNull().default(0),
});

export const inventoryItems = sqliteTable(
  'inventory_items',
  {
    id: text('id').primaryKey(), // `${factory_id}:${sku}`
    sku: text('sku').notNull(),
    factoryId: text('factory_id').notNull(),
    name: text('name').notNull(),
    kind: text('kind').notNull(), // material | chemical
    unit: text('unit').notNull(),
    reorderLevel: real('reorder_level').notNull().default(0),
    casNumber: text('cas_number'),
    hazardClass: text('hazard_class'),
    mrslRestricted: integer('mrsl_restricted', { mode: 'boolean' }).notNull().default(false),
    supplier: text('supplier'),
  },
  (table) => [index('inventory_items_factory_idx').on(table.factoryId)],
);

/** Public blockchain notarization checkpoints anchoring the private hash chain to L1/L2. */
export const chainCheckpoints = sqliteTable(
  'chain_checkpoints',
  {
    checkpointId: text('checkpoint_id').primaryKey(),
    blockHeight: integer('block_height').notNull(),
    blockHash: text('block_hash').notNull(),
    merkleRoot: text('merkle_root').notNull(),
    notarizedAt: text('notarized_at').notNull(),
    network: text('network').notNull(),
    txHash: text('tx_hash').notNull(),
    explorerUrl: text('explorer_url').notNull(),
    status: text('status').notNull().default('confirmed'),
  },
  (table) => [
    uniqueIndex('checkpoints_height_idx').on(table.blockHeight),
    uniqueIndex('checkpoints_tx_idx').on(table.txHash),
  ],
);

/* ------------------------------------------------------------ projections */

export const pRecords = sqliteTable(
  'p_records',
  {
    eventId: text('event_id').primaryKey(),
    blockIndex: integer('block_index').notNull(),
    humanReviewStatus: text('human_review_status').notNull().default('none'),
    reviewerId: text('reviewer_id'),
    reviewerName: text('reviewer_name'),
    reviewedAt: text('reviewed_at'),
    reviewNote: text('review_note'),
    /** Derived by deriveStatus() — stored so the review queue can filter in SQL. */
    status: text('status').notNull(),
  },
  (table) => [index('p_records_status_idx').on(table.status)],
);

export const pContracts = sqliteTable(
  'p_contracts',
  {
    contractId: text('contract_id').primaryKey(),
    title: text('title').notNull(),
    brandId: text('brand_id').notNull(),
    factoryId: text('factory_id').notNull(),
    valueMinor: integer('value_minor').notNull(),
    currency: text('currency').notNull(),
    incoterm: text('incoterm').notNull(),
    orderQuantity: integer('order_quantity').notNull(),
    product: text('product').notNull(),
    startDate: text('start_date').notNull(),
    deliveryDate: text('delivery_date').notNull(),
    status: text('status').notNull(),
    signaturesJson: text('signatures_json').notNull().default('[]'),
    amendmentsJson: text('amendments_json').notNull().default('[]'),
    invoicedMinor: integer('invoiced_minor').notNull().default(0),
    createdAt: text('created_at').notNull(),
    createdEventId: text('created_event_id').notNull(),
  },
  (table) => [
    index('p_contracts_factory_idx').on(table.factoryId),
    index('p_contracts_brand_idx').on(table.brandId),
  ],
);

export const pInvoices = sqliteTable(
  'p_invoices',
  {
    invoiceId: text('invoice_id').primaryKey(),
    contractId: text('contract_id').notNull(),
    factoryId: text('factory_id').notNull(),
    brandId: text('brand_id').notNull(),
    currency: text('currency').notNull(),
    lineItemsJson: text('line_items_json').notNull().default('[]'),
    subtotalMinor: integer('subtotal_minor').notNull(),
    taxMinor: integer('tax_minor').notNull(),
    totalMinor: integer('total_minor').notNull(),
    paidMinor: integer('paid_minor').notNull().default(0),
    pendingMinor: integer('pending_minor').notNull().default(0),
    status: text('status').notNull(),
    issuedAt: text('issued_at').notNull(),
    dueDate: text('due_date').notNull(),
    issuedEventId: text('issued_event_id').notNull(),
    disputeReason: text('dispute_reason'),
  },
  (table) => [
    index('p_invoices_contract_idx').on(table.contractId),
    index('p_invoices_factory_idx').on(table.factoryId),
    index('p_invoices_status_idx').on(table.status),
  ],
);

export const pPayments = sqliteTable(
  'p_payments',
  {
    paymentId: text('payment_id').primaryKey(),
    invoiceId: text('invoice_id').notNull(),
    contractId: text('contract_id').notNull().default(''),
    factoryId: text('factory_id').notNull().default(''),
    brandId: text('brand_id').notNull().default(''),
    amountMinor: integer('amount_minor').notNull(),
    currency: text('currency').notNull(),
    method: text('method').notNull(),
    reference: text('reference').notNull(),
    status: text('status').notNull(),
    initiatedAt: text('initiated_at').notNull(),
    settledAt: text('settled_at'),
    failureReason: text('failure_reason'),
    initiatedEventId: text('initiated_event_id').notNull(),
  },
  (table) => [index('p_payments_invoice_idx').on(table.invoiceId)],
);

export const pInventoryBalances = sqliteTable(
  'p_inventory_balances',
  {
    id: text('id').primaryKey(), // `${factory_id}:${sku}`
    sku: text('sku').notNull(),
    factoryId: text('factory_id').notNull(),
    received: real('received').notNull().default(0),
    issued: real('issued').notNull().default(0),
    consumed: real('consumed').notNull().default(0),
    disposed: real('disposed').notNull().default(0),
    adjusted: real('adjusted').notNull().default(0),
    onHand: real('on_hand').notNull().default(0),
    movementCount: integer('movement_count').notNull().default(0),
    lastMovementAt: text('last_movement_at'),
  },
  (table) => [index('p_inv_balances_factory_idx').on(table.factoryId)],
);

/* -------------------------------------------------------------------- DDL */

/**
 * Applied idempotently by `npm run db:migrate`. Kept beside the Drizzle schema above so
 * the two are edited together; `test/schema.test.ts` asserts they stay in step.
 */
export const DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS blocks (
     block_index INTEGER PRIMARY KEY,
     timestamp TEXT NOT NULL,
     previous_block_hash TEXT NOT NULL,
     block_hash TEXT NOT NULL,
     record_json TEXT NOT NULL,
     public_key_json TEXT,
     signature TEXT,
     ai_flag INTEGER NOT NULL DEFAULT 0,
     ai_score REAL,
     ai_flag_reason TEXT,
     ai_rule TEXT,
     event_id TEXT NOT NULL,
     event_type TEXT NOT NULL,
     event_family TEXT NOT NULL,
     factory_id TEXT NOT NULL,
     submitter_id TEXT NOT NULL,
     submitter_role TEXT NOT NULL,
     ref_id TEXT
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS blocks_event_id_idx ON blocks (event_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS blocks_hash_idx ON blocks (block_hash)`,
  `CREATE INDEX IF NOT EXISTS blocks_family_idx ON blocks (event_family)`,
  `CREATE INDEX IF NOT EXISTS blocks_factory_idx ON blocks (factory_id)`,
  `CREATE INDEX IF NOT EXISTS blocks_ref_idx ON blocks (ref_id)`,

  `CREATE TABLE IF NOT EXISTS identities (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     role TEXT NOT NULL,
     org TEXT NOT NULL,
     factory_id TEXT,
     created_at TEXT NOT NULL
   )`,

  `CREATE TABLE IF NOT EXISTS device_keys (
     id TEXT PRIMARY KEY,
     identity_id TEXT NOT NULL REFERENCES identities(id),
     public_key_json TEXT NOT NULL,
     fingerprint TEXT NOT NULL,
     label TEXT NOT NULL,
     created_at TEXT NOT NULL,
     revoked_at TEXT
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS device_keys_fingerprint_idx ON device_keys (fingerprint)`,
  `CREATE INDEX IF NOT EXISTS device_keys_identity_idx ON device_keys (identity_id)`,

  `CREATE TABLE IF NOT EXISTS factories (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     country TEXT NOT NULL,
     city TEXT NOT NULL,
     certifications_json TEXT NOT NULL DEFAULT '[]',
     employee_count INTEGER NOT NULL DEFAULT 0
   )`,

  `CREATE TABLE IF NOT EXISTS inventory_items (
     id TEXT PRIMARY KEY,
     sku TEXT NOT NULL,
     factory_id TEXT NOT NULL,
     name TEXT NOT NULL,
     kind TEXT NOT NULL,
     unit TEXT NOT NULL,
     reorder_level REAL NOT NULL DEFAULT 0,
     cas_number TEXT,
     hazard_class TEXT,
     mrsl_restricted INTEGER NOT NULL DEFAULT 0,
     supplier TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS inventory_items_factory_idx ON inventory_items (factory_id)`,

  `CREATE TABLE IF NOT EXISTS p_records (
     event_id TEXT PRIMARY KEY,
     block_index INTEGER NOT NULL,
     human_review_status TEXT NOT NULL DEFAULT 'none',
     reviewer_id TEXT,
     reviewer_name TEXT,
     reviewed_at TEXT,
     review_note TEXT,
     status TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS p_records_status_idx ON p_records (status)`,

  `CREATE TABLE IF NOT EXISTS p_contracts (
     contract_id TEXT PRIMARY KEY,
     title TEXT NOT NULL,
     brand_id TEXT NOT NULL,
     factory_id TEXT NOT NULL,
     value_minor INTEGER NOT NULL,
     currency TEXT NOT NULL,
     incoterm TEXT NOT NULL,
     order_quantity INTEGER NOT NULL,
     product TEXT NOT NULL,
     start_date TEXT NOT NULL,
     delivery_date TEXT NOT NULL,
     status TEXT NOT NULL,
     signatures_json TEXT NOT NULL DEFAULT '[]',
     amendments_json TEXT NOT NULL DEFAULT '[]',
     invoiced_minor INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL,
     created_event_id TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS p_contracts_factory_idx ON p_contracts (factory_id)`,
  `CREATE INDEX IF NOT EXISTS p_contracts_brand_idx ON p_contracts (brand_id)`,

  `CREATE TABLE IF NOT EXISTS p_invoices (
     invoice_id TEXT PRIMARY KEY,
     contract_id TEXT NOT NULL,
     factory_id TEXT NOT NULL,
     brand_id TEXT NOT NULL,
     currency TEXT NOT NULL,
     line_items_json TEXT NOT NULL DEFAULT '[]',
     subtotal_minor INTEGER NOT NULL,
     tax_minor INTEGER NOT NULL,
     total_minor INTEGER NOT NULL,
     paid_minor INTEGER NOT NULL DEFAULT 0,
     pending_minor INTEGER NOT NULL DEFAULT 0,
     status TEXT NOT NULL,
     issued_at TEXT NOT NULL,
     due_date TEXT NOT NULL,
     issued_event_id TEXT NOT NULL,
     dispute_reason TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS p_invoices_contract_idx ON p_invoices (contract_id)`,
  `CREATE INDEX IF NOT EXISTS p_invoices_factory_idx ON p_invoices (factory_id)`,
  `CREATE INDEX IF NOT EXISTS p_invoices_status_idx ON p_invoices (status)`,

  `CREATE TABLE IF NOT EXISTS p_payments (
     payment_id TEXT PRIMARY KEY,
     invoice_id TEXT NOT NULL,
     contract_id TEXT NOT NULL DEFAULT '',
     factory_id TEXT NOT NULL DEFAULT '',
     brand_id TEXT NOT NULL DEFAULT '',
     amount_minor INTEGER NOT NULL,
     currency TEXT NOT NULL,
     method TEXT NOT NULL,
     reference TEXT NOT NULL,
     status TEXT NOT NULL,
     initiated_at TEXT NOT NULL,
     settled_at TEXT,
     failure_reason TEXT,
     initiated_event_id TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS p_payments_invoice_idx ON p_payments (invoice_id)`,

  `CREATE TABLE IF NOT EXISTS p_inventory_balances (
     id TEXT PRIMARY KEY,
     sku TEXT NOT NULL,
     factory_id TEXT NOT NULL,
     received REAL NOT NULL DEFAULT 0,
     issued REAL NOT NULL DEFAULT 0,
     consumed REAL NOT NULL DEFAULT 0,
     disposed REAL NOT NULL DEFAULT 0,
     adjusted REAL NOT NULL DEFAULT 0,
     on_hand REAL NOT NULL DEFAULT 0,
     movement_count INTEGER NOT NULL DEFAULT 0,
     last_movement_at TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS p_inv_balances_factory_idx ON p_inventory_balances (factory_id)`,
  `CREATE TABLE IF NOT EXISTS chain_checkpoints (
     checkpoint_id TEXT PRIMARY KEY,
     block_height INTEGER NOT NULL,
     block_hash TEXT NOT NULL,
     merkle_root TEXT NOT NULL,
     notarized_at TEXT NOT NULL,
     network TEXT NOT NULL,
     tx_hash TEXT NOT NULL,
     explorer_url TEXT NOT NULL,
     status TEXT NOT NULL DEFAULT 'confirmed'
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS checkpoints_height_idx ON chain_checkpoints (block_height)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS checkpoints_tx_idx ON chain_checkpoints (tx_hash)`,
];

/** Projection tables, in the order `rebuildProjections()` clears them. */
export const PROJECTION_TABLES = [
  'p_records',
  'p_contracts',
  'p_invoices',
  'p_payments',
  'p_inventory_balances',
] as const;

/**
 * Every table, in an order that is safe to DELETE through: dependents before the rows
 * they reference, so `device_keys` clears before `identities`.
 */
export const ALL_TABLES = [
  ...PROJECTION_TABLES,
  'chain_checkpoints',
  'blocks',
  'device_keys',
  'identities',
  'inventory_items',
  'factories',
] as const;

export const RAW_SQL = sql;
