/**
 * Demo ledger.
 *
 * Everything here goes through the real `commit()` pipeline — real ECDSA signatures, real
 * SHA-256 hashes, real permission checks, and the real AI rules. Nothing is faked and no
 * flag is hardcoded: the anomalies below are flagged because the numbers genuinely trip
 * the thresholds when measured against each factory's own history.
 *
 * Seed identities get an extractable keypair so the seeder can sign on their behalf. Only
 * the public half is persisted; the private keys are discarded when this script finishes,
 * so nothing can forge those identities afterwards.
 */

import {
  canonicalJson,
  DEFAULT_CHAIN_ID,
  exportPublicJwk,
  generateKeyPair,
  GENESIS_PREV_HASH,
  publicKeyFingerprint,
  signRecord,
} from '@breadcrumbs/shared';
import type { EventType, Role, SignedRecord } from '@breadcrumbs/shared';

import { applySchema, getClient, getDb } from './client.ts';
import { deviceKeys, factories, identities, inventoryItems, ALL_TABLES } from './schema.ts';
import { commit, ensureGenesis, getHead, getNextNonce, type ActorContext } from '../chain/ledger.ts';
import { notarizeChainHead } from '../chain/notarization.ts';

/* ------------------------------------------------------------- reference */

const START = new Date('2026-06-06T06:00:00.000Z').getTime();
const at = (day: number, hour = 9) =>
  new Date(START + day * 86_400_000 + hour * 3_600_000).toISOString();
const dateOnly = (day: number) => at(day).slice(0, 10);

const FACTORIES = [
  {
    id: 'FAC-MEGHNA',
    name: 'Meghna Knit Composite',
    country: 'Bangladesh',
    city: 'Narayanganj',
    certifications: ['WRAP', 'OEKO-TEX Standard 100', 'BSCI'],
    employee_count: 2400,
  },
  {
    id: 'FAC-ASHULIA',
    name: 'Ashulia Apparels Ltd',
    country: 'Bangladesh',
    city: 'Savar',
    certifications: ['WRAP', 'GOTS'],
    employee_count: 1650,
  },
  {
    id: 'FAC-CTG',
    name: 'Chattogram Textile Mills',
    country: 'Bangladesh',
    city: 'Chattogram',
    certifications: ['SEDEX SMETA', 'OEKO-TEX Standard 100'],
    employee_count: 3100,
  },
  {
    id: 'FAC-GAZIPUR',
    name: 'Gazipur Fashion Works',
    country: 'Bangladesh',
    city: 'Gazipur',
    certifications: ['BSCI'],
    employee_count: 890,
  },
];

const IDENTITIES: {
  id: string;
  name: string;
  role: Role;
  org: string;
  factory_id: string | null;
}[] = [
  { id: 'usr-meghna', name: 'Rashida Akter', role: 'factory', org: 'Meghna Knit Composite', factory_id: 'FAC-MEGHNA' },
  { id: 'usr-ashulia', name: 'Imran Hossain', role: 'factory', org: 'Ashulia Apparels Ltd', factory_id: 'FAC-ASHULIA' },
  { id: 'usr-ctg', name: 'Nusrat Jahan', role: 'factory', org: 'Chattogram Textile Mills', factory_id: 'FAC-CTG' },
  { id: 'usr-gazipur', name: 'Tanvir Rahman', role: 'factory', org: 'Gazipur Fashion Works', factory_id: 'FAC-GAZIPUR' },
  { id: 'aud-farhana', name: 'Farhana Chowdhury', role: 'auditor', org: 'Veritas Compliance Partners', factory_id: null },
  { id: 'aud-osei', name: 'Michael Osei', role: 'auditor', org: 'Veritas Compliance Partners', factory_id: null },
  { id: 'brand-nordwear', name: 'Lena Bergström', role: 'brand', org: 'Nordwear Group', factory_id: null },
  { id: 'brand-atlas', name: 'Diego Marques', role: 'brand', org: 'Atlas Apparel Co.', factory_id: null },
];

const MATERIALS = [
  { sku: 'FAB-CTN-180', name: 'Cotton single jersey 180gsm', unit: 'kg', reorder: 3000, supplier: 'Nitol Spinning Mills' },
  { sku: 'FAB-PLY-140', name: 'Poly-cotton blend 140gsm', unit: 'kg', reorder: 2000, supplier: 'Nitol Spinning Mills' },
  { sku: 'TRM-ZIP-18', name: 'Nylon zipper 18cm', unit: 'pcs', reorder: 8000, supplier: 'YKK Bangladesh' },
  { sku: 'TRM-BTN-12', name: 'Corozo button 12mm', unit: 'pcs', reorder: 15000, supplier: 'Dhaka Trims Ltd' },
  { sku: 'THR-40-2', name: 'Polyester core thread 40/2', unit: 'cones', reorder: 900, supplier: 'Coats Bangladesh' },
];

