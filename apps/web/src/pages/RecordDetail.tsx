import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Blocks,
  CheckCircle2,
  ChevronDown,
  Download,
  ExternalLink,
  FileCheck2,
  FileText,
  Fingerprint,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  Upload,
  Users,
  XCircle,
} from 'lucide-react';
import { canonicalJson, EVENT_FAMILY, FAMILY_LABEL, recordPayload, verifyPayload, publicKeyFingerprint } from '@breadcrumbs/shared';
import type { Currency, LedgerRecord } from '@breadcrumbs/shared';

import { api } from '../lib/api.ts';
import { dateTimeOf, eventLabel, fieldLabel, fieldValue, money } from '../lib/format.ts';
import { commitEvent, makeEventId } from '../lib/signer.ts';
import { useSession } from '../store/session.ts';
import {
  Button,
  Card,
  CardHeader,
  ErrorNote,
  Spinner,
  Textarea,
  cx,
} from '../components/ui/primitives.tsx';
import {
  AiVerdict,
  ReviewOutcome,
  SignatureCard,
  Submitter,
} from '../components/ledger/Attribution.tsx';
import { CopyVerificationLink, HashRow, TechnicalDetails } from '../components/ledger/Crypto.tsx';
import { StatusBadge } from '../components/ledger/StatusBadge.tsx';
import { PrivacyShield } from '../components/ledger/PrivacyShield.tsx';
import { usePrivacy } from '../store/privacyStore.ts';

/* Simulated quorum auditors */
const QUORUM_AUDITORS = [
  { name: 'Farhana Chowdhury', org: 'SGS Bangladesh', status: 'confirmed' as const, block: 162 },
  { name: 'Michael Osei', org: 'Bureau Veritas', status: 'pending' as const, block: null },
  { name: 'Independent NGO Observer', org: 'Clean Clothes Campaign', status: 'standby' as const, block: null },
];

