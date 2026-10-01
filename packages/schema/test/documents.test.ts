import { describe, expect, it } from 'vitest';
import { exampleArenas, exampleChallenges, exampleRunRecords, validKits } from '../src/fixtures.ts';
import { validateArenaPreset, validateChallenge, validateKit, validateRunRecord } from '../src/index.ts';
import { catalogue, edited, push, reasons, remove, set } from './support.ts';
import type { Change } from './support.ts';

const byName = <T extends { readonly name: string; readonly data: unknown }>(list: readonly T[], name: string): unknown => {
  const found = list.find((entry) => entry.name === name);
  if (!found) throw new Error(`No fixture ${name}`);
  return found.data;
};

const wallStop = exampleArenas.find((arena) => (arena as { id: string }).id === 'wall-stop');
const arena = (...changes: readonly Change[]) => reasons(validateArenaPreset(edited(wallStop, ...changes)));
const kit = (...changes: readonly Change[]) => reasons(validateKit(edited(byName(validKits, 'rolling-start'), ...changes), catalogue));
const challenge = (name: string, ...changes: readonly Change[]) =>
  reasons(validateChallenge(edited(byName(exampleChallenges, name), ...changes), catalogue));
const run = (...changes: readonly Change[]) =>
  reasons(validateRunRecord(edited(byName(exampleRunRecords, 'rolling-start-run'), ...changes), catalogue));

describe('arena presets', () => {
  it('keeps everything on the floor', () => {
    expect(arena(set(['props', 0, 'at', 'x'], 2500))).toEqual(['arena.outside at $.props[0].at']);
    expect(arena(set(['start', 'y'], -1))).toEqual(['arena.outside at $.start']);
  });

  it('checks rectangles, cylinders, lines and headings', () => {
    expect(arena(set(['zones', 0, 'to'], { x: 1500, y: 800 }))).toEqual(['value.inconsistent at $.zones[0].to']);
    expect(arena(set(['props', 0, 'shape'], 'cylinder'), set(['props', 0, 'size', 'y'], 60))).toEqual(['value.inconsistent at $.props[0].size']);
    expect(arena(push(['lines'], { id: 'dot', points: [{ x: 1, y: 1 }], widthMm: 20 }))).toEqual(['value.empty at $.lines[0].points']);
    expect(arena(set(['start', 'heading'], 360))).toEqual(['value.out_of_range at $.start.heading']);
  });

  it('gives walls, zones, lines, ramps and props one id space', () => {
    expect(arena(set(['zones', 0, 'id'], 'far-wall'))).toEqual(['id.duplicate at $.zones[0].id']);
  });
});

describe('kits', () => {
  it('shows every entry in exactly one tray group and nothing else', () => {
    expect(kit(set(['tray', 3, 'parts'], ['chassis']))).toEqual(['kit.tray_mismatch at $.parts[4].part']);
    expect(kit(push(['tray', 1, 'parts'], 'servo-motor'))).toEqual(['kit.tray_mismatch at $.tray[1].parts[1]']);
    expect(kit(push(['tray', 2, 'parts'], 'caster'))).toEqual(['kit.tray_mismatch at $.tray[3].parts[1]']);
  });

  it('holds only parts introduced by its level', () => {
    expect(kit(push(['parts'], { part: 'servo-motor', quantity: 1 }), push(['tray', 1, 'parts'], 'servo-motor'))).toEqual([
      'kit.part_above_level at $.parts[6].part',
    ]);
  });

  it('checks entries: known parts, whole quantities, no repeats, one group per family', () => {
    expect(kit(set(['parts', 0, 'part'], 'battery-pack-9-cell'), set(['tray', 0, 'parts', 0], 'battery-pack-9-cell'))).toEqual([
      'ref.unknown_part_type at $.parts[0].part',
    ]);
    expect(kit(set(['parts', 2, 'quantity'], 1.5))).toEqual(['value.not_integer at $.parts[2].quantity']);
    expect(kit(set(['parts', 2, 'quantity'], 0))).toEqual(['value.out_of_range at $.parts[2].quantity']);
    expect(kit(push(['parts'], { part: 'switch', quantity: 2 }))).toEqual(['id.duplicate at $.parts[6].part']);
    expect(kit(set(['tray', 1, 'family'], 'power'))).toEqual(['value.duplicate at $.tray[1].family']);
  });
});

