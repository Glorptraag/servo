// The Level 3 slot's rules and runtime (task 6.6) on the real sim-core: with the flag off every brain is the no-op
// brain and the servo motor holds and hums (D41); with it on, the servo motor's angle setting, changed through the
// canvas's own `applyEdit`, sweeps the arm to that angle in a Run, tick by tick, the same every time.
import { describe, expect, it } from 'vitest';
import { applyEdit } from '@servo/canvas';
import type { Blueprint, Catalogue } from '@servo/schema';
import { createSimulation } from '@servo/sim-core';
import type { ProgramRuntime, RunFrame } from '@servo/sim-core';
import { NO_FLAGS } from '../../src/flags/index.ts';
import type { Flags } from '../../src/flags/index.ts';
import { programFor, programRuntime, programsOf } from '../../src/program-view/index.ts';
import { benchContent, microcontroller, servoOnBrain } from './fixtures.ts';

const ON: Flags = { 'level-3-slot': true };
const content = benchContent();
const { catalogue } = content;
const TICKS = 30;

/** Every frame of a one-second Run, tick 0 first. */
const run = async (blueprint: Blueprint, program: ProgramRuntime | undefined, at: Catalogue = catalogue): Promise<RunFrame[]> => {
  const arena = at.arenas?.get(blueprint.arena.preset);
  if (!arena) throw new Error('no arena');
  const simulation = await createSimulation({ blueprint, catalogue: at, arena, seed: 7, ...(program ? { program } : {}) });
  const frames = [simulation.frame];
  for (let tick = 0; tick < TICKS; tick += 1) frames.push(simulation.step());
  simulation.dispose();
  return frames;
};

const angles = (frames: readonly RunFrame[]): number[] => frames.map((frame) => frame.live.get('servo')?.values.angle ?? Number.NaN);
const faultsAt = (frame: RunFrame | undefined): readonly string[] => frame?.live.get('servo')?.faults ?? [];

/** The servo motor's angle set as the spec card and the list view set it: one `set-setting` through `applyEdit`. */
const withAngle = (blueprint: Blueprint, angle: number): Blueprint => {
  const result = applyEdit(blueprint, { kind: 'set-setting', partId: 'servo', setting: 'angle', value: angle }, catalogue);
  if (!result.ok) throw new Error(result.refusal.message);
  return result.blueprint;
};

describe('the program rules', () => {
  it('drives the output wired to the servo motor at the level of its angle', () => {
    expect(programsOf(withAngle(servoOnBrain(), 45), catalogue)).toEqual([
      {
        partId: 'brain',
        primitive: 'brain',
        rules: [
          expect.objectContaining({ output: 'out-1', level: 0.25, part: 'servo', port: 'signal', value: 45, setting: expect.objectContaining({ id: 'angle' }) }),
        ],
      },
    ]);
  });

  it('uses the setting’s default when the build holds none', () => {
    expect(programsOf(servoOnBrain(), catalogue)[0]?.rules[0]).toMatchObject({ level: 0.5, value: 90 });
  });

  it('maps the ends of the range to 0 and 1', () => {
    expect(programsOf(withAngle(servoOnBrain(), 0), catalogue)[0]?.rules[0]?.level).toBe(0);
    expect(programsOf(withAngle(servoOnBrain(), 180), catalogue)[0]?.rules[0]?.level).toBe(1);
  });

  it('has no rule for an output wired to nothing it can set, and no brain in a build without one', () => {
    const unwired = { ...servoOnBrain(), wires: servoOnBrain().wires.filter((wire) => wire.id !== 'w6') };
    expect(programsOf(unwired, catalogue)).toEqual([{ partId: 'brain', primitive: 'brain', rules: [] }]);
    const noBrain = { ...unwired, parts: unwired.parts.filter((part) => part.id !== 'brain'), wires: unwired.wires.filter((wire) => wire.to.part !== 'brain') };
    expect(programsOf(noBrain, catalogue)).toEqual([]);
  });

  it('gives an output reaching two servo motors the first line’s angle, in wire id order', () => {
    const base = servoOnBrain({ angle: 30 });
    const two: Blueprint = {
      ...base,
      parts: [...base.parts, { id: 'servo-b', part: 'servo-motor', position: { x: 60, y: 80 }, rotation: 0, settings: { angle: 150 } }],
      wires: [{ id: 'w0', from: { part: 'brain', port: 'out-1' }, to: { part: 'servo-b', port: 'signal' } }, ...base.wires],
    };
    expect(programsOf(two, catalogue)[0]?.rules).toEqual([expect.objectContaining({ part: 'servo-b', value: 150 })]);
  });

  it('reads parts by their data, not their names (ground rule 1)', () => {
    const renamed = { ...microcontroller, id: 'controller-board' };
    const at = benchContent(renamed).catalogue;
    expect(programsOf(servoOnBrain({ angle: 45 }, 'controller-board'), at)[0]?.rules[0]).toMatchObject({ output: 'out-1', level: 0.25 });
  });

  it('is off by default and on with the flag', () => {
    expect(programFor(NO_FLAGS, servoOnBrain(), catalogue)).toBeUndefined();
    expect(programFor(ON, servoOnBrain(), catalogue)).toBeDefined();
  });

  it('runs purely: no state, and nothing for a brain it has no program for', () => {
    const runtime = programRuntime(programsOf(withAngle(servoOnBrain(), 45), catalogue));
    expect(runtime.start({ partId: 'brain', primitive: 'brain' })).toBeNull();
    expect(runtime.run({ partId: 'brain', primitive: 'brain', tick: 3, inputs: {} }, null)).toEqual({ outputs: { 'out-1': 0.25 }, state: null });
    expect(runtime.run({ partId: 'other', primitive: 'brain', tick: 3, inputs: {} }, null)).toEqual({ outputs: {}, state: null });
  });
});

