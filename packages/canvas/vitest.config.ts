import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';
import type { TestProjectInlineConfiguration } from 'vitest/config';
import type { BrowserCommand } from 'vitest/node';

// Three projects (docs/renderer.md, "Tests"):
// - `unit` runs in Node: the scene model, the port layout, the camera and the arena's place.
// - `browser` runs the renderer in headless Chromium in the iPad profile: a 1180 × 820 CSS-pixel viewport at device
//   scale factor 2. It renders on SwiftShader, the same software GPU on every machine, so screenshots and pixel
//   probes match between a laptop and CI.
// - `performance` runs the frame-time test in the same profile on the machine's own GPU where it has one (SwiftShader
//   where it has none, as on CI). The test slows the CPU 4× itself, through CDP. `pnpm test` leaves it out; `pnpm perf`
//   runs it alone, and CI in a job of its own, so a busy machine's frame times never fail the correctness run.
// - `hands` runs the list view by tap and click in Chromium and in WebKit, Safari's engine: Safari does not focus a
//   button it is pressing, which Chromium does. Playwright's own input, no CDP, in a touchscreen context.
// Task 3.8 generalises this into the e2e harness.
const IPAD = { width: 1180, height: 820, deviceScaleFactor: 2 };
// Builders and reviewers run this at load 200–350 beside many agents' browsers. There a browser can take minutes to
// start and connect (Vitest's default is 60 s), and a beforeAll that mounts a canvas on SwiftShader far longer than
// the 10 s default hook timeout. Generous for both, in every browser project.
const CONNECT_TIMEOUT = 300_000;
const HOOK_TIMEOUT = 300_000;

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
    hookTimeout: HOOK_TIMEOUT,
    sequence: { groupOrder },
    browser: {
      enabled: true,
      headless: true,
      provider: chromium(args),
      instances: [{ browser: 'chromium' }],
      connectTimeout: CONNECT_TIMEOUT,
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
const HANDS = 'test/browser/list-view-hands.test.ts';

// Touchscreen taps and mouse clicks in the page under test, as Playwright gives them in every engine.
const tap: BrowserCommand<[selector: string]> = async (context, selector) => {
  await context.iframe.locator(selector).tap();
};
const tapAt: BrowserCommand<[x: number, y: number]> = async (context, x, y) => {
  await context.page.touchscreen.tap(x, y);
};
const clickAt: BrowserCommand<[x: number, y: number]> = async (context, x, y) => {
  await context.page.mouse.click(x, y);
};

const touchscreen = (browser: 'chromium' | 'webkit') =>
  playwright({
    ...(browser === 'chromium' ? { launchOptions: { channel: 'chromium' } } : {}),
    contextOptions: { viewport: { width: IPAD.width, height: IPAD.height }, deviceScaleFactor: IPAD.deviceScaleFactor, hasTouch: true },
  });

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
      // Generous: a software GPU on a busy machine (CI, other agents' browsers) can take a minute to mount a canvas, and
      // at load 45 and above a placement or art test has run past two minutes (every file here mounts one), so five.
      browserProject('browser', ['test/browser/**/*.test.ts'], [FRAME_TIME, HANDS], ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'], 300_000, 0),
      {
        test: {
          name: 'hands',
          include: [HANDS],
          testTimeout: 120_000,
          hookTimeout: HOOK_TIMEOUT,
          sequence: { groupOrder: 0 },
          browser: {
            enabled: true,
            headless: true,
            connectTimeout: CONNECT_TIMEOUT,
            commands: { tap, tapAt, clickAt },
            instances: [
              { browser: 'chromium', provider: touchscreen('chromium') },
              { browser: 'webkit', provider: touchscreen('webkit') },
            ],
            viewport: { width: IPAD.width, height: IPAD.height },
            screenshotFailures: false,
          },
        },
      },
      // Last and alone, so no other test competes for the CPU while frames are timed. Each test runs its gestures five
      // times (frame-time.test.ts), about three minutes on CI's software GPU, so fifteen minutes allows a slow runner.
      browserProject('performance', [FRAME_TIME], [], ['--enable-unsafe-swiftshader'], 900_000, 1),
    ],
  },
});
