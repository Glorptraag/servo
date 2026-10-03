// The store's Sync (task 5.5): pull, apply the conflict rule, push. With no remote it is local-only, which is also the
// offline path. With one it syncs as the store opens, whenever `now()` is called, and on reconnect; while the device
// is offline it waits and says so. A sync the remote refuses is tried again, 2 s later, then 4 s and so on up to 30 s.
// Nothing here is ever shown as a dialog (ground rule 9): the state is for the app to show as a line, if it wants one.
import type { StoreContext } from '../store/context.ts';
import type { Sync, SyncRemote, SyncState } from '../store/index.ts';
import { applyPull, cursorOf, markPushed, outbox } from './changes.ts';
import type { KeptCopy } from './changes.ts';
import { browserNetwork } from './network.ts';
import type { Network } from './network.ts';
import { RemoteUnreachable } from './remotes.ts';

export interface SyncOptions {
  /** Whether the device is online. Default: the browser's `navigator.onLine` and its online and offline events. */
  readonly network?: Network;
  /** Whether to sync as the store opens, when online. Default true. */
  readonly syncOnOpen?: boolean;
  /** Called with the copies each sync's conflict rule kept, so the app can say a copy was kept. */
  readonly onKept?: (copies: readonly KeptCopy[]) => void;
}

/** The store's Sync, and what the store does with it as it closes. */
export interface StoreSync extends Sync {
  /** Stops listening to the network and cancels a retry. A sync already running finishes or fails on its own. */
  dispose(): void;
}

const FIRST_RETRY_MS = 2_000;
const LAST_RETRY_MS = 30_000;

const localOnly = (): StoreSync => ({
  state: 'local-only',
  now: () => Promise.resolve(),
  subscribe: () => () => undefined,
  dispose: () => undefined,
});

export const syncFor = (ctx: StoreContext, remote: SyncRemote | undefined, options: SyncOptions = {}): StoreSync => {
  if (remote === undefined) return localOnly();
  const network = options.network ?? browserNetwork();
  const listeners = new Set<(state: SyncState) => void>();
  let state: SyncState = network.online() ? 'idle' : 'offline';
  let running: Promise<void> | null = null;
  let again = false;
  let retryMs = FIRST_RETRY_MS;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  const set = (next: SyncState): void => {
    if (next === state) return;
    state = next;
    for (const listener of [...listeners]) listener(next);
  };

  const cancelRetry = (): void => {
    if (retry !== undefined) clearTimeout(retry);
    retry = undefined;
  };

  const exchange = async (): Promise<void> => {
    const pulled = await remote.pull(await cursorOf(ctx.db));
    const kept = await applyPull(ctx, pulled);
    if (kept.length > 0) options.onKept?.(kept);
    const sending = await outbox(ctx.db);
    if (sending.changes.length > 0) {
      await remote.push(sending.changes);
      await markPushed(ctx, sending);
    }
  };

  // Two tabs of the app share the database: with Web Locks, one syncs at a time, so a change is never pushed twice.
  // Without them a change may be pushed twice, which every device takes as one.
  const locks = (globalThis as { readonly navigator?: { readonly locks?: LockManager } }).navigator?.locks;
  const once = (): Promise<void> => (locks ? locks.request(`servo-sync:${ctx.db.name}`, exchange) : exchange());

  /** One sync, then another if `now()` was called while it ran, since there may be new changes to send. */
  const run = async (): Promise<void> => {
    do {
      again = false;
      if (!network.online()) {
        set('offline');
        return;
      }
      set('syncing');
      try {
        await once();
      } catch (error) {
        if (disposed) return;
        if (error instanceof RemoteUnreachable || !network.online()) {
          set('offline');
          return;
        }
        set('failed');
        cancelRetry();
        retry = setTimeout(() => {
          retry = undefined;
          void now().catch(() => undefined);
        }, retryMs);
        retryMs = Math.min(retryMs * 2, LAST_RETRY_MS);
        throw error;
      }
      retryMs = FIRST_RETRY_MS;
      set(network.online() ? 'idle' : 'offline');
    } while (again && !disposed);
  };

  const now = (): Promise<void> => {
    if (disposed) return Promise.resolve();
    if (running) {
      again = true;
      return running;
    }
    cancelRetry();
    running = run().finally(() => {
      running = null;
    });
    return running;
  };

  const unsubscribe = network.subscribe((online) => {
    if (disposed) return;
    if (online) void now().catch(() => undefined);
    else if (!running) {
      cancelRetry();
      set('offline');
    }
  });

  if ((options.syncOnOpen ?? true) && network.online()) void now().catch(() => undefined);

  return {
    get state() {
      return state;
    },
    now,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose: () => {
      disposed = true;
      cancelRetry();
      unsubscribe();
      listeners.clear();
    },
  };
};
