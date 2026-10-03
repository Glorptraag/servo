// Offline (task 5.5): the web build's service worker keeps every file of the build on the device, so the full
// sandbox and every level baked into the build open and run with no network (brief Section 6). The store is already
// local-first (task 4.9), so builds, Runs and card games are kept offline too, and sync catches up on reconnect
// (src/sync/). main.tsx registers the worker; vite.config.ts builds it (plugin.ts). See README.md.
import { WORKER_FILE } from './worker-file.ts';

export interface OfflineOptions {
  /** Whether to register the worker. Default: in a production build only, so `pnpm dev` and the tests have none. */
  readonly enabled?: boolean;
}

/**
 * Registers the service worker once the page has loaded, so its downloads never slow the app's first start. Resolves
 * with the registration, or undefined where there is none: a dev build, a browser without service workers, a page
 * that is not a secure context (a laptop's plain http address on the home network), or a registration that failed.
 * A failure is never shown to the child: the app still works online, and the next start tries again.
 */
export const registerOffline = async (options: OfflineOptions = {}): Promise<ServiceWorkerRegistration | undefined> => {
  const enabled = options.enabled ?? import.meta.env.PROD;
  if (!enabled || !window.isSecureContext || !('serviceWorker' in navigator)) return undefined;
  if (document.readyState !== 'complete') await new Promise((loaded) => window.addEventListener('load', loaded, { once: true }));
  return navigator.serviceWorker.register(`${import.meta.env.BASE_URL}${WORKER_FILE}`, { scope: import.meta.env.BASE_URL }).catch((error: unknown) => {
    console.warn('The app could not be kept for offline use; it still works online.', error);
    return undefined;
  });
};
