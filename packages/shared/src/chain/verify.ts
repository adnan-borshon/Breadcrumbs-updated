/**
 * Chain verification.
 *
 * Returns a report rather than a boolean. A boolean tells you the chain is broken; the
 * report tells you *which* block broke, *how* it broke, and everything the break
 * invalidates downstream — which is the actual claim a hash-chain makes.
 */

import { computeBlockHash, isGenesis, recordPayload } from './block.ts';
import { verifyPayload } from './crypto.ts';
import { GENESIS_PREV_HASH } from '../types/ledger.ts';
import type { Block, BlockCheck, ChainReport } from '../types/ledger.ts';

/** Checks one block in isolation, given the block that should precede it. */
export async function verifyBlock(block: Block, previous: Block | null): Promise<BlockCheck> {
  const recomputed = await computeBlockHash({
    index: block.index,
    timestamp: block.timestamp,
    previous_block_hash: block.previous_block_hash,
    record: block.record,
    submitter_public_key: block.submitter_public_key,
    signature: block.signature,
    ai_flag: block.ai_flag,
    ai_score: block.ai_score,
    ai_flag_reason: block.ai_flag_reason,
    ai_rule: block.ai_rule,
  });

  const hashValid = recomputed === block.block_hash;

  const linkValid = isGenesis(block)
    ? block.previous_block_hash === GENESIS_PREV_HASH
    : previous !== null &&
      previous.index === block.index - 1 &&
      block.previous_block_hash === previous.block_hash;

  // Genesis is written by the ledger and carries no signature by design.
  let signatureValid: boolean;
  if (isGenesis(block)) {
    signatureValid = block.signature === null && block.submitter_public_key === null;
  } else if (block.signature === null || block.submitter_public_key === null) {
    // Any non-genesis block without a signature is unattributable, and therefore invalid.
    signatureValid = false;
  } else {
    signatureValid = await verifyPayload(
      block.submitter_public_key,
      recordPayload(block.record),
      block.signature,
    );
  }

  return {
    index: block.index,
    block_hash: block.block_hash,
    hashValid,
    linkValid,
    signatureValid,
    invalidatedByEarlierBreak: false,
  };
}

export function checkPassed(check: BlockCheck): boolean {
  return check.hashValid && check.linkValid && check.signatureValid;
}

/**
 * Walks the whole chain in order.
 *
 * Once a block fails, every later block is marked `invalidatedByEarlierBreak` even if its
 * own hash still recomputes correctly — because the history it is anchored to no longer
 * holds. This is the property the whole design exists to provide.
 */
export async function verifyChain(blocks: Block[]): Promise<ChainReport> {
  const ordered = [...blocks].sort((a, b) => a.index - b.index);
  const checks: BlockCheck[] = [];
  let firstBreakIndex: number | null = null;

  for (let i = 0; i < ordered.length; i += 1) {
    const block = ordered[i]!;
    const previous = i > 0 ? ordered[i - 1]! : null;
    const check = await verifyBlock(block, previous);

    if (firstBreakIndex !== null) {
      check.invalidatedByEarlierBreak = true;
    } else if (!checkPassed(check)) {
      firstBreakIndex = block.index;
    }

    checks.push(check);
  }

  const brokenCount = checks.filter(
    (check) => !checkPassed(check) || check.invalidatedByEarlierBreak,
  ).length;

  return {
    ok: firstBreakIndex === null,
    checkedAt: new Date().toISOString(),
    height: ordered.length,
    blocks: checks,
    firstBreakIndex,
    brokenCount,
  };
}
