// The app's performance measurement (task 6.1, docs/perf.md): `pnpm perf:app` at the repo root, and the last step of
// `pnpm perf`. Node 24 runs it as it is. It builds the web app twice (the release's build, and one with the perf page,
// src/perf/perf.html in packages/app), serves each gzipped, and in Playwright's Chromium on this machine's GPU, for each
// device profile (profiles.ts), measures RUNS times and reports the median of each figure:
// - the bundle: every file's bytes and gzipped bytes, and what index.html loads before the app can start;
// - cold start: first contentful paint and the app interactive (the `servo:interactive` mark), on a first visit over
//   home Wi-Fi, and again from the service worker's cache in a new tab;
// - frames on busy-workbench (25 parts): Build mode under a wheel zoom and a two-finger pinch, and Run mode at 30 ticks a
//   second, with nothing selected and with the spec card's live readouts showing.
// Each figure is held to its budget, and a figure out of budget exits non-zero. Options:
//   --profile <name>   only this profile (repeatable): ipad-2020, chromebook-low
//   --runs <n>         measurements per figure (default 3)
//   --json <file>      also write every sample and median as JSON
//   --no-budget        report only; never exit non-zero for a figure
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { chromium } from 'playwright';
import type { Browser, BrowserContext, CDPSession, Page } from 'playwright';
import { gpuName, pressRun, startTimes, timeFrames } from './page.ts';
import type { FrameSample, Gesture } from './page.ts';
import { BUDGETS, FRAMES, HOME_WIFI, PROFILES, RUNS } from './profiles.ts';
import type { DeviceProfile } from './profiles.ts';
import { serveFolder } from './serve.ts';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const outRoot = path.join(repoRoot, 'packages/tools/node_modules/.servo-perf');
const SPIN_UP_MS = 1000;

interface Options {
  readonly profiles: readonly DeviceProfile[];
  readonly runs: number;
  readonly json: string | undefined;
  readonly budget: boolean;
}

const parseOptions = (args: readonly string[]): Options => {
  const names: string[] = [];
  let runs = RUNS;
  let json: string | undefined;
  let budget = true;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const value = args[index + 1];
    if (arg === '--profile' && value) {
      names.push(value);
      index += 1;
    } else if (arg === '--runs' && value) {
      runs = Math.max(1, Number.parseInt(value, 10) || RUNS);
      index += 1;
    } else if (arg === '--json' && value) {
      json = path.resolve(process.env.INIT_CWD ?? process.cwd(), value);
      index += 1;
    } else if (arg === '--no-budget') budget = false;
    else throw new Error(`Unknown option ${String(arg)}. See the head of packages/tools/src/perf/main.ts.`);
  }
  const profiles = names.length === 0 ? PROFILES : names.map((name) => PROFILES.find((profile) => profile.name === name) ?? fail(`No profile ${name}.`));
  return { profiles, runs, json, budget };
};

const fail = (message: string): never => {
  throw new Error(message);
};

