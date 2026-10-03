// Whether the device can reach the network, as the browser reports it (task 5.5). Sync waits while it cannot, and
// syncs on reconnect. A page with no `navigator.onLine` or no window events (Node, tests) counts as always online.

export interface Network {
  online(): boolean;
  /** Called with the new value whenever the device goes on or off line. Returns the unsubscribe function. */
  subscribe(listener: (online: boolean) => void): () => void;
}

interface BrowserGlobals {
  readonly navigator?: { readonly onLine?: boolean };
  readonly addEventListener?: (type: string, listener: () => void) => void;
  readonly removeEventListener?: (type: string, listener: () => void) => void;
}

export const browserNetwork = (): Network => {
  const page = globalThis as BrowserGlobals;
  return {
    online: () => page.navigator?.onLine !== false,
    subscribe: (listener) => {
      const { addEventListener, removeEventListener } = page;
      if (typeof addEventListener !== 'function' || typeof removeEventListener !== 'function') return () => undefined;
      const on = (): void => listener(true);
      const off = (): void => listener(false);
      addEventListener.call(page, 'online', on);
      addEventListener.call(page, 'offline', off);
      return () => {
        removeEventListener.call(page, 'online', on);
        removeEventListener.call(page, 'offline', off);
      };
    },
  };
};

/** A network a test switches by hand. */
export interface ManualNetwork extends Network {
  set(online: boolean): void;
}

export const manualNetwork = (start = true): ManualNetwork => {
  let online = start;
  const listeners = new Set<(online: boolean) => void>();
  return {
    online: () => online,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set: (next) => {
      if (next === online) return;
      online = next;
      for (const listener of [...listeners]) listener(next);
    },
  };
};
