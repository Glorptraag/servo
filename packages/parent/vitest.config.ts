import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

// Two projects, as in packages/app:
// - `unit` runs in Node, on fake-indexeddb: the accounts model and the package contracts.
// - `browser` runs the parent view in headless Chromium on its real IndexedDB and localStorage.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['test/**/*.test.{ts,tsx}'],
          exclude: ['test/browser/**'],
          environment: 'node',
        },
      },
      {
        // The two-page test loads the child's app in a frame; optimising its dependencies up front keeps Vite from
        // reloading the page mid-test. The canvas renders on SwiftShader, as in packages/app.
        optimizeDeps: {
          // Every third-party package the app reaches: rapier, through sim-core, was found late and reloaded a page in CI.
          include: [
            'react',
            'react/jsx-runtime',
            'react/jsx-dev-runtime',
            'react-dom',
            'react-dom/client',
            '@servo/app > dexie',
            '@servo/app > @servo/canvas > pixi.js',
            '@servo/app > @servo/sim-core > @dimforge/rapier2d-deterministic-compat',
          ],
        },
        test: {
          name: 'browser',
          include: ['test/browser/**/*.test.{ts,tsx}'],
          testTimeout: 60_000,
          // At load 200–350 beside many agents' browsers, starting the browser and a hook that mounts a page take
          // minutes, past Vitest's 60 s connect and 10 s hook defaults.
          hookTimeout: 300_000,
          browser: {
            enabled: true,
            headless: true,
            connectTimeout: 300_000,
            provider: playwright({
              launchOptions: { channel: 'chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
              contextOptions: { viewport: { width: 1180, height: 820 } },
            }),
            viewport: { width: 1180, height: 820 },
            instances: [{ browser: 'chromium' }],
            screenshotFailures: false,
          },
        },
      },
    ],
  },
});
