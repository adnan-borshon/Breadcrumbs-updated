/**
 * The AI anomaly layer — deliberately small.
 *
 * Seven pure rules, run server-side in the commit pipeline *before* a block is appended.
 * The output is a flag, a score and a human-readable reason; nothing more. A flag never
 * blocks a commit — flagged records still go on the chain and are routed to an auditor,
 * because silently dropping a record would defeat the point of an immutable ledger.
 *
 * Statistical rules refuse to guess on thin data: fewer than MIN_HISTORY prior records
 * and the rule reports "insufficient history" rather than passing silently.
 */

import type { EventType } from '../types/roles.ts';

export const MIN_HISTORY = 3;
export const Z_THRESHOLD = 2.5;
/** Invoices may exceed the contract by this much before it is treated as over-billing. */
export const CONTRACT_TOLERANCE = 1.05;
/** Window for treating two same-value invoices from one factory as possible duplicates. */
export const DUPLICATE_WINDOW_DAYS = 3;

export interface HistoricalRecord {
  event_id: string;
  event_type: EventType;
  factory_id: string;
  timestamp: string;
  data_fields: Record<string, unknown>;
}

/**
 * Everything a rule may look at, exposed as lookups rather than raw projection objects so
 * the rules stay independent of how the API stores its read models.
 */
export interface AnomalyContext {
  /** Prior records for this factory, ascending by timestamp. Excludes the record under test. */
  history: HistoricalRecord[];
  contractValueMinor: (contractId: string) => number | null;
  invoicedToDateMinor: (contractId: string) => number;
  /** Uncommitted headroom: total − settled − in-flight. */
  invoiceBalanceMinor: (invoiceId: string) => number | null;
  invoiceStatus: (invoiceId: string) => string | null;
  /** The amount a payment was initiated for, or null if it was never initiated. */
  paymentAmountMinor: (paymentId: string) => number | null;
  paymentStatus: (paymentId: string) => string | null;
  stockOnHand: (factoryId: string, sku: string) => number;
}

export interface AnomalyResult {
  flagged: boolean;
  /** Rule-specific magnitude — a z-score, a ratio, or an overshoot multiple. */
  score: number | null;
  reason: string | null;
  rule: string | null;
  /** Set when a rule declined to judge, e.g. "insufficient history". */
  note: string | null;
}

export interface CandidateRecord {
  event_type: EventType;
  factory_id: string;
  timestamp: string;
  data_fields: Record<string, unknown>;
  ref_id: string | null;
}

const CLEAN: AnomalyResult = { flagged: false, score: null, reason: null, rule: null, note: null };

/* ------------------------------------------------------------------ stats */

interface ZResult {
  z: number;
  mean: number;
  stdev: number;
  n: number;
  ratio: number;
}

function zScore(values: number[], observed: number): ZResult | null {
  const n = values.length;
  if (n < MIN_HISTORY) return null;

  const mean = values.reduce((sum, v) => sum + v, 0) / n;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / n;
  const stdev = Math.sqrt(variance);

  // A factory that has reported the exact same number every time has no spread to
  // measure against. Fall back to a proportional check so the rule still means something.
  if (stdev === 0) {
    if (mean === 0) return null;
    const ratio = observed / mean;
    return { z: ratio >= 1.5 || ratio <= 0.5 ? Z_THRESHOLD : 0, mean, stdev, n, ratio };
  }

  return { z: (observed - mean) / stdev, mean, stdev, n, ratio: mean === 0 ? 0 : observed / mean };
}

