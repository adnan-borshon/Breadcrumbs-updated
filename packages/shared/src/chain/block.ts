/**
 * Block construction and hashing.
 *
 * A block's hash covers the record, the submitter's public key, their signature, *and*
 * the AI verdict. Folding the verdict in means a flag cannot be quietly erased later —
 * removing it would change the hash and break every block after it.
 */

import { canonicalJson } from './canonical.ts';
import { sha256Hex, signPayload } from './crypto.ts';
import { DEFAULT_CHAIN_ID, GENESIS_PREV_HASH } from '../types/ledger.ts';
import type { Block, BlockHashInput, SignedRecord } from '../types/ledger.ts';

/**
 * The exact bytes a submitter signs. Only the record — never the AI verdict, which the
 * submitter cannot know at signing time, and never the block position, which the server
 * assigns.
 */
export function recordPayload(record: SignedRecord): string {
  return canonicalJson(record);
}

/** The exact bytes that get hashed into `block_hash`. */
export function blockPayload(input: BlockHashInput): string {
  return canonicalJson({
    index: input.index,
    timestamp: input.timestamp,
    previous_block_hash: input.previous_block_hash,
    record: input.record,
    submitter_public_key: input.submitter_public_key,
    signature: input.signature,
    ai_flag: input.ai_flag,
    ai_score: input.ai_score,
    ai_flag_reason: input.ai_flag_reason,
    ai_rule: input.ai_rule,
  });
}

export async function computeBlockHash(input: BlockHashInput): Promise<string> {
  return sha256Hex(blockPayload(input));
}

/** Signs a record with a private key. Used by the browser and by the seeder. */
export async function signRecord(record: SignedRecord, privateKey: CryptoKey): Promise<string> {
  return signPayload(privateKey, recordPayload(record));
}

export interface BuildBlockInput {
  index: number;
  previous_block_hash: string;
  record: SignedRecord;
  submitter_public_key: JsonWebKey | null;
  signature: string | null;
  ai_flag: boolean;
  ai_score: number | null;
  ai_flag_reason: string | null;
  ai_rule: string | null;
  /** Commit time. Injectable so the seeder can lay down a realistic 90-day history. */
  timestamp?: string;
}

export async function buildBlock(input: BuildBlockInput): Promise<Block> {
  const hashInput: BlockHashInput = {
    index: input.index,
    timestamp: input.timestamp ?? new Date().toISOString(),
    previous_block_hash: input.previous_block_hash,
    record: input.record,
    submitter_public_key: input.submitter_public_key,
    signature: input.signature,
    ai_flag: input.ai_flag,
    ai_score: input.ai_score,
    ai_flag_reason: input.ai_flag_reason,
    ai_rule: input.ai_rule,
  };

  return { ...hashInput, block_hash: await computeBlockHash(hashInput) };
}

/**
 * The genesis block. Written by the ledger itself, carries no signature, and its
 * event type is not submittable by any role — so a second one cannot be forged.
 */
export async function buildGenesisBlock(timestamp: string): Promise<Block> {
  const record: SignedRecord = {
    chain_id: DEFAULT_CHAIN_ID,
    previous_block_hash: GENESIS_PREV_HASH,
    nonce: 0,
    event_id: 'genesis',
    factory_id: 'system',
    event_type: 'genesis',
    timestamp,
    submitter_id: 'system',
    submitter_name: 'Breadcrumbs Ledger',
    submitter_role: 'system',
    data_fields: {
      note: 'Genesis block — start of the Breadcrumbs permissioned ledger.',
      chain: DEFAULT_CHAIN_ID,
    },
    ref_id: null,
  };

  return buildBlock({
    index: 0,
    previous_block_hash: GENESIS_PREV_HASH,
    record,
    submitter_public_key: null,
    signature: null,
    ai_flag: false,
    ai_score: null,
    ai_flag_reason: null,
    ai_rule: null,
    timestamp,
  });
}

export function isGenesis(block: Pick<Block, 'index'>): boolean {
  return block.index === 0;
}

/** Middle-truncates a hash for display: `a3f5c9e1…7b21e40f`. */
export function shortHash(hash: string, lead = 8, tail = 8): string {
  if (hash.length <= lead + tail + 1) return hash;
  return `${hash.slice(0, lead)}…${hash.slice(-tail)}`;
}
