import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';
import type { TestProjectInlineConfiguration } from 'vitest/config';

// Three projects (docs/renderer.md, "Tests"):
// - `unit` runs in Node: the scene model, the port layout, the camera and the arena's place.
// - `browser` runs the renderer in headless Chromium in the iPad profile: a 1180 × 820 CSS-pixel viewport at device
//   scale factor 2. It renders on SwiftShader, the same software GPU on every machine, so screenshots and pixel
//   probes match between a laptop and CI.
// - `performance` runs the frame-time test in the same profile on the machine's own GPU where it has one (SwiftShader
//   where it has none, as on CI). The test slows the CPU 4× itself, through CDP.
// Task 3.8 generalises this into the e2e harness.
const IPAD = { width: 1180, height: 820, deviceScaleFactor: 2 };

const chromium = (args: string[]) =>
  playwright({
    // Full Chromium in new headless mode: the headless shell composites WebGL far below the display rate.
    launchOptions: { channel: 'chromium', args },
    contextOptions: { viewport: { width: IPAD.width, height: IPAD.height }, deviceScaleFactor: IPAD.deviceScaleFactor },
  });

const browserProject = (
  name: string,
  include: string[],
  exclude: string[],
  args: string[],
  testTimeout: number,
  groupOrder: number,
): TestProjectInlineConfiguration => ({
  test: {
    name,
    include,
    exclude,
    testTimeout,
    sequence: { groupOrder },
    browser: {
      enabled: true,
      headless: true,
      provider: chromium(args),
      instances: [{ browser: 'chromium' }],
      viewport: { width: IPAD.width, height: IPAD.height },
      screenshotFailures: false,
      expect: {
        toMatchScreenshot: {
          comparatorName: 'pixelmatch',
          comparatorOptions: { threshold: 0.03, allowedMismatchedPixelRatio: 0.005 },
          // A 2360 × 1640 screenshot rendered in software takes a while; two in a row must match.
          timeout: 30_000,
          // One reference for every platform: the pixels come from SwiftShader everywhere.
          resolveScreenshotPath: ({ root, testFileDirectory, testFileName, arg, ext }) =>
            `${root}/${testFileDirectory}/__screenshots__/${testFileName}/${arg}${ext}`,
          resolveDiffPath: ({ root, testFileName, arg, ext }) => `${root}/node_modules/.vitest-screenshots/${testFileName}/${arg}${ext}`,
        },
      },
    },
  },
});

const FRAME_TIME = 'test/browser/frame-time.test.ts';

export default defineConfig({
  test: {
    // Screenshot artifacts and diffs stay out of the source tree.
    attachmentsDir: 'node_modules/.vitest/attachments',
    projects: [
      {
        test: {
          name: 'unit',
          include: ['test/**/*.test.ts'],
          exclude: ['test/browser/**'],
          environment: 'node',
          sequence: { groupOrder: 0 },
        },
      },
      // Generous: a software GPU on a busy machine (CI, other agents' browsers) can take a minute to mount a canvas.
      browserProject('browser', ['test/browser/**/*.test.ts'], [FRAME_TIME], ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'], 120_000, 0),
      // Last and alone, so no other test competes for the CPU while frames are timed.
      browserProject('performance', [FRAME_TIME], [], ['--enable-unsafe-swiftshader'], 240_000, 1),
    ],
  },
});
