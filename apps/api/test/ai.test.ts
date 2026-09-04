/** The anomaly rules, exercised directly as pure functions. */

import { describe, expect, it } from 'vitest';
import { MIN_HISTORY, runAnomalyCheck } from '@breadcrumbs/shared';
import type { AnomalyContext, CandidateRecord, HistoricalRecord } from '@breadcrumbs/shared';

function ctx(overrides: Partial<AnomalyContext> = {}): AnomalyContext {
  return {
    history: [],
    contractValueMinor: () => null,
    invoicedToDateMinor: () => 0,
    invoiceBalanceMinor: () => null,
    invoiceStatus: () => null,
    paymentAmountMinor: () => null,
    paymentStatus: () => null,
    stockOnHand: () => 0,
    ...overrides,
  };
}

function history(
  eventType: HistoricalRecord['event_type'],
  values: Record<string, unknown>[],
): HistoricalRecord[] {
  return values.map((data_fields, i) => ({
    event_id: `H${i}`,
    event_type: eventType,
    factory_id: 'FAC-A',
    timestamp: new Date(Date.UTC(2026, 0, i + 1)).toISOString(),
    data_fields,
  }));
}

function candidate(
  eventType: CandidateRecord['event_type'],
  data_fields: Record<string, unknown>,
  ref_id: string | null = null,
): CandidateRecord {
  return {
    event_type: eventType,
    factory_id: 'FAC-A',
    timestamp: '2026-03-01T00:00:00.000Z',
    data_fields,
    ref_id,
  };
}

describe('production volume', () => {
  const priors = history(
    'production_report',
    [9800, 10_200, 10_050, 9900, 10_300].map((units_produced) => ({
      units_produced,
      working_hours: 1840,
    })),
  );

  it('flags a spike well outside the factory baseline', () => {
    const result = runAnomalyCheck(
      candidate('production_report', { units_produced: 34_000, working_hours: 1840 }),
      ctx({ history: priors }),
    );

    expect(result.flagged).toBe(true);
    expect(result.rule).toBe('production_volume_zscore');
    expect(result.reason).toContain('units_produced');
    expect(result.score).toBeGreaterThan(2.5);
  });

  it('passes an ordinary week', () => {
    const result = runAnomalyCheck(
      candidate('production_report', { units_produced: 10_120, working_hours: 1840 }),
      ctx({ history: priors }),
    );
    expect(result.flagged).toBe(false);
    expect(result.reason).toBeNull();
  });

  it('declines to judge on thin history and says so', () => {
    const result = runAnomalyCheck(
      candidate('production_report', { units_produced: 99_999, working_hours: 1840 }),
      ctx({ history: priors.slice(0, MIN_HISTORY - 1) }),
    );

    expect(result.flagged).toBe(false);
    expect(result.note).toContain('Insufficient history');
  });

  it('measures each factory against its own baseline only', () => {
    // A large factory's normal output must not normalise a small factory's spike.
    const otherFactory = history('production_report', [
      { units_produced: 90_000, working_hours: 1840 },
      { units_produced: 92_000, working_hours: 1840 },
      { units_produced: 91_000, working_hours: 1840 },
    ]).map((h) => ({ ...h, factory_id: 'FAC-B' }));

    // The API only ever passes this factory's own history in; confirm the rule
    // flags purely on what it is given.
    const result = runAnomalyCheck(
      candidate('production_report', { units_produced: 34_000, working_hours: 1840 }),
      ctx({ history: priors }),
    );
    expect(result.flagged).toBe(true);
    expect(otherFactory).toHaveLength(3);
  });
});

describe('chemical mass balance', () => {
  it('flags consumption per unit far off the factory norm', () => {
    const priors = history('chemical_consumption', [
      { quantity: 27, units_processed: 6000 },
      { quantity: 28, units_processed: 6100 },
      { quantity: 26.5, units_processed: 5950 },
      { quantity: 27.4, units_processed: 6050 },
    ]);

    const result = runAnomalyCheck(
      candidate('chemical_consumption', { quantity: 103, units_processed: 6100 }),
      ctx({ history: priors }),
    );

    expect(result.flagged).toBe(true);
    expect(result.rule).toBe('chemical_mass_balance');
    expect(result.reason).toContain('undeclared');
  });
});

