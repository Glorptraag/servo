// The app's run loop (task 4.4) in Node: the real sim-core on a stand-in canvas that refuses every edit and load, with
// a clock the test moves. Run mode with tick 0 held for the spin-up; 30 ticks a second; slow motion one tick per step
// at 1 to 5 ticks a second; Stop giving back the build and tick 0 byte for byte (ground rule 4); the same Simulation and
// seed while the build is unchanged and a new one when it changes (D37); switch flips; the run record's hook; a build
// changed while the Run loads; a long gap; disposal.
import { describe, expect, it } from 'vitest';
import type { CanvasEventMap, CanvasHandle, CanvasMode } from '@servo/canvas';
import { loadContent } from '@servo/content';
import { loadFixtures } from '@servo/content/fixtures';
import { serializeBlueprint } from '@servo/schema';
import type { Blueprint } from '@servo/schema';
import type { RunFrame, Simulation } from '@servo/sim-core';
import { MAX_STEPS_PER_FRAME, NORMAL_RATE, RunLoop, SPIN_UP_MS, runKeyOf } from '../../src/run-bar/run-loop.ts';
import type { RunClock, RunLoopOptions, RunState } from '../../src/run-bar/run-loop.ts';

const { content } = loadContent();
const { catalogue } = content;
const fixture = (name: string): Blueprint => {
  const found = loadFixtures().fixtures.find((candidate) => candidate.name === name)?.blueprint;
  if (!found) throw new Error(`no fixture ${name}`);
  return found;
};
const roller = fixture('level-1-roller');
const switched = fixture('switch-in-the-line');
/** The roller with its return wire taken away: a changed build. */
const unwired: Blueprint = { ...roller, wires: roller.wires.filter((wire) => wire.id !== 'w10') };

/** What the loop may ask of the canvas: its build, its mode and frames. Anything that would change the build throws. */
class StandIn {
  mode: CanvasMode = 'build';
  blueprint: Blueprint | undefined;
  readonly frames: RunFrame[] = [];
  readonly modes: CanvasMode[] = [];
  private readonly controls = new Set<(event: CanvasEventMap['control']) => void>();
  constructor(blueprint: Blueprint) {
    this.blueprint = blueprint;
  }
  setMode(mode: CanvasMode): void {
    this.mode = mode;
    this.modes.push(mode);
  }
  applyRunFrame(frame: RunFrame): void {
    if (this.mode !== 'run') throw new Error('a frame in Build mode');
    this.frames.push(frame);
  }
  load(): never {
    throw new Error('the run loop never loads a build');
  }
  apply(): never {
    throw new Error('the run loop never edits a build');
  }
  on(type: keyof CanvasEventMap, listener: (event: CanvasEventMap['control']) => void): () => void {
    if (type !== 'control') throw new Error(`the run loop listens only for control, not ${type}`);
    this.controls.add(listener);
    return () => this.controls.delete(listener);
  }
  /** A tap on a switch, Enter with it selected, or the list view's flip (D30, D42). */
  flip(partId: string, closed: boolean): void {
    for (const listener of this.controls) listener({ input: { partId, kind: 'switch', closed } });
  }
}

/** A clock the test moves: each `advance` runs the frame callback that is waiting, once per call. */
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
  get pending(): boolean {
    return this.waiting !== undefined;
  }
  advance(ms: number): void {
    this.time += ms;
    const callback = this.waiting;
    this.waiting = undefined;
    callback?.();
  }
}

const loopOf = (blueprint: Blueprint, options: Partial<RunLoopOptions> = {}) => {
  const canvas = new StandIn(blueprint);
  const clock = new TestClock();
  const seeds: number[] = [];
  const states: RunState[] = [];
  const heard: RunFrame[] = [];
  const loop = new RunLoop({
    canvas: canvas as unknown as CanvasHandle,
    catalogue,
    clock,
    seed: () => {
      const seed = seeds.length + 7;
      seeds.push(seed);
      return seed;
    },
    ...options,
  });
  loop.subscribe((state, frame) => {
    if (frame) heard.push(frame);
    else states.push(state);
  });
  return { loop, canvas, clock, seeds, states, heard };
};

const STARTED = '2026-10-03T10:00:00.000Z';
const ENDED = '2026-10-03T10:00:01.000Z';

const ticksOf = (frames: readonly RunFrame[]): number[] => frames.map((frame) => frame.tick);

/** Past the spin-up, then one animation frame each `ms`, `frames` times. */
const playFor = (clock: TestClock, frames: number, ms = 1000 / 30): void => {
  clock.advance(SPIN_UP_MS);
  for (let frame = 1; frame < frames; frame += 1) clock.advance(ms);
};

/** The Simulation the loop holds, through the run record hook. */
const holding = (loop: RunLoop): Simulation => (loop as unknown as { simulation: Simulation }).simulation;

