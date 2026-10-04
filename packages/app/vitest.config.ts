import { playwright } from '@vitest/browser-playwright';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { sidePageCommands } from './test/browser/side-page.ts';

// Two projects (docs/shell.md, "Tests"):
// - `unit` runs in Node: the layout maths, the tuck states' storage, the zoom ladder and the package contracts.
// - `browser` runs in headless Chromium. The layout tests open the real app page (index.html) in frames the size of
//   each target screen and reload them, so the viewport, the canvas and the reload are the real ones. The canvas
//   renders on SwiftShader, the same software GPU on every machine, as in packages/canvas.
// The test page is the size of the canvas package's iPad profile. Headless Chromium stops drawing frames for a much
// larger one, so the frames for bigger screens are scaled down to fit it (test/browser/frame.ts).
const VIEWPORT = { width: 1180, height: 820 };

/**
 * Vitest's browser mode rewrites every dynamic `import()` the dev server serves into a call on the tester page's
 * `__vitest_browser_runner__`. The app's own pages that tests open in frames (index.html, the test pages) have no such
 * runner, so the run loop's import of sim-core at the first Run (D11, docs/perf.md) would throw there. This gives each
 * served page the plain stand-in Vitest itself gives workers; the tester page sets its own runner after it.
 */
const dynamicImportsInFrames = (): Plugin => ({
  name: 'servo:dynamic-imports-in-frames',
  transformIndexHtml: () => [
    { tag: 'script', children: 'globalThis.__vitest_browser_runner__ ??= { wrapDynamicImport: (load) => load() };', injectTo: 'head-prepend' },
  ],
});

export default defineConfig({
  test: {
    attachmentsDir: 'node_modules/.vitest/attachments',
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
        plugins: [dynamicImportsInFrames()],
        // The app page loads these in a frame; optimising them up front keeps Vite from reloading the page mid-test.
        optimizeDeps: {
          // Every third-party package the app reaches: one found late (rapier, through sim-core) reloads a running page.
          include: [
            'react',
            'react/jsx-runtime',
            'react/jsx-dev-runtime',
            'react-dom',
            'react-dom/client',
            'dexie',
            'axe-core',
            '@servo/canvas > pixi.js',
            '@servo/sim-core > @dimforge/rapier2d-deterministic-compat',
          ],
        },
        test: {
          name: 'browser',
          include: ['test/browser/**/*.test.{ts,tsx}'],
          testTimeout: 120_000,
          // At load 200–350 beside many agents' browsers, starting the browser and a hook that mounts the app take
          // minutes, past Vitest's 60 s connect and 10 s hook defaults.
          hookTimeout: 300_000,
          browser: {
            enabled: true,
            headless: true,
            connectTimeout: 300_000,
            provider: playwright({
              launchOptions: { channel: 'chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
              contextOptions: { viewport: VIEWPORT },
            }),
            instances: [{ browser: 'chromium' }],
            viewport: VIEWPORT,
            screenshotFailures: false,
            // A page in a browser context of its own, which the offline and sync tests take offline (task 5.5).
            commands: sidePageCommands,
          },
        },
      },
    ],
  },
});
