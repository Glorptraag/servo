// The pace of the spec card's live readouts (task 6.1, docs/perf.md): on the real sim-core, a Run's frames reach the card
// every third tick, and at every tick a switch opens or closes or a fault starts or ends, so those show at their tick.
import { describe, expect, it } from 'vitest';
import { loadContent } from '@servo/content';
import { loadFixtures } from '@servo/content/fixtures';
import { createSimulation } from '@servo/sim-core';
import type { RunFrame } from '@servo/sim-core';
import { READOUT_EVERY_TICKS, createRunFrames, followRun, readoutFrameDue } from '../../src/spec-card/index.ts';

const { content } = loadContent();

const framesOf = async (name: string): Promise<RunFrame[]> => {
  const fixture = loadFixtures().fixtures.find((candidate) => candidate.name === name);
  if (!fixture) throw new Error(`no fixture ${name}`);
  const arena = content.catalogue.arenas?.get(fixture.blueprint.arena.preset);
  if (!arena) throw new Error('no arena');
  const simulation = await createSimulation({ blueprint: fixture.blueprint, catalogue: content.catalogue, arena, seed: 1 });
  const frames = [simulation.frame];
  for (let tick = 1; tick <= 60; tick += 1) {
    const input = fixture.inputs.find((candidate) => candidate.tick === tick - 1);
    if (input) simulation.input({ partId: input.partId, kind: input.kind, closed: input.closed });
    frames.push(simulation.step());
  }
  simulation.dispose();
  return frames;
};

/** The ticks the card is handed, frame by frame as App.tsx hands them. */
const handed = (frames: readonly RunFrame[]): number[] => {
  let shown: RunFrame | null = null;
  const ticks: number[] = [];
  for (const frame of frames) {
    if (!readoutFrameDue(shown, frame, 30)) continue;
    shown = frame;
    ticks.push(frame.tick);
  }
  return ticks;
};

const discrete = (frame: RunFrame, before: RunFrame): boolean =>
  [...frame.live].some(([subject, live]) => {
    const was = before.live.get(subject);
    return !was || was.values.closed !== live.values.closed || was.faults.join() !== live.faults.join();
  });

describe('the pace of live readouts', () => {
  it('hands the card the first frame and every third tick of a steady Run', async () => {
    const frames = await framesOf('busy-workbench');
    const ticks = handed(frames);
    expect(ticks[0]).toBe(0);
    for (let tick = 0; tick <= 60; tick += READOUT_EVERY_TICKS) expect(ticks).toContain(tick);
    expect(ticks.length).toBeLessThan(frames.length / 2);
  });

  it('hands the card every tick where a switch or a fault changes', async () => {
    for (const name of ['switch-in-the-line', 'broken-short-circuit', 'bumper-stops-at-wall']) {
      const frames = await framesOf(name);
      const ticks = handed(frames);
      frames.forEach((frame, index) => {
        const before = frames[index - 1];
        if (before && discrete(frame, before)) expect(ticks, `${name} tick ${String(frame.tick)}`).toContain(frame.tick);
      });
    }
  });

  it('starts again with a Run restored to tick 0', () => {
    const at = (tick: number): RunFrame => ({ tick, live: new Map() }) as unknown as RunFrame;
    expect(readoutFrameDue(at(7), at(0), 30)).toBe(true);
    expect(readoutFrameDue(at(7), at(8), 30)).toBe(false);
    expect(readoutFrameDue(null, at(8), 30)).toBe(true);
  });

  it('hands the card every tick in slow motion, at 1 to 10 ticks a second (R-6.1 F1)', async () => {
    const frames = await framesOf('busy-workbench');
    for (const rate of [1, 2, 3, 5, 10]) {
      const store = createRunFrames();
      const pushed: number[] = [];
      store.subscribe(() => {
        if (store.frame) pushed.push(store.frame.tick);
      });
      const listen = followRun(store);
      listen({ phase: 'spin-up', rate });
      for (const frame of frames) listen({ phase: frame.tick === 0 ? 'spin-up' : 'running', rate }, frame);
      expect(pushed, `${String(rate)} ticks a second`).toEqual(frames.map((frame) => frame.tick));
    }
  });

  it('hands the card the Run’s last tick before Stop clears it, never a tick or two behind (R-6.1 F2)', async () => {
    const frames = await framesOf('busy-workbench');
    for (const last of [59, 60, 58]) {
      const store = createRunFrames();
      const seen: (number | null)[] = [];
      store.subscribe(() => seen.push(store.frame?.tick ?? null));
      const listen = followRun(store);
      for (const frame of frames.slice(0, last + 1)) listen({ phase: 'running', rate: 30 }, frame);
      listen({ phase: 'build', rate: 30 });
      expect(seen.at(-2), `Stopped at tick ${String(last)}`).toBe(last);
      expect(seen.at(-1)).toBeNull();
      expect(store.frame).toBeNull();
    }
  });

  it('hands over the frame held back when the clock changes speed mid-Run', async () => {
    const frames = await framesOf('busy-workbench');
    const store = createRunFrames();
    const listen = followRun(store);
    for (const frame of frames.slice(0, 5)) listen({ phase: 'running', rate: 30 }, frame);
    expect(store.frame?.tick).toBe(3);
    listen({ phase: 'running', rate: 5 });
    expect(store.frame?.tick).toBe(4);
  });
});
