import { defineConfig } from 'vitest/config';

// `pnpm perf`: the timing tests (test/**/*.perf.ts), apart from `pnpm test`, whose default config does not pick them
// up. A timing only means something on a quiet machine; CI runs them in a job of their own.
export default defineConfig({
  test: {
    include: ['test/**/*.perf.ts'],
  },
});
