/**
 * Projection types — the read models folded out of the chain.
 *
 * None of these are edited directly. Every number here is the result of replaying ledger
 * events in order, which is why `POST /api/admin/rebuild` can throw them all away and
 * recompute identical values from the blocks alone.
 *
 * Money is stored in integer minor units (paisa, cents) throughout. Summing floats over a
 * long payment history drifts, and a ledger that cannot add up is worse than no ledger.
 */

import type { Role } from './roles.ts';

export interface Identity {
  id: string;
  name: string;
  role: Role;
  org: string;
  /** Set for factory users and for auditors assigned to a factory. */
  factory_id: string | null;
  created_at: string;
}

export interface DeviceKey {
  id: string;
  identity_id: string;
  public_key_jwk: JsonWebKey;
  fingerprint: string;
  label: string;
  created_at: string;
}

export interface Factory {
  id: string;
  name: string;
  country: string;
  city: string;
  /** Certifications held, e.g. ["WRAP", "OEKO-TEX", "GOTS"]. */
  certifications: string[];
  employee_count: number;
}

/* ------------------------------------------------------------------ money */

export type Currency = 'USD' | 'EUR' | 'BDT';

export const CURRENCY_MINOR_DIGITS: Record<Currency, number> = {
  USD: 2,
  EUR: 2,
  BDT: 2,
};

export const CURRENCY_SYMBOL: Record<Currency, string> = {
  USD: '$',
  EUR: '€',
  BDT: '৳',
};

export function formatMoney(minor: number, currency: Currency): string {
  const digits = CURRENCY_MINOR_DIGITS[currency];
  const major = minor / 10 ** digits;
  return `${CURRENCY_SYMBOL[currency]}${major.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

/* -------------------------------------------------------------- inventory */

export type InventoryKind = 'material' | 'chemical';

export interface InventoryItem {
  sku: string;
  factory_id: string;
  name: string;
  kind: InventoryKind;
  /** kg, m, pcs, L … */
  unit: string;
  reorder_level: number;
  /* Chemicals only — null on materials. */
  cas_number: string | null;
  /** GHS hazard class, e.g. "Skin Irrit. 2". */
  hazard_class: string | null;
  /** Listed on the ZDHC Manufacturing Restricted Substances List. */
  mrsl_restricted: boolean;
  supplier: string | null;
}

export interface InventoryBalance {
  sku: string;
  factory_id: string;
  received: number;
  issued: number;
  consumed: number;
  disposed: number;
  adjusted: number;
  /** received − issued − consumed − disposed + adjusted */
  on_hand: number;
  last_movement_at: string | null;
  movement_count: number;
}

export interface InventoryItemView extends InventoryItem {
  balance: InventoryBalance;
  below_reorder: boolean;
}

/* -------------------------------------------------------------- contracts */

export type ContractStatus = 'awaiting_signatures' | 'active' | 'closed';

export interface ContractSignature {
  identity_id: string;
  name: string;
  role: Role;
  signed_at: string;
  event_id: string;
}

export interface ContractAmendment {
  event_id: string;
  at: string;
  by: string;
  note: string;
  value_minor_delta: number;
}

export interface Contract {
  contract_id: string;
  title: string;
  brand_id: string;
  brand_name: string;
  factory_id: string;
  factory_name: string;
  value_minor: number;
  currency: Currency;
  incoterm: string;
  order_quantity: number;
  product: string;
  start_date: string;
  delivery_date: string;
  status: ContractStatus;
  signatures: ContractSignature[];
  amendments: ContractAmendment[];
  created_at: string;
  created_event_id: string;
  /** Folded from invoices raised against this contract. */
  invoiced_minor: number;
  remaining_minor: number;
}

/* --------------------------------------------------------------- invoices */

export type InvoiceStatus = 'issued' | 'approved' | 'disputed' | 'part_paid' | 'settled';

export interface InvoiceLineItem {
  description: string;
  quantity: number;
  unit_price_minor: number;
  amount_minor: number;
}

export interface Invoice {
  invoice_id: string;
  contract_id: string;
  factory_id: string;
  factory_name: string;
  brand_id: string;
  brand_name: string;
  currency: Currency;
  line_items: InvoiceLineItem[];
  subtotal_minor: number;
  tax_minor: number;
  total_minor: number;
  /** Settled payments only. */
  paid_minor: number;
  /** Initiated but not yet settled — money in flight. */
  pending_minor: number;
  /** total − paid. */
  balance_minor: number;
  status: InvoiceStatus;
  issued_at: string;
  due_date: string;
  issued_event_id: string;
  /** Present when the brand disputed it. */
  dispute_reason: string | null;
}

/* --------------------------------------------------------------- payments */

export type PaymentStatus = 'initiated' | 'settled' | 'failed';

export type PaymentMethod = 'bank_transfer' | 'letter_of_credit' | 'telegraphic_transfer';

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  bank_transfer: 'Bank transfer',
  letter_of_credit: 'Letter of credit',
  telegraphic_transfer: 'Telegraphic transfer',
};

export interface Payment {
  payment_id: string;
  invoice_id: string;
  contract_id: string;
  factory_id: string;
  brand_id: string;
  amount_minor: number;
  currency: Currency;
  method: PaymentMethod;
  reference: string;
  status: PaymentStatus;
  initiated_at: string;
  settled_at: string | null;
  failure_reason: string | null;
  initiated_event_id: string;
}

/* -------------------------------------------------------------- summaries */

export interface FactoryTrust {
  factory_id: string;
  factory_name: string;
  total_records: number;
  verified: number;
  pending: number;
  flagged: number;
  disputed: number;
  /** 0–100. Verified records lift it, open flags and disputes pull it down. */
  score: number;
  last_activity_at: string | null;
}