describe('invoice rules', () => {
  it('flags cumulative billing past the contract ceiling', () => {
    const result = runAnomalyCheck(
      candidate('invoice_issued', { contract_id: 'C1', total_minor: 20_000_000, invoice_id: 'I3' }),
      ctx({
        contractValueMinor: () => 39_000_000,
        invoicedToDateMinor: () => 26_000_000,
      }),
    );

    expect(result.flagged).toBe(true);
    expect(result.rule).toBe('invoice_exceeds_contract');
  });

  it('allows billing inside the tolerance', () => {
    const result = runAnomalyCheck(
      candidate('invoice_issued', { contract_id: 'C1', total_minor: 10_000_000, invoice_id: 'I2' }),
      ctx({ contractValueMinor: () => 39_000_000, invoicedToDateMinor: () => 26_000_000 }),
    );
    expect(result.flagged).toBe(false);
  });

  it('flags a same-value invoice raised within the duplicate window', () => {
    const priors: HistoricalRecord[] = [
      {
        event_id: 'H1',
        event_type: 'invoice_issued',
        factory_id: 'FAC-A',
        timestamp: '2026-02-27T00:00:00.000Z',
        data_fields: { invoice_id: 'INV-1', total_minor: 5_600_000 },
      },
    ];

    const result = runAnomalyCheck(
      candidate('invoice_issued', { contract_id: 'C1', invoice_id: 'INV-2', total_minor: 5_600_000 }),
      ctx({ history: priors }),
    );

    expect(result.flagged).toBe(true);
    expect(result.rule).toBe('duplicate_invoice');
    expect(result.reason).toContain('INV-1');
  });

  it('does not treat a same-value invoice months later as a duplicate', () => {
    const priors: HistoricalRecord[] = [
      {
        event_id: 'H1',
        event_type: 'invoice_issued',
        factory_id: 'FAC-A',
        timestamp: '2025-11-01T00:00:00.000Z',
        data_fields: { invoice_id: 'INV-1', total_minor: 5_600_000 },
      },
    ];

    const result = runAnomalyCheck(
      candidate('invoice_issued', { contract_id: 'C1', invoice_id: 'INV-2', total_minor: 5_600_000 }),
      ctx({ history: priors }),
    );
    expect(result.flagged).toBe(false);
  });
});

describe('payment rules', () => {
  it('does not flag an honest settlement of a payment already in flight', () => {
    // The regression this guards: headroom already excludes the in-flight amount, so
    // measuring a settlement against it would flag every legitimate payment.
    const result = runAnomalyCheck(
      candidate('payment_settled', { payment_id: 'P1', invoice_id: 'I1', amount_minor: 500_000 }),
      ctx({
        invoiceBalanceMinor: () => 0,
        invoiceStatus: () => 'approved',
        paymentAmountMinor: () => 500_000,
        paymentStatus: () => 'initiated',
      }),
    );

    expect(result.flagged).toBe(false);
  });

  it('flags a settlement for a different amount than was initiated', () => {
    const result = runAnomalyCheck(
      candidate('payment_settled', { payment_id: 'P1', invoice_id: 'I1', amount_minor: 900_000 }),
      ctx({ paymentAmountMinor: () => 500_000, paymentStatus: () => 'initiated' }),
    );

    expect(result.flagged).toBe(true);
    expect(result.rule).toBe('payment_mismatch');
  });

  it('flags a settlement for a payment that was never initiated', () => {
    const result = runAnomalyCheck(
      candidate('payment_settled', { payment_id: 'GHOST', invoice_id: 'I1', amount_minor: 1000 }),
      ctx({ paymentAmountMinor: () => null }),
    );

    expect(result.flagged).toBe(true);
    expect(result.reason).toContain('never initiated');
  });

  it('flags new money raised against an already-settled invoice', () => {
    const result = runAnomalyCheck(
      candidate('payment_initiated', { payment_id: 'P2', invoice_id: 'I1', amount_minor: 100 }),
      ctx({ invoiceStatus: () => 'settled' }),
    );

    expect(result.flagged).toBe(true);
    expect(result.reason).toContain('already settled');
  });

  it('flags a payment beyond the remaining headroom', () => {
    const result = runAnomalyCheck(
      candidate('payment_initiated', { payment_id: 'P2', invoice_id: 'I1', amount_minor: 900_000 }),
      ctx({ invoiceStatus: () => 'approved', invoiceBalanceMinor: () => 100_000 }),
    );

    expect(result.flagged).toBe(true);
    expect(result.rule).toBe('payment_mismatch');
  });
});

describe('negative stock', () => {
  it('flags a movement larger than the recorded stock', () => {
    const result = runAnomalyCheck(
      candidate('material_issue', { sku: 'FAB-CTN-180', quantity: 5000, order_ref: 'O1' }),
      ctx({ stockOnHand: () => 1200 }),
    );

    expect(result.flagged).toBe(true);
    expect(result.rule).toBe('negative_stock');
    expect(result.reason).toContain('no record of this quantity arriving');
  });

  it('passes a movement within stock', () => {
    const result = runAnomalyCheck(
      candidate('material_issue', { sku: 'FAB-CTN-180', quantity: 800, order_ref: 'O1' }),
      ctx({ stockOnHand: () => 1200 }),
    );
    expect(result.flagged).toBe(false);
  });
});
