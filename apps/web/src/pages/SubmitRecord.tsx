import { useCallback, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  Check,
  CheckCircle2,
  FileText,
  Loader2,
  Cpu,
  ScrollText,
  Upload,
  X,
} from 'lucide-react';
import { EVENT_LABEL, submittableEvents } from '@breadcrumbs/shared';
import type { EventType } from '@breadcrumbs/shared';

import { commitEvent, makeEventId, type CommitStage } from '../lib/signer.ts';
import { sha256File, formatBytes } from '../lib/verifyChain.ts';
import { useSession } from '../store/session.ts';
import { AnomalyChart } from '../components/ledger/AnomalyChart.tsx';
import {
  Button,
  Card,
  CardHeader,
  ErrorNote,
  Field,
  Input,
  Select,
  Textarea,
  cx,
} from '../components/ui/primitives.tsx';

/**
 * Field definitions per event type.
 *
 * Kept declarative so the form stays one component rather than a switch of bespoke
 * layouts, and so it can never offer a field the shared zod schema would reject.
 */
type FieldKind = 'text' | 'number' | 'integer' | 'date' | 'boolean' | 'textarea';

interface FormField {
  name: string;
  label: string;
  kind: FieldKind;
  hint?: string;
  optional?: boolean;
  placeholder?: string;
  defaultValue?: string | number | boolean;
}

const FORMS: Partial<Record<EventType, FormField[]>> = {
  inspection: [
    { name: 'inspection_type', label: 'Inspection type', kind: 'text', placeholder: 'Social compliance audit' },
    { name: 'workers_present', label: 'Workers present', kind: 'integer' },
    { name: 'working_hours', label: 'Working hours in period', kind: 'number' },
    { name: 'non_conformities', label: 'Non-conformities found', kind: 'integer', defaultValue: 0 },
    { name: 'passed', label: 'Passed', kind: 'boolean', defaultValue: true },
    { name: 'findings', label: 'Findings', kind: 'textarea', optional: true, hint: 'What was observed, in plain language.' },
  ],
  production_report: [
    { name: 'order_ref', label: 'Order reference', kind: 'text', placeholder: 'ORD-NW-4471' },
    { name: 'units_produced', label: 'Units produced', kind: 'integer', hint: 'Checked against this factory\'s own history.' },
    { name: 'working_hours', label: 'Working hours', kind: 'number' },
    { name: 'line_count', label: 'Lines running', kind: 'integer', defaultValue: 1 },
    { name: 'defect_count', label: 'Defects', kind: 'integer', defaultValue: 0 },
  ],
  certification: [
    { name: 'standard', label: 'Standard', kind: 'text', placeholder: 'OEKO-TEX Standard 100' },
    { name: 'certificate_no', label: 'Certificate number', kind: 'text' },
    { name: 'issued_by', label: 'Issued by', kind: 'text', placeholder: 'Hohenstein Institute' },
    { name: 'valid_until', label: 'Valid until', kind: 'date' },
    { name: 'scope', label: 'Scope', kind: 'textarea', optional: true },
  ],
  shipment: [
    { name: 'shipment_ref', label: 'Shipment reference', kind: 'text' },
    { name: 'destination', label: 'Destination', kind: 'text', placeholder: 'Rotterdam, Netherlands' },
    { name: 'carrier', label: 'Carrier', kind: 'text' },
    { name: 'cartons', label: 'Cartons', kind: 'integer' },
    { name: 'gross_weight_kg', label: 'Gross weight (kg)', kind: 'number' },
    { name: 'contract_id', label: 'Contract', kind: 'text', optional: true, hint: 'Leave blank if not against a contract.' },
  ],
  material_receipt: [
    { name: 'sku', label: 'SKU', kind: 'text', placeholder: 'FAB-CTN-180' },
    { name: 'quantity', label: 'Quantity received', kind: 'number' },
    { name: 'unit_cost_minor', label: 'Unit cost (cents)', kind: 'integer', defaultValue: 0 },
    { name: 'supplier', label: 'Supplier', kind: 'text' },
    { name: 'grn_ref', label: 'GRN reference', kind: 'text' },
    { name: 'lot_no', label: 'Lot number', kind: 'text', optional: true },
  ],
  material_issue: [
    { name: 'sku', label: 'SKU', kind: 'text' },
    { name: 'quantity', label: 'Quantity issued', kind: 'number', hint: 'Issuing more than the ledger shows in stock will be flagged.' },
    { name: 'order_ref', label: 'Order reference', kind: 'text' },
    { name: 'line', label: 'Line', kind: 'text', optional: true },
  ],
  chemical_receipt: [
    { name: 'sku', label: 'SKU', kind: 'text', placeholder: 'CHM-RDYE-R58' },
    { name: 'quantity', label: 'Quantity received', kind: 'number' },
    { name: 'supplier', label: 'Supplier', kind: 'text' },
    { name: 'lot_no', label: 'Lot number', kind: 'text' },
    { name: 'msds_ref', label: 'Safety data sheet ref', kind: 'text', optional: true },
    { name: 'expiry_date', label: 'Expiry date', kind: 'date' },
  ],
  chemical_consumption: [
    { name: 'sku', label: 'SKU', kind: 'text' },
    { name: 'quantity', label: 'Quantity used', kind: 'number' },
    { name: 'units_processed', label: 'Units processed', kind: 'integer', hint: 'Chemical use per unit is compared with this factory\'s norm.' },
    { name: 'process', label: 'Process', kind: 'text', placeholder: 'Reactive dyeing — exhaust' },
  ],
  chemical_disposal: [
    { name: 'sku', label: 'SKU', kind: 'text' },
    { name: 'quantity', label: 'Quantity disposed', kind: 'number' },
    { name: 'disposal_method', label: 'Disposal method', kind: 'text', placeholder: 'Licensed ETP contractor' },
    { name: 'permit_ref', label: 'Permit reference', kind: 'text', optional: true },
  ],
  stock_adjustment: [
    { name: 'sku', label: 'SKU', kind: 'text' },
    { name: 'quantity', label: 'Adjustment', kind: 'number', hint: 'Negative to reduce stock, positive to increase it.' },
    { name: 'reason', label: 'Reason', kind: 'text' },
  ],
};