/**
 * Chemicals carry the compliance fields a garment auditor actually looks for: CAS number,
 * GHS hazard class, and whether the substance sits on the ZDHC Manufacturing Restricted
 * Substances List. CHM-APEO-NP is genuinely MRSL-restricted, which gives the UI a real
 * compliance signal to surface rather than a decorative badge.
 */
const CHEMICALS = [
  { sku: 'CHM-RDYE-R58', name: 'Reactive dye Red 58', unit: 'kg', reorder: 120, cas: '12226-49-6', hazard: 'Skin Sens. 1', mrsl: false, supplier: 'DyStar Asia' },
  { sku: 'CHM-SOFT-01', name: 'Silicone softener SF-01', unit: 'L', reorder: 200, cas: '63148-62-9', hazard: null, mrsl: false, supplier: 'Archroma BD' },
  { sku: 'CHM-BLCH-H2O2', name: 'Hydrogen peroxide 35%', unit: 'L', reorder: 400, cas: '7722-84-1', hazard: 'Ox. Liq. 2 · Skin Corr. 1A', mrsl: false, supplier: 'Bengal Chemicals' },
  { sku: 'CHM-APEO-NP', name: 'Nonylphenol ethoxylate (legacy stock)', unit: 'L', reorder: 0, cas: '9016-45-9', hazard: 'Aquatic Chronic 1', mrsl: true, supplier: 'Legacy stock — pre-2024' },
];

/* --------------------------------------------------------- seed events */

interface SeedEvent {
  at: string;
  by: string;
  event_id: string;
  event_type: EventType;
  factory_id: string;
  data_fields: Record<string, unknown>;
  ref_id?: string | null;
}

const events: SeedEvent[] = [];
const push = (e: SeedEvent) => events.push(e);

const usd = (major: number) => Math.round(major * 100);

/* ---- routine factory operations -------------------------------------- */

interface FactoryPlan {
  factory: string;
  user: string;
  orderRef: string;
  baseUnits: number;
  baseHours: number;
  lines: number;
  materialSku: string;
  chemicalSku: string;
  chemPerBatch: number;
  unitsPerBatch: number;
}

function routineOperations(plan: FactoryPlan, weeks: number, startDay: number) {
  for (let w = 0; w < weeks; w += 1) {
    const day = startDay + w * 7;
    const jitter = ((w * 37) % 9) - 4; // deterministic, ±4%

    // Materials arrive, then get issued to the line.
    push({
      at: at(day, 8),
      by: plan.user,
      event_id: `${plan.factory}-MR-${w + 1}`,
      event_type: 'material_receipt',
      factory_id: plan.factory,
      data_fields: {
        sku: plan.materialSku,
        quantity: 4200 + w * 60,
        unit_cost_minor: usd(3.4),
        supplier: 'Nitol Spinning Mills',
        grn_ref: `GRN-${plan.factory}-${1000 + w}`,
        lot_no: `LOT-${2600 + w}`,
      },
      ref_id: null,
    });

    push({
      at: at(day + 1, 10),
      by: plan.user,
      event_id: `${plan.factory}-MI-${w + 1}`,
      event_type: 'material_issue',
      factory_id: plan.factory,
      data_fields: {
        sku: plan.materialSku,
        quantity: 3800 + w * 50,
        order_ref: plan.orderRef,
        line: `Line ${(w % plan.lines) + 1}`,
      },
      ref_id: null,
    });

    // Chemical use, recorded against the output it was used on. The ratio between the
    // two is what the mass-balance rule watches.
    push({
      at: at(day + 2, 11),
      by: plan.user,
      event_id: `${plan.factory}-CC-${w + 1}`,
      event_type: 'chemical_consumption',
      factory_id: plan.factory,
      data_fields: {
        sku: plan.chemicalSku,
        quantity: Number((plan.chemPerBatch * (1 + jitter / 200)).toFixed(2)),
        units_processed: plan.unitsPerBatch + w * 20,
        process: 'Reactive dyeing — exhaust',
      },
      ref_id: null,
    });

    push({
      at: at(day + 3, 17),
      by: plan.user,
      event_id: `${plan.factory}-PR-${w + 1}`,
      event_type: 'production_report',
      factory_id: plan.factory,
      data_fields: {
        order_ref: plan.orderRef,
        units_produced: Math.round(plan.baseUnits * (1 + jitter / 100)),
        working_hours: Number((plan.baseHours * (1 + jitter / 300)).toFixed(1)),
        line_count: plan.lines,
        defect_count: 40 + ((w * 13) % 25),
      },
      ref_id: null,
    });
  }
}