describe('the run loop', { timeout: 30_000 }, () => {
  it('puts the canvas in Run mode with tick 0 held for the one-second spin-up, then steps 30 ticks a second', async () => {
    const { loop, canvas, clock, states, heard } = loopOf(roller);
    expect(loop.rate).toBe(NORMAL_RATE);
    await loop.run();
    expect(canvas.mode).toBe('run');
    expect(loop.phase).toBe('spin-up');
    expect(ticksOf(canvas.frames)).toEqual([0]);
    clock.advance(SPIN_UP_MS - 1);
    expect(ticksOf(canvas.frames)).toEqual([0]);
    clock.advance(1);
    expect(loop.phase).toBe('running');
    for (let frame = 0; frame < 30; frame += 1) clock.advance(1000 / 30);
    expect(loop.tick).toBe(31);
    expect(ticksOf(canvas.frames)).toEqual(Array.from({ length: 32 }, (_, tick) => tick));
    // Listeners hear every frame the canvas is given, in tick order, and each change of phase.
    expect(heard).toEqual(canvas.frames);
    expect(states.map((state) => state.phase)).toEqual(['loading', 'spin-up', 'running']);
    loop.dispose();
  });

  it('gives back the build and tick 0 exactly on Stop, and the next Run of the unchanged build is the same run', async () => {
    const { loop, canvas, clock, seeds } = loopOf(roller);
    const before = serializeBlueprint(roller);
    await loop.run();
    const start = holding(loop).snapshot();
    playFor(clock, 45);
    const first = JSON.stringify(canvas.frames);
    expect(loop.tick).toBeGreaterThan(40);
    loop.stop();
    expect(loop.phase).toBe('build');
    expect(canvas.mode).toBe('build');
    expect(loop.tick).toBe(0);
    expect(clock.pending).toBe(false);
    // Ground rule 4: the build is untouched (the stand-in throws on any load or edit) and the Simulation is back at
    // tick 0, byte for byte.
    expect(canvas.blueprint).toBe(roller);
    expect(serializeBlueprint(roller)).toBe(before);
    const after = holding(loop).snapshot();
    expect(after.tick).toBe(0);
    expect(Buffer.from(after.bytes).equals(Buffer.from(start.bytes))).toBe(true);
    // D37: the same Simulation and seed, so the same run.
    canvas.frames.length = 0;
    await loop.run();
    playFor(clock, 45);
    expect(JSON.stringify(canvas.frames)).toBe(first);
    expect(seeds).toHaveLength(1);
    expect(canvas.modes).toEqual(['run', 'build', 'run']);
    loop.dispose();
    expect(canvas.mode).toBe('build');
  });

  it('makes a new Simulation with a new seed once the build has changed, and keeps it for a new name', async () => {
    const { loop, canvas, clock, seeds } = loopOf(roller);
    await loop.run();
    loop.stop();
    canvas.blueprint = { ...roller, meta: { ...roller.meta, name: 'Renamed' } };
    await loop.run();
    loop.stop();
    expect(seeds).toHaveLength(1);
    canvas.blueprint = unwired;
    expect(runKeyOf(canvas.blueprint)).not.toBe(runKeyOf(roller));
    await loop.run();
    expect(loop.phase).toBe('spin-up');
    expect(seeds).toHaveLength(2);
    expect(holding(loop).blueprint.wires.map((wire) => wire.id)).not.toContain('w10');
    playFor(clock, 3);
    loop.dispose();
  });

  it('steps one tick at a time in slow motion, at the rate the clock is set to, and changes speed mid-Run', async () => {
    const { loop, canvas, clock } = loopOf(roller, { rate: 1 });
    await loop.run();
    clock.advance(SPIN_UP_MS);
    expect(ticksOf(canvas.frames)).toEqual([0, 1]);
    // Animation frames come 60 a second; at 1 tick a second only the 60th steps.
    for (let frame = 0; frame < 59; frame += 1) clock.advance(1000 / 60);
    expect(ticksOf(canvas.frames)).toEqual([0, 1]);
    clock.advance(1000 / 60);
    expect(ticksOf(canvas.frames)).toEqual([0, 1, 2]);
    // Faster takes effect at once: at 5 a second, the next tick is due at most 200 ms on.
    loop.setRate(5);
    expect(loop.rate).toBe(5);
    clock.advance(200);
    expect(ticksOf(canvas.frames)).toEqual([0, 1, 2, 3]);
    for (let step = 0; step < 4; step += 1) clock.advance(200);
    expect(ticksOf(canvas.frames)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    // Never more than one tick per step in slow motion.
    loop.setRate(30);
    clock.advance(1000 / 30);
    expect(canvas.frames.at(-1)?.tick).toBe(8);
    // Rates are held to 1–30.
    loop.setRate(0);
    expect(loop.rate).toBe(1);
    loop.setRate(500);
    expect(loop.rate).toBe(30);
    loop.dispose();
  });

  it('gives the same frames at every speed: slow motion slows the clock, not the simulation', async () => {
    const fast = loopOf(roller);
    const slow = loopOf(roller, { rate: 2 });
    await fast.loop.run();
    await slow.loop.run();
    playFor(fast.clock, 20);
    playFor(slow.clock, 20, 500);
    expect(JSON.stringify(slow.canvas.frames)).toBe(JSON.stringify(fast.canvas.frames));
    fast.loop.dispose();
    slow.loop.dispose();
  });

  it('passes a switch flip from the canvas to the Simulation during a Run, and ignores one in Build mode', async () => {
    let ended: Simulation | undefined;
    const { loop, canvas, clock } = loopOf(switched, {
      onEnd: (simulation) => {
        ended = simulation;
      },
    });
    expect(loop.input({ partId: 'switch', kind: 'switch', closed: true })).toBe(false);
    canvas.flip('switch', true);
    await loop.run();
    playFor(clock, 3);
    const closed = canvas.frames.at(-1)?.live.get('switch')?.values.closed;
    expect(typeof closed).toBe('boolean');
    canvas.flip('switch', !closed);
    clock.advance(1000 / 30);
    expect(canvas.frames.at(-1)?.live.get('switch')?.values.closed).toBe(!closed);
    const inputs = holding(loop).record({ id: 'r', startedAt: STARTED, endedAt: ENDED, runNumber: 1, hints: [] }).inputs;
    expect(inputs).toEqual([{ tick: 3, partId: 'switch', kind: 'switch', closed: !closed }]);
    loop.stop();
    expect(ended).toBe(holding(loop));
    // Stopped, a flip goes nowhere.
    expect(loop.input({ partId: 'switch', kind: 'switch', closed: Boolean(closed) })).toBe(false);
    loop.dispose();
  });

  it('hands the Run to onEnd before restoring tick 0, so the record holds every tick, and only for a Run that started', async () => {
    const ticks: number[] = [];
    const starts: string[] = [];
    const { loop, clock } = loopOf(roller, {
      onStart: async (blueprint) => {
        starts.push(blueprint.meta.id);
        await Promise.resolve();
      },
      onEnd: (simulation) => {
        ticks.push(simulation.tick);
        expect(simulation.record({ id: 'r', startedAt: STARTED, endedAt: ENDED, runNumber: 1, hints: [], events: 'drop' }).ticks).toBe(simulation.tick);
      },
    });
    await loop.run();
    playFor(clock, 10);
    loop.stop();
    loop.stop();
    expect(ticks).toEqual([10]);
    // Stopped while it loads: nothing started, so nothing ends.
    const running = loop.run();
    loop.stop();
    await running;
    expect(ticks).toEqual([10]);
    expect(starts).toEqual([roller.meta.id, roller.meta.id]);
    loop.dispose();
  });

  it('runs the build as it is when the Run is ready, if the child changed it while the Run loaded', async () => {
    const { loop, canvas, clock, seeds } = loopOf(roller);
    const running = loop.run();
    expect(loop.phase).toBe('loading');
    canvas.blueprint = unwired;
    await running;
    expect(loop.phase).toBe('spin-up');
    expect(seeds).toHaveLength(2);
    expect(runKeyOf(holding(loop).blueprint)).toBe(runKeyOf(canvas.blueprint));
    playFor(clock, 2);
    loop.dispose();
  });

  it('skips a long gap rather than racing to catch up, and does nothing while already running', async () => {
    const { loop, canvas, clock } = loopOf(roller);
    await loop.run();
    await loop.run();
    playFor(clock, 5);
    const before = loop.tick;
    clock.advance(60_000);
    expect(loop.tick - before).toBe(MAX_STEPS_PER_FRAME);
    clock.advance(1000 / 30);
    expect(loop.tick - before).toBe(MAX_STEPS_PER_FRAME + 1);
    expect(canvas.frames.at(-1)?.tick).toBe(loop.tick);
    expect(canvas.modes).toEqual(['run']);
    loop.dispose();
  });

  it('fails with a plain state, never a throw, when the build cannot be run, and back in Build mode', async () => {
    const { loop, canvas, states } = loopOf({ ...roller, arena: { preset: 'no-such-arena', props: [] } });
    const warn = console.warn;
    const warnings: unknown[] = [];
    console.warn = (...args: unknown[]) => warnings.push(args[0]);
    try {
      await expect(loop.run()).resolves.toBeUndefined();
    } finally {
      console.warn = warn;
    }
    expect(loop.phase).toBe('failed');
    expect(states.at(-1)?.problem).toBe('This build could not be run.');
    expect(canvas.mode).toBe('build');
    expect(warnings).toEqual(['This build could not be run.']);
    loop.dispose();
  });

  it('toggles Run and Stop, and plays nothing once disposed', async () => {
    const { loop, canvas, clock } = loopOf(roller);
    loop.toggle();
    await vitestUntil(() => loop.phase === 'spin-up');
    loop.toggle();
    expect(loop.phase).toBe('build');
    const running = loop.run();
    loop.dispose();
    await running;
    expect(canvas.mode).toBe('build');
    expect(clock.pending).toBe(false);
    await loop.run();
    expect(loop.phase).toBe('build');
  });
});

/** Waits a few macrotasks for `done`. */
const vitestUntil = async (done: () => boolean): Promise<void> => {
  for (let tries = 0; tries < 200 && !done(); tries += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  expect(done()).toBe(true);
};