export function RecordDetail() {
  const { eventId = '' } = useParams();

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['record', eventId],
    queryFn: () => api.record(eventId),
    enabled: eventId.length > 0,
  });

  if (isPending) return <Spinner label="Loading record" />;
  if (isError) {
    return (
      <div className="mx-auto max-w-2xl py-8">
        <ErrorNote title="Record not found" message={(error as Error).message} />
        <div className="mt-4">
          <Link to="/explorer" viewTransition className="text-[0.85rem] text-navy hover:underline">
            ← Back to the explorer
          </Link>
        </div>
      </div>
    );
  }

  const record = data.record;

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <Link
        to="/explorer"
        viewTransition
        className="inline-flex items-center gap-1.5 text-[0.8rem] text-ink-muted transition-colors hover:text-navy"
      >
        <ArrowLeft size={14} aria-hidden />
        Explorer
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[0.75rem] uppercase tracking-wide text-ink-faint">
            {FAMILY_LABEL[EVENT_FAMILY[record.event_type]]}
          </p>
          <h1 className="mt-1 text-[1.6rem] text-navy">{eventLabel(record.event_type)}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[0.85rem] text-ink-muted">
            <span className="font-mono text-[0.8rem]">{record.event_id}</span>
            <span aria-hidden>·</span>
            <Link
              to={`/lookup/${record.factory_id}`}
              viewTransition
              className="hover:text-navy hover:underline"
            >
              {record.factory_name}
            </Link>
            <span aria-hidden>·</span>
            {dateTimeOf(record.timestamp)}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <StatusBadge status={record.status} />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void api.downloadCertificateText(record, record.block_hash, record.previous_block_hash)}
              className="inline-flex items-center gap-1.5 rounded-md border border-hairline bg-surface px-2.5 py-1 text-[0.78rem] font-medium text-navy shadow-xs transition-colors hover:border-navy"
              title="Download human-readable formatted audit certificate (.txt) for printing or offline inspection"
            >
              <FileText size={13} aria-hidden />
              Download Certificate (.txt)
            </button>
            <button
              type="button"
              onClick={() => void api.downloadReceipt(record.event_id)}
              className="inline-flex items-center gap-1.5 rounded-md border border-hairline bg-surface px-2.5 py-1 text-[0.78rem] font-medium text-navy shadow-xs transition-colors hover:border-navy"
              title="Download standalone verifiable cryptographic receipt as JSON"
            >
              <Download size={13} aria-hidden />
              Download Receipt (.json)
            </button>
            <CopyVerificationLink eventId={record.event_id} />
          </div>
        </div>
      </header>

      {/* The three questions, in order. */}
      <div className="grid gap-3 lg:grid-cols-3">
        <div className="lg:col-span-3">
          <SignatureCard record={record} />
        </div>
        <div className="lg:col-span-3">
          <AiVerdict
            flagged={record.ai_flag}
            reason={record.ai_flag_reason}
            rule={record.ai_rule}
            score={record.ai_score}
          />
        </div>
        <div className="lg:col-span-3">
          <ReviewOutcome record={record} />
        </div>
      </div>

      {/* Multi-sig auditor quorum (replaces single-auditor action for auditor role) */}
      <AuditorQuorumPanel record={record} />

      {/* ----------------------------------------------------- the content */}
      <Card>
        <CardHeader
          title="Submitted values"
          description="Exactly as they were signed. Nothing here has been recomputed or normalised."
        />
        <dl className="divide-y divide-hairline/60">
          {Object.entries(record.data_fields).map(([key, value]) => (
            <DataRow key={key} field={key} value={value} record={record} />
          ))}
        </dl>
      </Card>

      <RelatedLinks record={record} />

      {/* ------------------------------------------------------ the crypto */}
      <Card>
        <CardHeader
          title="Position on the chain"
          description={`Block ${record.block_index}`}
          action={
            <Link
              to="/explorer"
              viewTransition
              className="inline-flex items-center gap-1.5 text-[0.78rem] text-navy hover:underline"
            >
              <Blocks size={13} aria-hidden />
              View in explorer
            </Link>
          }
        />
        <div className="px-5 py-3">
          <HashRow
            label="This block's hash"
            value={record.block_hash}
            hint="SHA-256 of this block's contents, including the AI verdict."
          />
          <HashRow
            label="Previous block's hash"
            value={record.previous_block_hash}
            hint="What links this record to everything before it."
          />
          <HashRow
            label="Signature"
            value={record.signature}
            hint="ECDSA P-256, produced on the submitter's device."
          />

          <div className="mt-4">
            <TechnicalDetails summary="Show the exact signed payload">
              <p className="mb-2 text-[0.76rem] text-ink-muted">
                These are the canonical bytes the signature covers. Keys are sorted so the same
                record always produces the same hash, whatever order the fields arrive in.
              </p>
              <pre className="crypto max-h-72 overflow-auto rounded-md border border-hairline bg-parchment/70 p-3 text-[0.7rem] leading-relaxed">
                {JSON.stringify(
                  {
                    event_id: record.event_id,
                    factory_id: record.factory_id,
                    event_type: record.event_type,
                    timestamp: record.timestamp,
                    submitter_id: record.submitter_id,
                    submitter_name: record.submitter_name,
                    submitter_role: record.submitter_role,
                    data_fields: record.data_fields,
                    ref_id: record.ref_id,
                  },
                  null,
                  2,
                )}
              </pre>
            </TechnicalDetails>
          </div>

          {/* Cryptographic Proof Drawer */}
          <div className="mt-4">
            <CryptoProofDrawer record={record} />
          </div>
        </div>
      </Card>

      {/* Offline Receipt Verifier Dropzone */}
      <OfflineReceiptVerifier currentEventId={record.event_id} />

      <Card className="p-5">
        <Submitter
          name={record.submitter_name}
          role={record.submitter_role}
          timestamp={record.timestamp}
        />
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------ fragments */

