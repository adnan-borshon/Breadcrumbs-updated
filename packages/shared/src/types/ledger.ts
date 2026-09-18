/**
 * The ledger data model.
 *
 * A note on the split between `SignedRecord` and `Block`:
 *
 * The submitter signs only what they *assert* — the record. The AI verdict is computed
 * by the system after the signature arrives, so it cannot live inside the signed payload
 * (the client would have to sign something it cannot know). It is instead folded into the
 * block hash, which means the verdict is just as immutable as the record itself: nobody
 * can retroactively erase a flag without breaking the chain.
 */

import type { EventFamily, EventType, SubmitterRole } from './roles.ts';

export const DEFAULT_CHAIN_ID = 'breadcrumbs-garments-v1';

/** What the client signs. Anchored to the chain to prevent replay and reordering attacks. */
export interface SignedRecord {
  /** Target consortium chain/network identifier (cross-chain replay protection) */
  chain_id?: string;
  /** Cryptographic anchor linking the transaction to the current head block */
  previous_block_hash?: string;
  /** Submitter sequential transaction nonce for replay and ordering protection */
  nonce?: number;
  event_id: string;
  factory_id: string;
  event_type: EventType;
  /** ISO-8601, asserted by the submitter. */
  timestamp: string;
  submitter_id: string;
  submitter_name: string;
  submitter_role: SubmitterRole;
  /** Shape varies by event_type — validated by the zod schema for that type. */
  data_fields: Record<string, unknown>;
  /** The entity this event acts on: a contract id, invoice id, or another event_id. */
  ref_id: string | null;
}

/** A committed block. Append-only — no field is ever updated after commit. */
export interface Block {
  index: number;
  /** ISO-8601, set by the server at commit time. */
  timestamp: string;
  previous_block_hash: string;
  block_hash: string;
  record: SignedRecord;
  /** The submitter's public key, as registered. Genesis carries null. */
  submitter_public_key: JsonWebKey | null;
  /** base64url ECDSA P-256 signature over canonicalJson(record). Genesis carries null. */
  signature: string | null;
  ai_flag: boolean;
  ai_score: number | null;
  ai_flag_reason: string | null;
  ai_rule: string | null;
}

/** Everything that goes into the block hash, in the order the type declares. */
export interface BlockHashInput {
  index: number;
  timestamp: string;
  previous_block_hash: string;
  record: SignedRecord;
  submitter_public_key: JsonWebKey | null;
  signature: string | null;
  ai_flag: boolean;
  ai_score: number | null;
  ai_flag_reason: string | null;
  ai_rule: string | null;
}

export type ReviewStatus = 'none' | 'confirmed' | 'disputed';

export type RecordStatus = 'pending' | 'verified' | 'flagged' | 'disputed';

/**
 * The flattened read model the API returns and every page renders.
 * Field names follow the source spec verbatim so all pages agree.
 */
export interface LedgerRecord {
  event_id: string;
  factory_id: string;
  factory_name: string;
  event_type: EventType;
  event_family: EventFamily;
  timestamp: string;
  submitter_id: string;
  submitter_name: string;
  submitter_role: SubmitterRole;
  data_fields: Record<string, unknown>;
  ref_id: string | null;

  ai_flag: boolean;
  ai_flag_reason: string | null;
  ai_score: number | null;
  ai_rule: string | null;

  human_review_status: ReviewStatus;
  reviewer_name: string | null;
  reviewed_at: string | null;
  review_note: string | null;

  block_index: number;
  block_hash: string;
  previous_block_hash: string;
  signature: string | null;

  /** Derived — never stored. See deriveStatus(). */
  status: RecordStatus;
}

/**
 * The single place status is computed, so no page can drift from another.
 *
 * `pending` means committed and AI-clean but not yet countersigned by an auditor;
 * `verified` means an auditor confirmed it. Review outcomes arrive as their own
 * governance blocks, so this reads later chain events rather than a mutable column.
 */
export function deriveStatus(input: {
  ai_flag: boolean;
  human_review_status: ReviewStatus;
}): RecordStatus {
  if (input.human_review_status === 'confirmed') return 'verified';
  if (input.human_review_status === 'disputed') return 'disputed';
  if (input.ai_flag) return 'flagged';
  return 'pending';
}

export const STATUS_LABEL: Record<RecordStatus, string> = {
  pending: 'Pending',
  verified: 'Verified',
  flagged: 'Flagged',
  disputed: 'Disputed',
};

/** Per-block verification outcome. */
export interface BlockCheck {
  index: number;
  block_hash: string;
  /** Recomputed hash matches the stored hash. */
  hashValid: boolean;
  /** previous_block_hash matches the prior block's stored hash. */
  linkValid: boolean;
  /** ECDSA signature verifies against the submitter's public key. */
  signatureValid: boolean;
  /**
   * True when an earlier block broke. This is the cascade: editing old history
   * doesn't just invalidate the block you touched, it invalidates everything after it.
   */
  invalidatedByEarlierBreak: boolean;
}

export interface ChainReport {
  ok: boolean;
  checkedAt: string;
  height: number;
  blocks: BlockCheck[];
  /** Index of the first block that failed any check, or null on a clean chain. */
  firstBreakIndex: number | null;
  brokenCount: number;
}

export const GENESIS_PREV_HASH = '0'.repeat(64);

/**
 * Public blockchain notarization checkpoint (e.g. Polygon Amoy / Ethereum Sepolia).
 * Defeats the "single centralized database" attack by anchoring state roots to a public L1/L2.
 */
export interface ChainCheckpoint {
  checkpoint_id: string;
  block_height: number;
  block_hash: string;
  merkle_root: string;
  notarized_at: string;
  network: string;
  tx_hash: string;
  explorer_url: string;
  status: 'confirmed' | 'pending';
}

/** Telemetry from federated consortium nodes. */
export interface ConsortiumPeer {
  id: string;
  label: string;
  org: string;
  city: string;
  role: 'Validator' | 'Observer';
  height: number;
  status: 'active' | 'syncing' | 'standby';
  latency_ms: number;
  last_block_hash: string;
}

export interface NetworkTelemetry {
  local_node: {
    id: string;
    role: string;
    height: number;
    head_hash: string;
    chain_id: string;
  };
  consensus: {
    protocol: string;
    validators_online: number;
    total_validators: number;
    epoch: number;
    finalized_height: number;
  };
  peers: ConsortiumPeer[];
  latest_checkpoint: ChainCheckpoint | null;
}

