// Where the service worker is served, under the site's root: plugin.ts writes it there and index.ts registers it.
// Its own module, so the app's bundle never takes in the build plugin.
export const WORKER_FILE = 'sw.js';
