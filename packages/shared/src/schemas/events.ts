/**
 * Per-event-type validation for `data_fields`.
 *
 * One definition, used twice: the browser validates the form against it before signing,
 * and the API validates the request against it before verifying the signature. A record
 * cannot reach the chain in a shape the UI could not have produced.
 */

import { z } from 'zod';
import { EVENT_TYPES } from '../types/roles.ts';
import type { EventType } from '../types/roles.ts';
import { DEFAULT_CHAIN_ID, GENESIS_PREV_HASH } from '../types/ledger.ts';

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a YYYY-MM-DD date');

const isoDateTime = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Expected an ISO-8601 timestamp');

const nonEmpty = z.string().trim().min(1);
const quantity = z.number().finite().positive();
const minorAmount = z.number().int().nonnegative();
const currency = z.enum(['USD', 'EUR', 'BDT']);

const attestationMetadata = {
  _source: z.string().optional(),
  evidence_hash: z.string().optional(),
};

/* ------------------------------------------------------------------ audit */

const inspection = z.object({
  ...attestationMetadata,
  inspection_type: nonEmpty,
  workers_present: z.number().int().nonnegative(),
  working_hours: z.number().finite().nonnegative(),
  non_conformities: z.number().int().nonnegative(),
  passed: z.boolean(),
  findings: z.string().default(''),
});

const productionReport = z.object({
  ...attestationMetadata,
  order_ref: nonEmpty,
  units_produced: z.number().int().nonnegative(),
  working_hours: z.number().finite().nonnegative(),
  line_count: z.number().int().positive(),
  defect_count: z.number().int().nonnegative(),
});

const certification = z.object({
  ...attestationMetadata,
  standard: nonEmpty,
  certificate_no: nonEmpty,
  issued_by: nonEmpty,
  valid_until: isoDate,
  scope: z.string().default(''),
});

const shipment = z.object({
  ...attestationMetadata,
  shipment_ref: nonEmpty,
  destination: nonEmpty,
  carrier: nonEmpty,
  cartons: z.number().int().positive(),
  gross_weight_kg: z.number().finite().positive(),
  contract_id: z.string().nullable().default(null),
});

/* -------------------------------------------------------------- inventory */

const materialReceipt = z.object({
  ...attestationMetadata,
  sku: nonEmpty,
  quantity,
  unit_cost_minor: minorAmount,
  supplier: nonEmpty,
  grn_ref: nonEmpty,
  lot_no: z.string().default(''),
});

const materialIssue = z.object({
  ...attestationMetadata,
  sku: nonEmpty,
  quantity,
  order_ref: nonEmpty,
  line: z.string().default(''),
});

const chemicalReceipt = z.object({
  ...attestationMetadata,
  sku: nonEmpty,
  quantity,
  supplier: nonEmpty,
  lot_no: nonEmpty,
  msds_ref: z.string().default(''),
  expiry_date: isoDate,
});

const chemicalConsumption = z.object({
  ...attestationMetadata,
  sku: nonEmpty,
  quantity,
  /** Denominator for the mass-balance rule. */
  units_processed: z.number().int().positive(),
  process: nonEmpty,
});

const stockAdjustment = z.object({
  ...attestationMetadata,
  sku: nonEmpty,
  /** Signed — a correction can go either way. */
  quantity: z.number().finite(),
  reason: nonEmpty,
});

const chemicalDisposal = z.object({
  ...attestationMetadata,
  sku: nonEmpty,
  quantity,
  disposal_method: nonEmpty,
  permit_ref: z.string().default(''),
});

/* -------------------------------------------------------------- contracts */

const contractCreated = z.object({
  ...attestationMetadata,
  contract_id: nonEmpty,
  title: nonEmpty,
  brand_id: nonEmpty,
  factory_id: nonEmpty,
  value_minor: z.number().int().positive(),
  currency,
  incoterm: nonEmpty,
  order_quantity: z.number().int().positive(),
  product: nonEmpty,
  start_date: isoDate,
  delivery_date: isoDate,
});

const contractSigned = z.object({
  ...attestationMetadata,
  contract_id: nonEmpty,
});

const contractAmended = z.object({
  ...attestationMetadata,
  contract_id: nonEmpty,
  note: nonEmpty,
  value_minor_delta: z.number().int(),
});

const contractClosed = z.object({
  ...attestationMetadata,
  contract_id: nonEmpty,
  reason: nonEmpty,
});

/* --------------------------------------------------------------- invoices */

const lineItem = z.object({
  description: nonEmpty,
  quantity: z.number().finite().positive(),
  unit_price_minor: minorAmount,
  amount_minor: minorAmount,
});

