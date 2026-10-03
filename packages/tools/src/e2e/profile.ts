// The reference device the harness emulates: a 2020-class iPad held in landscape (brief Section 7), as task 3.1's
// canvas tests set it up. Plain data, read by the Vitest config in Node and by the harness in the browser.

/** The iPad profile: a 1180 × 820 CSS-pixel viewport at device scale factor 2, with touch. */
export const IPAD = { width: 1180, height: 820, deviceScaleFactor: 2 } as const;

/** The CPU slowdown, through CDP, that stands a fast machine in for the iPad's CPU in frame-time measurements. */
export const IPAD_CPU_SLOWDOWN = 4;

/** One 60 fps frame. */
export const FRAME_BUDGET_MS = 16;

/**
 * Chromium flags. SwiftShader is the same software GPU on every machine, so screenshots and pixel probes match
 * between a laptop and CI. Vsync and the frame-rate limit stay on: without them a gesture takes half the time on a
 * many-core laptop, but the GPU process draws flat out and takes more than a core, which a two-core CI runner lacks.
 */
export const SOFTWARE_GPU_FLAGS: readonly string[] = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

/** Frame times are measured on the machine's own GPU where it has one, at its own display rate. */
export const OWN_GPU_FLAGS: readonly string[] = ['--enable-unsafe-swiftshader'];

/**
 * The harness's timing file. The `performance` project runs it alone, through `pnpm perf` and CI's perf job, never
 * through `pnpm e2e` or an e2e shard, so a busy machine's frame times never fail a correctness run.
 */
export const PERFORMANCE_FILE = 'test/e2e/performance.e2e.ts';
