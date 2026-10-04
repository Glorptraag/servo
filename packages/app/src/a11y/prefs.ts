// The access options (brief Section 13, task 5.7): high contrast, dyslexia-friendly type, the left-handed mirror and
// read-aloud. They are this device's settings, as sound on and off is (src/sound/mute.ts), so they live in
// localStorage beside it, never in the store, and never sync. Every option starts off. One AccessStore per page holds
// them; Settings writes through it, the shell and the canvas follow it, and another page of the app on this device
// hears the change through the `storage` event.
import type { CanvasPrefs } from '@servo/canvas';

export interface AccessPrefs {
  /** The high-contrast theme on the chrome and the spec card, and the canvas's high-contrast palette. */
  readonly highContrast: boolean;
  /** The dyslexia-friendly typeface and spacing on the chrome, the spec card and the canvas. */
  readonly dyslexiaType: boolean;
  /** The left-handed mirror: the tray and the spec card swap sides, and so do the canvas's handles. */
  readonly leftHanded: boolean;
  /** Read-aloud: a tap on any words, or keyboard focus on a control, reads them, and new status lines are read too. */
  readonly readAloud: boolean;
}

export const ACCESS_OPTIONS = ['highContrast', 'dyslexiaType', 'leftHanded', 'readAloud'] as const;

export type AccessOption = (typeof ACCESS_OPTIONS)[number];

export const DEFAULT_ACCESS: AccessPrefs = { highContrast: false, dyslexiaType: false, leftHanded: false, readAloud: false };

/** The localStorage key: a JSON object of the options that are on. */
export const ACCESS_KEY = 'servo.access';

/** The options saved in `storage`. Anything missing, unreadable or not exactly `true` counts as off. */
export const readAccess = (storage: Storage | null): AccessPrefs => {
  let saved: unknown;
  try {
    saved = JSON.parse(storage?.getItem(ACCESS_KEY) ?? '{}');
  } catch {
    return DEFAULT_ACCESS;
  }
  if (typeof saved !== 'object' || saved === null) return DEFAULT_ACCESS;
  const on = (option: AccessOption): boolean => (saved as Record<string, unknown>)[option] === true;
  return { highContrast: on('highContrast'), dyslexiaType: on('dyslexiaType'), leftHanded: on('leftHanded'), readAloud: on('readAloud') };
};

/** Keeps the options. A storage that refuses (full, blocked, private browsing) keeps them for this visit only. */
export const writeAccess = (storage: Storage | null, prefs: AccessPrefs): void => {
  try {
    storage?.setItem(ACCESS_KEY, JSON.stringify(Object.fromEntries(ACCESS_OPTIONS.map((option) => [option, prefs[option]]))));
  } catch {
    // Nothing to do: the page still follows the options until it closes.
  }
};

const same = (a: AccessPrefs, b: AccessPrefs): boolean => ACCESS_OPTIONS.every((option) => a[option] === b[option]);

/** The canvas's prefs with the access options laid over `base`; `base` itself when nothing differs. */
export const canvasPrefsFor = (access: AccessPrefs, base: CanvasPrefs): CanvasPrefs => {
  const typeface = access.dyslexiaType ? 'dyslexia-friendly' : 'standard';
  if (base.highContrast === access.highContrast && base.leftHanded === access.leftHanded && base.typeface === typeface) return base;
  return { ...base, highContrast: access.highContrast, leftHanded: access.leftHanded, typeface };
};

/** The page's access options, for useSyncExternalStore: `prefs` is a new object only when an option changed. */
export class AccessStore {
  private readonly storage: Storage | null;
  private current: AccessPrefs;
  private readonly listeners = new Set<() => void>();

  constructor(storage: Storage | null) {
    this.storage = storage;
    this.current = readAccess(storage);
  }

  get prefs(): AccessPrefs {
    return this.current;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Turns one option on or off and keeps it. */
  set(option: AccessOption, on: boolean): void {
    if (this.current[option] === on) return;
    this.replace({ ...this.current, [option]: on });
    writeAccess(this.storage, this.current);
  }

  /** Reads the options again: another page of this device may have changed them. */
  reload(): void {
    this.replace(readAccess(this.storage));
  }

  /** Follows changes another page makes, through `view`'s `storage` event. Returns the unsubscribe function. */
  follow(view: Pick<Window, 'addEventListener' | 'removeEventListener'>): () => void {
    const onStorage = (event: StorageEvent): void => {
      if (event.key === ACCESS_KEY || event.key === null) this.reload();
    };
    view.addEventListener('storage', onStorage);
    return () => view.removeEventListener('storage', onStorage);
  }

  private replace(next: AccessPrefs): void {
    if (same(next, this.current)) return;
    this.current = next;
    for (const listener of [...this.listeners]) listener();
  }
}
