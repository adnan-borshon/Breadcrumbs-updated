/** The trust layer: canonicalisation, hashing, linking, signatures, and the tamper cascade. */

import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  buildBlock,
  buildGenesisBlock,
  canonicalJson,
  computeBlockHash,
  exportPublicJwk,
  generateKeyPair,
  GENESIS_PREV_HASH,
  recordPayload,
  sha256Hex,
  signRecord,
  verifyChain,
  verifyPayload,
} from '@breadcrumbs/shared';
import type { Block, SignedRecord } from '@breadcrumbs/shared';

import { getAllBlocks, verifyLedger } from '../src/chain/ledger.ts';
import { getDb } from '../src/db/client.ts';
import { blocks } from '../src/db/schema.ts';
import { seededLedger } from './helpers.ts';

describe('canonicalJson', () => {
  it('is independent of key insertion order', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
    expect(canonicalJson({ z: { y: 1, x: 2 } })).toBe(canonicalJson({ z: { x: 2, y: 1 } }));
  });

  it('preserves array order, which is meaningful', () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });

  it('survives a JSON round trip unchanged', () => {
    const value = { total: 1200, lines: [{ q: 2, d: 'x' }], nested: { b: null, a: true } };
    expect(canonicalJson(JSON.parse(JSON.stringify(value)))).toBe(canonicalJson(value));
  });

  it('refuses values that cannot be hashed deterministically', () => {
    expect(() => canonicalJson({ x: Number.NaN })).toThrow();
    expect(() => canonicalJson({ x: 1n })).toThrow();
  });
});

