// @servo/app: the child's app. Task 4.1 draws the shell round the canvas; task 4.9 adds the store. See README.md.
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { loadContent } from '@servo/content';
import { App } from './App.tsx';
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

/**
 * Loads the content and draws the shell and the canvas in `host`, which needs a definite size: the shell fills it.
 * Resolves once the canvas is mounted. The store is not opened yet: task 4.9 adds it, and `options.store` with it.
 */
export const mountApp: MountApp = (host) =>
  new Promise<AppHandle>((resolve, reject) => {
    const { content } = loadContent();
    const root = createRoot(host, {
      onUncaughtError: (error) => {
        reject(error instanceof Error ? error : new Error(String(error)));
        reportError(error);
      },
    });
    const handle: AppHandle = { destroy: () => root.unmount() };
    root.render(createElement(App, { content, onReady: () => resolve(handle) }));
  });
