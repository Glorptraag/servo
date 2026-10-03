// The sound layer (task 4.10) in Node, on the real sim-core and the app's run loop with a stand-in canvas and a clock
// the test moves, and a sink that writes down every cue instead of playing it. A recorded Run's sound events and the
// machine cues the layer played are the same list, one for one, for every machine sound sim-core makes (motor, hum,
// buzz, squeal, knock), at normal speed and in slow motion, Run after Run. The whir once per Run, a tick per step only in
// slow motion, every sound stopped on Stop, a click per wire landed, and nothing at all without a Run or an edit. Sound
// off persists on the device, and the cues still reach the sink, which stays silent.
import { describe, expect, it } from 'vitest';
import type { CanvasEventMap, CanvasHandle, CanvasMode, EditCommand } from '@servo/canvas';
import { loadContent } from '@servo/content';
import { loadFixtures } from '@servo/content/fixtures';
import type { Blueprint, RunRecord, RunSound } from '@servo/schema';
import type { Simulation } from '@servo/sim-core';
import { RunLoop, SPIN_UP_MS } from '../../src/run-bar/run-loop.ts';
import type { RunClock } from '../../src/run-bar/run-loop.ts';
import { MUTED_KEY, SoundLayer, landsAWire, machineCuesOf } from '../../src/sound/index.ts';
import type { AudioSink, SoundCue } from '../../src/sound/index.ts';

const { content } = loadContent();
const fixture = (name: string): Blueprint => {
  const found = loadFixtures().fixtures.find((candidate) => candidate.name === name)?.blueprint;
  if (!found) throw new Error(`no fixture ${name}`);
  return found;
};

