/**
 * Read routes for the five commercial modules.
 *
 * Every one of these is a projection of the chain — none of them can be written to
 * directly. Creating a contract, issuing an invoice or recording a payment all go
 * through `POST /chain/commit` as signed events, exactly like an audit record.
 */

import { Hono } from 'hono';
import type { InvoiceStatus } from '@breadcrumbs/shared';

import { LedgerError } from '../chain/ledger.ts';
import {
  getContract,
  getInventoryItem,
  getInventoryLedger,
  getInvoice,
  getPayment,
  listContracts,
  listInventory,
  listInvoices,
  listPayments,
  listRecords,
} from '../chain/queries.ts';
import type { AppEnv } from '../middleware/auth.ts';

/* ------------------------------------------------------------- inventory */

export const inventoryRoutes = new Hono<AppEnv>();

inventoryRoutes.get('/materials', async (c) =>
  c.json({
    items: await listInventory({ factoryId: c.req.query('factory') || undefined, kind: 'material' }),
  }),
);

inventoryRoutes.get('/chemicals', async (c) =>
  c.json({
    items: await listInventory({ factoryId: c.req.query('factory') || undefined, kind: 'chemical' }),
  }),
);

inventoryRoutes.get('/items', async (c) =>
  c.json({ items: await listInventory({ factoryId: c.req.query('factory') || undefined }) }),
);

inventoryRoutes.get('/:factoryId/:sku', async (c) => {
  const { factoryId, sku } = c.req.param();
  const item = await getInventoryItem(factoryId, sku);
  if (!item) throw new LedgerError(404, 'no_such_item', `No item ${sku} at ${factoryId}.`);
  return c.json({ item, ledger: await getInventoryLedger(factoryId, sku) });
});

/* ------------------------------------------------------------- contracts */

export const contractRoutes = new Hono<AppEnv>();

contractRoutes.get('/', async (c) => {
  const actor = c.get('actor');
  let factoryId = c.req.query('factory') || undefined;
  let brandId = c.req.query('brand') || undefined;
  if (actor?.role === 'factory' && actor.factoryId) factoryId = actor.factoryId;
  if (actor?.role === 'brand') brandId = actor.id;

  return c.json({
    contracts: await listContracts({ factoryId, brandId }),
  });
});

contractRoutes.get('/:contractId', async (c) => {
  const contractId = c.req.param('contractId');
  const contract = await getContract(contractId);
  if (!contract) throw new LedgerError(404, 'no_such_contract', 'No contract with that id.');

  const [invoices, events] = await Promise.all([
    listInvoices({ contractId }),
    listRecords({ family: 'contract' }),
  ]);

  return c.json({
    contract,
    invoices,
    events: events.filter(
      (e) => e.data_fields['contract_id'] === contractId || e.ref_id === contractId,
    ),
  });
});

/* -------------------------------------------------------------- invoices */

export const invoiceRoutes = new Hono<AppEnv>();

invoiceRoutes.get('/', async (c) => {
  const actor = c.get('actor');
  let factoryId = c.req.query('factory') || undefined;
  let brandId = c.req.query('brand') || undefined;
  if (actor?.role === 'factory' && actor.factoryId) factoryId = actor.factoryId;
  if (actor?.role === 'brand') brandId = actor.id;

  return c.json({
    invoices: await listInvoices({
      factoryId,
      brandId,
      contractId: c.req.query('contract') || undefined,
      status: (c.req.query('status') as InvoiceStatus | undefined) || undefined,
    }),
  });
});

invoiceRoutes.get('/:invoiceId', async (c) => {
  const invoiceId = c.req.param('invoiceId');
  const invoice = await getInvoice(invoiceId);
  if (!invoice) throw new LedgerError(404, 'no_such_invoice', 'No invoice with that id.');

  const [payments, contract, events] = await Promise.all([
    listPayments({ invoiceId }),
    getContract(invoice.contract_id),
    listRecords({ family: 'invoice' }),
  ]);

  return c.json({
    invoice,
    payments,
    contract,
    events: events.filter(
      (e) => e.data_fields['invoice_id'] === invoiceId || e.ref_id === invoiceId,
    ),
  });
});

/* -------------------------------------------------------------- payments */

export const paymentRoutes = new Hono<AppEnv>();

paymentRoutes.get('/', async (c) => {
  const actor = c.get('actor');
  let factoryId = c.req.query('factory') || undefined;
  let brandId = c.req.query('brand') || undefined;
  if (actor?.role === 'factory' && actor.factoryId) factoryId = actor.factoryId;
  if (actor?.role === 'brand') brandId = actor.id;

  return c.json({
    payments: await listPayments({
      invoiceId: c.req.query('invoice') || undefined,
      factoryId,
      brandId,
    }),
  });
});

paymentRoutes.get('/:paymentId', async (c) => {
  const payment = await getPayment(c.req.param('paymentId'));
  if (!payment) throw new LedgerError(404, 'no_such_payment', 'No payment with that id.');

  const [invoice, events] = await Promise.all([
    payment.invoice_id ? getInvoice(payment.invoice_id) : Promise.resolve(null),
    listRecords({ family: 'payment' }),
  ]);

  return c.json({
    payment,
    invoice,
    events: events.filter(
      (e) => e.data_fields['payment_id'] === payment.payment_id || e.ref_id === payment.payment_id,
    ),
  });
});

/* ---------------------------------------------------------- transactions */

export const transactionRoutes = new Hono<AppEnv>();

/**
 * The unified feed: every state-changing event across every module, in one stream.
 * This is the business-readable view of the same blocks the explorer shows as hashes.
 */
transactionRoutes.get('/', async (c) => {
  const actor = c.get('actor');
  let factoryId = c.req.query('factory') || undefined;
  if (actor?.role === 'factory' && actor.factoryId) {
    factoryId = actor.factoryId;
  }

  const families = (c.req.query('family') ?? '')
    .split(',')
    .map((f) => f.trim())
    .filter(Boolean);

  const all = await listRecords({
    factoryId,
    status: (c.req.query('status') as never) || undefined,
  });

  const filtered = families.length
    ? all.filter((r) => families.includes(r.event_family))
    : all;

  const search = (c.req.query('q') ?? '').toLowerCase().trim();
  const matched = search
    ? filtered.filter((r) =>
        [r.event_id, r.factory_name, r.submitter_name, r.event_type, JSON.stringify(r.data_fields)]
          .join(' ')
          .toLowerCase()
          .includes(search),
      )
    : filtered;

  const limit = Number(c.req.query('limit') ?? 200);
  return c.json({ transactions: matched.slice(0, limit), total: matched.length });
});
