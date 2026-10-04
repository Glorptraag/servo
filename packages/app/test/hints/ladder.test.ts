// The hint ladder's rules (task 4.6), pure, on the schema's example challenges against the real content: which ladder
// applies for each trigger kind, type targets narrowed to the part the trigger found, and do-it as one batch that the
// canvas's own applyEdit accepts and that leaves a build validateBlueprint accepts, with the wire the ladder names.
import { describe, expect, it } from 'vitest';
import { applyEdit } from '@servo/canvas';
import type { EditCommand } from '@servo/canvas';
import { loadContent } from '@servo/content';
import { validateBlueprint } from '@servo/schema';
import type { Blueprint, HintStep, PortRef } from '@servo/schema';
import { chooseLadder, doItCommand, narrowStep, partOfStep, triggerParts } from '../../src/hints/ladder.ts';
import { example, fixture } from './support.ts';

const { catalogue } = loadContent().content;

const edit = (blueprint: Blueprint, command: EditCommand): Blueprint => {
  const result = applyEdit(blueprint, command, catalogue);
  if (!result.ok) throw new Error(result.refusal.message);
  return result.blueprint;
};

const joined = (blueprint: Blueprint, a: PortRef, b: PortRef): boolean =>
  blueprint.wires.some(
    (wire) =>
      (wire.from.part === a.part && wire.from.port === a.port && wire.to.part === b.part && wire.to.port === b.port) ||
      (wire.from.part === b.part && wire.from.port === b.port && wire.to.part === a.part && wire.to.port === a.port),
  );

const valid = (blueprint: Blueprint): void => {
  const result = validateBlueprint(blueprint, catalogue);
  expect(result.ok, result.ok ? '' : result.issues.map((issue) => issue.message).join(' ')).toBe(true);
};

const MEET = example('meet-the-switch');
const BACKWARDS = example('one-motor-backwards', fixture('broken-reversed-motor'));
const LIGHT = example('drive-and-light', fixture('switch-in-the-line'));

const lastStep = (step: HintStep | undefined): Extract<HintStep, { step: 'do-it' }> => {
  if (step?.step !== 'do-it') throw new Error('the ladder does not end with do-it');
  return step;
};

describe('which ladder applies', () => {
  it('takes the first whose `unwired` trigger holds, then the next once that port is wired', () => {
    const start = MEET.start as Blueprint;
    expect(chooseLadder(MEET, start, [])).toMatchObject({ index: 0, part: 'switch' });
    const wired = edit(start, { kind: 'connect', from: { part: 'battery', port: 'plus' }, to: { part: 'switch', port: 'a' } });
    // The second ladder has no trigger, so it always applies.
    expect(chooseLadder(MEET, wired, [])).toMatchObject({ index: 1, part: undefined });
  });

  it('holds a `fault` trigger only for a part the last Run showed it on, still on the canvas', () => {
    const start = BACKWARDS.start as Blueprint;
    expect(chooseLadder(BACKWARDS, start, [])).toBeUndefined();
    expect(chooseLadder(BACKWARDS, start, [{ partId: 'motor-left', failure: 'reversed' }])).toBeUndefined();
    expect(chooseLadder(BACKWARDS, start, [{ partId: 'motor-right', failure: 'reversed' }])).toMatchObject({ index: 0, part: 'motor-right' });
    const gone = edit(start, { kind: 'remove-part', partId: 'motor-right' });
    expect(chooseLadder(BACKWARDS, gone, [{ partId: 'motor-right', failure: 'reversed' }])).toBeUndefined();
  });

  it('finds the part of a type with the unwired port, and holds no `unwired` trigger with no such part', () => {
    const start = LIGHT.start as Blueprint;
    expect(chooseLadder(LIGHT, start, [])).toBeUndefined();
    const withLed = edit(start, { kind: 'place-part', part: 'led' });
    const led = withLed.parts.find((part) => part.part === 'led')?.id;
    expect(chooseLadder(LIGHT, withLed, [])).toMatchObject({ index: 0, part: led });
  });

  it('holds `missing` while the build has no part of the type', () => {
    const start = fixture('level-1-roller');
    expect(triggerParts({ kind: 'missing', part: 'led' }, start, [])).toEqual([]);
    expect(triggerParts({ kind: 'missing', part: 'dc-motor' }, start, [])).toBeUndefined();
  });
});

describe('narrowing a step to the part the trigger found', () => {
  it('turns a target by type into that placed part, and leaves other types by type', () => {
    const withLed = edit(LIGHT.start as Blueprint, { kind: 'place-part', part: 'led' });
    const choice = chooseLadder(LIGHT, withLed, []);
    const led = choice?.part;
    expect(led).toBeDefined();
    const [port, ghost] = choice?.ladder.steps ?? [];
    expect(narrowStep(port as HintStep, withLed, led)).toMatchObject({ step: 'pulse-port', target: { placed: led, port: 'plus' } });
    expect(narrowStep(ghost as HintStep, withLed, led)).toMatchObject({ step: 'ghost-wire', from: { placed: led, port: 'plus' }, to: { part: 'switch', port: 'b' } });
    expect(partOfStep(narrowStep(ghost as HintStep, withLed, undefined), undefined)).toBeUndefined();
    expect(partOfStep(MEET.hints[0]?.steps[2] as HintStep, undefined)).toBe('switch');
  });
});