describe('challenges', () => {
  it('starts breakdowns and what-ifs from a blueprint', () => {
    expect(challenge('one-motor-backwards', remove(['start']), set(['hints'], []), set(['goal'], { kind: 'uses', part: 'dc-motor', count: 2 }))).toEqual([
      'challenge.start_required at $.start',
    ]);
    expect(challenge('cross-and-stop', set(['kind'], 'what-if'))).toEqual(['challenge.start_required at $.start']);
  });

  it('names the introduced part on part introductions only', () => {
    expect(challenge('meet-the-switch', remove(['introduces']))).toEqual(['challenge.introduces_required at $.introduces']);
    expect(challenge('cross-and-stop', set(['introduces'], 'switch'))).toEqual(['challenge.introduces_unexpected at $.introduces']);
  });

  it('runs the starting blueprint in the challenge arena', () => {
    expect(challenge('one-motor-backwards', set(['arena', 'preset'], 'wall-stop'))).toEqual(['challenge.arena_mismatch at $.start.arena.preset']);
  });

  it('checks the starting blueprint in full', () => {
    expect(challenge('one-motor-backwards', set(['start', 'wires', 0, 'to', 'port'], 'signal'))).toEqual([
      'ref.unknown_port at $.start.wires[0].to.port',
    ]);
  });

  it('keeps hint ladders in order and ending with do it', () => {
    const ladder = ['hints', 0, 'steps'];
    expect(challenge('one-motor-backwards', set([...ladder, 0, 'step'], 'ghost-wire'), set([...ladder, 0, 'from'], { placed: 'switch', port: 'b' }), set([...ladder, 0, 'to'], { placed: 'motor-right', port: 'plus' }), remove([...ladder, 0, 'target']))).toEqual([
      'hint.bad_order at $.hints[0].steps',
    ]);
    expect(challenge('meet-the-switch', set(['hints', 1, 'steps'], [{ step: 'pulse-part', target: { placed: 'switch' }, line: 'The switch' }]))).toEqual([
      'hint.bad_order at $.hints[1].steps',
    ]);
  });

  it('draws hint wires the child could draw', () => {
    expect(challenge('one-motor-backwards', set(['hints', 0, 'steps', 2, 'to'], { placed: 'wheel-right', port: 'hub' }))).toEqual([
      'wire.type_mismatch at $.hints[0].steps[2]',
    ]);
  });

  it('resolves every part, port, zone, wall, failure mode and setting named', () => {
    expect(challenge('one-motor-backwards', set(['hints', 0, 'steps', 0, 'target'], { placed: 'motor-middle' }))).toEqual([
      'ref.unknown_placed_part at $.hints[0].steps[0].target.placed',
    ]);
    expect(challenge('one-motor-backwards', set(['hints', 0, 'when', 'failure'], 'jammed'))).toEqual(['ref.unknown_failure_mode at $.hints[0].when.failure']);
    expect(challenge('cross-and-stop', set(['goal', 'when', 'of', 0, 'wall'], 'stop-zone'))).toEqual(['ref.unknown_arena_feature at $.goal.when.of[0].wall']);
    expect(challenge('cross-and-stop', set(['goal', 'when', 'of', 1, 'target'], { part: 'hovercraft' }))).toEqual([
      'ref.unknown_part_type at $.goal.when.of[1].target.part',
    ]);
    expect(
      challenge('meet-the-switch', set(['hints', 1, 'steps', 1, 'changes'], [{ kind: 'set-setting', target: { placed: 'motor' }, setting: 'speed', value: 105 }])),
    ).toEqual(['setting.out_of_range at $.hints[1].steps[1].changes[0].value']);
    expect(
      challenge('meet-the-switch', set(['hints', 1, 'steps', 1, 'changes'], [{ kind: 'add-part', part: 'caster', mountOn: { placed: 'motor', port: 'shaft' } }])),
    ).toEqual(['port.wrong_kind at $.hints[1].steps[1].changes[0].mountOn.port']);
    expect(challenge('cross-and-stop', set(['kit'], 'mystery-kit'))).toEqual(['ref.unknown_kit at $.kit']);
  });

  it('checks goal conditions', () => {
    expect(challenge('cross-and-stop', remove(['goal', 'when', 'of', 1, 'atMost']))).toEqual(['value.missing at $.goal.when.of[1].atLeast']);
    expect(challenge('cross-and-stop', set(['goal', 'forTicks'], 0))).toEqual(['value.out_of_range at $.goal.forTicks']);
    expect(challenge('cross-and-stop', set(['goalLine'], 'Cross the arena!'))).toEqual(['text.exclamation at $.goalLine']);
  });

  it('signs forward-speed along the heading, and only forward-speed', () => {
    expect(challenge('drive-and-light', set(['goal', 'when', 'of', 1, 'atLeast'], -20))).toEqual([]);
    expect(challenge('cross-and-stop', set(['goal', 'when', 'of', 1, 'atMost'], -5))).toEqual(['value.out_of_range at $.goal.when.of[1].atMost']);
  });

  it('stops cross-and-stop at the wall without a stall, at Level 2 (D26)', () => {
    const data = byName(exampleChallenges, 'cross-and-stop') as {
      level: number;
      kit: string;
      goal: { when: { of: unknown[] } };
    };
    expect(data.level).toBe(2);
    expect(data.kit).toBe('circuit-crew');
    expect(data.goal.when.of).toContainEqual({ kind: 'not', of: { kind: 'fault', target: { part: 'dc-motor' }, failure: 'overload' } });
  });

  it('refuses goals nested too deep', () => {
    let goal: unknown = { kind: 'uses', part: 'switch', count: 1 };
    for (let depth = 0; depth < 10; depth += 1) goal = { kind: 'all', of: [goal] };
    expect(challenge('cross-and-stop', set(['goal'], goal))).toEqual(['value.too_deep at $.goal.of[0].of[0].of[0].of[0].of[0].of[0].of[0].of[0]']);
  });
});

