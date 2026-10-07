// The site's two fixed-name files beside the pages: the icon and the web manifest. A Vite plugin writes them into the
// build as assets, so the offline step (plugin.ts) lists them for the worker's cache like every other file the build
// writes, and serves them in `pnpm dev`; it also puts their <link> tags into each page's head, so the pages name no
// file that only the build has. The icon is placeholder vector art (ground rule 12): a power socket as the canvas draws
// one, hollow, in the renderer's power red (packages/canvas/src/renderer/style.ts) on the workbench grey, with a short
// run of power line into it; the final icon comes through the art pipeline. iPadOS takes a PNG for its home-screen icon
// and shows an SVG only in the tab, so that icon waits for the pipeline too. No dependency, and never part of the bundle.
import type { Plugin } from 'vite';

export const ICON_FILE = 'icon.svg';
export const MANIFEST_FILE = 'manifest.webmanifest';

/** The shell's workbench grey (index.html's background and theme colour). */
const WORKBENCH = '#ebe8e3';

export const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <rect width="64" height="64" rx="14" fill="${WORKBENCH}"/>
  <path d="M6 40 H24" stroke="#d63a3a" stroke-width="7" stroke-linecap="round"/>
  <circle cx="40" cy="40" r="13" fill="#fbfaf7" stroke="#d63a3a" stroke-width="7"/>
</svg>
`;

/**
 * The web manifest: "Add to Home Screen" on a tablet then opens the app full screen, with no browser bars round the
 * canvas (brief Section 9: the canvas takes at least 70% of the screen). Its paths are relative to the manifest, so
 * they hold under any base.
 */
export const MANIFEST = {
  name: 'Servo',
  short_name: 'Servo',
  description: 'A digital robotics kit: real parts, wired together on a canvas and run.',
  start_url: './',
  scope: './',
  display: 'standalone',
  orientation: 'any',
  background_color: WORKBENCH,
  theme_color: WORKBENCH,
  icons: [{ src: ICON_FILE, sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
} as const;

export interface SiteFile {
  readonly fileName: string;
  readonly source: string;
  readonly contentType: string;
}

export const SITE_FILES: readonly SiteFile[] = [
  { fileName: ICON_FILE, source: ICON_SVG, contentType: 'image/svg+xml' },
  { fileName: MANIFEST_FILE, source: `${JSON.stringify(MANIFEST, null, 2)}\n`, contentType: 'application/manifest+json' },
];

/** The tags each page's head gets: every page the icon, the app's page (index.html) the manifest and its home-screen settings too. */
export const headTagsFor = (page: string, base: string): readonly { readonly tag: 'link' | 'meta'; readonly attrs: Record<string, string> }[] => [
  { tag: 'link', attrs: { rel: 'icon', href: `${base}${ICON_FILE}`, type: 'image/svg+xml' } },
  ...(page.endsWith('index.html')
    ? ([
        { tag: 'link', attrs: { rel: 'manifest', href: `${base}${MANIFEST_FILE}` } },
        { tag: 'meta', attrs: { name: 'mobile-web-app-capable', content: 'yes' } },
        { tag: 'meta', attrs: { name: 'apple-mobile-web-app-capable', content: 'yes' } },
        { tag: 'meta', attrs: { name: 'apple-mobile-web-app-status-bar-style', content: 'default' } },
        { tag: 'meta', attrs: { name: 'apple-mobile-web-app-title', content: 'Servo' } },
      ] as const)
    : []),
];

export const siteFilesPlugin = (): Plugin => {
  let base = '/';
  return {
    name: 'servo:site-files',
    configResolved: (config) => {
      base = config.base;
    },
    // The dev server serves them from memory, so the tab has its icon in `pnpm dev` too.
    configureServer: (server) => {
      server.middlewares.use((request, response, next) => {
        const path = request.url?.split('?')[0] ?? '';
        const file = SITE_FILES.find((candidate) => path === `${base}${candidate.fileName}`);
        if (!file) {
          next();
          return;
        }
        response.setHeader('content-type', file.contentType);
        response.end(file.source);
      });
    },
    buildStart() {
      for (const file of SITE_FILES) this.emitFile({ type: 'asset', fileName: file.fileName, source: file.source });
    },
    transformIndexHtml: {
      order: 'pre',
      handler: (_html, ctx) => headTagsFor(ctx.filename, base).map((tag) => ({ ...tag, injectTo: 'head' as const })),
    },
  };
};
