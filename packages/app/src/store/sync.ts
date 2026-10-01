// The sync seam (D10, D13). With no remote, the default until a host is chosen, the store is local-only, which is also
// the offline path: `now()` resolves at once. Pulling, the conflict rule and pushing are task 5.5's, so with a remote
// `now()` rejects until then. Meanwhile every write records its change (changes.ts) for 5.5 to push.
import type { Sync, SyncRemote, SyncState } from './index.ts';

export const syncOf = (remote: SyncRemote | undefined): Sync => {
  const state: SyncState = remote === undefined ? 'local-only' : 'idle';
  const listeners = new Set<(state: SyncState) => void>();
  return {
    get state() {
      return state;
    },
    now: () => (remote === undefined ? Promise.resolve() : Promise.reject(new Error('Sync with a remote is not implemented yet (task 5.5).'))),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};
