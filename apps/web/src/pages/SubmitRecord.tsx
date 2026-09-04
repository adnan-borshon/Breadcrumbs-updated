import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, ScrollText } from 'lucide-react';
import { EVENT_LABEL, submittableEvents } from '@breadcrumbs/shared';
import type { EventType } from '@breadcrumbs/shared';

import { commitEvent, makeEventId, type CommitStage } from '../lib/signer.ts';
import { useSession } from '../store/session.ts';
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
    { name: 'units_produced', label: 'Units produced', kind: 'integer', hint: 'Checked against this factory’s own history.' },
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
    { name: 'units_processed', label: 'Units processed', kind: 'integer', hint: 'Chemical use per unit is compared with this factory’s norm.' },
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
  { id: 'validating', label: 'Running the anomaly check', detail: 'Measured against this factory’s own history' },
  { id: 'signing', label: 'Signing on this device', detail: 'ECDSA P-256, private key never leaves the browser' },
  { id: 'committing', label: 'Hashing onto the chain', detail: 'SHA-256, linked to the current head block' },
  { id: 'done', label: 'Committed', detail: 'The block is written and verifiable' },
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

  const fields = FORMS[eventType] ?? [];

  const setField = (name: string, value: string | boolean) =>
    setValues((current) => ({ ...current, [name]: value }));

  const valueFor = (field: FormField): string | boolean => {
    const current = values[field.name];
    if (current !== undefined) return current;
    if (field.defaultValue !== undefined) return field.defaultValue as string | boolean;
    return field.kind === 'boolean' ? false : '';
  };

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!identity?.factory_id) return;

    setError(null);
    setStage('validating');

    // Coerce to the types the shared schema expects. Anything optional and blank falls
    // back to the schema's own default, so the signed payload matches what the server
    // would parse — a mismatch there is rejected, by design.
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

    try {
      const result = await commitEvent({
        eventType,
        factoryId: identity.factory_id,
        eventId: makeEventId(eventType.slice(0, 3).toUpperCase()),
        dataFields,
        onStage: setStage,
      });

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

      <form onSubmit={onSubmit}>
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
      </form>

      {stage ? <PipelineProgress stage={stage} /> : null}
      {error ? <ErrorNote title="The ledger rejected this record" message={error} /> : null}
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
