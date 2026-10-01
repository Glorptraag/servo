import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

// Two projects (docs/shell.md, "Tests"):
// - `unit` runs in Node: the layout maths, the tuck states' storage, the zoom ladder and the package contracts.
// - `browser` runs in headless Chromium. The layout tests open the real app page (index.html) in frames the size of
//   each target screen and reload them, so the viewport, the canvas and the reload are the real ones. The canvas
//   renders on SwiftShader, the same software GPU on every machine, as in packages/canvas.
// The test page is the size of the canvas package's iPad profile. Headless Chromium stops drawing frames for a much
// larger one, so the frames for bigger screens are scaled down to fit it (test/browser/frame.ts).
const VIEWPORT = { width: 1180, height: 820 };

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
        // The app page loads these in a frame; optimising them up front keeps Vite from reloading the page mid-test.
        optimizeDeps: {
          include: ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom', 'react-dom/client', '@servo/canvas > pixi.js'],
        },
        test: {
          name: 'browser',
          include: ['test/browser/**/*.test.{ts,tsx}'],
          testTimeout: 120_000,
          browser: {
            enabled: true,
            headless: true,
            provider: playwright({
              launchOptions: { channel: 'chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
              contextOptions: { viewport: VIEWPORT },
            }),
            instances: [{ browser: 'chromium' }],
            viewport: VIEWPORT,
            screenshotFailures: false,
          },
        },
      },
    ],
  },
});