describe('hashing', () => {
  it('produces the documented SHA-256 for a known input', async () => {
    // Independently checkable: sha256("abc")
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('changes completely when one character of the input changes', async () => {
    const a = await sha256Hex('500 units');
    const b = await sha256Hex('5000 units');
    expect(a).not.toBe(b);
    // Avalanche: essentially none of the hex characters should coincide by position.
    const shared = [...a].filter((ch, i) => ch === b[i]).length;
    expect(shared).toBeLessThan(20);
  });
});

function sampleRecord(dataFields: Record<string, unknown>): SignedRecord {
  return {
    event_id: 'E1',
    factory_id: 'FAC-TEST',
    event_type: 'production_report',
    timestamp: '2026-01-01T00:00:00.000Z',
    submitter_id: 'u1',
    submitter_name: 'Test User',
    submitter_role: 'factory',
    data_fields: dataFields,
    ref_id: null,
  };
}

describe('signatures', () => {
  it('verifies a genuine signature and rejects one from another key', async () => {
    const mine = await generateKeyPair(true);
    const theirs = await generateKeyPair(true);
    const jwk = await exportPublicJwk(mine.publicKey);

    const record = sampleRecord({ units_produced: 500 });
    const payload = recordPayload(record);

    const good = await signRecord(record, mine.privateKey);
    const forged = await signRecord(record, theirs.privateKey);

    expect(await verifyPayload(jwk, payload, good)).toBe(true);
    expect(await verifyPayload(jwk, payload, forged)).toBe(false);
  });

  it('fails when the signed content is altered afterwards', async () => {
    const pair = await generateKeyPair(true);
    const jwk = await exportPublicJwk(pair.publicKey);

    const record = sampleRecord({ units_produced: 500 });
    const signature = await signRecord(record, pair.privateKey);

    // The classic case from the brief: 500 units quietly becomes 5000.
    const altered = sampleRecord({ units_produced: 5000 });
    expect(await verifyPayload(jwk, recordPayload(record), signature)).toBe(true);
    expect(await verifyPayload(jwk, recordPayload(altered), signature)).toBe(false);
  });
});

describe('the seeded chain', () => {
  beforeAll(async () => {
    await seededLedger();
  });

  it('verifies clean end to end', async () => {
    const report = await verifyLedger();
    expect(report.ok).toBe(true);
    expect(report.firstBreakIndex).toBeNull();
    expect(report.brokenCount).toBe(0);
    expect(report.height).toBeGreaterThan(100);
  });

  it('stores hashes that recompute from the block contents', async () => {
    const all = await getAllBlocks();
    for (const block of all.slice(0, 25)) {
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
      expect(recomputed).toBe(block.block_hash);
    }
  });

  it('links every block to its predecessor', async () => {
    const all = await getAllBlocks();
    expect(all[0]!.previous_block_hash).toBe(GENESIS_PREV_HASH);
    for (let i = 1; i < all.length; i += 1) {
      expect(all[i]!.previous_block_hash).toBe(all[i - 1]!.block_hash);
    }
  });

  it('carries a verifiable signature on every non-genesis block', async () => {
    const all = await getAllBlocks();
    expect(all[0]!.signature).toBeNull();
    for (const block of all.slice(1, 20)) {
      expect(block.signature).not.toBeNull();
      expect(
        await verifyPayload(block.submitter_public_key!, recordPayload(block.record), block.signature!),
      ).toBe(true);
    }
  });
});

describe('tampering', () => {
  beforeAll(async () => {
    await seededLedger();
  });

  it('is detected at the altered block and invalidates everything after it', async () => {
    const db = getDb();
    const before = await verifyLedger();
    expect(before.ok).toBe(true);

    const target = 40;
    const [row] = await db.select().from(blocks).where(eq(blocks.blockIndex, target));
    const record = JSON.parse(row!.recordJson) as SignedRecord;

    // Rewrite the data and leave the stored hash alone — what an attacker with
    // database access would actually do.
    const tampered: SignedRecord = {
      ...record,
      data_fields: { ...record.data_fields, quantity: 999_999 },
    };
    await db
      .update(blocks)
      .set({ recordJson: canonicalJson(tampered) })
      .where(eq(blocks.blockIndex, target));

    const after = await verifyLedger();

    expect(after.ok).toBe(false);
    expect(after.firstBreakIndex).toBe(target);

    const broken = after.blocks.find((b) => b.index === target)!;
    expect(broken.hashValid).toBe(false);
    // The signature no longer covers the record either.
    expect(broken.signatureValid).toBe(false);

    // The cascade: every later block is invalidated even though its own hash is intact.
    const later = after.blocks.filter((b) => b.index > target);
    expect(later.length).toBeGreaterThan(0);
    expect(later.every((b) => b.invalidatedByEarlierBreak)).toBe(true);

    // Blocks before the break are untouched.
    expect(after.blocks.filter((b) => b.index < target).every((b) => !b.invalidatedByEarlierBreak)).toBe(true);
  });

  it('detects a re-pointed previous hash even when the block itself hashes correctly', async () => {
    const t = '2026-01-01T00:00:00.000Z';
    const genesis = await buildGenesisBlock(t);

    const pair = await generateKeyPair(true);
    const jwk = await exportPublicJwk(pair.publicKey);

    const makeSigned = async (index: number, previous: string, eventId: string): Promise<Block> => {
      const record: SignedRecord = {
        event_id: eventId,
        factory_id: 'F',
        event_type: 'inspection',
        timestamp: t,
        submitter_id: 'u',
        submitter_name: 'U',
        submitter_role: 'factory',
        data_fields: { inspection_type: 'x', workers_present: 1, working_hours: 1, non_conformities: 0, passed: true, findings: '' },
        ref_id: null,
      };
      return buildBlock({
        index,
        previous_block_hash: previous,
        record,
        submitter_public_key: jwk,
        signature: await signRecord(record, pair.privateKey),
        ai_flag: false,
        ai_score: null,
        ai_flag_reason: null,
        ai_rule: null,
        timestamp: t,
      });
    };

    const b1 = await makeSigned(1, genesis.block_hash, 'X1');
    const good = await verifyChain([genesis, b1]);
    expect(good.ok).toBe(true);

    // Rebuilt against a predecessor that isn't there. Its own hash recomputes
    // perfectly — it is the link, and only the link, that is wrong.
    const orphan = await makeSigned(1, 'f'.repeat(64), 'X1');
    const bad = await verifyChain([genesis, orphan]);

    expect(bad.blocks[1]!.hashValid).toBe(true);
    expect(bad.blocks[1]!.signatureValid).toBe(true);
    expect(bad.blocks[1]!.linkValid).toBe(false);
    expect(bad.ok).toBe(false);
    expect(bad.firstBreakIndex).toBe(1);
  });
});