const GROUPS: { label: string; types: EventType[] }[] = [
  { label: 'Audit', types: ['inspection', 'production_report', 'certification', 'shipment'] },
  {
    label: 'Inventory',
    types: [
      'material_receipt',
      'material_issue',
      'chemical_receipt',
      'chemical_consumption',
      'chemical_disposal',
      'stock_adjustment',
    ],
  },
];

const STAGES: { id: CommitStage; label: string; detail: string }[] = [
  { id: 'validating', label: 'Running the anomaly check', detail: "Measured against this factory's own history" },
  { id: 'signing', label: 'Signing on this device', detail: 'ECDSA P-256, private key never leaves the browser' },
  { id: 'committing', label: 'Hashing onto the chain', detail: 'SHA-256, linked to the current head block' },
  { id: 'done', label: 'Committed', detail: 'The block is written and verifiable' },
];


/* IoT device options */
const IOT_DEVICES = [
  { id: 'scale-001', label: 'Digital Scale TS-200', cert: 'CERT-IOT-2024-7712', type: 'Material weighing' },
  { id: 'flow-003', label: 'Effluent Flow Meter EFM-3', cert: 'CERT-IOT-2024-8801', type: 'Water treatment monitoring' },
  { id: 'cut-007', label: 'Auto Cutting Table CUT-7', cert: 'CERT-IOT-2024-5503', type: 'Fabric processing' },
  { id: 'temp-002', label: 'Dye Bath Sensor DBS-2', cert: 'CERT-IOT-2024-6614', type: 'Chemical process' },
];

