// The web build's offline step (task 5.5): a Vite plugin that builds service-worker.ts into /sw.js and writes in
// front of it the build's every file, so the worker can download them all on install. vite.config.ts adds it; it runs
// for `vite build` only, so `pnpm dev` and the tests have no worker. It runs in Node at build time and is never part
// of the app's bundle. No dependency: the file list comes from the bundle Vite is about to write.
import type { Plugin } from 'vite';
import { WORKER_FILE } from './worker-file.ts';

/** cyrb53: a 53-bit hash of the text, in hex, to name a build's cache. */
const hashOf = (text: string): string => {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
};

const textOf = (source: string | Uint8Array): string => (typeof source === 'string' ? source : new TextDecoder().decode(source));

/**
 * Builds the service worker with the app. Every file the build writes is listed, index.html first, except the worker
 * itself and source maps. The cache's version is a hash of the list and of the text of every file whose name never
 * changes: the pages (index.html and parent.html) and the site files beside them (the icon and the manifest,
 * site-files.ts), all at the top of the build. Every other file's name carries a hash of its content, so a change to
 * any file changes the worker's bytes, which is how the browser knows a new build is there.
 */
export const offlinePlugin = (): Plugin => {
  let base = '/';
  const source = decodeURIComponent(new URL('./service-worker.ts', import.meta.url).pathname);
  return {
    name: 'servo:offline',
    apply: 'build',
    enforce: 'post',
    configResolved: (config) => {
      base = config.base;
    },
    buildStart() {
      this.emitFile({ type: 'chunk', id: source, fileName: WORKER_FILE });
    },
    generateBundle(_options, bundle) {
      const worker = bundle[WORKER_FILE];
      if (worker?.type !== 'chunk') throw new Error(`The offline step did not find ${WORKER_FILE} in the build.`);
      const index = bundle['index.html'];
      if (index?.type !== 'asset') throw new Error('The offline step did not find index.html in the build.');
      const others = Object.keys(bundle)
        .filter((name) => name !== WORKER_FILE && name !== 'index.html' && !name.endsWith('.map'))
        .sort();
      const files = ['index.html', ...others].map((name) => `${base}${name}`);
      // Files at the top of the build keep their names (the pages, D91, and the site files), so each one's own text is
      // hashed too; the hashed names under assets/ speak for their contents.
      const fixed = ['index.html', ...others.filter((name) => !name.includes('/'))].map((name) => {
        const file = bundle[name];
        return file?.type === 'asset' ? textOf(file.source) : '';
      });
      const version = hashOf(`${files.join('\n')}\n${fixed.join('\n')}`);
      worker.code = `self.__SERVO_OFFLINE__ = ${JSON.stringify({ version, files })};\n${worker.code}`;
    },
  };
};
