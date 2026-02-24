import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 300000, // 5 minutes - ICRC85 tests advance time by months
    hookTimeout: 120000, // 2 minutes for hooks - some tests have complex setup
    // Run tests sequentially and in single thread to avoid PocketIC conflicts
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    // Run test files sequentially
    fileParallelism: false,
  },
});