describe('do it for me', () => {
  it('wires the battery pack’s plus to side A of the switch: one batch, a valid build, one new wire', () => {
    const start = MEET.start as Blueprint;
    const doIt = doItCommand(lastStep(MEET.hints[0]?.steps.at(-1)).changes, start, catalogue);
    if (!doIt.ok) throw new Error(doIt.reason);
    expect(doIt.command).toEqual({ kind: 'batch', commands: [{ kind: 'connect', from: { part: 'battery', port: 'plus' }, to: { part: 'switch', port: 'a' } }] });
    valid(doIt.blueprint);
    expect(doIt.blueprint.wires.length).toBe(start.wires.length + 1);
    expect(joined(doIt.blueprint, { part: 'battery', port: 'plus' }, { part: 'switch', port: 'a' })).toBe(true);
    // The canvas's own command layer gives the same build for the batch.
    expect(edit(start, doIt.command)).toEqual(doIt.blueprint);
    // Done once, the same change has nothing left to do: the wire is there.
    expect(doItCommand(lastStep(MEET.hints[0]?.steps.at(-1)).changes, doIt.blueprint, catalogue).ok).toBe(false);
  });

  it('swaps the right motor’s wires in one batch', () => {
    const start = BACKWARDS.start as Blueprint;
    const doIt = doItCommand(lastStep(BACKWARDS.hints[0]?.steps.at(-1)).changes, start, catalogue);
    if (!doIt.ok) throw new Error(doIt.reason);
    expect(doIt.command.commands.map((command) => command.kind)).toEqual(['disconnect', 'disconnect', 'connect', 'connect']);
    valid(doIt.blueprint);
    expect(joined(doIt.blueprint, { part: 'switch', port: 'b' }, { part: 'motor-right', port: 'plus' })).toBe(true);
    expect(joined(doIt.blueprint, { part: 'motor-right', port: 'minus' }, { part: 'battery', port: 'minus' })).toBe(true);
    expect(joined(doIt.blueprint, { part: 'switch', port: 'b' }, { part: 'motor-right', port: 'minus' })).toBe(false);
  });

  it('finishes a fix the child began: wires already made and wires already taken off are skipped (R-4.7 R1)', () => {
    const start = BACKWARDS.start as Blueprint;
    const changes = lastStep(BACKWARDS.hints[0]?.steps.at(-1)).changes;
    // The child makes the first two changes by hand; do-it makes only the rest.
    const half = doItCommand(changes.slice(0, 2), start, catalogue);
    if (!half.ok) throw new Error(half.reason);
    const rest = doItCommand(changes, half.blueprint, catalogue);
    if (!rest.ok) throw new Error(rest.reason);
    expect(rest.command.commands).toHaveLength(changes.length - 2);
    const whole = doItCommand(changes, start, catalogue);
    if (!whole.ok) throw new Error(whole.reason);
    const wires = (build: Blueprint): string[] => build.wires.map((wire) => `${wire.from.part}.${wire.from.port} ${wire.to.part}.${wire.to.port}`).sort();
    expect(wires(rest.blueprint)).toEqual(wires(whole.blueprint));
  });

  it('wires a part named by type, narrowed to the one the trigger found', () => {
    const withLed = edit(LIGHT.start as Blueprint, { kind: 'place-part', part: 'led' });
    const choice = chooseLadder(LIGHT, withLed, []);
    const step = narrowStep(lastStep(choice?.ladder.steps.at(-1)), withLed, choice?.part);
    if (step.step !== 'do-it') throw new Error('not do-it');
    const doIt = doItCommand(step.changes, withLed, catalogue);
    if (!doIt.ok) throw new Error(doIt.reason);
    valid(doIt.blueprint);
    expect(joined(doIt.blueprint, { part: choice?.part ?? '', port: 'plus' }, { part: 'switch', port: 'b' })).toBe(true);
  });

  it('places a part on its mount point and wires it by type in the same batch', () => {
    const start = fixture('level-1-roller');
    const doIt = doItCommand(
      [
        { kind: 'add-part', part: 'led', mountOn: { placed: 'chassis', port: 'deck-front' } },
        { kind: 'add-wire', from: { part: 'led', port: 'plus' }, to: { placed: 'battery', port: 'plus' } },
        { kind: 'add-wire', from: { part: 'led', port: 'minus' }, to: { placed: 'battery', port: 'minus' } },
      ],
      start,
      catalogue,
    );
    if (!doIt.ok) throw new Error(doIt.reason);
    valid(doIt.blueprint);
    const led = doIt.blueprint.parts.find((part) => part.part === 'led');
    expect(led).toBeDefined();
    expect(joined(doIt.blueprint, { part: led?.id ?? '', port: 'mount' }, { part: 'chassis', port: 'deck-front' })).toBe(true);
    expect(joined(doIt.blueprint, { part: led?.id ?? '', port: 'plus' }, { part: 'battery', port: 'plus' })).toBe(true);
  });

  it('refuses the whole step when one change fits nothing, so nothing is half done', () => {
    const start = MEET.start as Blueprint;
    const doIt = doItCommand(
      [
        { kind: 'add-wire', from: { placed: 'battery', port: 'plus' }, to: { placed: 'switch', port: 'a' } },
        { kind: 'remove-part', target: { placed: 'no-such-part' } },
      ],
      start,
      catalogue,
    );
    expect(doIt).toMatchObject({ ok: false, change: 1 });
    // A power line into a mount point is refused by the schema's wiring rules: the ladder never makes one.
    expect(doItCommand([{ kind: 'add-wire', from: { placed: 'battery', port: 'plus' }, to: { placed: 'motor', port: 'mount' } }], start, catalogue).ok).toBe(false);
  });
});