/** The canvas as the loop and the layer reach it: its build, its mode, frames, and its control and edit events. */
class StandIn {
  mode: CanvasMode = 'build';
  readonly blueprint: Blueprint;
  private readonly listeners = new Map<string, Set<(event: never) => void>>();
  constructor(blueprint: Blueprint) {
    this.blueprint = blueprint;
  }
  setMode(mode: CanvasMode): void {
    this.mode = mode;
  }
  applyRunFrame(): void {
    if (this.mode !== 'run') throw new Error('a frame in Build mode');
  }
  on<K extends keyof CanvasEventMap>(type: K, listener: (event: CanvasEventMap[K]) => void): () => void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener as (event: never) => void);
    this.listeners.set(type, set);
    return () => set.delete(listener as (event: never) => void);
  }
  edit(command: EditCommand): void {
    for (const listener of this.listeners.get('edit') ?? []) (listener as (event: CanvasEventMap['edit']) => void)({ command, blueprint: this.blueprint });
  }
  get handle(): CanvasHandle {
    return this as unknown as CanvasHandle;
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

/** A sink that writes down what it is asked to play, and whether sound is off. */
class Heard implements AudioSink {
  readonly cues: SoundCue[] = [];
  readonly mutes: boolean[] = [];
  unlocks = 0;
  closed = false;
  play(cue: SoundCue): void {
    this.cues.push(cue);
  }
  setMuted(muted: boolean): void {
    this.mutes.push(muted);
  }
  unlock(): void {
    this.unlocks += 1;
  }
  close(): void {
    this.closed = true;
  }
  of<K extends SoundCue['kind']>(kind: K): Extract<SoundCue, { kind: K }>[] {
    return this.cues.filter((cue): cue is Extract<SoundCue, { kind: K }> => cue.kind === kind);
  }
  clear(): void {
    this.cues.length = 0;
  }
}

/** A Storage held in memory, which outlives a layer as localStorage outlives a page. */
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

const recordOf = (simulation: Simulation, runNumber: number): RunRecord =>
  simulation.record({
    id: `00000000-0000-4000-8000-00000000000${runNumber}`,
    startedAt: '2026-10-03T10:00:00.000Z',
    endedAt: '2026-10-03T10:00:10.000Z',
    runNumber,
    hints: [],
  });

/** The app's run loop on `name`, heard by a layer, with every Run recorded as it ends. */
const setUp = (name: string, storage: Storage | null = null) => {
  const canvas = new StandIn(fixture(name));
  const clock = new TestClock();
  const records: RunRecord[] = [];
  const loop = new RunLoop({
    canvas: canvas.handle,
    catalogue: content.catalogue,
    clock,
    seed: () => 7,
    onEnd: (simulation) => records.push(recordOf(simulation, records.length + 1)),
  });
  const sink = new Heard();
  const layer = new SoundLayer({ sink, storage });
  layer.follow(loop);
  layer.hear(canvas.handle);
  return { canvas, clock, loop, records, sink, layer };
};

/** Runs `frames` steps after the spin-up, one tick each at `rate` ticks a second, then stops. */
const runFor = async (setup: ReturnType<typeof setUp>, frames: number, rate = 30): Promise<RunRecord> => {
  const { loop, clock, records } = setup;
  loop.setRate(rate);
  await loop.run();
  expect(loop.phase).toBe('spin-up');
  clock.advance(SPIN_UP_MS);
  for (let frame = 1; frame < frames; frame += 1) clock.advance(1000 / rate);
  loop.stop();
  const record = records.at(-1);
  if (!record) throw new Error('the Run was not recorded');
  return record;
};

const soundEventsOf = (record: RunRecord) => (record.events ?? []).filter((event) => event.kind === 'sound');

describe('machine sounds map one for one to a recorded Run', { timeout: 60_000 }, () => {
  const cases: readonly { readonly name: string; readonly frames: number; readonly sounds: readonly RunSound[] }[] = [
    { name: 'busy-workbench', frames: 300, sounds: ['motor', 'buzz', 'knock'] },
    { name: 'small-wheel-roller', frames: 300, sounds: ['motor', 'squeal', 'knock'] },
    { name: 'level-1-roller', frames: 300, sounds: ['motor', 'hum', 'knock'] },
  ];
  for (const { name, frames, sounds } of cases) {
    it(`plays each sound event of ${name} once, in order, with its part, level and pitch`, async () => {
      const setup = setUp(name);
      const record = await runFor(setup, frames);
      const events = soundEventsOf(record);
      const played = setup.sink.of('machine');
      // Derived from the run record alone, as a replay would: the same cues the live Run played.
      expect(played).toEqual(machineCuesOf(record.events ?? []));
      expect(played).toHaveLength(events.length);
      played.forEach((cue, index) => {
        const event = events[index];
        expect(cue).toEqual({ kind: 'machine', tick: event?.tick, partId: event?.partId, ...event?.payload });
      });
      for (const sound of sounds) expect(played.some((cue) => cue.sound === sound && cue.level > 0), sound).toBe(true);
      // A knock is heard as it starts; its level-0 event ends it, as every sound's does.
      expect(played.filter((cue) => cue.sound === 'knock' && cue.level === 0).length).toBe(played.filter((cue) => cue.sound === 'knock' && cue.level > 0).length);
    });
  }

  it('plays the same cues for the same Run again, and in slow motion the same cues one tick per step', async () => {
    const setup = setUp('busy-workbench');
    await runFor(setup, 60);
    const first = setup.sink.cues.slice();
    setup.sink.clear();
    await runFor(setup, 60);
    expect(setup.sink.cues).toEqual(first);
    const [fast, again] = setup.records.map(soundEventsOf);
    expect(again).toEqual(fast);

    setup.sink.clear();
    const slow = await runFor(setup, 60, 5);
    expect(slow.ticks).toBe(60);
    expect(setup.sink.of('machine')).toEqual(machineCuesOf(slow.events ?? []));
    expect(setup.sink.of('machine')).toEqual(first.filter((cue) => cue.kind === 'machine'));
  });
});

describe('the Run around the machine sounds', { timeout: 60_000 }, () => {
  it('whirs once as Run spins up, ticks only in slow motion, one tick per step, and hushes on Stop', async () => {
    const setup = setUp('level-1-roller');
    const record = await runFor(setup, 30);
    expect(setup.sink.of('whir')).toHaveLength(1);
    expect(setup.sink.cues[0]).toEqual({ kind: 'whir' });
    expect(setup.sink.of('tick')).toEqual([]);
    expect(setup.sink.cues.at(-1)).toEqual({ kind: 'hush' });
    expect(setup.sink.of('hush')).toHaveLength(1);
    expect(record.ticks).toBe(30);

    for (const rate of [1, 5]) {
      setup.sink.clear();
      const slow = await runFor(setup, 6, rate);
      expect(setup.sink.of('tick').map((cue) => cue.tick)).toEqual([1, 2, 3, 4, 5, 6]);
      expect(slow.ticks).toBe(6);
      expect(setup.sink.of('whir')).toHaveLength(1);
      expect(setup.sink.of('hush')).toHaveLength(1);
      // The tick of a step comes before that step's machine sounds.
      const firstTick = setup.sink.cues.findIndex((cue) => cue.kind === 'tick');
      expect(setup.sink.cues.slice(0, firstTick).every((cue) => cue.kind !== 'machine' || cue.tick === 0)).toBe(true);
    }

    setup.sink.clear();
    setup.loop.setRate(10);
    await setup.loop.run();
    setup.clock.advance(SPIN_UP_MS);
    setup.clock.advance(100);
    expect(setup.sink.of('tick')).toEqual([]);
    setup.loop.setRate(3);
    setup.clock.advance(1000 / 3);
    expect(setup.sink.of('tick')).toHaveLength(1);
    setup.loop.stop();
  });

  it('hushes a Run that is playing when the loop goes, and plays nothing at all without a Run or an edit', async () => {
    const setup = setUp('level-1-roller');
    expect(setup.sink.cues).toEqual([]);
    await setup.loop.run();
    setup.clock.advance(SPIN_UP_MS);
    setup.layer.follow(null);
    expect(setup.sink.cues.at(-1)).toEqual({ kind: 'hush' });
    const heard = setup.sink.cues.length;
    setup.clock.advance(1000);
    setup.loop.stop();
    expect(setup.sink.cues).toHaveLength(heard);
  });
});

describe('wires landing', () => {
  it('clicks once for each edit that lands a wire, by any path, and for nothing else', () => {
    const setup = setUp('level-1-roller');
    const connect: EditCommand = { kind: 'connect', from: { part: 'p1', port: 'positive' }, to: { part: 'p2', port: 'positive' } };
    setup.canvas.edit(connect);
    setup.canvas.edit({ kind: 'batch', commands: [{ kind: 'place-part', part: 'dc-motor', at: { x: 0, y: 0 } } as never, connect] });
    setup.canvas.edit({ kind: 'disconnect', wireId: 'w1' });
    setup.canvas.edit({ kind: 'remove-part', partId: 'p1' } as never);
    setup.canvas.edit({ kind: 'tidy-wires' });
    expect(setup.sink.cues).toEqual([{ kind: 'click' }, { kind: 'click' }]);
    expect([connect].map(landsAWire)).toEqual([true]);
    setup.layer.hear(null);
    setup.canvas.edit(connect);
    expect(setup.sink.of('click')).toHaveLength(2);
  });
});

describe('sound off', { timeout: 60_000 }, () => {
  it('starts on, persists off across a reload of the page, and back on', () => {
    const storage = new MemoryStorage();
    const first = new SoundLayer({ sink: new Heard(), storage });
    expect(first.muted).toBe(false);
    let told = 0;
    const off = first.subscribe(() => {
      told += 1;
    });
    first.toggle();
    expect(first.muted).toBe(true);
    expect(storage.getItem(MUTED_KEY)).toBe('true');
    expect(told).toBe(1);
    first.setMuted(true);
    expect(told).toBe(1);
    off();
    first.dispose();

    const sink = new Heard();
    const reloaded = new SoundLayer({ sink, storage });
    expect(reloaded.muted).toBe(true);
    expect(sink.mutes).toEqual([true]);
    reloaded.setMuted(false);
    expect(sink.mutes).toEqual([true, false]);
    expect(new SoundLayer({ sink: new Heard(), storage }).muted).toBe(false);
  });

  it('reads anything unreadable as on, and keeps the setting for the visit where storage refuses', () => {
    const storage = new MemoryStorage();
    storage.setItem(MUTED_KEY, 'maybe');
    expect(new SoundLayer({ sink: new Heard(), storage }).muted).toBe(false);
    const refusing = new MemoryStorage();
    refusing.setItem = () => {
      throw new Error('full');
    };
    refusing.getItem = () => {
      throw new Error('blocked');
    };
    const layer = new SoundLayer({ sink: new Heard(), storage: refusing });
    layer.setMuted(true);
    expect(layer.muted).toBe(true);
    expect(new SoundLayer({ sink: new Heard(), storage: null }).muted).toBe(false);
  });

  it('still hands the sink every cue while sound is off, so the mapping holds and sound comes back mid-Run', async () => {
    const storage = new MemoryStorage();
    storage.setItem(MUTED_KEY, 'true');
    const setup = setUp('busy-workbench', storage);
    expect(setup.layer.muted).toBe(true);
    const record = await runFor(setup, 90);
    expect(setup.sink.of('machine')).toEqual(machineCuesOf(record.events ?? []));
  });
});

describe('the first gesture', () => {
  it('lets the sink start audio at a touch, click or key press, and stops listening when detached and disposed', () => {
    const listeners = new Map<string, EventListener>();
    const view = {
      addEventListener: (type: string, listener: EventListener) => listeners.set(type, listener),
      removeEventListener: (type: string) => listeners.delete(type),
    } as unknown as Window;
    const sink = new Heard();
    const layer = new SoundLayer({ sink, storage: null });
    const detach = layer.attach(view);
    expect([...listeners.keys()].sort()).toEqual(['click', 'keydown', 'pointerdown', 'pointerup', 'touchend']);
    listeners.get('pointerdown')?.(new Event('pointerdown'));
    listeners.get('keydown')?.(new Event('keydown'));
    expect(sink.unlocks).toBe(2);
    detach();
    expect(listeners.size).toBe(0);
    layer.dispose();
    expect(sink.closed).toBe(true);
  });
});
