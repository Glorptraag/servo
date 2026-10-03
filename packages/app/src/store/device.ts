// What the store keeps beside its database in the page's localStorage, which is this device's alone and never syncs:
// the profile in use on this device (task 5.1), and the autosave journal's notes (task 4.9, src/shell/autosave.ts),
// which go with their profile when it is removed (D38, review R-4.9 finding 12). Each item names the database, so two
// stores on one device never share one. See docs/store.md.
import type { ProfileId } from '@servo/schema';
import { isRecord } from './context.ts';

/** The start of every journal note's key: then the database's name, the page and the build. */
export const UNSAVED_PREFIX = 'servo.unsaved:';

/** The start of the key that holds the profile in use on this device: then the database's name. */
export const IN_USE_PREFIX = 'servo.profile:';

/**
 * The page's localStorage, or null where the page has none. Reading `localStorage` itself throws in some browsers
 * when site data is blocked, so even the lookup is guarded.
 */
export const deviceStorage = (): Storage | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

/** The id of the profile chosen for this device, as stored, or undefined. */
export const chosenProfile = (storage: Storage | null, scope: string): string | undefined => {
  try {
    return storage?.getItem(`${IN_USE_PREFIX}${scope}`) ?? undefined;
  } catch {
    return undefined;
  }
};

/** Chooses `profile` for this device. Throws when the storage refuses the write. */
export const chooseProfile = (storage: Storage, scope: string, profile: ProfileId): void => {
  storage.setItem(`${IN_USE_PREFIX}${scope}`, profile);
};

/** The start of the BroadcastChannel's name on which a store says its profiles changed: then the database's name. */
export const PROFILES_CHANNEL_PREFIX = 'servo.profiles:';

/**
 * Tells this device's other pages on the same database that the profiles, or the one in use, may have changed: the
 * parent view's switch, a child added or removed. A page with no BroadcastChannel says nothing, and its listeners still
 * hear the in-use key change through the `storage` event.
 */
export const announceProfiles = (scope: string): void => {
  try {
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel(`${PROFILES_CHANNEL_PREFIX}${scope}`);
    channel.postMessage('changed');
    channel.close();
  } catch {
    // Another page then learns of the change when it next opens.
  }
};

/**
 * Calls `listener` whenever another page of this device may have changed the profiles of the database `scope`: the
 * in-use key changed (`storage` event, which also fires when the page's storage is cleared), or a store announced a
 * change. It may be called when nothing changed for this page, so the listener reads the store again. Returns the
 * unsubscribe function.
 */
export const onProfilesChanged = (scope: string, listener: () => void): (() => void) => {
  const key = `${IN_USE_PREFIX}${scope}`;
  const onStorage = (event: StorageEvent) => {
    if (event.key === key || event.key === null) listener();
  };
  const target = typeof window === 'undefined' ? undefined : window;
  target?.addEventListener('storage', onStorage);
  let channel: BroadcastChannel | undefined;
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel(`${PROFILES_CHANNEL_PREFIX}${scope}`);
      channel.onmessage = () => listener();
    }
  } catch {
    channel = undefined;
  }
  return () => {
    target?.removeEventListener('storage', onStorage);
    channel?.close();
  };
};

/** The profile a journal note belongs to, or undefined for a note that cannot be read. */
const profileOfNote = (text: string | null): unknown => {
  try {
    const value: unknown = JSON.parse(text ?? 'null');
    return isRecord(value) ? value.profile : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Forgets everything this device keeps outside the database for a removed profile: its journal notes, which hold
 * whole builds, and the choice of it as the profile in use. Other profiles' notes, and other databases', stay.
 */
export const forgetProfileOnDevice = (storage: Storage | null, scope: string, profile: ProfileId): void => {
  if (!storage) return;
  try {
    const prefix = `${UNSAVED_PREFIX}${scope}:`;
    const items: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const item = storage.key(index);
      if (item?.startsWith(prefix) && profileOfNote(storage.getItem(item)) === profile) items.push(item);
    }
    for (const item of items) storage.removeItem(item);
    if (chosenProfile(storage, scope) === profile) storage.removeItem(`${IN_USE_PREFIX}${scope}`);
  } catch (error) {
    console.warn('What this device noted for the removed profile could not all be cleared.', error);
  }
};