/* ---- chemical restocking so consumption never runs the balance negative */

function chemicalRestock(factory: string, user: string, sku: string, day: number, qty: number, n: number) {
  for (let i = 0; i < n; i += 1) {
    push({
      at: at(day + i * 21, 7),
      by: user,
      event_id: `${factory}-CR-${sku}-${i + 1}`,
      event_type: 'chemical_receipt',
      factory_id: factory,
      data_fields: {
        sku,
        quantity: qty,
        supplier: 'DyStar Asia',
        lot_no: `CL-${factory.slice(4, 8)}-${400 + i}`,
        msds_ref: `MSDS-${sku}-v3`,
        expiry_date: dateOnly(day + 400),
      },
      ref_id: null,
    });
  }
}

/* ================================================================= plan */

function buildTimeline() {
  /* --- contracts: brand creates, both parties sign --------------------- */

  const contracts = [
    { id: 'CON-2026-014', brand: 'brand-nordwear', factory: 'FAC-MEGHNA', user: 'usr-meghna', value: usd(480_000), qty: 120_000, product: "Men's cotton crew tee, 180gsm", title: 'Nordwear AW26 — cotton tee programme', day: 0 },
    { id: 'CON-2026-021', brand: 'brand-atlas', factory: 'FAC-ASHULIA', user: 'usr-ashulia', value: usd(265_000), qty: 62_000, product: 'Organic cotton hoodie', title: 'Atlas core hoodie replenishment', day: 3 },
    { id: 'CON-2026-030', brand: 'brand-nordwear', factory: 'FAC-CTG', user: 'usr-ctg', value: usd(390_000), qty: 95_000, product: 'Poly-cotton polo shirt', title: 'Nordwear SS27 polo programme', day: 6 },
  ];

  for (const contract of contracts) {
    push({
      at: at(contract.day, 9),
      by: contract.brand,
      event_id: `${contract.id}-CREATE`,
      event_type: 'contract_created',
      factory_id: contract.factory,
      data_fields: {
        contract_id: contract.id,
        title: contract.title,
        brand_id: contract.brand,
        factory_id: contract.factory,
        value_minor: contract.value,
        currency: 'USD',
        incoterm: 'FOB Chattogram',
        order_quantity: contract.qty,
        product: contract.product,
        start_date: dateOnly(contract.day),
        delivery_date: dateOnly(contract.day + 110),
      },
      ref_id: contract.id,
    });

    push({
      at: at(contract.day, 11),
      by: contract.brand,
      event_id: `${contract.id}-SIGN-BRAND`,
      event_type: 'contract_signed',
      factory_id: contract.factory,
      data_fields: { contract_id: contract.id },
      ref_id: contract.id,
    });

    push({
      at: at(contract.day + 1, 10),
      by: contract.user,
      event_id: `${contract.id}-SIGN-FACTORY`,
      event_type: 'contract_signed',
      factory_id: contract.factory,
      data_fields: { contract_id: contract.id },
      ref_id: contract.id,
    });
  }

  /* A fourth contract left half-signed, so the UI has a real
     "awaiting counter-signature" state to show rather than a mocked one. */
  push({
    at: at(70, 9),
    by: 'brand-atlas',
    event_id: 'CON-2026-033-CREATE',
    event_type: 'contract_created',
    factory_id: 'FAC-GAZIPUR',
    data_fields: {
      contract_id: 'CON-2026-033',
      title: 'Atlas capsule — knitwear trial',
      brand_id: 'brand-atlas',
      factory_id: 'FAC-GAZIPUR',
      value_minor: usd(150_000),
      currency: 'USD',
      incoterm: 'FOB Chattogram',
      order_quantity: 28_000,
      product: 'Merino-blend knit crew',
      start_date: dateOnly(70),
      delivery_date: dateOnly(160),
    },
    ref_id: 'CON-2026-033',
  });
  push({
    at: at(70, 11),
    by: 'brand-atlas',
    event_id: 'CON-2026-033-SIGN-BRAND',
    event_type: 'contract_signed',
    factory_id: 'FAC-GAZIPUR',
    data_fields: { contract_id: 'CON-2026-033' },
    ref_id: 'CON-2026-033',
  });

  /* --- chemical stock in, before anything is consumed ------------------ */

  chemicalRestock('FAC-MEGHNA', 'usr-meghna', 'CHM-RDYE-R58', 2, 900, 4);
  chemicalRestock('FAC-ASHULIA', 'usr-ashulia', 'CHM-RDYE-R58', 4, 700, 4);
  chemicalRestock('FAC-CTG', 'usr-ctg', 'CHM-RDYE-R58', 7, 1100, 4);
  chemicalRestock('FAC-GAZIPUR', 'usr-gazipur', 'CHM-SOFT-01', 72, 300, 1);

  /* --- routine operations ---------------------------------------------- */

  routineOperations(
    { factory: 'FAC-MEGHNA', user: 'usr-meghna', orderRef: 'ORD-NW-4471', baseUnits: 10_000, baseHours: 1840, lines: 6, materialSku: 'FAB-CTN-180', chemicalSku: 'CHM-RDYE-R58', chemPerBatch: 42, unitsPerBatch: 9800 },
    9,
    5,
  );
  routineOperations(
    { factory: 'FAC-ASHULIA', user: 'usr-ashulia', orderRef: 'ORD-AT-2210', baseUnits: 6200, baseHours: 1260, lines: 4, materialSku: 'FAB-CTN-180', chemicalSku: 'CHM-RDYE-R58', chemPerBatch: 27, unitsPerBatch: 6000 },
    9,
    7,
  );
  routineOperations(
    { factory: 'FAC-CTG', user: 'usr-ctg', orderRef: 'ORD-NW-5108', baseUnits: 12_500, baseHours: 2310, lines: 8, materialSku: 'FAB-PLY-140', chemicalSku: 'CHM-RDYE-R58', chemPerBatch: 55, unitsPerBatch: 12_000 },
    9,
    9,
  );

  /* --- inspections and certifications ---------------------------------- */

  const inspections = [
    { factory: 'FAC-MEGHNA', user: 'usr-meghna', day: 21, type: 'Social compliance audit', nc: 2, passed: true, workers: 2380, hours: 1848 },
    { factory: 'FAC-ASHULIA', user: 'usr-ashulia', day: 26, type: 'Fire and building safety', nc: 0, passed: true, workers: 1640, hours: 1270 },
    { factory: 'FAC-CTG', user: 'usr-ctg', day: 33, type: 'Chemical management audit', nc: 4, passed: false, workers: 3080, hours: 2320 },
    { factory: 'FAC-MEGHNA', user: 'usr-meghna', day: 62, type: 'Follow-up corrective action', nc: 0, passed: true, workers: 2395, hours: 1850 },
  ];

  for (const [i, ins] of inspections.entries()) {
    push({
      at: at(ins.day, 14),
      by: ins.user,
      event_id: `INS-${ins.factory}-${i + 1}`,
      event_type: 'inspection',
      factory_id: ins.factory,
      data_fields: {
        inspection_type: ins.type,
        workers_present: ins.workers,
        working_hours: ins.hours,
        non_conformities: ins.nc,
        passed: ins.passed,
        findings: ins.passed
          ? 'All checked controls operating as documented.'
          : 'Chemical inventory records incomplete for two storage areas; corrective action plan requested within 30 days.',
      },
      ref_id: null,
    });
  }

  push({
    at: at(30, 12),
    by: 'usr-meghna',
    event_id: 'CERT-MEGHNA-OEKO-2026',
    event_type: 'certification',
    factory_id: 'FAC-MEGHNA',
    data_fields: {
      standard: 'OEKO-TEX Standard 100',
      certificate_no: 'OT-24-BD-118422',
      issued_by: 'Hohenstein Institute',
      valid_until: dateOnly(400),
      scope: 'Knitted cotton fabrics and finished garments, product class II.',
    },
    ref_id: null,
  });

  push({
    at: at(44, 12),
    by: 'usr-ashulia',
    event_id: 'CERT-ASHULIA-GOTS-2026',
    event_type: 'certification',
    factory_id: 'FAC-ASHULIA',
    data_fields: {
      standard: 'GOTS 7.0',
      certificate_no: 'GOTS-BD-2026-0771',
      issued_by: 'Control Union Certifications',
      valid_until: dateOnly(370),
      scope: 'Organic cotton knitwear, cutting through to packing.',
    },
    ref_id: null,
  });

  /* --- shipments -------------------------------------------------------- */

  push({
    at: at(55, 15),
    by: 'usr-meghna',
    event_id: 'SHP-MEGHNA-1',
    event_type: 'shipment',
    factory_id: 'FAC-MEGHNA',
    data_fields: {
      shipment_ref: 'SHP-NW-88301',
      destination: 'Gothenburg, Sweden',
      carrier: 'Maersk',
      cartons: 940,
      gross_weight_kg: 11_280,
      contract_id: 'CON-2026-014',
    },
    ref_id: 'CON-2026-014',
  });

  push({
    at: at(74, 15),
    by: 'usr-ctg',
    event_id: 'SHP-CTG-1',
    event_type: 'shipment',
    factory_id: 'FAC-CTG',
    data_fields: {
      shipment_ref: 'SHP-NW-88544',
      destination: 'Rotterdam, Netherlands',
      carrier: 'CMA CGM',
      cartons: 1310,
      gross_weight_kg: 15_720,
      contract_id: 'CON-2026-030',
    },
    ref_id: 'CON-2026-030',
  });

  /* ================================================================
     Anomalies. Every one of these is caught by the real rules running
     over the real history above — none are pre-marked as flagged.
     ================================================================ */

  /* (1) Production spike — 3.4× Meghna's own weekly average. */
  push({
    at: at(69, 17),
    by: 'usr-meghna',
    event_id: 'FAC-MEGHNA-PR-SPIKE',
    event_type: 'production_report',
    factory_id: 'FAC-MEGHNA',
    data_fields: {
      order_ref: 'ORD-NW-4471',
      units_produced: 34_000,
      working_hours: 1880,
      line_count: 6,
      defect_count: 61,
    },
    ref_id: null,
  });

  /* (2) Chemical mass balance — dye per unit ~3.8× Ashulia's norm, which is what
         undeclared production or undeclared chemical use looks like in the data. */
  push({
    at: at(71, 11),
    by: 'usr-ashulia',
    event_id: 'FAC-ASHULIA-CC-OFFBALANCE',
    event_type: 'chemical_consumption',
    factory_id: 'FAC-ASHULIA',
    data_fields: {
      sku: 'CHM-RDYE-R58',
      quantity: 103,
      units_processed: 6100,
      process: 'Reactive dyeing — exhaust',
    },
    ref_id: null,
  });

  /* --- invoices and payments ------------------------------------------- */

  const invoice = (
    day: number,
    by: string,
    factory: string,
    invoiceId: string,
    contractId: string,
    lines: { description: string; quantity: number; unit: number }[],
    taxRate = 0,
  ): { id: string; total: number } => {
    const lineItems = lines.map((l) => ({
      description: l.description,
      quantity: l.quantity,
      unit_price_minor: usd(l.unit),
      amount_minor: Math.round(usd(l.unit) * l.quantity),
    }));
    const subtotal = lineItems.reduce((sum, l) => sum + l.amount_minor, 0);
    const tax = Math.round(subtotal * taxRate);

    push({
      at: at(day, 13),
      by,
      event_id: `${invoiceId}-ISSUE`,
      event_type: 'invoice_issued',
      factory_id: factory,
      data_fields: {
        invoice_id: invoiceId,
        contract_id: contractId,
        currency: 'USD',
        line_items: lineItems,
        subtotal_minor: subtotal,
        tax_minor: tax,
        total_minor: subtotal + tax,
        due_date: dateOnly(day + 45),
      },
      ref_id: invoiceId,
    });

    return { id: invoiceId, total: subtotal + tax };
  };

  // Meghna — a clean, fully settled cycle.
  const invM1 = invoice(40, 'usr-meghna', 'FAC-MEGHNA', 'INV-MEG-0117', 'CON-2026-014', [
    { description: "Men's cotton crew tee — 30,000 pcs", quantity: 30_000, unit: 3.95 },
  ]);
  push({ at: at(42, 10), by: 'brand-nordwear', event_id: 'INV-MEG-0117-APPROVE', event_type: 'invoice_approved', factory_id: 'FAC-MEGHNA', data_fields: { invoice_id: invM1.id }, ref_id: invM1.id });
  push({ at: at(45, 10), by: 'brand-nordwear', event_id: 'PAY-MEG-0117-INIT', event_type: 'payment_initiated', factory_id: 'FAC-MEGHNA', data_fields: { payment_id: 'PAY-MEG-0117', invoice_id: invM1.id, amount_minor: invM1.total, currency: 'USD', method: 'letter_of_credit', reference: 'LC-SEB-4471-A' }, ref_id: invM1.id });
  push({ at: at(49, 10), by: 'brand-nordwear', event_id: 'PAY-MEG-0117-SETTLE', event_type: 'payment_settled', factory_id: 'FAC-MEGHNA', data_fields: { payment_id: 'PAY-MEG-0117', invoice_id: invM1.id, amount_minor: invM1.total }, ref_id: invM1.id });

  // Meghna — a part-paid invoice, so a balance is visible on screen.
  const invM2 = invoice(66, 'usr-meghna', 'FAC-MEGHNA', 'INV-MEG-0131', 'CON-2026-014', [
    { description: "Men's cotton crew tee — 24,000 pcs", quantity: 24_000, unit: 3.95 },
    { description: 'Rush-handling surcharge', quantity: 1, unit: 1_200 },
  ]);
  push({ at: at(68, 10), by: 'brand-nordwear', event_id: 'INV-MEG-0131-APPROVE', event_type: 'invoice_approved', factory_id: 'FAC-MEGHNA', data_fields: { invoice_id: invM2.id }, ref_id: invM2.id });
  push({ at: at(72, 10), by: 'brand-nordwear', event_id: 'PAY-MEG-0131-INIT', event_type: 'payment_initiated', factory_id: 'FAC-MEGHNA', data_fields: { payment_id: 'PAY-MEG-0131', invoice_id: invM2.id, amount_minor: usd(50_000), currency: 'USD', method: 'telegraphic_transfer', reference: 'TT-SEB-99021' }, ref_id: invM2.id });
  push({ at: at(75, 10), by: 'brand-nordwear', event_id: 'PAY-MEG-0131-SETTLE', event_type: 'payment_settled', factory_id: 'FAC-MEGHNA', data_fields: { payment_id: 'PAY-MEG-0131', invoice_id: invM2.id, amount_minor: usd(50_000) }, ref_id: invM2.id });

  // Ashulia — a failed payment, then a retry.
  const invA1 = invoice(50, 'usr-ashulia', 'FAC-ASHULIA', 'INV-ASH-0204', 'CON-2026-021', [
    { description: 'Organic cotton hoodie — 12,000 pcs', quantity: 12_000, unit: 7.0 },
  ]);
  push({ at: at(53, 10), by: 'brand-atlas', event_id: 'INV-ASH-0204-APPROVE', event_type: 'invoice_approved', factory_id: 'FAC-ASHULIA', data_fields: { invoice_id: invA1.id }, ref_id: invA1.id });
  push({ at: at(56, 10), by: 'brand-atlas', event_id: 'PAY-ASH-0204-INIT', event_type: 'payment_initiated', factory_id: 'FAC-ASHULIA', data_fields: { payment_id: 'PAY-ASH-0204-A', invoice_id: invA1.id, amount_minor: invA1.total, currency: 'USD', method: 'bank_transfer', reference: 'BT-HSBC-33108' }, ref_id: invA1.id });
  push({ at: at(57, 12), by: 'brand-atlas', event_id: 'PAY-ASH-0204-FAIL', event_type: 'payment_failed', factory_id: 'FAC-ASHULIA', data_fields: { payment_id: 'PAY-ASH-0204-A', invoice_id: invA1.id, reason: 'Correspondent bank rejected — beneficiary name mismatch.' }, ref_id: invA1.id });
  push({ at: at(59, 10), by: 'brand-atlas', event_id: 'PAY-ASH-0204-INIT-B', event_type: 'payment_initiated', factory_id: 'FAC-ASHULIA', data_fields: { payment_id: 'PAY-ASH-0204-B', invoice_id: invA1.id, amount_minor: invA1.total, currency: 'USD', method: 'bank_transfer', reference: 'BT-HSBC-33204' }, ref_id: invA1.id });
  push({ at: at(61, 10), by: 'brand-atlas', event_id: 'PAY-ASH-0204-SETTLE', event_type: 'payment_settled', factory_id: 'FAC-ASHULIA', data_fields: { payment_id: 'PAY-ASH-0204-B', invoice_id: invA1.id, amount_minor: invA1.total }, ref_id: invA1.id });

  /* (3) Duplicate invoice — same amount, two days apart. */
  const invA2 = invoice(76, 'usr-ashulia', 'FAC-ASHULIA', 'INV-ASH-0219', 'CON-2026-021', [
    { description: 'Organic cotton hoodie — 8,000 pcs', quantity: 8_000, unit: 7.0 },
  ]);
  invoice(78, 'usr-ashulia', 'FAC-ASHULIA', 'INV-ASH-0221', 'CON-2026-021', [
    { description: 'Organic cotton hoodie — 8,000 pcs', quantity: 8_000, unit: 7.0 },
  ]);
  push({ at: at(80, 10), by: 'brand-atlas', event_id: 'INV-ASH-0221-DISPUTE', event_type: 'invoice_disputed', factory_id: 'FAC-ASHULIA', data_fields: { invoice_id: 'INV-ASH-0221', reason: 'Appears to duplicate INV-ASH-0219 — same quantity and value, no corresponding second dispatch.' }, ref_id: 'INV-ASH-0221' });

  /* (4) Over-billing — cumulative invoicing runs past the contract ceiling. */
  invoice(52, 'usr-ctg', 'FAC-CTG', 'INV-CTG-0301', 'CON-2026-030', [
    { description: 'Poly-cotton polo — 32,000 pcs', quantity: 32_000, unit: 4.2 },
  ]);
  invoice(64, 'usr-ctg', 'FAC-CTG', 'INV-CTG-0312', 'CON-2026-030', [
    { description: 'Poly-cotton polo — 30,000 pcs', quantity: 30_000, unit: 4.4 },
  ]);
  invoice(79, 'usr-ctg', 'FAC-CTG', 'INV-CTG-0325', 'CON-2026-030', [
    { description: 'Poly-cotton polo — 33,000 pcs', quantity: 33_000, unit: 4.4 },
    { description: 'Additional dyeing surcharge', quantity: 1, unit: 46_000 },
  ]);

  /* --- auditor decisions ------------------------------------------------ */

  /* Confirmed: the production spike turned out to be a genuine consolidated run.
     The flag stays on the chain forever — it is not erased, it is answered. */
  push({
    at: at(82, 11),
    by: 'aud-farhana',
    event_id: 'REV-MEGHNA-SPIKE',
    event_type: 'review_confirmed',
    factory_id: 'FAC-MEGHNA',
    data_fields: {
      target_event_id: 'FAC-MEGHNA-PR-SPIKE',
      note: 'Verified against dispatch notes and the SHP-NW-88301 packing list. Three weekly runs were consolidated into one report after a line changeover. Output is genuine.',
    },
    ref_id: 'FAC-MEGHNA-PR-SPIKE',
  });

  /* Disputed: the over-billing invoice does not reconcile. */
  push({
    at: at(83, 15),
    by: 'aud-osei',
    event_id: 'REV-CTG-OVERBILL',
    event_type: 'review_disputed',
    factory_id: 'FAC-CTG',
    data_fields: {
      target_event_id: 'INV-CTG-0325-ISSUE',
      note: 'Cumulative invoicing against CON-2026-030 exceeds the agreed contract value and the surcharge line has no amendment behind it. Referred back to the brand.',
    },
    ref_id: 'INV-CTG-0325',
  });

  /* The duplicate invoice and the chemical mass-balance anomaly are deliberately
     left unreviewed, so the auditor's queue has real work waiting in it. */
}

