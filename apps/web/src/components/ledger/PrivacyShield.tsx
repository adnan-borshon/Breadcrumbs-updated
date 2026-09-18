/**
 * PrivacyShield — renders a ZK-proof compliance badge in public/auditor mode,
 * and the real value in authorized mode.
 *
 * Usage:
 *   <PrivacyShield
 *     value={record.data_fields.unit_cost_minor}
 *     zkProof="Verified ≤ PO Ceiling (Proof #zk-7f8a)"
 *     category="commercial"
 *   />
 *
 * In public mode  → [Confidential Commercial Data] — ZK-Proof: Verified ≤ PO Ceiling (Proof #zk-7f8a)
 * In authorized   → $12.40
 */

import { Lock, ShieldCheck } from 'lucide-react';
import { usePrivacy } from '../../store/privacyStore.ts';
import { cx } from '../ui/primitives.tsx';

type ShieldCategory = 'commercial' | 'chemical' | 'quantity' | 'supplier';

const CATEGORY_LABELS: Record<ShieldCategory, string> = {
  commercial: 'Confidential Commercial Data',
  chemical: 'Proprietary Formulation',
  quantity: 'Confidential Volume Data',
  supplier: 'Undisclosed Supplier',
};

interface PrivacyShieldProps {
  /** The actual value to show in authorized mode. */
  value: React.ReactNode;
  /** The ZK-proof summary string for public mode. */
  zkProof: string;
  /** Visual category label shown in public mode. */
  category?: ShieldCategory;
  /** Proof ID (auto-generated deterministically if not supplied). */
  proofId?: string;
  className?: string;
}

export function PrivacyShield({
  value,
  zkProof,
  category = 'commercial',
  proofId,
  className,
}: PrivacyShieldProps) {
  const { viewMode } = usePrivacy();

  if (viewMode === 'authorized') {
    return (
      <span className={cx('inline-flex items-center gap-1.5', className)}>
        <ShieldCheck size={11} className="text-teal shrink-0" aria-hidden />
        {value}
      </span>
    );
  }

  const pid = proofId ?? 'zk-' + Math.abs(String(zkProof).split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 0)).toString(16).slice(0, 8);

  return (
    <span
      className={cx(
        'inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md border border-[#4B3B6A]/30 bg-[#1e1030]/6 px-2 py-0.5 font-mono text-[0.72rem]',
        className,
      )}
      title={`Zero-Knowledge Compliance Proof — authorized parties can view the actual value`}
    >
      <span className="inline-flex items-center gap-1 text-[#5b3fa8] font-medium">
        <Lock size={9} aria-hidden />
        {CATEGORY_LABELS[category]}
      </span>
      <span className="text-ink-faint" aria-hidden>
        —
      </span>
      <span className="inline-flex items-center gap-1 text-teal">
        <ShieldCheck size={9} aria-hidden />
        ZK-Proof: {zkProof}
        <span className="text-ink-faint ml-1">#{pid}</span>
      </span>
    </span>
  );
}

/**
 * A ZK compliance badge with no fallback value — used in public timelines
 * where the field name itself is shown alongside the proof.
 */
export function ZkBadge({
  label,
  proof,
  category = 'commercial',
}: {
  label: string;
  proof: string;
  category?: ShieldCategory;
}) {
  return (
    <div className="mt-2 rounded-md border border-[#4B3B6A]/20 bg-[#1e1030]/5 px-3 py-2">
      <p className="text-[0.68rem] font-semibold uppercase tracking-wide text-[#5b3fa8]">
        {label}
      </p>
      <p className="mt-0.5 inline-flex items-center gap-1.5 text-[0.76rem] text-teal">
        <ShieldCheck size={11} aria-hidden />
        ZK-Proof: {proof}
      </p>
      <p className="mt-0.5 text-[0.68rem] text-ink-faint">
        Authorized consortium members can view the actual {CATEGORY_LABELS[category].toLowerCase()} with a valid session key.
      </p>
    </div>
  );
}
