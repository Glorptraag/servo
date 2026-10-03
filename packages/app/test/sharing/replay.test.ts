// The shared build's replay (task 5.6) in Node: the real sim-core on a stand-in canvas, with a clock the test moves.
// Run mode with tick 0 held for the spin-up, 30 ticks a second, Stop back to tick 0 in Build mode, Run again the
// same run, the same run on every device, and a canvas that cannot draw frames ending the replay without a throw.
import { describe, expect, it } from 'vitest';
import type { CanvasHandle, CanvasMode } from '@servo/canvas';
import { loadContent } from '@servo/content';
import { loadFixtures } from '@servo/content/fixtures';
import type { Blueprint } from '@servo/schema';
import { createSimulation } from '@servo/sim-core';
import type { RunFrame } from '@servo/sim-core';
import { readShareFragment, shareLinkOf } from '../../src/sharing/link.ts';
import { MAX_STEPS_PER_FRAME, Replay, SPIN_UP_MS } from '../../src/sharing/replay.ts';
import type { ReplayClock, ReplayPhase } from '../../src/sharing/replay.ts';

const { content } = loadContent();
const { catalogue } = content;
const roller = loadFixtures().fixtures.find((fixture) => fixture.name === 'level-1-roller')?.blueprint;
if (!roller) throw new Error('no level-1-roller fixture');

/** What the replay asks of the canvas: its mode, and the frames it is handed. */
class StandIn {
  mode: CanvasMode = 'build';
  readonly frames: RunFrame[] = [];
  readonly modes: CanvasMode[] = [];
  failFrames = false;
  setMode(mode: CanvasMode): void {
    this.mode = mode;
    this.modes.push(mode);
  }
  applyRunFrame(frame: RunFrame): void {
    if (this.failFrames) throw new Error('applyRunFrame is task 3.5');
    this.frames.push(frame);
  }
}