describe('run records', () => {
  it('keeps events and inputs in tick order, within the run', () => {
    expect(run(set(['events', 1, 'tick'], 0), set(['events', 0, 'tick'], 5))).toEqual(['run.event_order at $.events[1].tick']);
    expect(run(set(['events', 10, 'tick'], 91))).toEqual(['run.tick_out_of_range at $.events[10].tick']);
    expect(run(set(['faults', 0, 'firstTick'], 120))).toEqual(['run.tick_out_of_range at $.faults[0].firstTick']);
  });

  it('names parts, props and failure modes that exist in the blueprint that ran', () => {
    expect(run(set(['events', 4, 'partId'], 'arena:ball'))).toEqual(['ref.unknown_arena_feature at $.events[4].partId']);
    expect(run(set(['events', 7, 'partId'], 'motor-middle'))).toEqual(['ref.unknown_placed_part at $.events[7].partId']);
    expect(
      run(set(['faults', 0, 'failure'], 'jammed'), set(['events', 6, 'payload', 'failure'], 'jammed'), set(['events', 8, 'payload', 'failure'], 'jammed')),
    ).toEqual([
      'ref.unknown_failure_mode at $.events[6].payload.failure',
      'ref.unknown_failure_mode at $.events[8].payload.failure',
      'ref.unknown_failure_mode at $.faults[0].failure',
    ]);
    expect(run(set(['inputs', 0, 'partId'], 'battery'))).toEqual(['value.inconsistent at $.inputs[0].partId']);
  });

  it('keeps the fault summary and the fault events in step', () => {
    expect(run(set(['faults'], []))).toEqual(['run.unrecorded_fault at $.events[6]']);
    expect(run(set(['faults', 0, 'firstTick'], 53))).toEqual(['run.unrecorded_fault at $.faults[0].firstTick']);
    expect(run(set(['events', 6, 'kind'], 'value'), set(['events', 6, 'payload'], { volts: 2.8 }))).toEqual([
      'run.unrecorded_fault at $.faults[0].firstTick',
    ]);
  });

  it('gives a goal only to a run inside a challenge', () => {
    expect(run(remove(['challenge']))).toEqual(['run.goal_without_challenge at $.goal']);
    expect(run(remove(['challenge']), remove(['goal']))).toEqual([]);
  });

  it('names the blueprint that ran by its id', () => {
    expect(run(set(['blueprintId'], '2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f60'))).toEqual(['value.inconsistent at $.blueprintId']);
    expect(run(set(['blueprintId'], 'rolling-start'))).toEqual(['value.bad_format at $.blueprintId']);
  });

  it('checks the goal, times, tick rate, seed and ids', () => {
    expect(run(set(['goal'], { met: true }))).toEqual(['value.inconsistent at $.goal']);
    expect(run(set(['endedAt'], '2026-10-01T09:20:00.000Z'))).toEqual(['value.inconsistent at $.endedAt']);
    expect(run(set(['tickRate'], 60))).toEqual(['value.not_allowed at $.tickRate']);
    expect(run(set(['seed'], -1))).toEqual(['value.out_of_range at $.seed']);
    expect(run(set(['profile'], 'emily-johnson-age-7'))).toEqual(['value.bad_format at $.profile']);
    expect(run(set(['id'], 'A3F1C2D4-5B6E-4F70-8A91-B2C3D4E5F607'))).toEqual(['value.bad_format at $.id']);
  });

  it('checks event payloads', () => {
    expect(run(set(['events', 0, 'payload'], {}))).toEqual(['value.missing at $.events[0].payload']);
    expect(run(set(['events', 2, 'payload', 'sound'], 'beep'))).toEqual(['value.not_allowed at $.events[2].payload.sound']);
    expect(run(set(['events', 3, 'payload', 'heading'], 400))).toEqual(['value.out_of_range at $.events[3].payload.heading']);
  });

  it('records how a fault was fixed as build changes', () => {
    const backToDefault = { kind: 'change-setting', partId: 'motor-left', setting: 'speed' };
    expect(run(set(['fixed', 0, 'changes', 0], backToDefault))).toEqual([]);
    expect(run(set(['fixed', 0, 'changes', 0, 'kind'], 'teleport'))).toEqual(['value.not_allowed at $.fixed[0].changes[0].kind']);
  });

  it("names a prop as 'arena:' and its id", () => {
    expect(run(set(['events', 4, 'partId'], 'arena:Big Box'))).toEqual(['value.bad_format at $.events[4].partId']);
  });

  it('may leave the event stream out of a stored summary', () => {
    expect(run(remove(['events']))).toEqual([]);
  });
});
