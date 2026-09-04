/** Projections must be pure derivations of the chain — nothing more, nothing less. */

import { beforeAll, describe, expect, it } from 'vitest';

import { rebuildProjections } from '../src/chain/projections.ts';
import {
  getContract,
  getInvoice,
  listContracts,
  listInventory,
  listInvoices,
  listPayments,
  listRecords,
} from '../src/chain/queries.ts';
import { seededLedger } from './helpers.ts';

beforeAll(async () => {
  await seededLedger();
});

describe('rebuild', () => {
  it('reproduces identical state from the blocks alone', async () => {
    const snapshot = async () => ({
      contracts: await listContracts(),
      invoices: await listInvoices(),
      payments: await listPayments(),
      inventory: await listInventory({}),
      records: await listRecords(),
    });

    const before = await snapshot();
    const { replayed } = await rebuildProjections();
    const after = await snapshot();

    expect(replayed).toBeGreaterThan(100);
    // If any number moved, the projections were not derived from the chain.
    expect(after).toEqual(before);
  });
});

describe('money reconciles', () => {
  it('balances every invoice against its payments', async () => {
    const invoices = await listInvoices();
    expect(invoices.length).toBeGreaterThan(0);

    for (const invoice of invoices) {
      const payments = await listPayments({ invoiceId: invoice.invoice_id });
      const settled = payments
        .filter((p) => p.status === 'settled')
        .reduce((sum, p) => sum + p.amount_minor, 0);
      const inFlight = payments
        .filter((p) => p.status === 'initiated')
        .reduce((sum, p) => sum + p.amount_minor, 0);

      expect(invoice.paid_minor).toBe(settled);
      expect(invoice.pending_minor).toBe(inFlight);
      expect(invoice.balance_minor).toBe(invoice.total_minor - settled);
      expect(invoice.subtotal_minor + invoice.tax_minor).toBe(invoice.total_minor);
    }
  });

  it('rolls invoices up into their contract', async () => {
    const contracts = await listContracts();

    for (const contract of contracts) {
      const invoices = await listInvoices({ contractId: contract.contract_id });
      const invoiced = invoices.reduce((sum, i) => sum + i.total_minor, 0);

      expect(contract.invoiced_minor).toBe(invoiced);
      expect(contract.remaining_minor).toBe(contract.value_minor - invoiced);
    }
  });

  it('marks a fully paid invoice settled and a partly paid one part_paid', async () => {
    const settled = await getInvoice('INV-MEG-0117');
    expect(settled?.status).toBe('settled');
    expect(settled?.balance_minor).toBe(0);

    const partial = await getInvoice('INV-MEG-0131');
    expect(partial?.status).toBe('part_paid');
    expect(partial?.balance_minor).toBeGreaterThan(0);
  });

  it('does not count a failed payment as money received', async () => {
    const payments = await listPayments({ invoiceId: 'INV-ASH-0204' });
    const failed = payments.find((p) => p.status === 'failed');
    const settled = payments.find((p) => p.status === 'settled');

    expect(failed).toBeDefined();
    expect(settled).toBeDefined();

    const invoice = await getInvoice('INV-ASH-0204');
    expect(invoice?.paid_minor).toBe(settled!.amount_minor);
    expect(invoice?.pending_minor).toBe(0);
  });
});

describe('inventory reconciles', () => {
  it('derives on-hand from the movements alone', async () => {
    const items = await listInventory({ factoryId: 'FAC-MEGHNA' });
    const moved = items.filter((i) => i.balance.movement_count > 0);
    expect(moved.length).toBeGreaterThan(0);

    for (const item of moved) {
      const b = item.balance;
      expect(b.on_hand).toBeCloseTo(b.received - b.issued - b.consumed - b.disposed + b.adjusted, 6);
    }
  });

  it('carries the compliance metadata an auditor needs on chemicals', async () => {
    const chemicals = await listInventory({ factoryId: 'FAC-MEGHNA', kind: 'chemical' });
    const restricted = chemicals.find((c) => c.mrsl_restricted);

    expect(restricted).toBeDefined();
    expect(restricted?.cas_number).toBeTruthy();
  });
});

describe('contract lifecycle', () => {
  it('activates only once both parties have signed', async () => {
    const active = await getContract('CON-2026-014');
    expect(active?.status).toBe('active');
    expect(active?.signatures.map((s) => s.role).sort()).toEqual(['brand', 'factory']);

    const halfSigned = await getContract('CON-2026-033');
    expect(halfSigned?.status).toBe('awaiting_signatures');
    expect(halfSigned?.signatures).toHaveLength(1);
    expect(halfSigned?.signatures[0]!.role).toBe('brand');
  });
});

describe('review outcomes', () => {
  it('reflects the auditor decisions committed to the chain', async () => {
    const records = await listRecords();

    const confirmed = records.find((r) => r.event_id === 'FAC-MEGHNA-PR-SPIKE');
    expect(confirmed?.ai_flag).toBe(true);
    expect(confirmed?.human_review_status).toBe('confirmed');
    expect(confirmed?.status).toBe('verified');
    // The flag is answered, not erased.
    expect(confirmed?.ai_flag_reason).toContain('units_produced');

    const disputed = records.find((r) => r.event_id === 'INV-CTG-0325-ISSUE');
    expect(disputed?.human_review_status).toBe('disputed');
    expect(disputed?.status).toBe('disputed');
  });

  it('leaves unreviewed flags in the queue', async () => {
    const queue = await listRecords({ flaggedOnly: true });
    expect(queue.length).toBeGreaterThan(0);
    expect(queue.every((r) => r.ai_flag && r.human_review_status === 'none')).toBe(true);
    expect(queue.map((r) => r.event_id)).toContain('INV-ASH-0221-ISSUE');
  });
});