const run = (command: string, args: readonly string[]): void => {
  const result = spawnSync(command, [...args], { cwd: repoRoot, stdio: ['ignore', 'ignore', 'inherit'] });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} stopped (${result.signal ?? `exit status ${String(result.status)}`}).`);
};

const buildApp = (outDir: string, mode: 'production' | 'perf'): void =>
  run('pnpm', ['--filter', '@servo/app', 'exec', 'vite', 'build', '--mode', mode, '--outDir', outDir, '--emptyOutDir', '--logLevel', 'error']);

// The bundle.

interface BundleFile {
  readonly name: string;
  readonly bytes: number;
  readonly gzip: number;
  /** index.html loads it (a script, a module preload or a stylesheet) before the app starts. */
  readonly initial: boolean;
}

const bundleOf = (web: string): BundleFile[] => {
  const html = fs.readFileSync(path.join(web, 'index.html'), 'utf8');
  const loaded = new Set([...html.matchAll(/\b(?:src|href)="\/([^"]+)"/g)].map((match) => match[1]));
  return fs
    .readdirSync(path.join(web, 'assets'))
    .filter((name) => /\.(?:js|css)$/.test(name))
    .map((name) => {
      const bytes = fs.readFileSync(path.join(web, 'assets', name));
      return { name, bytes: bytes.length, gzip: zlib.gzipSync(bytes, { level: 9 }).length, initial: loaded.has(`assets/${name}`) };
    })
    .sort((a, b) => b.bytes - a.bytes);
};

// Measuring.

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[middle] ?? 0) : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
};

const contextFor = (browser: Browser, profile: DeviceProfile): Promise<BrowserContext> =>
  browser.newContext({ viewport: profile.viewport, deviceScaleFactor: profile.deviceScaleFactor, hasTouch: profile.hasTouch, serviceWorkers: 'allow' });

const throttle = async (cdp: CDPSession, rate: number): Promise<void> => {
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });
};

const waitInteractive = async (page: Page): Promise<{ firstPaint: number; interactive: number }> => {
  const handle = await page.waitForFunction(startTimes, undefined, { timeout: 180_000, polling: 50 });
  const times = (await handle.jsonValue()) as { firstPaint: number; interactive: number };
  return times;
};

interface ColdStart {
  readonly firstVisit: { firstPaint: number; interactive: number };
  readonly cached: { firstPaint: number; interactive: number };
}

const coldStart = async (browser: Browser, profile: DeviceProfile, url: string): Promise<ColdStart> => {
  const context = await contextFor(browser, profile);
  try {
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await throttle(cdp, profile.cpuSlowdown);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.send('Network.emulateNetworkConditions', { offline: false, ...HOME_WIFI });
    await page.goto(url);
    const firstVisit = await waitInteractive(page);
    // The worker installs once it has every file of the build; the next tab loads from its cache.
    await page.evaluate(async () => Boolean((await navigator.serviceWorker.ready).active));
    await page.close();
    const again = await context.newPage();
    const againCdp = await context.newCDPSession(again);
    await throttle(againCdp, profile.cpuSlowdown);
    await again.goto(url);
    const cached = await waitInteractive(again);
    const fromWorker = await again.evaluate(() => Boolean(navigator.serviceWorker.controller));
    if (!fromWorker) throw new Error('The second visit was not served by the service worker.');
    return { firstVisit, cached };
  } finally {
    await context.close();
  }
};

type FrameSet = Record<'buildWheel' | 'buildPinch' | 'run' | 'runSpecCard', FrameSample>;

interface FrameRun {
  /** The first Run's press until Run mode, ms. */
  readonly firstRun: number;
  readonly frames: FrameSet;
}

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const frames = async (page: Page, count: number, gesture: Gesture): Promise<FrameSample> => page.evaluate(timeFrames, { frames: count, gesture });

const frameRun = async (browser: Browser, profile: DeviceProfile, url: string, index: number): Promise<FrameRun> => {
  const context = await contextFor(browser, profile);
  try {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${url}/src/perf/perf.html?store=servo-perf-${String(index)}`);
    await waitInteractive(page);
    // Pictures load and the fit settles before any frame is timed.
    await pause(1500);
    const cdp = await context.newCDPSession(page);
    await throttle(cdp, profile.cpuSlowdown);
    const buildWheel = await frames(page, FRAMES.build, 'wheel');
    const buildPinch = await frames(page, FRAMES.build, 'pinch');
    const runButton = page.getByRole('button', { name: 'Run', exact: true });
    const stopButton = page.getByRole('button', { name: 'Stop', exact: true });
    await showWholeBuild(page);
    const firstRun = await page.evaluate(pressRun);
    await stopButton.waitFor({ timeout: 60_000 });
    await pause(SPIN_UP_MS + 500);
    const running = await frames(page, FRAMES.run, 'none');
    await stopButton.click();
    await runButton.waitFor({ timeout: 60_000 });
    // The spec card of the build's microcontroller: its live readouts change every tick of a Run.
    await showWholeBuild(page);
    await runButton.click();
    await stopButton.waitFor({ timeout: 60_000 });
    await selectPart(page);
    await pause(SPIN_UP_MS + 500);
    const runSpecCard = await frames(page, FRAMES.run, 'none');
    await stopButton.click();
    if (errors.length > 0) throw new Error(`The perf page threw: ${errors.join('; ')}`);
    return { firstRun, frames: { buildWheel, buildPinch, run: running, runSpecCard } };
  } finally {
    await context.close();
  }
};

