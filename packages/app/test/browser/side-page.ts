// Browser commands for the offline and sync tests (task 5.5). They run in Node, in Vitest's process, and drive a page
// in a browser context of its own beside the test page, so that taking that context offline never touches the test
// runner's own connection. Each test file has its own, since the browser runs test files side by side.
// vitest.config.ts registers them; tests call them through `commands` from 'vitest/browser'.
// They can also build the app with its real web build and serve it, so a test opens the app exactly as it ships.
import type { BrowserCommand, BrowserCommandContext } from 'vitest/node';
import type { BrowserContext, Page } from 'playwright';
import { build, preview } from 'vite';
import type { PreviewServer } from 'vite';

export interface BuiltApp {
  /** Where the build is served, ending in '/'. */
  readonly url: string;
  /** Every file the build wrote, as paths under the site's root ('/index.html', '/assets/…'). */
  readonly files: readonly string[];
}

const pathOf = (relative: string): string => decodeURIComponent(new URL(relative, import.meta.url).pathname);
const APP = pathOf('../..');
const OUT = pathOf('../../node_modules/.vitest/offline-build');
const VIEWPORT = { width: 1180, height: 820 };

let built: Promise<readonly string[]> | undefined;
let server: PreviewServer | undefined;
interface Side {
  readonly context: BrowserContext;
  readonly page: Page;
  readonly failed: string[];
}

/** Each test file's side page: the browser runs test files side by side. */
const sides = new Map<string, Side>();

/** Vitest's process runs with NODE_ENV=test, which would make Vite build for development; the build sets it back. */
const environment = (globalThis as unknown as { readonly process: { readonly env: Record<string, string | undefined> } }).process.env;

/** The app's production build, made once per test run, with the real vite.config.ts (so the service worker too). */
const buildApp = async (): Promise<readonly string[]> => {
  const mode = environment.NODE_ENV;
  environment.NODE_ENV = 'production';
  try {
    const output = await build({ root: APP, configFile: `${APP}/vite.config.ts`, mode: 'production', logLevel: 'error', build: { outDir: OUT, emptyOutDir: true } });
    const outputs = Array.isArray(output) ? output : [output];
    return outputs.flatMap((result) => ('output' in result ? result.output.map((file) => `/${file.fileName}`) : [])).sort();
  } finally {
    environment.NODE_ENV = mode;
  }
};

const keyOf = (ctx: BrowserCommandContext): string => ctx.testPath ?? ctx.sessionId;

const sidePage = (ctx: BrowserCommandContext): Side => {
  const side = sides.get(keyOf(ctx));
  if (!side) throw new Error('No side page is open: call openSidePage first.');
  return side;
};

const closeSide = async (ctx: BrowserCommandContext): Promise<void> => {
  const side = sides.get(keyOf(ctx));
  sides.delete(keyOf(ctx));
  await side?.context.close();
};

/** Builds the app (once) and serves the build with `vite preview` on a free port. */
export const startBuiltApp: BrowserCommand<[]> = async (): Promise<BuiltApp> => {
  built ??= buildApp();
  const files = await built;
  if (!server) {
    server = await preview({ root: APP, configFile: false, logLevel: 'error', build: { outDir: OUT }, preview: { host: 'localhost', port: 4300, strictPort: false } });
  }
  const url = server.resolvedUrls?.local[0];
  if (!url) throw new Error('The preview server has no local address.');
  return { url, files };
};

/** Stops serving the build: from then on the site cannot be reached at all, as in airplane mode. */
export const stopBuiltApp: BrowserCommand<[]> = async () => {
  await server?.close();
  server = undefined;
};

/** Opens `url` in a fresh browser context (its own storage and service workers) and waits for it to load. */
export const openSidePage: BrowserCommand<[url: string]> = async (ctx, url) => {
  await closeSide(ctx);
  const browser = ctx.context.browser();
  if (!browser) throw new Error('The test browser cannot open another context.');
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();
  const failed: string[] = [];
  page.on('requestfailed', (request) => failed.push(request.url()));
  sides.set(keyOf(ctx), { context, page, failed });
  await page.goto(url, { waitUntil: 'load' });
};

/** Takes the side page's browser context off the network, or puts it back: the page sees offline and online events. */
export const setSideNetwork: BrowserCommand<[online: boolean]> = async (ctx, online) => {
  await sidePage(ctx).context.setOffline(!online);
};

export const reloadSidePage: BrowserCommand<[]> = async (ctx) => {
  await sidePage(ctx).page.reload({ waitUntil: 'load' });
};

/** Evaluates a JavaScript expression in the side page, awaiting it when it is a promise, and returns its value as JSON. */
export const evaluateInSidePage: BrowserCommand<[expression: string]> = async (ctx, expression) => sidePage(ctx).page.evaluate(expression);

/** Clicks the first element `selector` matches in the side page, as a person would. */
export const clickInSidePage: BrowserCommand<[selector: string]> = async (ctx, selector) => {
  await sidePage(ctx).page.click(selector);
};

/** The addresses of requests the side page made that failed since the last call. */
export const failedSideRequests: BrowserCommand<[]> = async (ctx) => sidePage(ctx).failed.splice(0);

export const closeSidePage: BrowserCommand<[]> = closeSide;

export const sidePageCommands = {
  startBuiltApp,
  stopBuiltApp,
  openSidePage,
  setSideNetwork,
  reloadSidePage,
  evaluateInSidePage,
  clickInSidePage,
  failedSideRequests,
  closeSidePage,
};

declare module 'vitest/browser' {
  interface BrowserCommands {
    startBuiltApp: () => Promise<BuiltApp>;
    stopBuiltApp: () => Promise<void>;
    openSidePage: (url: string) => Promise<void>;
    setSideNetwork: (online: boolean) => Promise<void>;
    reloadSidePage: () => Promise<void>;
    evaluateInSidePage: <T = unknown>(expression: string) => Promise<T>;
    clickInSidePage: (selector: string) => Promise<void>;
    failedSideRequests: () => Promise<string[]>;
    closeSidePage: () => Promise<void>;
  }
}