/** A clock the test moves: each `advance` runs the frame callback that is waiting, once per call. */
class TestClock implements ReplayClock {
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

const opened = async (blueprint: Blueprint): Promise<{ blueprint: Blueprint; seed: number }> => {
  const link = await shareLinkOf(blueprint, catalogue, { base: 'https://servo.example/' });
  if (!link.ok) throw new Error('no link');
  const read = await readShareFragment(link.fragment, catalogue);
  if (!read.ok) throw new Error('not opened');
  return read;
};

const replayOf = async (blueprint: Blueprint) => {
  const { blueprint: shared, seed } = await opened(blueprint);
  const canvas = new StandIn();
  const clock = new TestClock();
  const phases: ReplayPhase[] = [];
  const replay = new Replay({ canvas: canvas as unknown as CanvasHandle, blueprint: shared, catalogue, seed, clock, onChange: (phase) => phases.push(phase) });
  return { replay, canvas, clock, phases, seed, shared };
};

/** Plays the replay for `ticks` ticks past the spin-up, a 30th of a second per animation frame. */
const playFor = (clock: TestClock, ticks: number): void => {
  clock.advance(SPIN_UP_MS);
  for (let tick = 1; tick < ticks; tick += 1) clock.advance(1000 / 30);
};

const ticksOf = (frames: readonly RunFrame[]): number[] => frames.map((frame) => frame.tick);

describe('the shared build’s replay', () => {
  it('runs on the canvas: Run mode, tick 0 held for the spin-up, then 30 ticks a second', async () => {
    const { replay, canvas, clock, phases } = await replayOf(roller);
    await replay.play();
    expect(canvas.mode).toBe('run');
    expect(ticksOf(canvas.frames)).toEqual([0]);
    expect(replay.phase).toBe('spin-up');
    clock.advance(SPIN_UP_MS / 2);
    expect(ticksOf(canvas.frames)).toEqual([0]);
    clock.advance(SPIN_UP_MS / 2);
    expect(replay.phase).toBe('running');
    expect(ticksOf(canvas.frames)).toEqual([0, 1]);
    for (let frame = 0; frame < 30; frame += 1) clock.advance(1000 / 30);
    expect(replay.tick).toBe(31);
    expect(ticksOf(canvas.frames)).toEqual(Array.from({ length: 32 }, (_, tick) => tick));
    expect(phases.slice(0, 3)).toEqual(['loading', 'spin-up', 'running']);
    replay.dispose();
  });

  it('is the same run as the build’s own Run with the link’s seed, on every device', async () => {
    const first = await replayOf(roller);
    const second = await replayOf(roller);
    await first.replay.play();
    await second.replay.play();
    playFor(first.clock, 60);
    playFor(second.clock, 60);
    expect(first.canvas.frames.length).toBe(61);
    expect(JSON.stringify(second.canvas.frames)).toBe(JSON.stringify(first.canvas.frames));
    const arena = catalogue.arenas?.get(first.shared.arena.preset);
    if (!arena) throw new Error('no arena');
    const own = await createSimulation({ blueprint: first.shared, catalogue, arena, seed: first.seed });
    const frames = [own.frame, ...Array.from({ length: 60 }, () => own.step())];
    own.dispose();
    expect(JSON.stringify(first.canvas.frames)).toBe(JSON.stringify(frames));
    // The robot moves: the replay is a run, not a still.
    expect(first.canvas.frames.some((frame) => frame.events.some((event) => event.tick > 0))).toBe(true);
    first.replay.dispose();
    second.replay.dispose();
  });

  it('stops back at tick 0 in Build mode, and Run again plays the same run from there', async () => {
    const { replay, canvas, clock } = await replayOf(roller);
    await replay.play();
    playFor(clock, 20);
    const firstRun = JSON.stringify(canvas.frames);
    replay.stop();
    expect(replay.phase).toBe('stopped');
    expect(canvas.mode).toBe('build');
    expect(replay.tick).toBe(0);
    expect(clock.pending).toBe(false);
    canvas.frames.length = 0;
    await replay.play();
    playFor(clock, 20);
    expect(JSON.stringify(canvas.frames)).toBe(firstRun);
    expect(canvas.modes).toEqual(['run', 'build', 'run']);
    replay.dispose();
    expect(canvas.mode).toBe('build');
  });

  it('skips a long gap, as when the page was hidden, rather than racing to catch up', async () => {
    const { replay, canvas, clock } = await replayOf(roller);
    await replay.play();
    playFor(clock, 5);
    const before = replay.tick;
    clock.advance(60_000);
    expect(replay.tick - before).toBe(MAX_STEPS_PER_FRAME);
    clock.advance(1000 / 30);
    expect(replay.tick - before).toBe(MAX_STEPS_PER_FRAME + 1);
    expect(canvas.frames.at(-1)?.tick).toBe(replay.tick);
    replay.dispose();
  });

  it('ends with a plain state, never a throw, when the canvas cannot draw a frame', async () => {
    const { replay, canvas } = await replayOf(roller);
    canvas.failFrames = true;
    const warn = console.warn;
    const warnings: unknown[] = [];
    console.warn = (...args: unknown[]) => warnings.push(args[0]);
    try {
      await expect(replay.play()).resolves.toBeUndefined();
    } finally {
      console.warn = warn;
    }
    expect(replay.phase).toBe('failed');
    expect(canvas.mode).toBe('build');
    expect(warnings).toEqual(['The replay could not be drawn.']);
    replay.dispose();
  });

  it('plays nothing once disposed, even when disposed while the run was being made', async () => {
    const { replay, canvas, clock } = await replayOf(roller);
    const playing = replay.play();
    replay.dispose();
    await playing;
    expect(canvas.frames).toEqual([]);
    expect(canvas.mode).toBe('build');
    expect(clock.pending).toBe(false);
    await replay.play();
    expect(canvas.frames).toEqual([]);
  });

  it('plays nothing when stopped while the run was being made, and plays on Run again', async () => {
    const { replay, canvas, clock } = await replayOf(roller);
    const playing = replay.play();
    replay.stop();
    await playing;
    expect(canvas.frames).toEqual([]);
    expect(clock.pending).toBe(false);
    await replay.play();
    expect(replay.phase).toBe('spin-up');
    expect(ticksOf(canvas.frames)).toEqual([0]);
    replay.dispose();
  });
});
