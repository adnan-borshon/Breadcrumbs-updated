/** Translation between database rows and the shared chain types. */

import { canonicalJson, EVENT_FAMILY } from '@breadcrumbs/shared';
import type { Block, SignedRecord } from '@breadcrumbs/shared';

export interface BlockRow {
  blockIndex: number;
  timestamp: string;
  previousBlockHash: string;
  blockHash: string;
  recordJson: string;
  publicKeyJson: string | null;
  signature: string | null;
  aiFlag: boolean;
  aiScore: number | null;
  aiFlagReason: string | null;
  aiRule: string | null;
}

export function rowToBlock(row: BlockRow): Block {
  return {
    index: row.blockIndex,
    timestamp: row.timestamp,
    previous_block_hash: row.previousBlockHash,
    block_hash: row.blockHash,
    record: JSON.parse(row.recordJson) as SignedRecord,
    submitter_public_key: row.publicKeyJson
      ? (JSON.parse(row.publicKeyJson) as JsonWebKey)
      : null,
    signature: row.signature,
    ai_flag: row.aiFlag,
    ai_score: row.aiScore,
    ai_flag_reason: row.aiFlagReason,
    ai_rule: row.aiRule,
  };
}

/**
 * Stores the record as canonical JSON — the exact bytes that were signed — so a
 * round-trip through the database cannot alter what the signature covers.
 */
export function blockToRow(block: Block) {
  return {
    blockIndex: block.index,
    timestamp: block.timestamp,
    previousBlockHash: block.previous_block_hash,
    blockHash: block.block_hash,
    recordJson: canonicalJson(block.record),
    publicKeyJson: block.submitter_public_key
      ? canonicalJson(block.submitter_public_key)
      : null,
    signature: block.signature,
    aiFlag: block.ai_flag,
    aiScore: block.ai_score,
    aiFlagReason: block.ai_flag_reason,
    aiRule: block.ai_rule,
    eventId: block.record.event_id,
    eventType: block.record.event_type,
    eventFamily: EVENT_FAMILY[block.record.event_type],
    factoryId: block.record.factory_id,
    submitterId: block.record.submitter_id,
    submitterRole: block.record.submitter_role,
    refId: block.record.ref_id,
  };
}

/* ------------------------------------------------- data_fields accessors */

export function num(fields: Record<string, unknown>, key: string, fallback = 0): number {
  const value = fields[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function str(fields: Record<string, unknown>, key: string, fallback = ''): string {
  const value = fields[key];
  return typeof value === 'string' ? value : fallback;
}

export function strOrNull(fields: Record<string, unknown>, key: string): string | null {
  const value = fields[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function arr<T>(fields: Record<string, unknown>, key: string): T[] {
  const value = fields[key];
  return Array.isArray(value) ? (value as T[]) : [];
}
