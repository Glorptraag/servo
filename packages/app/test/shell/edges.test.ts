// Where the tuck states persist (src/shell/edges.ts): localStorage, guarded, so a storage that is missing, full or
// blocked never stops the shell. The browser tests reload a real page to show they survive.
import { describe, expect, it } from 'vitest';
import { ALL_OPEN, EDGES, EDGE_NAMES, TUCKED_KEY, readTucked, writeTucked } from '../../src/shell/edges.ts';

/** An in-memory Storage, as a browser gives one. */
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
    this.items.set(key, String(value));
  }
}

/** A storage that refuses everything, as Safari can when site data is blocked. */
class RefusingStorage extends MemoryStorage {
  override getItem(): string | null {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  }
  override setItem(): void {
    throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
  }
}

describe('tuck states', () => {
  it('names every edge as the brief does', () => {
    expect(EDGES.map((edge) => EDGE_NAMES[edge])).toEqual(['Header', 'Part tray', 'Spec card', 'Arena strip', 'Run bar']);
  });

  it('start with every edge open', () => {
    expect(readTucked(new MemoryStorage())).toEqual(ALL_OPEN);
    expect(readTucked(null)).toEqual(ALL_OPEN);
  });

  it('round-trip through storage as a list of the tucked edges', () => {
    const storage = new MemoryStorage();
    writeTucked(storage, { ...ALL_OPEN, tray: true, runBar: true });
    expect(storage.getItem(TUCKED_KEY)).toBe('["tray","runBar"]');
    expect(readTucked(storage)).toEqual({ ...ALL_OPEN, tray: true, runBar: true });
    writeTucked(storage, ALL_OPEN);
    expect(readTucked(storage)).toEqual(ALL_OPEN);
  });

  it('read anything unreadable or unknown as open', () => {
    const storage = new MemoryStorage();
    for (const saved of ['not json', '{"tray":true}', '"tray"', '7', 'null']) {
      storage.setItem(TUCKED_KEY, saved);
      expect(readTucked(storage), saved).toEqual(ALL_OPEN);
    }
    storage.setItem(TUCKED_KEY, '["tray","dashboard",3,null,"specCard","tray"]');
    expect(readTucked(storage)).toEqual({ ...ALL_OPEN, tray: true, specCard: true });
  });

  it('never throw when the storage refuses', () => {
    const storage = new RefusingStorage();
    expect(readTucked(storage)).toEqual(ALL_OPEN);
    expect(() => writeTucked(storage, { ...ALL_OPEN, header: true })).not.toThrow();
    expect(() => writeTucked(null, ALL_OPEN)).not.toThrow();
  });
});
