// Gate G3's page test: `pnpm gate:g3:test` at the repo root (after `pnpm art`), or `pnpm --filter @servo/tools
// e2e:gate-g3`. It runs in Node: it serves the page with the page's own Vite config, as `pnpm gate:g3` does, and
// drives it in Playwright's Chromium on SwiftShader in the iPad profile. Named .gate.ts, not .e2e.ts or .test.ts, so
// neither `pnpm e2e` nor `pnpm test` runs it: the page is a dev-only aid for the gate, not a CI check.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  root,
  test: {
    root,
    include: ['test/e2e/gate-g3.gate.ts'],
    // Generous: a software GPU on a busy machine takes its time over every gesture.
    testTimeout: 600_000,
    hookTimeout: 300_000,
  },
});
