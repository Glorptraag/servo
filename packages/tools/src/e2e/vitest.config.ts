// The canvas e2e harness (task 3.8): `pnpm e2e` at the repo root runs `pnpm art`, then this config from packages/tools.
// Two Vitest browser projects in Playwright's Chromium, in the iPad profile (profile.ts), one after the other:
// - `e2e` renders on SwiftShader, the same software GPU on every machine, so screenshots and pixel probes match
//   between a laptop and CI: the parity check, screenshots, their mutation test and gestures.
// - `performance` runs the frame-time measurement on the machine's own GPU where it has one, last and alone.
// CI runs the files as shards (.github/workflows/ci.yml); `pnpm e2e` with no files runs them all. SERVO_PARITY_STRICT=1
// makes a parity fixture with a step left out or a path waiting fail (gate G3). See README.md.
import { fileURLToPath } from 'node:url';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';
import type { TestProjectInlineConfiguration } from 'vitest/config';
import { IPAD, OWN_GPU_FLAGS, SOFTWARE_GPU_FLAGS } from './profile.ts';
import { ParityReporter } from './reporter.ts';

/** packages/tools: test paths, screenshots and attachments are relative to it. */
const root = fileURLToPath(new URL('../..', import.meta.url));

const PERFORMANCE = 'test/e2e/performance.e2e.ts';

const browserProject = (name: string, include: string[], exclude: string[], flags: readonly string[], groupOrder: number): TestProjectInlineConfiguration => ({
  test: {
    name,
    root,
    include,
    exclude,
    // Generous: a software GPU on a busy machine can take a minute to mount a canvas or settle a screenshot.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    sequence: { groupOrder },
    browser: {
      enabled: true,
      headless: true,
      provider: playwright({
        // Full Chromium in new headless mode: the headless shell composites WebGL far below the display rate.
        launchOptions: { channel: 'chromium', args: [...flags] },
        contextOptions: {
          viewport: { width: IPAD.width, height: IPAD.height },
          deviceScaleFactor: IPAD.deviceScaleFactor,
          hasTouch: true,
        },
      }),
      instances: [{ browser: 'chromium' }],
      // A loaded machine can take over a minute to bring the page up with the canvas and its pictures.
      connectTimeout: 180_000,
      viewport: { width: IPAD.width, height: IPAD.height },
      // Screenshots are compared by the harness's own rule (src/e2e/pixels.ts, screenshots.ts), not Vitest's.
      screenshotFailures: false,
    },
    provide: { parityStrict: process.env.SERVO_PARITY_STRICT === '1' },
  },
});

// On GitHub Actions, failures become annotations on the workflow run; the parity lines stay in the log.
const githubActions: ['github-actions', { displayAnnotations: boolean }] = ['github-actions', { displayAnnotations: false }];

export default defineConfig({
  root,
  test: {
    attachmentsDir: 'node_modules/.vitest/attachments',
    reporters: ['default', new ParityReporter(), ...(process.env.GITHUB_ACTIONS === 'true' ? [githubActions] : [])],
    // One project at a time: CI's runners have two cores, and SwiftShader would use both for each.
    projects: [
      browserProject('e2e', ['test/e2e/**/*.e2e.ts'], [PERFORMANCE], SOFTWARE_GPU_FLAGS, 0),
      // Last and alone, so nothing else competes for the CPU while frames are timed.
      browserProject('performance', [PERFORMANCE], [], OWN_GPU_FLAGS, 1),
    ],
  },
});