function numeric(fields: Record<string, unknown>, key: string): number | null {
  const value = fields[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function text(fields: Record<string, unknown>, key: string): string | null {
  const value = fields[key];
  return typeof value === 'string' ? value : null;
}

function round(value: number, places = 2): number {
  return Number(value.toFixed(places));
}

function daysBetween(a: string, b: string): number {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 86_400_000;
}

/* ------------------------------------------------------------------ rules */

/** Shared body for the two production z-score rules. */
function volumeRule(
  record: CandidateRecord,
  ctx: AnomalyContext,
  rule: string,
  field: string,
  noun: string,
): AnomalyResult | null {
  const observed = numeric(record.data_fields, field);
  if (observed === null) return null;

  const priors = ctx.history
    .filter((h) => h.event_type === record.event_type)
    .map((h) => numeric(h.data_fields, field))
    .filter((v): v is number => v !== null);

  const stats = zScore(priors, observed);
  if (!stats) {
    return {
      ...CLEAN,
      note: `Insufficient history — ${priors.length} prior ${noun} record${
        priors.length === 1 ? '' : 's'
      } for this factory, ${MIN_HISTORY} needed before a baseline is meaningful.`,
    };
  }

  if (Math.abs(stats.z) < Z_THRESHOLD) return CLEAN;

  const direction = stats.z > 0 ? 'above' : 'below';
  const multiple = stats.ratio > 0 ? `${round(stats.ratio, 1)}×` : 'far';

  return {
    flagged: true,
    score: round(Math.abs(stats.z)),
    rule,
    note: null,
    reason: `${field} is ${multiple} this factory's average — ${round(observed)} against a mean of ${round(
      stats.mean,
    )} (${round(Math.abs(stats.z), 1)}σ ${direction} normal across ${stats.n} prior records).`,
  };
}

function productionVolume(record: CandidateRecord, ctx: AnomalyContext): AnomalyResult | null {
  if (record.event_type !== 'production_report') return null;
  return volumeRule(record, ctx, 'production_volume_zscore', 'units_produced', 'production');
}

function workingHours(record: CandidateRecord, ctx: AnomalyContext): AnomalyResult | null {
  if (record.event_type !== 'production_report' && record.event_type !== 'inspection') return null;
  return volumeRule(record, ctx, 'working_hours_zscore', 'working_hours', 'labour-hours');
}

function invoiceExceedsContract(
  record: CandidateRecord,
  ctx: AnomalyContext,
): AnomalyResult | null {
  if (record.event_type !== 'invoice_issued') return null;

  const contractId = text(record.data_fields, 'contract_id') ?? record.ref_id;
  if (!contractId) return null;

  const contractValue = ctx.contractValueMinor(contractId);
  if (contractValue === null || contractValue <= 0) return null;

  const total = numeric(record.data_fields, 'total_minor');
  if (total === null) return null;

  const cumulative = ctx.invoicedToDateMinor(contractId) + total;
  const ceiling = contractValue * CONTRACT_TOLERANCE;
  if (cumulative <= ceiling) return CLEAN;

  const overshoot = cumulative / contractValue;

  return {
    flagged: true,
    score: round(overshoot),
    rule: 'invoice_exceeds_contract',
    note: null,
    reason: `Invoicing against ${contractId} would reach ${round(
      overshoot * 100,
      1,
    )}% of the agreed contract value — cumulative billing exceeds the contract ceiling.`,
  };
}

function duplicateInvoice(record: CandidateRecord, ctx: AnomalyContext): AnomalyResult | null {
  if (record.event_type !== 'invoice_issued') return null;

  const total = numeric(record.data_fields, 'total_minor');
  if (total === null) return null;

  const match = ctx.history.find(
    (h) =>
      h.event_type === 'invoice_issued' &&
      numeric(h.data_fields, 'total_minor') === total &&
      daysBetween(h.timestamp, record.timestamp) <= DUPLICATE_WINDOW_DAYS,
  );

  if (!match) return CLEAN;

  const priorId = text(match.data_fields, 'invoice_id') ?? match.event_id;

  return {
    flagged: true,
    score: 1,
    rule: 'duplicate_invoice',
    note: null,
    reason: `Possible duplicate — an invoice for an identical amount (${priorId}) was issued by this factory within ${DUPLICATE_WINDOW_DAYS} days.`,
  };
}

/**
 * Mass balance: chemical use per unit of declared output. A factory that consumes far more
 * dye than its reported production accounts for is either producing units it has not
 * declared, or using chemicals it has not declared.
 */
function chemicalMassBalance(record: CandidateRecord, ctx: AnomalyContext): AnomalyResult | null {
  if (record.event_type !== 'chemical_consumption') return null;

  const quantity = numeric(record.data_fields, 'quantity');
  const output = numeric(record.data_fields, 'units_processed');
  if (quantity === null || output === null || output <= 0) return null;

  const observed = quantity / output;

  const priors = ctx.history
    .filter((h) => h.event_type === 'chemical_consumption')
    .map((h) => {
      const q = numeric(h.data_fields, 'quantity');
      const u = numeric(h.data_fields, 'units_processed');
      return q !== null && u !== null && u > 0 ? q / u : null;
    })
    .filter((v): v is number => v !== null);

  const stats = zScore(priors, observed);
  if (!stats) {
    return {
      ...CLEAN,
      note: `Insufficient history — ${priors.length} prior consumption record${
        priors.length === 1 ? '' : 's'
      } for this factory, ${MIN_HISTORY} needed before a mass-balance baseline is meaningful.`,
    };
  }

  if (Math.abs(stats.z) < Z_THRESHOLD) return CLEAN;

  return {
    flagged: true,
    score: round(Math.abs(stats.z)),
    rule: 'chemical_mass_balance',
    note: null,
    reason: `Chemical use per unit processed is ${round(
      stats.ratio,
      1,
    )}× this factory's norm (${round(observed, 4)} vs ${round(
      stats.mean,
      4,
    )} per unit) — consistent with undeclared production or undeclared chemical use.`,
  };
}

/**
 * Two genuinely different questions hide behind "payment mismatch", and conflating them
 * produces false positives on every honest settlement:
 *
 *   initiating — is this new money more than the invoice still has room for?
 *   settling   — does this match the payment that was actually initiated?
 *
 * A settlement must NOT be measured against the invoice balance, because initiating the
 * payment already reserved that amount against it.
 */
function paymentMismatch(record: CandidateRecord, ctx: AnomalyContext): AnomalyResult | null {
  const invoiceId = text(record.data_fields, 'invoice_id') ?? record.ref_id;
  const amount = numeric(record.data_fields, 'amount_minor');

  if (record.event_type === 'payment_settled') {
    const paymentId = text(record.data_fields, 'payment_id');
    if (!paymentId || amount === null) return null;

    const initiated = ctx.paymentAmountMinor(paymentId);
    if (initiated === null) {
      return {
        flagged: true,
        score: 1,
        rule: 'payment_mismatch',
        note: null,
        reason: `Settlement recorded for ${paymentId}, which was never initiated on the ledger.`,
      };
    }

    if (ctx.paymentStatus(paymentId) === 'failed') {
      return {
        flagged: true,
        score: 1,
        rule: 'payment_mismatch',
        note: null,
        reason: `Settlement recorded for ${paymentId}, which had already failed.`,
      };
    }

    if (amount === initiated) return CLEAN;

    return {
      flagged: true,
      score: round(initiated > 0 ? amount / initiated : 2),
      rule: 'payment_mismatch',
      note: null,
      reason: `Settled amount does not match the amount initiated for ${paymentId} — the ledger recorded a different figure when the payment was raised.`,
    };
  }

  if (record.event_type !== 'payment_initiated') return null;
  if (!invoiceId || amount === null) return null;

  if (ctx.invoiceStatus(invoiceId) === 'settled') {
    return {
      flagged: true,
      score: 1,
      rule: 'payment_mismatch',
      note: null,
      reason: `Payment raised against ${invoiceId}, which is already settled in full.`,
    };
  }

  // Headroom already accounts for money in flight, so a second payment for the full
  // amount is caught before it settles rather than after.
  const headroom = ctx.invoiceBalanceMinor(invoiceId);
  if (headroom === null) return CLEAN;
  if (amount <= headroom) return CLEAN;

  return {
    flagged: true,
    score: round(headroom > 0 ? amount / headroom : 2),
    rule: 'payment_mismatch',
    note: null,
    reason: `Payment of ${amount / 100} exceeds what is still owed on ${invoiceId} — including payments already in flight, only ${headroom / 100} remains outstanding.`,
  };
}

/** A movement that would drive stock below zero describes something that cannot have happened. */
function negativeStock(record: CandidateRecord, ctx: AnomalyContext): AnomalyResult | null {
  const outflows: EventType[] = ['material_issue', 'chemical_consumption', 'chemical_disposal'];
  const isAdjustment = record.event_type === 'stock_adjustment';
  if (!outflows.includes(record.event_type) && !isAdjustment) return null;

  const sku = text(record.data_fields, 'sku');
  const quantity = numeric(record.data_fields, 'quantity');
  if (!sku || quantity === null) return null;

  // Positive stock adjustments increase inventory and cannot cause negative stock
  if (isAdjustment && quantity >= 0) return CLEAN;
  const outflow = isAdjustment ? -quantity : quantity;

  const onHand = ctx.stockOnHand(record.factory_id, sku);
  if (outflow <= onHand) return CLEAN;

  return {
    flagged: true,
    score: round(onHand > 0 ? outflow / onHand : 2),
    rule: 'negative_stock',
    note: null,
    reason: `Movement of ${outflow} exceeds recorded stock of ${onHand} for ${sku} — ${
      isAdjustment ? 'stock adjustment drives inventory negative' : 'the ledger has no record of this quantity arriving'
    }.`,
  };
}

const RULES = [
  productionVolume,
  workingHours,
  invoiceExceedsContract,
  duplicateInvoice,
  chemicalMassBalance,
  paymentMismatch,
  negativeStock,
] as const;

export const RULE_NAMES = [
  'production_volume_zscore',
  'working_hours_zscore',
  'invoice_exceeds_contract',
  'duplicate_invoice',
  'chemical_mass_balance',
  'payment_mismatch',
  'negative_stock',
] as const;

/**
 * Runs every applicable rule and returns the most severe flag.
 *
 * When nothing flags, any "insufficient history" note is surfaced instead, so the UI can
 * say why no baseline was applied rather than implying the record was checked and passed.
 */
export function runAnomalyCheck(record: CandidateRecord, ctx: AnomalyContext): AnomalyResult {
  const results = RULES.map((rule) => rule(record, ctx)).filter(
    (r): r is AnomalyResult => r !== null,
  );

  const flags = results.filter((r) => r.flagged);
  if (flags.length > 0) {
    return flags.reduce((worst, r) => ((r.score ?? 0) > (worst.score ?? 0) ? r : worst));
  }

  const note = results.find((r) => r.note !== null);
  return note ? { ...CLEAN, note: note.note } : CLEAN;
}