/**
 * Fits the build, then zooms out three steps, so the robot and the bench's test circuits all stay in view while the
 * robot drives off: a Run draws every part, as a child watching it would see it.
 */
const showWholeBuild = async (page: Page): Promise<void> => {
  await page.getByRole('button', { name: 'Fit', exact: true }).click();
  for (let step = 0; step < 3; step += 1) await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
  await pause(500);
};

/**
 * Opens the spec card of the robot's motor driver during a Run, through Run mode's list view (the screen-reader path),
 * so the selection never depends on where a tap lands.
 */
const selectPart = async (page: Page): Promise<void> => {
  // The list view rebuilds once a simulated second in a Run, so a button found just before may be gone: try again.
  const card = page.locator('article.spec-card[data-part="motor-driver"]');
  for (let attempt = 0; attempt < 5 && !(await card.isVisible()); attempt += 1) {
    await page.getByRole('button', { name: 'Select motor driver 2', exact: true }).evaluate((button: HTMLElement) => button.click());
    await card.waitFor({ timeout: 3000 }).catch(() => undefined);
  }
  await card.waitFor({ timeout: 10_000 });
};

// Reporting.

const ms = (value: number): string => `${value.toFixed(value < 100 ? 1 : 0)} ms`;
const kb = (bytes: number): string => `${(bytes / 1024).toFixed(1)} KB`;

interface Check {
  readonly figure: string;
  readonly value: number;
  readonly limit: number;
  readonly below: boolean;
}

