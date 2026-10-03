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
        optimizeDeps: { include: ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom', 'react-dom/client'] },
        test: {
          name: 'browser',
          include: ['test/browser/**/*.test.{ts,tsx}'],
          testTimeout: 60_000,
          browser: {
            enabled: true,
            headless: true,
            provider: playwright({ launchOptions: { channel: 'chromium' } }),
            instances: [{ browser: 'chromium' }],
            screenshotFailures: false,
          },
        },
      },
    ],
  },
});
