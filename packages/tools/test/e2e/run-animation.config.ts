// Run-mode animation's e2e proof (task 3.5): `pnpm --filter @servo/tools e2e:run-animation`, after `pnpm art`. Two
// Vitest browser projects in Playwright's Chromium, in the iPad profile (1180 × 820 CSS pixels at device scale factor
// 2), one after the other:
// - `run-animation` renders on SwiftShader, the same software GPU on every machine, so screenshots and pixel probes
//   match between a laptop and CI: every broken content fixture, and a working one, run and screenshotted.
// - `run-animation-performance` times Run-mode frames on the machine's own GPU where it has one, last and alone.
//   `pnpm perf` runs it alone, as CI's perf job does.
// Kept apart from task 3.8's harness (packages/tools/src/e2e/); the two can merge once both land.
import { fileURLToPath } from 'node:url';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';
import type { TestProjectInlineConfiguration } from 'vitest/config';

/** packages/tools: test paths, screenshots and attachments are relative to it. */
const root = fileURLToPath(new URL('../..', import.meta.url));

const IPAD = { width: 1180, height: 820, deviceScaleFactor: 2 } as const;
// Named .timing.ts, not .e2e.ts, so task 3.8's harness (`pnpm e2e`) does not time it on a software GPU.
const PERFORMANCE = 'test/e2e/run-animation.timing.ts';

const project = (name: string, include: string[], args: string[], groupOrder: number): TestProjectInlineConfiguration => ({
  // The third-party packages the bench reaches, optimised before any page loads: one Vite found late would reload a
  // running test page, which then may never load again.
  optimizeDeps: { include: ['@servo/canvas > pixi.js', '@servo/sim-core > @dimforge/rapier2d-deterministic-compat'] },
  test: {
    name,
    root,
    include,
    // Generous: a software GPU on a busy machine can take a minute to mount a canvas or settle a screenshot.
    testTimeout: 240_000,
    hookTimeout: 240_000,
    sequence: { groupOrder },
    browser: {
      enabled: true,
      headless: true,
      provider: playwright({
        // Full Chromium in new headless mode: the headless shell composites WebGL far below the display rate.
        launchOptions: { channel: 'chromium', args },
        contextOptions: { viewport: { width: IPAD.width, height: IPAD.height }, deviceScaleFactor: IPAD.deviceScaleFactor, hasTouch: true },
      }),
      instances: [{ browser: 'chromium' }],
      // At load 200–350 with many agents running, the browser can take minutes to start and connect (default 60 s).
      connectTimeout: 300_000,
      viewport: { width: IPAD.width, height: IPAD.height },
      screenshotFailures: false,
      expect: {
        toMatchScreenshot: {
          comparatorName: 'pixelmatch',
          comparatorOptions: { threshold: 0.03, allowedMismatchedPixelRatio: 0.005 },
          timeout: 30_000,
          // One reference for every platform: the pixels come from SwiftShader everywhere.
          resolveScreenshotPath: ({ root: base, testFileDirectory, testFileName, arg, ext }) =>
            `${base}/${testFileDirectory}/__screenshots__/${testFileName}/${arg}${ext}`,
          resolveDiffPath: ({ root: base, testFileName, arg, ext }) => `${base}/node_modules/.vitest-screenshots/${testFileName}/${arg}${ext}`,
        },
      },
    },
  },
});

export default defineConfig({
  root,
  test: {
    attachmentsDir: 'node_modules/.vitest/attachments',
    projects: [
      project('run-animation', ['test/e2e/run-animation.e2e.ts'], ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'], 0),
      project('run-animation-performance', [PERFORMANCE], ['--enable-unsafe-swiftshader'], 1),
    ],
  },
});
