import { describe, expect, it } from 'vitest';
import {
  computeMerkleRoot,
  getMerkleProof,
  verifyMerkleProof,
  DEFAULT_CHAIN_ID,
  sha256Hex,
} from '@breadcrumbs/shared';
import type { SignedRecord } from '@breadcrumbs/shared';
import { commit, getNextNonce, getHead } from '../src/chain/ledger.ts';
import { notarizeChainHead, listCheckpoints, getConsortiumTelemetry } from '../src/chain/notarization.ts';
import { emptyLedger, makeFactory, makeSigner, buildRecord, sign } from './helpers.ts';

describe('Merkle Root and Proofs', () => {
  it('computes deterministic root for empty and single-element inputs', async () => {
    const emptyRoot = await computeMerkleRoot([]);
    expect(emptyRoot).toHaveLength(64);

    const h1 = await sha256Hex('block_0');
    const singleRoot = await computeMerkleRoot([h1]);
    expect(singleRoot).toHaveLength(64);
    expect(singleRoot).toBe(h1);
  });

  it('generates valid Merkle proofs that verify against the computed root', async () => {
    const leaves = await Promise.all([
      sha256Hex('leaf_A'),
      sha256Hex('leaf_B'),
      sha256Hex('leaf_C'),
      sha256Hex('leaf_D'),
      sha256Hex('leaf_E'),
    ]);
    const root = await computeMerkleRoot(leaves);

    for (let i = 0; i < leaves.length; i++) {
      const proof = await getMerkleProof(leaves, i);
      const isValid = await verifyMerkleProof(leaves[i]!, proof, root);
      expect(isValid).toBe(true);

      // Tampered leaf should fail proof verification
      const isTamperedValid = await verifyMerkleProof('f'.repeat(64), proof, root);
      expect(isTamperedValid).toBe(false);
    }
  });
});

describe('Notarization and Consortium Telemetry', () => {
  it('notarizes chain head and produces verifiable Polygon Amoy checkpoint', async () => {
    await emptyLedger();

    const checkpoint = await notarizeChainHead();
    expect(checkpoint.network).toContain('Polygon Amoy');
    expect(checkpoint.merkle_root).toHaveLength(64);
    expect(checkpoint.tx_hash).toMatch(/^0x[a-f0-9]{64}$/);
    expect(checkpoint.explorer_url).toContain(checkpoint.tx_hash);

    const history = await listCheckpoints();
    expect(history.length).toBeGreaterThan(0);
    expect(history[0]?.checkpoint_id).toBe(checkpoint.checkpoint_id);
  });

  it('provides consortium telemetry with active validators and consensus state', async () => {
    await emptyLedger();
    const telemetry = await getConsortiumTelemetry();

    expect(telemetry.local_node.chain_id).toBe(DEFAULT_CHAIN_ID);
    expect(telemetry.consensus.protocol).toContain('Federated');
    expect(telemetry.consensus.validators_online).toBeGreaterThanOrEqual(2);
    expect(telemetry.peers.length).toBe(3);
    expect(telemetry.latest_checkpoint).toBeDefined();
  });
});

describe('Chain-Binding & Anti-Replay Protection', () => {
  it('rejects records with invalid chain_id or replayed nonce', async () => {
    await emptyLedger();
    await makeFactory('FAC-A', 'Factory A');
    const factoryUser = await makeSigner('u-fac', 'Amina Rahman', 'factory', 'FAC-A');

    const head = await getHead();
    const headHash = head?.block_hash ?? '0'.repeat(64);
    const currentNonce = await getNextNonce(factoryUser.actor.id);

    const validProdFields = {
      order_ref: 'PO-100',
      units_produced: 100,
      working_hours: 8,
      line_count: 2,
      defect_count: 0,
    };

    // 1. Wrong chain_id
    const wrongChainRecord: SignedRecord = buildRecord(
      factoryUser,
      'production_report',
      'FAC-A',
      validProdFields,
      {
        chain_id: 'arbitrary-rogue-chain',
        previous_block_hash: headHash,
        nonce: currentNonce,
      },
    );

    await expect(
      commit({
        record: wrongChainRecord,
        signature: await sign(wrongChainRecord, factoryUser),
        keyFingerprint: factoryUser.fingerprint,
        actor: factoryUser.actor,
      }),
    ).rejects.toMatchObject({
      status: 400,
      code: 'wrong_chain_id',
    });

    // 2. Out-of-order nonce
    const badNonceRecord: SignedRecord = buildRecord(
      factoryUser,
      'production_report',
      'FAC-A',
      validProdFields,
      {
        chain_id: DEFAULT_CHAIN_ID,
        previous_block_hash: headHash,
        nonce: currentNonce + 10,
      },
    );

    await expect(
      commit({
        record: badNonceRecord,
        signature: await sign(badNonceRecord, factoryUser),
        keyFingerprint: factoryUser.fingerprint,
        actor: factoryUser.actor,
      }),
    ).rejects.toMatchObject({
      status: 400,
      code: 'invalid_nonce',
    });

    // 3. Stale previous_block_hash
    const staleHashRecord: SignedRecord = buildRecord(
      factoryUser,
      'production_report',
      'FAC-A',
      validProdFields,
      {
        chain_id: DEFAULT_CHAIN_ID,
        previous_block_hash: '0'.repeat(64),
        nonce: currentNonce,
      },
    );

    await expect(
      commit({
        record: staleHashRecord,
        signature: await sign(staleHashRecord, factoryUser),
        keyFingerprint: factoryUser.fingerprint,
        actor: factoryUser.actor,
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: 'stale_block_anchor',
    });

    // 4. Valid record with correct chain_id, nonce, and head hash succeeds
    const validRecord: SignedRecord = buildRecord(
      factoryUser,
      'production_report',
      'FAC-A',
      validProdFields,
      {
        chain_id: DEFAULT_CHAIN_ID,
        previous_block_hash: headHash,
        nonce: currentNonce,
      },
    );

    const result = await commit({
      record: validRecord,
      signature: await sign(validRecord, factoryUser),
      keyFingerprint: factoryUser.fingerprint,
      actor: factoryUser.actor,
    });
    expect(result.block.record.nonce).toBe(currentNonce);
    expect(result.block.record.chain_id).toBe(DEFAULT_CHAIN_ID);
    expect(result.block.previous_block_hash).toBe(headHash);
  });
});
