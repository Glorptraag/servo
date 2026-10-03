// Shared by the accounts tests: stores on databases no other test meets, an in-memory localStorage, and an empty build.
import { openStore } from '@servo/app/store';
import type { ServoStore } from '@servo/app/store';

const names = new WeakMap<ServoStore, string>();

/** A store on a database of its own, with the content the app ships. */
export const open = async (): Promise<ServoStore> => {
  const name = `servo-parent-${crypto.randomUUID()}`;
  const store = await openStore({ name });
  names.set(store, name);
  return store;
};

/** The database a store from `open` is on: the journal's notes and the profile in use are kept under its name. */
export const databaseOf = (store: ServoStore): string => names.get(store) ?? '';

/** An empty Level 1 build on the plain floor. */
export const plainFloor = (name: string) => ({ name, level: 1, arena: { preset: 'open-floor', props: [] } }) as const;

/** An in-memory Storage, as localStorage behaves. */
export const memoryStorage = (): Storage => {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => void items.delete(key),
    setItem: (key, value) => void items.set(key, String(value)),
  };
};
