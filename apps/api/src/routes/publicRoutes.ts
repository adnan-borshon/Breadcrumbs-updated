/**
 * Unauthenticated routes.
 *
 * A buyer arriving from a QR code has no account and should not need one. These endpoints
 * answer "is this factory's history real and reviewed?" in plain language, with the
 * cryptographic detail available but not forced on anyone.
 */

import { Hono } from 'hono';
import { EVENT_LABEL } from '@breadcrumbs/shared';
import type { LedgerRecord } from '@breadcrumbs/shared';

import { LedgerError } from '../chain/ledger.ts';
import {
  getFactory,
  getRecord,
  listFactories,
  listFactoryTrust,
  listRecords,
} from '../chain/queries.ts';
import type { AppEnv } from '../middleware/auth.ts';

export const publicRoutes = new Hono<AppEnv>();

publicRoutes.get('/factories', async (c) => {
  const [factories, trust] = await Promise.all([listFactories(), listFactoryTrust()]);
  const trustById = new Map(trust.map((t) => [t.factory_id, t]));
  return c.json({
    factories: factories.map((f) => ({ ...f, trust: trustById.get(f.id) ?? null })),
  });
});

/** Turns a ledger record into a sentence a buyer can actually read. */
function plainLanguage(record: LedgerRecord): string {
  const fields = record.data_fields;
  const n = (key: string) => {
    const v = fields[key];
    return typeof v === 'number' ? v.toLocaleString('en-US') : null;
  };
  const s = (key: string) => {
    const v = fields[key];
    return typeof v === 'string' ? v : null;
  };

  switch (record.event_type) {
    case 'inspection':
      return `${s('inspection_type') ?? 'Site inspection'} carried out — ${
        fields['passed'] ? 'passed' : 'issues raised'
      }, ${n('non_conformities') ?? '0'} non-conformities recorded.`;
    case 'production_report':
      return `${n('units_produced') ?? 'Some'} units produced against order ${s('order_ref') ?? ''}.`;
    case 'certification':
      return `${s('standard') ?? 'Certification'} certificate ${s('certificate_no') ?? ''} issued by ${
        s('issued_by') ?? 'an accredited body'
      }, valid to ${s('valid_until') ?? 'an unstated date'}.`;
    case 'shipment':
      return `Shipment ${s('shipment_ref') ?? ''} dispatched to ${s('destination') ?? 'its destination'} — ${
        n('cartons') ?? ''
      } cartons via ${s('carrier') ?? 'carrier'}.`;
    case 'material_receipt':
      return `Received ${n('quantity') ?? ''} of ${s('sku') ?? 'material'} from ${s('supplier') ?? 'a supplier'}.`;
    case 'chemical_receipt':
      return `Received ${n('quantity') ?? ''} of chemical ${s('sku') ?? ''} from ${s('supplier') ?? 'a supplier'}.`;
    case 'chemical_consumption':
      return `Used ${n('quantity') ?? ''} of ${s('sku') ?? 'a chemical'} in ${s('process') ?? 'production'}.`;
    case 'chemical_disposal':
      return `Disposed of ${n('quantity') ?? ''} of ${s('sku') ?? 'a chemical'} by ${
        s('disposal_method') ?? 'an approved method'
      }.`;
    case 'material_issue':
      return `Issued ${n('quantity') ?? ''} of ${s('sku') ?? 'material'} to order ${s('order_ref') ?? ''}.`;
    case 'stock_adjustment':
      return `Stock correction on ${s('sku') ?? 'an item'} — ${s('reason') ?? 'no reason given'}.`;
    case 'contract_created':
      return `Purchase agreement opened for ${s('product') ?? 'goods'}.`;
    case 'contract_signed':
      return `Purchase agreement signed by ${record.submitter_name}.`;
    case 'review_confirmed':
      return `An independent auditor reviewed a flagged record and confirmed it.`;
    case 'review_disputed':
      return `An independent auditor reviewed a flagged record and disputed it.`;
    default:
      return EVENT_LABEL[record.event_type];
  }
}

publicRoutes.get('/factories/:factoryId', async (c) => {
  const factoryId = c.req.param('factoryId');
  const factory = await getFactory(factoryId);
  if (!factory) throw new LedgerError(404, 'no_such_factory', 'No factory with that id.');

  const [records, trust] = await Promise.all([
    listRecords({ factoryId }),
    listFactoryTrust(),
  ]);

  // Buyers see what happened and whether it was reviewed — not the internal money flow.
  const visible = records.filter((r) =>
    ['audit', 'inventory', 'governance'].includes(r.event_family),
  );

  return c.json({
    factory,
    trust: trust.find((t) => t.factory_id === factoryId) ?? null,
    timeline: visible.map((r) => ({
      event_id: r.event_id,
      timestamp: r.timestamp,
      headline: EVENT_LABEL[r.event_type],
      summary: plainLanguage(r),
      status: r.status,
      submitter_name: r.submitter_name,
      submitter_role: r.submitter_role,
      reviewer_name: r.reviewer_name,
      ai_flag: r.ai_flag,
      ai_flag_reason: r.ai_flag_reason,
      block_index: r.block_index,
      block_hash: r.block_hash,
      previous_block_hash: r.previous_block_hash,
      signature: r.signature,
    })),
  });
});

/** The target of a "copy verification link" — opens for anyone, no account needed. */
publicRoutes.get('/verify/:eventId', async (c) => {
  const record = await getRecord(c.req.param('eventId'));
  if (!record) throw new LedgerError(404, 'no_such_record', 'No record with that id.');
  return c.json({ record, summary: plainLanguage(record) });
});
