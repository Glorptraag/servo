// @servo/app: the child's app. Task 4.1 builds it; until then mountApp rejects. See README.md.
import type { StoreOptions } from './store/index.ts';

export interface AppOptions {
  /** How to open the store. Tests and the e2e harness pass their own database name. */
  readonly store?: StoreOptions;
}

export interface AppHandle {
  /** Removes the app from its host and closes the store. */
  destroy(): void;
}

/**
 * Starts the child's app in `host`: opens the store, then draws the shell around the canvas. A shared link opens as
 * a read-only replay with "keep a copy" (D43). The web build and the e2e harness call it.
 */
export type MountApp = (host: HTMLElement, options?: AppOptions) => Promise<AppHandle>;

export const mountApp: MountApp = () => Promise.reject(new Error('mountApp is not implemented yet (task 4.1).'));