const invoiceIssued = z
  .object({
    ...attestationMetadata,
    invoice_id: nonEmpty,
    contract_id: nonEmpty,
    currency,
    line_items: z.array(lineItem).min(1),
    subtotal_minor: minorAmount,
    tax_minor: minorAmount,
    total_minor: z.number().int().positive(),
    due_date: isoDate,
  })
  .refine((v) => v.subtotal_minor + v.tax_minor === v.total_minor, {
    message: 'total_minor must equal subtotal_minor + tax_minor',
    path: ['total_minor'],
  })
  .refine(
    (v) => v.line_items.reduce((sum, li) => sum + li.amount_minor, 0) === v.subtotal_minor,
    { message: 'subtotal_minor must equal the sum of line item amounts', path: ['subtotal_minor'] },
  );

const invoiceApproved = z.object({ ...attestationMetadata, invoice_id: nonEmpty });

const invoiceDisputed = z.object({ ...attestationMetadata, invoice_id: nonEmpty, reason: nonEmpty });

const invoiceSettled = z.object({ ...attestationMetadata, invoice_id: nonEmpty });

/* --------------------------------------------------------------- payments */

const paymentInitiated = z.object({
  ...attestationMetadata,
  payment_id: nonEmpty,
  invoice_id: nonEmpty,
  amount_minor: z.number().int().positive(),
  currency,
  method: z.enum(['bank_transfer', 'letter_of_credit', 'telegraphic_transfer']),
  reference: nonEmpty,
});

const paymentSettled = z.object({
  ...attestationMetadata,
  payment_id: nonEmpty,
  invoice_id: nonEmpty,
  amount_minor: z.number().int().positive(),
});

const paymentFailed = z.object({
  ...attestationMetadata,
  payment_id: nonEmpty,
  invoice_id: nonEmpty,
  reason: nonEmpty,
});

/* ------------------------------------------------------------- governance */

const reviewConfirmed = z.object({
  ...attestationMetadata,
  target_event_id: nonEmpty,
  note: z.string().default(''),
});

const reviewDisputed = z.object({
  ...attestationMetadata,
  target_event_id: nonEmpty,
  note: nonEmpty,
});

const genesis = z.object({
  note: nonEmpty,
  chain: nonEmpty,
});

/* ------------------------------------------------------------------ table */

export const EVENT_DATA_SCHEMAS = {
  inspection,
  production_report: productionReport,
  certification,
  shipment,

  material_receipt: materialReceipt,
  material_issue: materialIssue,
  chemical_receipt: chemicalReceipt,
  chemical_consumption: chemicalConsumption,
  stock_adjustment: stockAdjustment,
  chemical_disposal: chemicalDisposal,

  contract_created: contractCreated,
  contract_signed: contractSigned,
  contract_amended: contractAmended,
  contract_closed: contractClosed,

  invoice_issued: invoiceIssued,
  invoice_approved: invoiceApproved,
  invoice_disputed: invoiceDisputed,
  invoice_settled: invoiceSettled,

  payment_initiated: paymentInitiated,
  payment_settled: paymentSettled,
  payment_failed: paymentFailed,

  review_confirmed: reviewConfirmed,
  review_disputed: reviewDisputed,

  genesis,
} as const satisfies Record<EventType, z.ZodType>;

export function dataSchemaFor(eventType: EventType): z.ZodType {
  return EVENT_DATA_SCHEMAS[eventType];
}

/* ----------------------------------------------------- record and commit */

export const signedRecordSchema = z.object({
  chain_id: nonEmpty.default(DEFAULT_CHAIN_ID),
  previous_block_hash: nonEmpty.default(GENESIS_PREV_HASH),
  nonce: z.number().int().nonnegative().default(0),
  event_id: nonEmpty,
  factory_id: nonEmpty,
  event_type: z.enum(EVENT_TYPES as [EventType, ...EventType[]]),
  timestamp: isoDateTime,
  submitter_id: nonEmpty,
  submitter_name: nonEmpty,
  submitter_role: z.enum(['factory', 'auditor', 'brand', 'system']),
  data_fields: z.record(z.string(), z.unknown()),
  ref_id: z.string().nullable(),
});

export const commitRequestSchema = z.object({
  record: signedRecordSchema,
  signature: nonEmpty,
  /** Fingerprint of the registered device key that produced the signature. */
  key_fingerprint: nonEmpty,
});

export type CommitRequest = z.infer<typeof commitRequestSchema>;

/**
 * Validates `data_fields` against the schema for its event type.
 * Returns the parsed value, which carries any schema defaults applied.
 */
export function validateDataFields(
  eventType: EventType,
  dataFields: unknown,
):
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; issues: { path: string; message: string }[] } {
  const result = dataSchemaFor(eventType).safeParse(dataFields);

  if (result.success) {
    return { ok: true, value: result.data as Record<string, unknown> };
  }

  return {
    ok: false,
    issues: result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    })),
  };
}
