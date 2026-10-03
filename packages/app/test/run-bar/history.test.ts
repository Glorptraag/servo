// Undo's history (task 4.4): each edit is one step back, Undo walks back through them, another build starts it again.
import { describe, expect, it } from 'vitest';
import { loadFixtures } from '@servo/content/fixtures';
import type { Blueprint } from '@servo/schema';
import { UndoHistory } from '../../src/run-bar/history.ts';

const [first, other] = loadFixtures().fixtures.map((fixture) => fixture.blueprint);
if (!first || !other) throw new Error('two fixtures needed');
const named = (name: string): Blueprint => ({ ...first, meta: { ...first.meta, name } });

describe('Undo’s history', () => {
  it('steps back through every edit, one at a time, to the build as it was loaded', () => {
    const history = new UndoHistory();
    history.loaded(first);
    expect(history.size).toBe(0);
    const a = named('A');
    const b = named('B');
    history.edited(a);
    history.edited(b);
    expect(history.current).toBe(b);
    expect(history.size).toBe(2);
    expect(history.undo()).toBe(a);
    expect(history.current).toBe(a);
    expect(history.undo()).toBe(first);
    expect(history.undo()).toBeUndefined();
    expect(history.current).toBe(first);
  });

  it('keeps the canonical form the canvas loaded, and a new edit after Undo carries on from it', () => {
    const history = new UndoHistory();
    history.loaded(first);
    history.edited(named('A'));
    const back = history.undo();
    const canonical = { ...back } as Blueprint;
    history.settle(canonical);
    history.edited(named('C'));
    expect(history.undo()).toBe(canonical);
  });

  it('starts again for another build, and takes another form of the same build as one step', () => {
    const history = new UndoHistory();
    history.loaded(first);
    history.edited(named('A'));
    history.loaded(other);
    expect(history.size).toBe(0);
    expect(history.current).toBe(other);
    const again = { ...other, meta: { ...other.meta, name: 'Again' } };
    history.loaded(again);
    expect(history.undo()).toBe(other);
  });

  it('keeps at most its limit of steps, dropping the oldest', () => {
    const history = new UndoHistory(3);
    history.loaded(first);
    const steps = ['A', 'B', 'C', 'D', 'E'].map(named);
    for (const step of steps) history.edited(step);
    expect(history.size).toBe(3);
    expect([history.undo(), history.undo(), history.undo(), history.undo()]).toEqual([steps[3], steps[2], steps[1], undefined]);
  });
});