describe('a Run with the Level 3 slot', () => {
  it('flag off: the servo motor gets no signal, holds where it is and hums (D41)', async () => {
    const build = withAngle(servoOnBrain(), 45);
    const frames = await run(build, programFor(NO_FLAGS, build, catalogue));
    expect(new Set(angles(frames))).toEqual(new Set([90]));
    expect(faultsAt(frames.at(-1))).toContain('no-signal');
  });

  it('flag on: the servo motor sweeps to the angle set and holds it', async () => {
    for (const angle of [45, 0, 135, 180]) {
      const build = withAngle(servoOnBrain(), angle);
      const seen = angles(await run(build, programFor(ON, build, catalogue)));
      expect(seen[0]).toBe(90);
      expect(seen.at(-1)).toBeCloseTo(angle, 9);
      // A sweep, not a jump: it passes through angles between, and never goes back.
      expect(seen.some((each) => Math.min(90, angle) < each && each < Math.max(90, angle))).toBe(true);
      for (let tick = 1; tick < seen.length; tick += 1) {
        const step = (seen[tick] ?? 0) - (seen[tick - 1] ?? 0);
        expect(Math.sign(step) === 0 || Math.sign(step) === Math.sign(angle - 90)).toBe(true);
      }
    }
  });

  it('flag on: the signal line carries the level and the no-signal fault is gone', async () => {
    const build = withAngle(servoOnBrain(), 45);
    const frames = await run(build, programFor(ON, build, catalogue));
    const last = frames.at(-1);
    expect(last?.flows.get('w6')?.signal).toBe(0.25);
    expect(faultsAt(last)).not.toContain('no-signal');
  });

  it('flag on: a new angle is the next Run’s', async () => {
    const first = withAngle(servoOnBrain(), 45);
    const second = withAngle(first, 150);
    expect(angles(await run(second, programFor(ON, second, catalogue))).at(-1)).toBeCloseTo(150, 9);
  });

  it('flag on: the same build gives the same Run, tick for tick (ground rule 2)', async () => {
    const build = withAngle(servoOnBrain(), 60);
    const once = await run(build, programFor(ON, build, catalogue));
    const again = await run(build, programFor(ON, build, catalogue));
    expect(again.map((frame) => frame.events)).toEqual(once.map((frame) => frame.events));
  });

  it('flag on: a microcontroller without power drives nothing', async () => {
    const build = withAngle(servoOnBrain(), 45);
    const unpowered = { ...build, wires: build.wires.filter((wire) => wire.id !== 'w4') };
    const frames = await run(unpowered, programFor(ON, unpowered, catalogue));
    expect(new Set(angles(frames))).toEqual(new Set([90]));
    expect(faultsAt(frames.at(-1))).toContain('no-signal');
  });
});
