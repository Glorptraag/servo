// Live readouts (task 4.3): each value is exactly the run record's, read with its real unit. Every content fixture is
// run on the real sim-core, and at every tick each placed part's readouts are compared with the fold of the run
// record's value events up to that tick (sim-core docs/runs.md: frame.live is that fold). The frame store hands the
// card each frame.
import { describe, expect, it } from 'vitest';
import { loadContent } from '@servo/content';
import { loadFixtures } from '@servo/content/fixtures';
import type { RunEvent, ValuePayload } from '@servo/schema';
import { createSimulation } from '@servo/sim-core';
import type { RunFrame } from '@servo/sim-core';
import { createRunFrames, formatReadout, readoutsOf } from '../../src/spec-card/index.ts';

const { content } = loadContent();
const { fixtures } = loadFixtures();

/** Each subject's readouts at `tick`, folded from the record's value events. */
const foldValues = (events: readonly RunEvent[], tick: number): Map<string, ValuePayload> => {
  const values = new Map<string, ValuePayload>();
  for (const event of events) {
    if (event.tick > tick) break;
    if (event.kind === 'value') values.set(event.partId, { ...values.get(event.partId), ...event.payload });
  }
  return values;
};

describe('readout text', () => {
  it('reads each value with its real unit, rounded only for reading', () => {
    expect(formatReadout('volts', 2.987)).toBe('3.0 V');
    expect(formatReadout('volts', -0.6)).toBe('−0.6 V');
    expect(formatReadout('volts', -0.04)).toBe('0.0 V');
    expect(formatReadout('milliamps', 119.6)).toBe('120 mA');
    expect(formatReadout('charge', 0.987)).toBe('99%');
    expect(formatReadout('rpm', -199.7)).toBe('−200 rpm');
    expect(formatReadout('angle', 90)).toBe('90°');
    expect(formatReadout('light', 0.5)).toBe('50%');
    expect(formatReadout('signal', 1)).toBe('100%');
    expect(formatReadout('closed', true)).toBe('Closed');
    expect(formatReadout('closed', false)).toBe('Open');
  });

  it('lists the readouts a part reports, in ValuePayload’s order, keeping the exact values', () => {
    expect(readoutsOf({ rpm: 12.25, volts: 5.5 })).toEqual([
      { key: 'volts', label: 'Voltage', value: 5.5, text: '5.5 V' },
      { key: 'rpm', label: 'Speed', value: 12.25, text: '12 rpm' },
    ]);
    expect(readoutsOf({})).toEqual([]);
  });
});

describe('the frame store', () => {
  it('keeps the latest frame and tells its listeners', () => {
    const frames = createRunFrames();
    const seen: (number | null)[] = [];
    const off = frames.subscribe(() => seen.push(frames.frame?.tick ?? null));
    const frame = (tick: number): RunFrame => ({ tick, events: [], live: new Map(), flows: new Map() });
    frames.push(frame(0));
    frames.push(frame(1));
    frames.clear();
    off();
    frames.push(frame(2));
    expect(seen).toEqual([0, 1, null]);
    expect(frames.frame?.tick).toBe(2);
  });
});

describe('live readouts match the run record', () => {
  for (const fixture of fixtures) {
    it(`${fixture.name}: every part, every tick`, async () => {
      const arena = content.catalogue.arenas?.get(fixture.blueprint.arena.preset);
      if (!arena) throw new Error(`no arena ${fixture.blueprint.arena.preset}`);
      const simulation = await createSimulation({ blueprint: fixture.blueprint, catalogue: content.catalogue, arena, seed: fixture.seed });
      const inputs = [...fixture.inputs];
      const frames: RunFrame[] = [simulation.frame];
      while (simulation.tick < fixture.ticks) {
        for (const input of inputs.filter((candidate) => candidate.tick === simulation.tick)) {
          simulation.input({ partId: input.partId, kind: input.kind, closed: input.closed });
        }
        frames.push(simulation.step());
      }
      const record = simulation.record({
        id: '00000000-0000-4000-8000-000000000000',
        startedAt: '2026-10-01T09:00:00.000Z',
        endedAt: '2026-10-01T09:00:03.000Z',
        runNumber: 1,
        hints: [],
      });
      simulation.dispose();
      const events = record.events ?? [];
      expect(events.length).toBeGreaterThan(0);
      let checked = 0;
      for (const frame of frames) {
        const folded = foldValues(events, frame.tick);
        for (const placed of fixture.blueprint.parts) {
          const shown = readoutsOf(frame.live.get(placed.id)?.values ?? {});
          const expected = folded.get(placed.id) ?? {};
          expect(Object.fromEntries(shown.map((readout) => [readout.key, readout.value])), `${placed.id} at tick ${frame.tick}`).toEqual(expected);
          for (const readout of shown) expect(readout.text).toBe(formatReadout(readout.key, readout.value));
          checked += shown.length;
        }
      }
      expect(checked).toBeGreaterThan(0);
    });
  }
});