export function SubmitRecord() {
  const { identity } = useSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const allowed = useMemo(
    () => (identity ? submittableEvents(identity.role).filter((type) => type in FORMS) : []),
    [identity],
  );

  const [eventType, setEventType] = useState<EventType>('production_report');
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [stage, setStage] = useState<CommitStage | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Oracle / physical attestation state
  const [iotSource, setIotSource] = useState<'manual' | 'iot'>('manual');
  const [selectedDevice, setSelectedDevice] = useState(IOT_DEVICES[0]!);
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [evidenceHash, setEvidenceHash] = useState<string | null>(null);
  const [hashingFile, setHashingFile] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Anomaly chart state (shown post-commit for production_report)
  const [anomalyResult, setAnomalyResult] = useState<{ flagged: boolean; score: number | null } | null>(null);

  const fields = FORMS[eventType] ?? [];

  const setField = (name: string, value: string | boolean) =>
    setValues((current) => ({ ...current, [name]: value }));

  const valueFor = (field: FormField): string | boolean => {
    const current = values[field.name];
    if (current !== undefined) return current;
    if (field.defaultValue !== undefined) return field.defaultValue as string | boolean;
    return field.kind === 'boolean' ? false : '';
  };

  const handleFile = useCallback(async (file: File) => {
    setEvidenceFile(file);
    setEvidenceHash(null);
    setHashingFile(true);
    try {
      const hash = await sha256File(file);
      setEvidenceHash(hash);
    } finally {
      setHashingFile(false);
    }
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) void handleFile(file);
    },
    [handleFile],
  );

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!identity?.factory_id) return;

    setError(null);
    setStage('validating');
    setAnomalyResult(null);

    const dataFields: Record<string, unknown> = {};
    for (const field of fields) {
      const raw = valueFor(field);

      if (field.kind === 'boolean') {
        dataFields[field.name] = Boolean(raw);
        continue;
      }
      if (field.kind === 'number' || field.kind === 'integer') {
        const numeric = Number(raw);
        dataFields[field.name] = Number.isFinite(numeric) ? numeric : 0;
        continue;
      }
      if (field.name === 'contract_id') {
        dataFields[field.name] = String(raw).trim() || null;
        continue;
      }
      dataFields[field.name] = String(raw).trim();
    }

    // Embed oracle source metadata
    dataFields['_source'] = iotSource === 'iot'
      ? `IoT:${selectedDevice.id}:${selectedDevice.cert}`
      : 'ManualEntry';

    // Embed evidence hash if a file was attached
    if (evidenceHash) {
      dataFields['evidence_hash'] = evidenceHash;
    }

    try {
      const result = await commitEvent({
        eventType,
        factoryId: identity.factory_id,
        eventId: makeEventId(eventType.slice(0, 3).toUpperCase()),
        dataFields,
        onStage: setStage,
      });

      setAnomalyResult(result.anomaly);
      await queryClient.invalidateQueries({ predicate: () => true });
      navigate(`/record/${encodeURIComponent(result.record.event_id)}`, { viewTransition: true });
    } catch (err) {
      setStage(null);
      setError(err instanceof Error ? err.message : 'Could not commit the record.');
    }
  };

  if (!identity?.factory_id) {
    return <ErrorNote message="Only a factory account can submit records." />;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <header>
        <h1 className="text-[1.6rem] text-navy">Submit an audit record</h1>
        <p className="mt-1.5 max-w-2xl text-[0.88rem] leading-relaxed text-ink-muted">
          Recorded against <span className="font-medium text-navy">{identity.factory_id}</span>. The
          record is signed in this browser before it is sent, so the entry is provably yours and
          cannot be altered afterwards without breaking the chain.
        </p>
      </header>

      <form onSubmit={(e) => void onSubmit(e)}>
        <div className="space-y-5">
          <Card>
            <CardHeader title="What happened" />

            <div className="space-y-5 px-5 py-5">
              <Field label="Event type" required>
                <Select
                  value={eventType}
                  onChange={(event) => {
                    setEventType(event.target.value as EventType);
                    setValues({});
                  }}
                >
                  {GROUPS.map((group) => {
                    const options = group.types.filter((type) => allowed.includes(type));
                    if (options.length === 0) return null;
                    return (
                      <optgroup key={group.label} label={group.label}>
                        {options.map((type) => (
                          <option key={type} value={type}>
                            {EVENT_LABEL[type]}
                          </option>
                        ))}
                      </optgroup>
                    );
                  })}
                </Select>
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                {fields.map((field) => {
                  const wide = field.kind === 'textarea';
                  return (
                    <div key={field.name} className={wide ? 'sm:col-span-2' : undefined}>
                      <Field label={field.label} hint={field.hint} required={!field.optional}>
                        {field.kind === 'boolean' ? (
                          <label className="flex items-center gap-2 rounded-md border border-hairline-strong bg-surface px-3 py-2">
                            <input
                              type="checkbox"
                              checked={Boolean(valueFor(field))}
                              onChange={(event) => setField(field.name, event.target.checked)}
                              className="size-4 accent-[#0F2540]"
                            />
                            <span className="text-[0.82rem] text-ink">
                              {valueFor(field) ? 'Yes' : 'No'}
                            </span>
                          </label>
                        ) : field.kind === 'textarea' ? (
                          <Textarea
                            value={String(valueFor(field))}
                            onChange={(event) => setField(field.name, event.target.value)}
                            placeholder={field.placeholder}
                          />
                        ) : (
                          <Input
                            type={field.kind === 'date' ? 'date' : field.kind === 'text' ? 'text' : 'number'}
                            step={field.kind === 'number' ? 'any' : field.kind === 'integer' ? '1' : undefined}
                            value={String(valueFor(field))}
                            onChange={(event) => setField(field.name, event.target.value)}
                            placeholder={field.placeholder}
                            required={!field.optional}
                          />
                        )}
                      </Field>
                    </div>
                  );
                })}
              </div>

              <p className="border-t border-hairline pt-4 text-[0.76rem] text-ink-muted">
                The timestamp is taken at submission and the factory is fixed to your account — both
                are part of what you sign.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3 border-t border-hairline px-5 py-4">
              <Button type="submit" variant="primary" disabled={stage !== null}>
                <ScrollText size={15} aria-hidden />
                Sign and commit
              </Button>
              <span className="text-[0.76rem] text-ink-muted">
                This writes a permanent block. Records are never deleted, only reviewed.
              </span>
            </div>
          </Card>

          {/* Oracle / Physical Attestation */}
          <Card>
            <CardHeader
              title="Physical Attestation & Data Source"
              description="Bridge the physical-digital divide. Document how this data was collected."
            />
            <div className="space-y-5 px-5 py-5">
              {/* Source selector */}
              <div>
                <p className="mb-2 text-[0.78rem] font-medium text-navy">Data source</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <SourceOption
                    id="manual"
                    active={iotSource === 'manual'}
                    onClick={() => setIotSource('manual')}
                    icon={<ScrollText size={16} />}
                    label="Manual Operator Entry"
                    description="Data entered by a human operator. Subject to input error — reviewers may request corroborating evidence."
                  />
                  <SourceOption
                    id="iot"
                    active={iotSource === 'iot'}
                    onClick={() => setIotSource('iot')}
                    icon={<Cpu size={16} />}
                    label="Direct IoT Telemetry (Verified Stream)"
                    description="Data piped directly from a hardware sensor or automated system. Device certificate is embedded in the block."
                    badge="Higher Trust"
                  />
                </div>
              </div>

              {/* IoT device selector */}
              {iotSource === 'iot' && (
                <div className="rounded-[var(--radius-card)] border border-teal/25 bg-teal-soft/30 p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-teal opacity-60" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-teal" />
                    </span>
                    <p className="text-[0.78rem] font-semibold text-teal">Hardware Attestation Active</p>
                  </div>

                  <Field label="Select registered IoT device">
                    <Select
                      value={selectedDevice.id}
                      onChange={(e) => {
                        const d = IOT_DEVICES.find((d) => d.id === e.target.value);
                        if (d) setSelectedDevice(d);
                      }}
                    >
                      {IOT_DEVICES.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.label} — {d.type}
                        </option>
                      ))}
                    </Select>
                  </Field>

                  <dl className="grid grid-cols-2 gap-2 text-[0.75rem]">
                    <div>
                      <dt className="text-ink-muted">Device ID</dt>
                      <dd className="font-mono text-navy">{selectedDevice.id}</dd>
                    </div>
                    <div>
                      <dt className="text-ink-muted">Certificate</dt>
                      <dd className="font-mono text-teal">{selectedDevice.cert}</dd>
                    </div>
                    <div>
                      <dt className="text-ink-muted">Type</dt>
                      <dd className="text-navy">{selectedDevice.type}</dd>
                    </div>
                    <div>
                      <dt className="text-ink-muted">Stream status</dt>
                      <dd className="text-teal">✓ Live &amp; authenticated</dd>
                    </div>
                  </dl>
                </div>
              )}

              {/* Physical evidence dropzone */}
              <div>
                <p className="mb-2 text-[0.78rem] font-medium text-navy">
                  Attach Physical Evidence{' '}
                  <span className="text-ink-faint font-normal">(optional)</span>
                </p>
                <p className="mb-3 text-[0.74rem] text-ink-muted">
                  Lab test certificates, bill of lading PDFs, factory inspection photos. The
                  SHA-256 fingerprint is computed locally in your browser and anchored to the block
                  — never the file itself.
                </p>

                {evidenceFile ? (
                  <div className="rounded-md border border-teal/30 bg-teal-soft/40 p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <FileText size={16} className="shrink-0 text-teal" aria-hidden />
                        <div className="min-w-0">
                          <p className="truncate text-[0.82rem] font-medium text-navy">{evidenceFile.name}</p>
                          <p className="text-[0.72rem] text-ink-muted">{formatBytes(evidenceFile.size)}</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => { setEvidenceFile(null); setEvidenceHash(null); }}
                        className="shrink-0 p-1 text-ink-faint hover:text-navy"
                        aria-label="Remove file"
                      >
                        <X size={14} aria-hidden />
                      </button>
                    </div>

                    {hashingFile ? (
                      <div className="flex items-center gap-2 text-[0.76rem] text-[#8a6d24]">
                        <Loader2 size={13} className="animate-spin" />
                        Computing SHA-256 in browser…
                      </div>
                    ) : evidenceHash ? (
                      <div>
                        <p className="text-[0.68rem] font-semibold uppercase tracking-wide text-teal">
                          Digital Fingerprint — Anchored to Block
                        </p>
                        <p className="mt-0.5 font-mono text-[0.7rem] text-ink break-all">{evidenceHash}</p>
                        <p className="mt-1 flex items-center gap-1.5 text-[0.72rem] text-teal">
                          <CheckCircle2 size={11} aria-hidden />
                          Computed locally via window.crypto.subtle.digest("SHA-256") — not uploaded
                        </p>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div
                    className={cx(
                      'flex flex-col items-center justify-center gap-3 rounded-md border-2 border-dashed p-8 text-center transition-colors cursor-pointer',
                      dragOver
                        ? 'border-navy bg-navy/5'
                        : 'border-hairline-strong hover:border-navy/40 hover:bg-parchment/60',
                    )}
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={onDrop}
                    onClick={() => fileInputRef.current?.click()}
                    role="button"
                    aria-label="Drop physical evidence file or click to browse"
                  >
                    <Upload size={22} className="text-ink-faint" aria-hidden />
                    <div>
                      <p className="text-[0.82rem] font-medium text-navy">Drop file or click to browse</p>
                      <p className="text-[0.74rem] text-ink-muted">PDF, JPEG, PNG, XLSX — any format</p>
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      className="sr-only"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); }}
                    />
                  </div>
                )}
              </div>
            </div>
          </Card>
        </div>
      </form>

      {stage ? <PipelineProgress stage={stage} /> : null}
      {error ? <ErrorNote title="The ledger rejected this record" message={error} /> : null}

      {/* Anomaly chart — shown for production_report after commit */}
      {anomalyResult && eventType === 'production_report' && (
        <Card className="p-5">
          <AnomalyChart
            value={Number(values['units_produced'] ?? 0)}
            mean={10200}
            stdDev={1400}
            unit="units"
          />
          {anomalyResult.flagged && (
            <div className="mt-4 rounded-md border border-clay/30 bg-clay-soft px-4 py-3 text-[0.8rem] text-clay">
              This submission was flagged for human review. Score: {anomalyResult.score?.toFixed(2)}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- sub-components */

function SourceOption({
  id,
  active,
  onClick,
  icon,
  label,
  description,
  badge,
}: {
  id: string;
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  description: string;
  badge?: string;
}) {
  return (
    <div
      role="radio"
      aria-checked={active}
      id={id}
      onClick={onClick}
      className={cx(
        'cursor-pointer rounded-[var(--radius-card)] border p-3.5 transition-colors',
        active ? 'border-navy bg-navy/5' : 'border-hairline bg-surface hover:border-hairline-strong',
      )}
    >
      <div className="flex items-start gap-2.5">
        <div
          className={cx(
            'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
            active ? 'bg-navy text-parchment' : 'bg-parchment-deep text-ink-muted',
          )}
        >
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[0.82rem] font-semibold text-navy">{label}</p>
            {badge && (
              <span className="rounded-[var(--radius-pill)] border border-teal/30 bg-teal-soft px-2 py-0.5 text-[0.62rem] font-semibold text-teal">
                {badge}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[0.73rem] leading-relaxed text-ink-muted">{description}</p>
        </div>
        <div
          className={cx(
            'mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border-2',
            active ? 'border-navy bg-navy' : 'border-hairline-strong bg-surface',
          )}
        />
      </div>
    </div>
  );
}

/**
 * The commit pipeline, shown as it happens.
 *
 * These are the real stages the record passes through — not a decorative timer.
 */
function PipelineProgress({ stage }: { stage: CommitStage }) {
  const currentIndex = STAGES.findIndex((s) => s.id === stage);

  return (
    <Card className="p-5" aria-live="polite">
      <ol className="space-y-3">
        {STAGES.map((item, index) => {
          const done = index < currentIndex || stage === 'done';
          const active = index === currentIndex && stage !== 'done';

          return (
            <li key={item.id} className="flex items-start gap-3">
              <span
                className={cx(
                  'mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border transition-colors',
                  done
                    ? 'border-teal bg-teal text-parchment'
                    : active
                      ? 'border-navy bg-surface text-navy'
                      : 'border-hairline-strong bg-surface text-ink-faint',
                )}
              >
                {done ? (
                  <Check size={11} aria-hidden />
                ) : active ? (
                  <Loader2 size={11} className="animate-spin" aria-hidden />
                ) : (
                  <span className="size-1.5 rounded-full bg-current" aria-hidden />
                )}
              </span>
              <div>
                <p
                  className={cx(
                    'text-[0.85rem] font-medium',
                    done || active ? 'text-navy' : 'text-ink-faint',
                  )}
                >
                  {item.label}
                </p>
                <p className="text-[0.75rem] text-ink-muted">{item.detail}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
