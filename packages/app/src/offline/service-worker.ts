// The service worker (task 5.5), served at /sw.js by the web build. It runs in the worker, not in the page, and
// imports nothing: plugin.ts builds this file on its own and writes the build's file list in front of it as
// `self.__SERVO_OFFLINE__`. On install it downloads every file of the build: the app shell, the content baked into
// it, the art, and every lazily loaded chunk (Rapier's WebAssembly too, once the Run loop loads it), all or nothing.
// After that the app opens and runs with no network: each file comes from the cache, and every page of the app opens
// on the cached index.html. A new build waits until no page of the old one is open, so a child mid-build never has
// the code swapped under them. See README.md, "Offline and sync".

interface Precache {
  /** Names this build's cache: a hash of its file list and its index.html. */
  readonly version: string;
  /** Every file of the build, as paths under the site's root. The first is index.html. */
  readonly files: readonly string[];
}

interface WaitEvent extends Event {
  waitUntil(work: Promise<unknown>): void;
}

interface FetchEvent extends WaitEvent {
  readonly request: Request;
  respondWith(response: Promise<Response>): void;
}

interface WorkerScope {
  readonly __SERVO_OFFLINE__: Precache;
  readonly location: Location;
  readonly clients: { claim(): Promise<void> };
  addEventListener(type: 'install' | 'activate', listener: (event: WaitEvent) => void): void;
  addEventListener(type: 'fetch', listener: (event: FetchEvent) => void): void;
}

const worker = self as unknown as WorkerScope;
const { version, files } = worker.__SERVO_OFFLINE__;
const PREFIX = 'servo-offline-';
const CACHE = `${PREFIX}${version}`;
const [INDEX] = files;

worker.addEventListener('install', (event) => {
  // `reload` skips the HTTP cache, so a file is never taken from an older build that shared its name.
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(files.map((file) => new Request(file, { cache: 'reload' })))));
});

worker.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name.startsWith(PREFIX) && name !== CACHE).map((name) => caches.delete(name))))
      .then(() => worker.clients.claim()),
  );
});

const cached = async (request: Request): Promise<Response> => {
  const cache = await caches.open(CACHE);
  // Vary is ignored: each file is cached once, by its address, and a module script's request carries an Origin header
  // that the request that cached it did not.
  const found = await cache.match(request.mode === 'navigate' && INDEX !== undefined ? INDEX : request, { ignoreVary: true });
  return found ?? fetch(request);
};

worker.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== worker.location.origin) return;
  event.respondWith(cached(request));
});
