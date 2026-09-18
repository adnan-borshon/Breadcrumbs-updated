/**
 * Deterministic Merkle tree calculation and inclusion proof verification.
 *
 * Used for public blockchain notarization checkpoints and light-client proofs.
 */

import { sha256Hex } from './crypto.ts';

export async function computeMerkleRoot(leafHashes: string[]): Promise<string> {
  if (leafHashes.length === 0) return '0'.repeat(64);
  let currentLevel = [...leafHashes];

  while (currentLevel.length > 1) {
    const nextLevel: string[] = [];
    for (let i = 0; i < currentLevel.length; i += 2) {
      const left = currentLevel[i]!;
      const right = i + 1 < currentLevel.length ? currentLevel[i + 1]! : left;
      const combined = await sha256Hex(left + right);
      nextLevel.push(combined);
    }
    currentLevel = nextLevel;
  }

  return currentLevel[0]!;
}

export interface MerkleProofStep {
  position: 'left' | 'right';
  hash: string;
}

export async function getMerkleProof(
  leafHashes: string[],
  leafIndex: number,
): Promise<MerkleProofStep[]> {
  if (leafIndex < 0 || leafIndex >= leafHashes.length) return [];
  const proof: MerkleProofStep[] = [];
  let currentLevel = [...leafHashes];
  let index = leafIndex;

  while (currentLevel.length > 1) {
    const isRightNode = index % 2 === 1;
    const siblingIndex = isRightNode ? index - 1 : index + 1;

    if (siblingIndex < currentLevel.length) {
      proof.push({
        position: isRightNode ? 'left' : 'right',
        hash: currentLevel[siblingIndex]!,
      });
    } else {
      proof.push({
        position: 'right',
        hash: currentLevel[index]!,
      });
    }

    const nextLevel: string[] = [];
    for (let i = 0; i < currentLevel.length; i += 2) {
      const left = currentLevel[i]!;
      const right = i + 1 < currentLevel.length ? currentLevel[i + 1]! : left;
      const combined = await sha256Hex(left + right);
      nextLevel.push(combined);
    }

    currentLevel = nextLevel;
    index = Math.floor(index / 2);
  }

  return proof;
}

export async function verifyMerkleProof(
  leafHash: string,
  proof: MerkleProofStep[],
  expectedRoot: string,
): Promise<boolean> {
  let computed = leafHash;
  for (const step of proof) {
    if (step.position === 'left') {
      computed = await sha256Hex(step.hash + computed);
    } else {
      computed = await sha256Hex(computed + step.hash);
    }
  }
  return computed === expectedRoot;
}
