// The access options' storage and store (task 5.7): every option starts off, anything unreadable counts as off, a
// refusing storage keeps them for the visit, the store tells its listeners only of real changes and follows another
// page's, and the canvas's prefs take the options without losing the drag sensitivity. Every word is plain: no
// exclamation marks and no praise (ground rule 7).
import { describe, expect, it, vi } from 'vitest';
import { ACCESS_KEY, ACCESS_OPTIONS, ACCESS_TEXT, AccessStore, DEFAULT_ACCESS, canvasPrefsFor, readAccess, writeAccess } from '../../src/a11y/index.ts';
import { DEFAULT_PREFS } from '../../src/shell/shell.tsx';

class MemoryStorage implements Storage {
  private readonly items = new Map<string, string>();
  get length(): number {
    return this.items.size;
  }
  clear(): void {
    this.items.clear();
  }
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.items.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
}

const refusing = (): Storage => {
  const storage = new MemoryStorage();
  storage.setItem = () => {
    throw new Error('QuotaExceededError');
  };
  storage.getItem = () => {
    throw new Error('SecurityError');
  };
  return storage;
};

describe('the access options in storage', () => {
  it('start off, with nothing stored and with no storage', () => {
    expect(readAccess(new MemoryStorage())).toEqual(DEFAULT_ACCESS);
    expect(readAccess(null)).toEqual(DEFAULT_ACCESS);
    expect(ACCESS_OPTIONS.every((option) => !DEFAULT_ACCESS[option])).toBe(true);
  });

  it('read back what was written', () => {
    const storage = new MemoryStorage();
    const prefs = { highContrast: true, dyslexiaType: false, leftHanded: true, readAloud: true };
    writeAccess(storage, prefs);
    expect(readAccess(storage)).toEqual(prefs);
  });

  it('count anything unreadable or not exactly true as off', () => {
    const storage = new MemoryStorage();
    for (const text of ['not json', 'null', '[true]', '"on"', '{"highContrast":"true","leftHanded":1,"readAloud":true,"other":true}']) {
      storage.setItem(ACCESS_KEY, text);
      const read = readAccess(storage);
      expect(Object.keys(read).sort()).toEqual([...ACCESS_OPTIONS].sort());
      expect(read.highContrast || read.leftHanded || read.dyslexiaType).toBe(false);
    }
    expect(readAccess(storage).readAloud).toBe(true);
  });

  it('survive a storage that refuses to read or write', () => {
    expect(readAccess(refusing())).toEqual(DEFAULT_ACCESS);
    expect(() => writeAccess(refusing(), { ...DEFAULT_ACCESS, highContrast: true })).not.toThrow();
    const store = new AccessStore(refusing());
    store.set('highContrast', true);
    expect(store.prefs.highContrast).toBe(true);
  });
});

describe('the access store', () => {
  it('tells its listeners of a change once, keeps it, and gives the same object while nothing changes', () => {
    const storage = new MemoryStorage();
    const store = new AccessStore(storage);
    const heard = vi.fn();
    const off = store.subscribe(heard);
    const before = store.prefs;
    store.set('readAloud', false);
    expect(store.prefs).toBe(before);
    expect(heard).not.toHaveBeenCalled();
    store.set('leftHanded', true);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(store.prefs.leftHanded).toBe(true);
    expect(readAccess(storage).leftHanded).toBe(true);
    off();
    store.set('leftHanded', false);
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it("follows another page's change through the storage event, and only for its key", () => {
    const storage = new MemoryStorage();
    const store = new AccessStore(storage);
    const listeners = new Set<(event: StorageEvent) => void>();
    const view = {
      addEventListener: (_type: string, listener: (event: StorageEvent) => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: (event: StorageEvent) => void) => listeners.delete(listener),
    } as unknown as Window;
    const off = store.follow(view);
    writeAccess(storage, { ...DEFAULT_ACCESS, highContrast: true });
    for (const listener of listeners) listener({ key: 'servo.sound.muted' } as StorageEvent);
    expect(store.prefs.highContrast).toBe(false);
    for (const listener of listeners) listener({ key: ACCESS_KEY } as StorageEvent);
    expect(store.prefs.highContrast).toBe(true);
    off();
    expect(listeners.size).toBe(0);
  });
});

describe("the canvas's prefs", () => {
  it('take high contrast, the typeface and the hand, and keep the drag sensitivity', () => {
    const base = { ...DEFAULT_PREFS, dragSensitivity: 0.5 };
    expect(canvasPrefsFor(DEFAULT_ACCESS, base)).toBe(base);
    expect(canvasPrefsFor({ highContrast: true, dyslexiaType: true, leftHanded: true, readAloud: true }, base)).toEqual({
      dragSensitivity: 0.5,
      highContrast: true,
      typeface: 'dyslexia-friendly',
      leftHanded: true,
    });
    expect(canvasPrefsFor({ ...DEFAULT_ACCESS, readAloud: true }, base)).toBe(base);
  });
});

describe('the words', () => {
  const words = [ACCESS_TEXT.heading, ...Object.values(ACCESS_TEXT.options).flatMap((option) => [option.name, option.line])];

  it('name every option, with no exclamation marks and no praise', () => {
    expect(Object.keys(ACCESS_TEXT.options).sort()).toEqual([...ACCESS_OPTIONS].sort());
    for (const line of words) {
      expect(line).not.toMatch(/!/);
      expect(line).not.toMatch(/\b(great|well done|awesome|amazing|good job|nice|brilliant)\b/i);
    }
  });
});
