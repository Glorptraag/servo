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

/** One clock for every recorder in this file, so a later recorder's Runs come later. */
let second = 0;
const times = (): (() => string) => {
  return () => {
    second += 1;
    return new Date(Date.UTC(2026, 9, 3, 10, 0, second)).toISOString();
  };
};

const setUp = async (child: () => ProfileStore | null, wait = true) => {
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
  // The Run bar starts reading as the build comes onto the canvas.
  recorder.prepare(roller);
  if (wait) await recorder.settled();
  return { recorder, loop, clock, runFor };
};

const openChild = async () => {
  const store = await openStoreWith(loaded, { name: freshName() });
  const profile = await store.profiles.create('Builder 1');
  return { store, child: store.forProfile(profile.id) };
};

describe('keeping each Run', { timeout: 30_000 }, () => {
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
    // A second recorder, as after a reload, counts the Runs the store already holds.
    loop.dispose();
    const again = await setUp(() => child);
    await again.runFor(3);
    expect((await child.runs.list({ blueprintId: roller.meta.id })).map((run) => run.runNumber)).toEqual([1, 2, 3]);
    again.loop.dispose();
    store.close();
  });

  it('keeps no Run stopped before its first tick, so it never marks the Run before’s faults fixed (D31)', async () => {
    const { store, child } = await openChild();
    const { recorder, loop, runFor } = await setUp(() => child);
    await runFor(5);
    // Stopped in the spin-up, and stopped while it loads: neither stepped, so neither is kept.
    await loop.run();
    loop.stop();
    const loading = loop.run();
    loop.stop();
    await loading;
    await recorder.settled();
    await runFor(4);
    const runs = await child.runs.list({ blueprintId: roller.meta.id });
    expect(runs.map((run) => [run.runNumber, run.ticks])).toEqual([
      [1, 5],
      [2, 4],
    ]);
    loop.dispose();
    const none = await setUp(() => null);
    await none.runFor(5);
    none.loop.dispose();
    store.close();
  });

  it('never makes a Run wait on the store, and keeps a Run that ends once the store has answered', async () => {
    const { store, child } = await openChild();
    let answer: () => void = () => undefined;
    const answered = new Promise<void>((resolve) => {
      answer = resolve;
    });
    const slow: ProfileStore = { ...child, runs: { ...child.runs, list: (filter) => answered.then(() => child.runs.list(filter)) } };
    const { recorder, loop, clock } = await setUp(() => slow, false);
    const phases: string[] = [];
    loop.subscribe((state, frame) => {
      if (!frame) phases.push(state.phase);
    });
    // The first Run loads only the Simulation; the second, with the Simulation kept, has no loading at all.
    await loop.run();
    expect(loop.phase).toBe('spin-up');
    loop.stop();
    await loop.run();
    expect(phases).toEqual(['loading', 'spin-up', 'build', 'spin-up']);
    answer();
    await new Promise((resolve) => setTimeout(resolve, 20));
    clock.advance(SPIN_UP_MS);
    loop.stop();
    await recorder.settled();
    expect((await child.runs.list()).map((run) => [run.runNumber, run.ticks])).toEqual([[1, 1]]);
    loop.dispose();
    store.close();
  });

  it('runs on when the store never answers or cannot keep a Run: a warning, not a dialog', async () => {
    const { store, child } = await openChild();
    const never = new Promise<never>(() => undefined);
    const stalled: ProfileStore = { ...child, runs: { ...child.runs, list: () => never } };
    const refusing: ProfileStore = { ...child, runs: { ...child.runs, add: () => Promise.reject(new Error('full')) } };
    const warn = console.warn;
    const warnings: unknown[] = [];
    console.warn = (...args: unknown[]) => warnings.push(args[0]);
    try {
      const first = await setUp(() => stalled, false);
      await first.loop.run();
      expect(first.loop.phase).toBe('spin-up');
      first.clock.advance(SPIN_UP_MS);
      first.loop.stop();
      await first.loop.run();
      expect(first.loop.phase).toBe('spin-up');
      first.loop.dispose();
      const second = await setUp(() => refusing);
      await second.runFor(5);
      await second.runFor(5);
      expect(second.loop.phase).toBe('build');
      second.loop.dispose();
    } finally {
      console.warn = warn;
    }
    expect(warnings).toEqual([
      'The earlier Runs of this build were not read in time, so this Run is not kept.',
      'This Run could not be kept on this device.',
      'This Run could not be kept on this device.',
    ]);
    store.close();
  });
});
