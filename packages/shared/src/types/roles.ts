/**
 * Roles, event taxonomy and the permission matrix.
 *
 * This is what makes the chain *permissioned*: being an identity in the system is not
 * enough — each role may only commit the event types listed for it. The API enforces
 * `canSubmit()` on every commit, so "a factory can only submit factory records" is a
 * structural rule, not a UI convention.
 */

export type Role = 'factory' | 'auditor' | 'brand';

export const ROLES: readonly Role[] = ['factory', 'auditor', 'brand'] as const;

export const ROLE_LABEL: Record<Role, string> = {
  factory: 'Factory',
  auditor: 'Auditor',
  brand: 'Brand / Buyer',
};

/**
 * Who a block can be attributed to. `system` exists only for the genesis block, which
 * is written by the ledger itself and belongs to no participant.
 */
export type SubmitterRole = Role | 'system';

export const SUBMITTER_ROLE_LABEL: Record<SubmitterRole, string> = {
  ...ROLE_LABEL,
  system: 'System',
};

export type EventFamily =
  | 'audit'
  | 'inventory'
  | 'contract'
  | 'invoice'
  | 'payment'
  | 'governance'
  | 'system';

/** The families offered as filters in the UI. `system` is excluded — it holds only genesis. */
export const EVENT_FAMILIES: readonly EventFamily[] = [
  'audit',
  'inventory',
  'contract',
  'invoice',
  'payment',
  'governance',
] as const;

export const FAMILY_LABEL: Record<EventFamily, string> = {
  audit: 'Audit',
  inventory: 'Inventory',
  contract: 'Contracts',
  invoice: 'Invoices',
  payment: 'Payments',
  governance: 'Governance',
  system: 'System',
};

export type EventType =
  // audit
  | 'inspection'
  | 'production_report'
  | 'certification'
  | 'shipment'
  // inventory
  | 'material_receipt'
  | 'material_issue'
  | 'chemical_receipt'
  | 'chemical_consumption'
  | 'stock_adjustment'
  | 'chemical_disposal'
  // contract
  | 'contract_created'
  | 'contract_signed'
  | 'contract_amended'
  | 'contract_closed'
  // invoice
  | 'invoice_issued'
  | 'invoice_approved'
  | 'invoice_disputed'
  | 'invoice_settled'
  // payment
  | 'payment_initiated'
  | 'payment_settled'
  | 'payment_failed'
  // governance
  | 'review_confirmed'
  | 'review_disputed'
  // system — the genesis block only. No role can submit this, so a second one
  // can never be forged through the commit endpoint.
  | 'genesis';

export const EVENT_FAMILY: Record<EventType, EventFamily> = {
  inspection: 'audit',
  production_report: 'audit',
  certification: 'audit',
  shipment: 'audit',

  material_receipt: 'inventory',
  material_issue: 'inventory',
  chemical_receipt: 'inventory',
  chemical_consumption: 'inventory',
  stock_adjustment: 'inventory',
  chemical_disposal: 'inventory',

  contract_created: 'contract',
  contract_signed: 'contract',
  contract_amended: 'contract',
  contract_closed: 'contract',

  invoice_issued: 'invoice',
  invoice_approved: 'invoice',
  invoice_disputed: 'invoice',
  invoice_settled: 'invoice',

  payment_initiated: 'payment',
  payment_settled: 'payment',
  payment_failed: 'payment',

  review_confirmed: 'governance',
  review_disputed: 'governance',

  genesis: 'system',
};

export const EVENT_TYPES = Object.keys(EVENT_FAMILY) as EventType[];

export const EVENT_LABEL: Record<EventType, string> = {
  inspection: 'Inspection',
  production_report: 'Production report',
  certification: 'Certification',
  shipment: 'Shipment',

  material_receipt: 'Material receipt',
  material_issue: 'Material issue',
  chemical_receipt: 'Chemical receipt',
  chemical_consumption: 'Chemical consumption',
  stock_adjustment: 'Stock adjustment',
  chemical_disposal: 'Chemical disposal',

  contract_created: 'Contract created',
  contract_signed: 'Contract signed',
  contract_amended: 'Contract amended',
  contract_closed: 'Contract closed',

  invoice_issued: 'Invoice issued',
  invoice_approved: 'Invoice approved',
  invoice_disputed: 'Invoice disputed',
  invoice_settled: 'Invoice settled',

  payment_initiated: 'Payment initiated',
  payment_settled: 'Payment settled',
  payment_failed: 'Payment failed',

  review_confirmed: 'Review — confirmed',
  review_disputed: 'Review — disputed',

  genesis: 'Ledger genesis',
};

/**
 * Which role may commit which event type.
 *
 * The shape follows who actually holds the authority in a garment supply chain:
 * factories produce, consume stock and bill; brands contract and pay; auditors
 * rule on flagged records and nothing else. `contract_signed` is deliberately
 * shared — a contract needs both parties' signatures to become active.
 */
export const ROLE_PERMISSIONS: Record<Role, readonly EventType[]> = {
  factory: [
    'inspection',
    'production_report',
    'certification',
    'shipment',
    'material_receipt',
    'material_issue',
    'chemical_receipt',
    'chemical_consumption',
    'stock_adjustment',
    'chemical_disposal',
    'contract_signed',
    'invoice_issued',
  ],
  auditor: ['review_confirmed', 'review_disputed'],
  brand: [
    'contract_created',
    'contract_signed',
    'contract_amended',
    'contract_closed',
    'invoice_approved',
    'invoice_disputed',
    'invoice_settled',
    'payment_initiated',
    'payment_settled',
    'payment_failed',
  ],
};

export function canSubmit(role: Role, eventType: EventType): boolean {
  return ROLE_PERMISSIONS[role].includes(eventType);
}

export function submittableEvents(role: Role): readonly EventType[] {
  return ROLE_PERMISSIONS[role];
}

export function familyOf(eventType: EventType): EventFamily {
  return EVENT_FAMILY[eventType];
}