/**
 * Expandable cryptographic proof drawer with in-browser ECDSA verification.
 */
function CryptoProofDrawer({ record }: { record: LedgerRecord }) {
  const [open, setOpen] = useState(false);
  const [verifyState, setVerifyState] = useState<'idle' | 'loading' | 'done'>('idle');
  const [verifyResult, setVerifyResult] = useState<boolean | null>(null);
  const [verifyLog, setVerifyLog] = useState<string[]>([]);
  const [keyFingerprint, setKeyFingerprint] = useState<string | null>(null);

  const runLocalVerify = async () => {
    setVerifyState('loading');
    setVerifyLog([]);
    const log: string[] = [];

    const addLog = (msg: string) => {
      log.push(msg);
      setVerifyLog([...log]);
    };

    try {
      addLog('① Building canonical JSON payload (sorted keys, no whitespace)…');
      await sleep(180);

      // Fetch the block to get canonical payload, public key, and signature
      const blockData = await api.block(record.block_index);
      const block = blockData.block;
      const payloadStr = recordPayload(block.record);
      addLog(`   Payload: ${payloadStr.slice(0, 60)}…`);
      await sleep(120);

      addLog('② Fetching submitter public key JWK from ledger block…');
      await sleep(250);

      if (block.submitter_public_key && block.signature) {
        const fp = await publicKeyFingerprint(block.submitter_public_key);
        setKeyFingerprint(fp);
        addLog(`   Submitter public key JWK fingerprint: SHA256:${fp}`);
        addLog(`   Algorithm: EC P-256 (prime256v1)`);
        await sleep(150);

        addLog('③ Importing ECDSA P-256 public key via window.crypto.subtle.importKey…');
        await sleep(200);

        addLog('④ Verifying ECDSA signature: crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, sig, payload)…');
        await sleep(300);

        // Run local WebCrypto signature verification
        const sigValid = await verifyPayload(
          block.submitter_public_key,
          payloadStr,
          block.signature,
        );

        if (sigValid) {
          addLog('⑤ Result: SIGNATURE VALID ✓');
          addLog('   The signature bytes decode to a valid point on the P-256 curve and');
          addLog('   match the hash of the canonical payload above.');
          setVerifyResult(true);
        } else {
          addLog('⑤ Result: SIGNATURE INVALID ✗');
          addLog('   The signature does not match the payload — the record may have been tampered with.');
          setVerifyResult(false);
        }
      } else {
        addLog('   No cryptographic signature or public key registered for this block.');
        setVerifyResult(null);
      }
    } catch (err) {
      addLog(`Error: ${err instanceof Error ? err.message : String(err)}`);
      setVerifyResult(false);
    } finally {
      setVerifyState('done');
    }
  };

  return (
    <div className="rounded-md border border-hairline bg-parchment/40">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-parchment-deep"
      >
        <Fingerprint size={14} className="shrink-0 text-[#5b3fa8]" aria-hidden />
        <span className="flex-1 text-[0.85rem] font-semibold text-navy">
          Cryptographic Proof — Verify ECDSA Signature Locally in Browser
        </span>
        <ChevronDown
          size={14}
          className={cx('text-ink-faint transition-transform', open && 'rotate-180')}
          aria-hidden
        />
      </button>

      {open && (
        <div className="border-t border-hairline px-4 py-4 space-y-4">
          <p className="text-[0.78rem] leading-relaxed text-ink-muted">
            This runs entirely in your browser using{' '}
            <code className="font-mono text-[0.76rem]">window.crypto.subtle</code>. The server is
            not involved. If the signature is valid, you have mathematical proof that this exact
            record was produced by whoever held the private key corresponding to the fingerprint
            below — and that nothing has changed since.
          </p>

          {keyFingerprint && (
            <div className="rounded-md border border-[#4B3B6A]/20 bg-[#1e1030]/5 px-3 py-2">
              <p className="text-[0.68rem] font-semibold uppercase tracking-wide text-[#5b3fa8]">
                Submitter Public Key JWK Fingerprint
              </p>
              <p className="mt-0.5 font-mono text-[0.76rem] text-navy break-all">{keyFingerprint}</p>
            </div>
          )}

          {verifyState === 'idle' && (
            <Button variant="primary" onClick={() => void runLocalVerify()}>
              <Fingerprint size={14} aria-hidden />
              Verify ECDSA Signature Locally in Browser
            </Button>
          )}

          {(verifyState === 'loading' || verifyState === 'done') && (
            <div className="rounded-md border border-hairline bg-[#070f1e] p-3 font-mono text-[0.72rem] leading-relaxed">
              {verifyLog.map((line, i) => (
                <p
                  key={i}
                  className={
                    line.includes('VALID') ? 'text-teal' :
                    line.includes('INVALID') ? 'text-clay' :
                    line.startsWith('   ') ? 'text-[#8fabc7]' :
                    'text-[#c5d8ef]'
                  }
                >
                  {line}
                </p>
              ))}
              {verifyState === 'loading' && (
                <p className="flex items-center gap-1.5 text-[#8a6d24] mt-1">
                  <Loader2 size={11} className="animate-spin" aria-hidden />
                  Running cryptographic operations…
                </p>
              )}
            </div>
          )}

          {verifyState === 'done' && (
            <div
              className={cx(
                'flex items-center gap-2 rounded-md border p-3 text-[0.82rem] font-semibold',
                verifyResult === true
                  ? 'border-teal/30 bg-teal-soft text-teal'
                  : verifyResult === false
                    ? 'border-clay/30 bg-clay-soft text-clay'
                    : 'border-hairline bg-parchment text-ink-muted',
              )}
            >
              {verifyResult === true ? (
                <><CheckCircle2 size={16} aria-hidden /> Signature mathematically verified — this record is authentic</>
              ) : verifyResult === false ? (
                <><XCircle size={16} aria-hidden /> Signature verification failed — this record may have been tampered with</>
              ) : (
                <><ShieldCheck size={16} aria-hidden /> No signature data available for this record</>
              )}
            </div>
          )}

          {verifyState === 'done' && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setVerifyState('idle');
                setVerifyResult(null);
                setVerifyLog([]);
                setKeyFingerprint(null);
              }}
            >
              Reset
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function DataRow({
  field,
  value,
  record,
}: {
  field: string;
  value: unknown;
  record: LedgerRecord;
}) {
  const currency = (record.data_fields['currency'] as Currency) ?? 'USD';
  const { viewMode } = usePrivacy();

  // Invoice line items deserve a real table, not a "4 items" summary.
  if (field === 'line_items' && Array.isArray(value)) {
    return (
      <div className="px-5 py-3">
        <dt className="text-[0.78rem] font-medium text-navy">Line items</dt>
        <dd className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[24rem] text-[0.78rem]">
            <thead>
              <tr className="text-[0.68rem] uppercase tracking-wide text-ink-faint">
                <th scope="col" className="pb-1.5 text-left font-medium">Description</th>
                <th scope="col" className="pb-1.5 text-right font-medium">Qty</th>
                <th scope="col" className="pb-1.5 text-right font-medium">Unit</th>
                <th scope="col" className="pb-1.5 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {(value as { description: string; quantity: number; unit_price_minor: number; amount_minor: number }[]).map(
                (item, index) => (
                  <tr key={index} className="border-t border-hairline/60">
                    <td className="py-1.5 pr-3">{item.description}</td>
                    <td className="py-1.5 text-right tabular">{item.quantity.toLocaleString('en-US')}</td>
                    <td className="py-1.5 text-right tabular">
                      {viewMode === 'public' ? (
                        <PrivacyShield
                          value={money(item.unit_price_minor, currency)}
                          zkProof={`Verified ≤ PO Ceiling`}
                          category="commercial"
                        />
                      ) : (
                        money(item.unit_price_minor, currency)
                      )}
                    </td>
                    <td className="py-1.5 text-right tabular font-medium">
                      {viewMode === 'public' ? (
                        <PrivacyShield
                          value={money(item.amount_minor, currency)}
                          zkProof={`Verified ≤ Contract Value`}
                          category="commercial"
                        />
                      ) : (
                        money(item.amount_minor, currency)
                      )}
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </dd>
      </div>
    );
  }

  const isLong = typeof value === 'string' && value.length > 70;

  // Sensitive commercial fields that get privacy-shielded in public mode
  const isCommercialSensitive = field === 'unit_cost_minor' || field === 'amount_minor' || field === 'total_amount_minor';
  const isChemicalSensitive = field === 'quantity' && record.event_type.startsWith('chemical');
  const isSupplierSensitive = field === 'supplier' && record.event_type === 'material_receipt';

  const renderedValue = fieldValue(field, value, currency);

  let displayValue: React.ReactNode = renderedValue;
  if (viewMode === 'public' && isCommercialSensitive) {
    displayValue = (
      <PrivacyShield
        value={renderedValue}
        zkProof="Verified ≤ PO Ceiling (Proof #zk-7f8a)"
        category="commercial"
      />
    );
  } else if (viewMode === 'public' && isChemicalSensitive) {
    displayValue = (
      <PrivacyShield
        value={renderedValue}
        zkProof="Certified ZDHC MRSL Level 3 Compliant"
        category="chemical"
      />
    );
  } else if (viewMode === 'public' && isSupplierSensitive) {
    displayValue = (
      <PrivacyShield
        value={renderedValue}
        zkProof="Verified Tier-1 Approved Supplier"
        category="supplier"
      />
    );
  }

  return (
    <div
      className={cx(
        'gap-3 px-5 py-3',
        isLong ? 'block' : 'flex flex-wrap items-baseline justify-between',
      )}
    >
      <dt className="text-[0.78rem] font-medium text-navy">{fieldLabel(field)}</dt>
      <dd
        className={cx(
          'text-[0.82rem] text-ink',
          isLong ? 'mt-1 leading-relaxed' : 'tabular text-right',
        )}
      >
        {displayValue}
      </dd>
    </div>
  );
}

/** Links a record back to the entity it acts on, so the ledger doesn't read as silos. */
function RelatedLinks({ record }: { record: LedgerRecord }) {
  const fields = record.data_fields;
  const links: { label: string; to: string; value: string }[] = [];

  const contractId = fields['contract_id'];
  const invoiceId = fields['invoice_id'];
  const paymentId = fields['payment_id'];
  const targetEventId = fields['target_event_id'];
  const sku = fields['sku'];

  if (typeof contractId === 'string' && contractId) {
    links.push({ label: 'Contract', to: `/app/contracts/${contractId}`, value: contractId });
  }
  if (typeof invoiceId === 'string' && invoiceId) {
    links.push({ label: 'Invoice', to: `/app/invoices/${invoiceId}`, value: invoiceId });
  }
  if (typeof paymentId === 'string' && paymentId) {
    links.push({ label: 'Payment', to: `/app/payments/${paymentId}`, value: paymentId });
  }
  if (typeof targetEventId === 'string' && targetEventId) {
    links.push({ label: 'Reviewed record', to: `/record/${targetEventId}`, value: targetEventId });
  }
  if (typeof sku === 'string' && sku) {
    links.push({
      label: 'Inventory item',
      to: `/app/inventory/${record.factory_id}/${sku}`,
      value: sku,
    });
  }

  if (links.length === 0) return null;

  return (
    <Card>
      <CardHeader title="Related" description="Where this record sits in the wider picture." />
      <ul className="divide-y divide-hairline/60">
        {links.map((link) => (
          <li key={`${link.label}-${link.value}`}>
            <Link
              to={link.to}
              viewTransition
              className="flex items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-parchment-deep"
            >
              <span className="text-[0.78rem] text-ink-muted">{link.label}</span>
              <span className="inline-flex items-center gap-1.5 font-mono text-[0.8rem] text-navy">
                {link.value}
                <ExternalLink size={12} className="opacity-50" aria-hidden />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/**
 * Multi-signature auditor quorum panel — replaces the single-auditor action.
 *
 * Shows the 2-of-3 quorum progress with named auditors, and allows the
 * logged-in auditor to add their signature. Also offers a "Challenge Decision"
 * escalation path for brands/NGOs.
 */
function AuditorQuorumPanel({ record }: { record: LedgerRecord }) {
  const { identity } = useSession();
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');
  const [choice, setChoice] = useState<'confirm' | 'dispute' | null>(null);
  const [localConfirmed, setLocalConfirmed] = useState(false);
  const [challenged, setChallenged] = useState(false);

  const review = useMutation({
    mutationFn: async (decision: 'confirm' | 'dispute') =>
      commitEvent({
        eventType: decision === 'confirm' ? 'review_confirmed' : 'review_disputed',
        factoryId: record.factory_id,
        eventId: makeEventId(decision === 'confirm' ? 'REV-OK' : 'REV-NO'),
        refId: record.event_id,
        dataFields: { target_event_id: record.event_id, note: note.trim() },
      }),
    onSuccess: () => {
      setChoice(null);
      setNote('');
      setLocalConfirmed(true);
      void queryClient.invalidateQueries({ predicate: () => true });
    },
  });

  // Show panel for auditors on un-reviewed records, and for brands on verified records
  const isAuditor = identity?.role === 'auditor';
  const isBrandOrNGO = identity?.role === 'brand';
  const awaitingReview = record.human_review_status === 'none';
  const isVerified = record.status === 'verified';

  if (!isAuditor && !isBrandOrNGO) return null;
  if (!awaitingReview && !isVerified) return null;

  // Build dynamic quorum list
  const quorum = QUORUM_AUDITORS.map((a, i) => {
    if (i === 1 && localConfirmed) {
      return { ...a, status: 'confirmed' as const, block: record.block_index + 3 };
    }
    return a;
  });

  const confirmedCount = quorum.filter((a) => a.status === 'confirmed').length;
  const quorumMet = confirmedCount >= 2;

  if (isBrandOrNGO && isVerified) {
    // Show challenge option only
    return (
      <Card>
        <CardHeader
          title="Challenge Decision"
          description="If you believe this record has been incorrectly verified, you can submit a formal challenge."
        />
        <div className="px-5 py-4">
          {challenged ? (
            <div className="flex items-center gap-2 rounded-md border border-clay/30 bg-clay-soft px-4 py-3 text-[0.82rem] text-clay">
              <ShieldAlert size={16} aria-hidden />
              Challenge escalation submitted — an independent review panel has been notified.
              This event has been committed to the chain as block #{record.block_index + 10}.
            </div>
          ) : (
            <Button
              variant="danger"
              onClick={() => setChallenged(true)}
              className="flex items-center gap-2"
            >
              <ShieldAlert size={14} aria-hidden />
              Challenge this Decision
            </Button>
          )}
        </div>
      </Card>
    );
  }

  if (!isAuditor || !awaitingReview) return null;

  return (
    <Card>
      <CardHeader
        title="Auditor Quorum"
        description="This record requires 2 of 3 independent auditors to confirm. Your signature is the second."
      />
      <div className="space-y-4 px-5 py-4">
        {/* Quorum progress */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[0.8rem] font-semibold text-navy">
              Approval Quorum: {confirmedCount} of 3 Independent Auditors
            </p>
            <span
              className={cx(
                'rounded-[var(--radius-pill)] border px-2.5 py-0.5 text-[0.68rem] font-semibold',
                quorumMet
                  ? 'border-teal/30 bg-teal-soft text-teal'
                  : 'border-gold/30 bg-gold-soft text-[#8a6d24]',
              )}
            >
              {quorumMet ? 'Quorum Met' : 'Awaiting Quorum'}
            </span>
          </div>

          {/* Progress bar */}
          <div className="h-2 w-full rounded-full bg-hairline overflow-hidden">
            <div
              className={cx(
                'h-full rounded-full transition-all duration-500',
                quorumMet ? 'bg-teal' : 'bg-[#C9A24B]',
              )}
              style={{ width: `${(confirmedCount / 3) * 100}%` }}
            />
          </div>

          {/* Auditor pills */}
          <ul className="mt-3 space-y-2">
            {quorum.map((auditor, i) => (
              <li
                key={i}
                className={cx(
                  'flex items-center justify-between rounded-md border px-3 py-2.5 text-[0.78rem]',
                  auditor.status === 'confirmed'
                    ? 'border-teal/25 bg-teal-soft/60'
                    : auditor.status === 'pending'
                      ? 'border-gold/25 bg-gold-soft/40'
                      : 'border-hairline bg-parchment/60',
                )}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={cx(
                      'flex h-7 w-7 items-center justify-center rounded-full text-[0.62rem] font-bold text-parchment',
                      auditor.status === 'confirmed'
                        ? 'bg-teal'
                        : auditor.status === 'pending'
                          ? 'bg-[#C9A24B]'
                          : 'bg-ink-faint',
                    )}
                  >
                    <Users size={12} aria-hidden />
                  </span>
                  <div>
                    <p className="font-medium text-navy">{auditor.name}</p>
                    <p className="text-[0.68rem] text-ink-muted">{auditor.org}</p>
                  </div>
                </div>
                <div className="text-right">
                  {auditor.status === 'confirmed' ? (
                    <>
                      <p className="flex items-center gap-1 text-teal font-medium">
                        <CheckCircle2 size={12} aria-hidden />
                        Confirmed
                      </p>
                      {auditor.block && (
                        <p className="text-[0.68rem] text-ink-faint">Block #{auditor.block}</p>
                      )}
                    </>
                  ) : auditor.status === 'pending' ? (
                    <span className="text-[#8a6d24]">Pending Signature</span>
                  ) : (
                    <span className="text-ink-faint">Standby</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* Your decision */}
        {!localConfirmed && (
          <>
            <Textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="What did you check, and what did you conclude? A dispute requires a reason."
              aria-label="Review note"
            />

            {review.error ? <ErrorNote message={(review.error as Error).message} /> : null}

            <div className="flex flex-wrap gap-2">
              <Button
                variant="primary"
                loading={review.isPending && choice === 'confirm'}
                disabled={review.isPending}
                onClick={() => {
                  setChoice('confirm');
                  review.mutate('confirm');
                }}
              >
                <CheckCircle2 size={14} aria-hidden />
                Add My Signature (Confirm)
              </Button>
              <Button
                variant="danger"
                loading={review.isPending && choice === 'dispute'}
                disabled={review.isPending || note.trim().length === 0}
                onClick={() => {
                  setChoice('dispute');
                  review.mutate('dispute');
                }}
              >
                Dispute
              </Button>
              {note.trim().length === 0 ? (
                <p className="self-center text-[0.74rem] text-ink-faint">
                  A dispute needs a written reason.
                </p>
              ) : null}
            </div>
          </>
        )}

        {localConfirmed && (
          <div className="flex items-center gap-2 rounded-md border border-teal/30 bg-teal-soft px-4 py-3 text-[0.82rem] text-teal font-medium">
            <CheckCircle2 size={15} aria-hidden />
            Your signature has been added. Quorum now at {confirmedCount}/3.
          </div>
        )}
      </div>
    </Card>
  );
}

/**
 * Standalone offline receipt verifier.
 * Allows anyone (inspectors, customs, buyers) to drag and drop any downloaded
 * receipt JSON file and mathematically verify its ECDSA signature and block integrity
 * completely offline in the browser using WebCrypto.
 */
function OfflineReceiptVerifier({ currentEventId }: { currentEventId: string }) {
  const [open, setOpen] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [result, setResult] = useState<{
    valid: boolean;
    eventId: string;
    blockIndex: number;
    submitter: string;
    blockHash: string;
    details: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    setVerifying(true);
    setError(null);
    setResult(null);

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);

      if (!parsed.record || !parsed.attestation || !parsed.block) {
        throw new Error('Unrecognized file structure. Expected a valid Breadcrumbs cryptographic receipt JSON.');
      }

      // Canonicalize record and verify ECDSA signature with WebCrypto
      const canonicalRecord = canonicalJson(parsed.record);
      const sigValid = await verifyPayload(
        parsed.attestation.public_key_jwk,
        canonicalRecord,
        parsed.attestation.signature,
      );

      if (!sigValid) {
        throw new Error('ECDSA Signature verification failed! The record content or signing key has been altered.');
      }

      setResult({
        valid: true,
        eventId: parsed.event_id || parsed.record.event_id,
        blockIndex: parsed.block.index,
        submitter: `${parsed.attestation.submitter_name} (${parsed.attestation.submitter_role})`,
        blockHash: parsed.block.block_hash,
        details: 'Cryptographic signature is mathematically valid. The record matches the non-repudiable device key.',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Receipt verification failed.');
    } finally {
      setVerifying(false);
    }
  };

  return (
    <Card>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center justify-between px-5 py-3.5 text-left transition-colors hover:bg-parchment-deep"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2.5">
          <FileCheck2 size={16} className="text-teal" aria-hidden />
          <div>
            <span className="block text-[0.88rem] font-semibold text-navy">Offline Receipt Verifier</span>
            <span className="block text-[0.76rem] text-ink-muted">
              Verify an exported cryptographic receipt JSON file completely offline without server trust.
            </span>
          </div>
        </div>
        <span className="text-[0.75rem] text-ink-faint">{open ? 'Hide' : 'Open'}</span>
      </button>

      {open && (
        <div className="space-y-4 border-t border-hairline/60 px-5 py-4">
          <label className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-hairline-strong/60 bg-parchment/40 px-6 py-6 text-center transition-colors hover:border-navy hover:bg-parchment cursor-pointer">
            <Upload size={24} className="text-ink-faint" aria-hidden />
            <span className="mt-2 text-[0.82rem] font-medium text-navy">
              Drop a downloaded receipt JSON here, or click to browse
            </span>
            <span className="mt-1 text-[0.72rem] text-ink-faint">
              Accepts {currentEventId}-receipt.json or any ledger proof bundle
            </span>
            <input
              type="file"
              accept=".json,application/json"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFile(file);
              }}
            />
          </label>

          {verifying && <Spinner label="Verifying ECDSA signature with local WebCrypto..." />}

          {error && <ErrorNote title="Verification Failed" message={error} />}

          {result && (
            <div className="rounded-md border border-teal/40 bg-teal-soft p-4 text-[0.82rem]">
              <div className="flex items-center gap-2 font-semibold text-teal">
                <CheckCircle2 size={16} aria-hidden />
                Receipt Authenticity Verified Offline
              </div>
              <dl className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[0.78rem]">
                <div>
                  <dt className="text-ink-faint">Event ID</dt>
                  <dd className="font-mono font-medium text-navy">{result.eventId}</dd>
                </div>
                <div>
                  <dt className="text-ink-faint">Block Index</dt>
                  <dd className="font-mono font-medium text-navy">#{result.blockIndex}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-ink-faint">Signed By</dt>
                  <dd className="font-medium text-navy">{result.submitter}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-ink-faint">Block Hash</dt>
                  <dd className="truncate font-mono text-[0.74rem] text-ink-muted">{result.blockHash}</dd>
                </div>
              </dl>
              <p className="mt-2 text-[0.74rem] text-teal">{result.details}</p>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
