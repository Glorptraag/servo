// Keeping each Run (task 4.4, docs/run-loop.md "Stop") in Node on fake-indexeddb: the run loop with the recorder, as the
// Run bar wires them, on the real sim-core and a real store. Each Run that started is kept with its number among the
// build's Runs, the Run before it, the child's profile and every tick; a Run stopped while loading is not; no child,
// or a store that refuses, keeps nothing and never stops a Run.
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import type { CanvasHandle, CanvasMode } from '@servo/canvas';
import { loadContent } from '@servo/content';
import { loadFixtures } from '@servo/content/fixtures';
import type { Blueprint } from '@servo/schema';
import { RunRecorder } from '../../src/run-bar/record.ts';
import { RunLoop, SPIN_UP_MS } from '../../src/run-bar/run-loop.ts';
import type { RunClock } from '../../src/run-bar/run-loop.ts';
import { openStoreWith } from '../../src/store/open.ts';
import type { ProfileStore } from '../../src/store/index.ts';
import { freshName } from '../store/support.ts';

const loaded = loadContent();
const roller = loadFixtures().fixtures.find((fixture) => fixture.name === 'level-1-roller')?.blueprint;
if (!roller) throw new Error('no level-1-roller fixture');

class StandIn {
  mode: CanvasMode = 'build';
  blueprint: Blueprint | undefined = roller;
  setMode(mode: CanvasMode): void {
    this.mode = mode;
  }
  applyRunFrame(): void {}
  on(): () => void {
    return () => undefined;
  }
}

class TestClock implements RunClock {
  time = 0;
  private waiting: (() => void) | undefined;
  now(): number {
    return this.time;
  }
  frame(callback: () => void): () => void {
    this.waiting = callback;
    return () => {
      if (this.waiting === callback) this.waiting = undefined;
    };
  }
  advance(ms: number): void {
    this.time += ms;
    const callback = this.waiting;
    this.waiting = undefined;
    callback?.();
  }
}

const times = (): (() => string) => {
  let second = 0;
  return () => {
    second += 1;
    return new Date(Date.UTC(2026, 9, 3, 10, 0, second)).toISOString();
  };
};

const setUp = async (child: () => ProfileStore | null) => {
  const recorder = new RunRecorder({ child, now: times() });
  const clock = new TestClock();
  const loop = new RunLoop({
    canvas: new StandIn() as unknown as CanvasHandle,
    catalogue: loaded.content.catalogue,
    clock,
    seed: () => 11,
    onStart: (build) => recorder.start(build),
    onEnd: (simulation) => recorder.end(simulation),
  });
  const runFor = async (ticks: number): Promise<void> => {
    await loop.run();
    clock.advance(SPIN_UP_MS);
    for (let tick = 1; tick < ticks; tick += 1) clock.advance(1000 / 30);
    loop.stop();
    await recorder.settled();
  };
  return { recorder, loop, runFor };
};

const openChild = async () => {
  const store = await openStoreWith(loaded, { name: freshName() });
  const profile = await store.profiles.create('Builder 1');
  return { store, child: store.forProfile(profile.id) };
};

describe('keeping each Run', () => {
  it('keeps each Run as it stops, numbered among the build’s Runs, with the Run before it and every tick', async () => {
    const { store, child } = await openChild();
    const { loop, runFor } = await setUp(() => child);
    await runFor(12);
    await runFor(20);
    const runs = await child.runs.list({ blueprintId: roller.meta.id });
    expect(runs.map((run) => run.runNumber)).toEqual([1, 2]);
    expect(runs.map((run) => run.ticks)).toEqual([12, 20]);
    expect(runs.every((run) => run.profile === child.profile && run.seed === 11 && run.blueprintId === roller.meta.id)).toBe(true);
    expect(runs.every((run) => run.challenge === undefined)).toBe(true);
    expect((runs[0]?.startedAt ?? '') < (runs[0]?.endedAt ?? '')).toBe(true);
    expect(runs[0]?.id).not.toBe(runs[1]?.id);
    loop.dispose();
    store.close();
  });

  it('keeps nothing for a Run stopped while it loads, or with no child', async () => {
    const { store, child } = await openChild();
    const { recorder, loop } = await setUp(() => child);
    const running = loop.run();
    loop.stop();
    await running;
    await recorder.settled();
    expect(await child.runs.list()).toEqual([]);
    loop.dispose();
    const none = await setUp(() => null);
    await none.runFor(5);
    none.loop.dispose();
    store.close();
  });

  it('never stops a Run when the store cannot keep it: a warning, not a dialog', async () => {
    const { store, child } = await openChild();
    const refusing: ProfileStore = { ...child, runs: { ...child.runs, add: () => Promise.reject(new Error('full')) } };
    const { loop, runFor } = await setUp(() => refusing);
    const warn = console.warn;
    const warnings: unknown[] = [];
    console.warn = (...args: unknown[]) => warnings.push(args[0]);
    try {
      await runFor(5);
      await runFor(5);
    } finally {
      console.warn = warn;
    }
    expect(warnings).toEqual(['This Run could not be kept on this device.', 'This Run could not be kept on this device.']);
    expect(loop.phase).toBe('build');
    loop.dispose();
    store.close();
  });
});