const main = async (): Promise<number> => {
  const options = parseOptions(process.argv.slice(2));
  const web = path.join(outRoot, 'web');
  const perf = path.join(outRoot, 'perf');
  console.log('[perf:app] pnpm art, then the web build and the perf build');
  run('pnpm', ['art']);
  buildApp(web, 'production');
  buildApp(perf, 'perf');

  const bundle = bundleOf(web);
  const initial = bundle.filter((file) => file.initial);
  const total = (files: readonly BundleFile[], key: 'bytes' | 'gzip'): number => files.reduce((sum, file) => sum + file[key], 0);
  console.log(`[perf:app] bundle: ${String(bundle.length)} JS and CSS files, ${kb(total(bundle, 'bytes'))} (${kb(total(bundle, 'gzip'))} gzipped)`);
  console.log(`[perf:app] loaded before start: ${kb(total(initial, 'bytes'))} (${kb(total(initial, 'gzip'))} gzipped)`);
  for (const file of bundle.slice(0, 6)) console.log(`  ${file.initial ? 'start' : 'lazy '} ${file.name}: ${kb(file.bytes)} (${kb(file.gzip)} gzipped)`);

  const webServer = await serveFolder(web);
  const perfServer = await serveFolder(perf);
  const browser = await chromium.launch({ channel: 'chromium', headless: true, args: ['--enable-unsafe-swiftshader'] });
  const checks: Check[] = [];
  const report: Record<string, unknown> = { bundle, initialBytes: total(initial, 'bytes'), initialGzip: total(initial, 'gzip') };
  try {
    const page = await browser.newPage();
    const gpu = await page.evaluate(gpuName);
    await page.close();
    report.gpu = gpu;
    console.log(`[perf:app] GPU ${gpu}; ${String(options.runs)} runs per figure, the median reported`);
    for (const profile of options.profiles) {
      console.log(`\n[perf:app] ${profile.label}`);
      const starts: ColdStart[] = [];
      const runs: FrameRun[] = [];
      for (let index = 1; index <= options.runs; index += 1) {
        const start = await coldStart(browser, profile, webServer.url);
        console.log(
          `  run ${String(index)} cold start: first visit paint ${ms(start.firstVisit.firstPaint)}, interactive ${ms(start.firstVisit.interactive)}; ` +
            `cached paint ${ms(start.cached.firstPaint)}, interactive ${ms(start.cached.interactive)}`,
        );
        starts.push(start);
        const frameSet = await frameRun(browser, profile, perfServer.url, index);
        console.log(`  run ${String(index)} first Run: ${ms(frameSet.firstRun)} from the press to Run mode`);
        for (const [name, sample] of Object.entries(frameSet.frames) as [string, FrameSample][]) {
          console.log(
            `  run ${String(index)} ${name}: busy p50 ${ms(sample.busyP50)} p95 ${ms(sample.busyP95)}, rAF work p50 ${ms(sample.workP50)} p95 ${ms(sample.workP95)}, ` +
              `${sample.fps.toFixed(0)} fps (interval p95 ${ms(sample.intervalP95)}), ${String(sample.over16)} of ${String(sample.frames)} frames over 16 ms`,
          );
        }
        runs.push(frameSet);
      }
      const medians = {
        firstVisitPaint: median(starts.map((start) => start.firstVisit.firstPaint)),
        firstVisitInteractive: median(starts.map((start) => start.firstVisit.interactive)),
        cachedPaint: median(starts.map((start) => start.cached.firstPaint)),
        cachedInteractive: median(starts.map((start) => start.cached.interactive)),
        firstRun: median(runs.map((frameSet) => frameSet.firstRun)),
        // On screen and taking input: the later of the first paint and the mark.
        firstVisitReady: median(starts.map((start) => Math.max(start.firstVisit.firstPaint, start.firstVisit.interactive))),
        cachedReady: median(starts.map((start) => Math.max(start.cached.firstPaint, start.cached.interactive))),
        frames: Object.fromEntries(
          (['buildWheel', 'buildPinch', 'run', 'runSpecCard'] as const).map((name) => [
            name,
            {
              busyP50: median(runs.map((frameSet) => frameSet.frames[name].busyP50)),
              busyP95: median(runs.map((frameSet) => frameSet.frames[name].busyP95)),
              workP50: median(runs.map((frameSet) => frameSet.frames[name].workP50)),
              workP95: median(runs.map((frameSet) => frameSet.frames[name].workP95)),
              fps: median(runs.map((frameSet) => frameSet.frames[name].fps)),
            },
          ]),
        ),
      };
      report[profile.name] = { label: profile.label, starts, runs, medians };
      console.log(`  median cold start: first visit paint ${ms(medians.firstVisitPaint)}, interactive ${ms(medians.firstVisitInteractive)}; cached paint ${ms(medians.cachedPaint)}, interactive ${ms(medians.cachedInteractive)}; ready ${ms(medians.firstVisitReady)} first visit, ${ms(medians.cachedReady)} cached; first Run ${ms(medians.firstRun)}`);
      checks.push({ figure: `${profile.name} cold start, first visit`, value: medians.firstVisitReady, limit: BUDGETS.coldStartMs, below: true });
      checks.push({ figure: `${profile.name} cold start, cached`, value: medians.cachedReady, limit: BUDGETS.coldStartMs, below: true });
      for (const [name, figures] of Object.entries(medians.frames)) {
        console.log(`  median ${name}: busy p50 ${ms(figures.busyP50)} p95 ${ms(figures.busyP95)}, rAF work p50 ${ms(figures.workP50)} p95 ${ms(figures.workP95)}, ${figures.fps.toFixed(0)} fps`);
        checks.push({ figure: `${profile.name} ${name} frame p95`, value: figures.busyP95, limit: BUDGETS.frameMs, below: true });
        checks.push({ figure: `${profile.name} ${name} fps`, value: figures.fps, limit: BUDGETS.minFps, below: false });
      }
    }
  } finally {
    await browser.close();
    await webServer.close();
    await perfServer.close();
  }
  if (options.json) {
    fs.mkdirSync(path.dirname(options.json), { recursive: true });
    fs.writeFileSync(options.json, `${JSON.stringify(report, null, 2)}\n`);
  }
  const missed = checks.filter((check) => (check.below ? check.value > check.limit : check.value < check.limit));
  console.log(`\n[perf:app] ${String(checks.length - missed.length)} of ${String(checks.length)} figures within budget`);
  for (const check of missed) console.log(`  out of budget: ${check.figure} ${check.value.toFixed(1)} (budget ${check.below ? '≤' : '≥'} ${String(check.limit)})`);
  return missed.length > 0 && options.budget ? 1 : 0;
};

process.exitCode = await main();
