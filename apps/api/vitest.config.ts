import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // The seeded fixture builds a real 165-block chain with real ECDSA signatures,
    // so give the setup room rather than flaking on a slow machine.
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