/* ============================================================== seeding */

async function clearAll(): Promise<void> {
  const raw = getClient();
  for (const table of ALL_TABLES) {
    await raw.execute(`DELETE FROM ${table}`);
  }
}

async function insertReferenceData(): Promise<void> {
  const db = getDb();
  const now = new Date(START).toISOString();

  await db.insert(factories).values(
    FACTORIES.map((f) => ({
      id: f.id,
      name: f.name,
      country: f.country,
      city: f.city,
      certificationsJson: JSON.stringify(f.certifications),
      employeeCount: f.employee_count,
    })),
  );

  await db.insert(identities).values(
    IDENTITIES.map((i) => ({
      id: i.id,
      name: i.name,
      role: i.role,
      org: i.org,
      factoryId: i.factory_id,
      createdAt: now,
    })),
  );

  const items = FACTORIES.flatMap((factory) => [
    ...MATERIALS.map((m) => ({
      id: `${factory.id}:${m.sku}`,
      sku: m.sku,
      factoryId: factory.id,
      name: m.name,
      kind: 'material',
      unit: m.unit,
      reorderLevel: m.reorder,
      casNumber: null,
      hazardClass: null,
      mrslRestricted: false,
      supplier: m.supplier,
    })),
    ...CHEMICALS.map((chemical) => ({
      id: `${factory.id}:${chemical.sku}`,
      sku: chemical.sku,
      factoryId: factory.id,
      name: chemical.name,
      kind: 'chemical',
      unit: chemical.unit,
      reorderLevel: chemical.reorder,
      casNumber: chemical.cas,
      hazardClass: chemical.hazard,
      mrslRestricted: chemical.mrsl,
      supplier: chemical.supplier,
    })),
  ]);

  await db.insert(inventoryItems).values(items);
}

/**
 * Generates a keypair per identity, registers the public half, and hands back the
 * private keys for this run only. They are never written anywhere.
 */
async function provisionKeys(): Promise<Map<string, { key: CryptoKey; fingerprint: string }>> {
  const db = getDb();
  const keyring = new Map<string, { key: CryptoKey; fingerprint: string }>();
  const now = new Date(START).toISOString();

  for (const identity of IDENTITIES) {
    const pair = await generateKeyPair(true);
    const jwk = await exportPublicJwk(pair.publicKey);
    const fingerprint = await publicKeyFingerprint(jwk);

    await db.insert(deviceKeys).values({
      id: crypto.randomUUID(),
      identityId: identity.id,
      publicKeyJson: canonicalJson(jwk),
      fingerprint,
      label: 'Seed key (historical records)',
      createdAt: now,
    });

    keyring.set(identity.id, { key: pair.privateKey, fingerprint });
  }

  return keyring;
}

export interface SeedResult {
  blocks: number;
  flagged: number;
  skipped: { event_id: string; reason: string }[];
}

export async function seedDatabase(): Promise<SeedResult> {
  events.length = 0;
  buildTimeline();
  events.sort((a, b) => a.at.localeCompare(b.at));

  await insertReferenceData();
  const keyring = await provisionKeys();
  await ensureGenesis(new Date(START - 86_400_000).toISOString());

  const actors = new Map<string, ActorContext>(
    IDENTITIES.map((i) => [
      i.id,
      { id: i.id, name: i.name, role: i.role, factoryId: i.factory_id },
    ]),
  );

  let flagged = 0;
  const skipped: { event_id: string; reason: string }[] = [];

  for (const event of events) {
    const actor = actors.get(event.by);
    const signer = keyring.get(event.by);
    if (!actor || !signer) throw new Error(`Seed identity ${event.by} is not provisioned.`);

    const currentHead = await getHead();
    const prevHash = currentHead ? currentHead.block_hash : GENESIS_PREV_HASH;
    const nonce = await getNextNonce(actor.id);

    const record: SignedRecord = {
      chain_id: DEFAULT_CHAIN_ID,
      previous_block_hash: prevHash,
      nonce,
      event_id: event.event_id,
      factory_id: event.factory_id,
      event_type: event.event_type,
      timestamp: event.at,
      submitter_id: actor.id,
      submitter_name: actor.name,
      submitter_role: actor.role,
      data_fields: event.data_fields,
      ref_id: event.ref_id ?? null,
    };

    const signature = await signRecord(record, signer.key);

    try {
      const result = await commit({
        record,
        signature,
        keyFingerprint: signer.fingerprint,
        actor,
        committedAt: event.at,
      });
      if (result.anomaly.flagged) flagged += 1;
    } catch (error) {
      // Surfaced rather than swallowed — a seed event the pipeline rejects means the
      // demo data contradicts the rules, which is worth knowing about.
      skipped.push({
        event_id: event.event_id,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Publish a public blockchain notarization checkpoint anchoring this demo history
  try {
    await notarizeChainHead();
  } catch (err) {
    console.error('Failed to notarize chain head:', err);
  }

  const db = getDb();
  const { blocks } = await import('./schema.ts');
  const rows = await db.select({ i: blocks.blockIndex }).from(blocks);

  return { blocks: rows.length, flagged, skipped };
}

export async function resetAndSeed(): Promise<SeedResult> {
  await applySchema();
  await clearAll();
  return seedDatabase();
}

/* --------------------------------------------------------- entrypoint */

const isEntrypoint = process.argv[1]?.replace(/\\/g, '/').endsWith('db/seed.ts');

if (isEntrypoint) {
  const { closeDb } = await import('./client.ts');
  const { verifyLedger } = await import('../chain/ledger.ts');

  try {
    const result = await resetAndSeed();
    const report = await verifyLedger();

    console.log(`\n  seeded ${result.blocks} blocks`);
    console.log(`  ${result.flagged} record${result.flagged === 1 ? '' : 's'} flagged by the AI check`);
    console.log(
      `  chain integrity: ${report.ok ? 'verified' : `BROKEN at block ${report.firstBreakIndex}`}`,
    );

    if (result.skipped.length) {
      console.log(`\n  ${result.skipped.length} event(s) rejected by the pipeline:`);
      for (const s of result.skipped) console.log(`    - ${s.event_id}: ${s.reason}`);
    }
    console.log('');

    await closeDb();
  } catch (error) {
    console.error('seed failed:', error);
    await closeDb();
    process.exit(1);
  }
}
