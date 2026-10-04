// The parity check's plans (src/e2e/plan.ts): each content fixture as the steps that build it from an empty canvas,
// then the edits a child makes on it (task 7.6). The browser half (test/e2e/parity-*.e2e.ts) takes these steps on
// every input path; here, in Node, the plans themselves are held to the fixtures: every part placed once after its
// holder, every wire made once, every setting set, and every kind of edit taken on several fixtures.
import { describe, expect, it } from 'vitest';
import { loadCatalogue } from '@servo/content';
import { loadFixtures } from '@servo/content/fixtures';
import { checkPortPair, indexPlacedParts, resolvePort, validateBlueprint } from '@servo/schema';
import type { PortRef, Wire } from '@servo/schema';
import { EDIT_KINDS, PLAN_PROP, STEP_KINDS, TOURS, assignTours, commandFor, describeStep, isBuildStep, mapPart, planFor } from '../src/e2e/plan.ts';
import type { PlaceStep, Step, StepKind } from '../src/e2e/plan.ts';

const catalogue = loadCatalogue();
const { fixtures, issues } = loadFixtures();

const samePort = (a: PortRef, b: PortRef): boolean => a.part === b.part && a.port === b.port;

/** The steps that make `wire`: a placement that attaches across it, or a connect between its ends. */
const stepsMaking = (steps: readonly Step[], wire: Wire): Step[] =>
  steps.filter((step) => {
    if (step.kind === 'place' && step.attach) {
      const own = { part: step.ref, port: step.attach.port };
      return (samePort(own, wire.from) && samePort(step.attach.onto, wire.to)) || (samePort(own, wire.to) && samePort(step.attach.onto, wire.from));
    }
    return step.kind === 'connect' && samePort(step.from, wire.from) && samePort(step.to, wire.to);
  });

it('has content fixtures to plan', () => {
  expect(issues).toEqual([]);
  expect(fixtures.length).toBeGreaterThan(0);
});

describe.each(fixtures.map((fixture) => [fixture.name, fixture] as const))('the plan for %s', (_name, fixture) => {
  const plan = planFor(fixture, catalogue);
  const places = plan.steps.filter((step): step is PlaceStep => step.kind === 'place');

  it('starts from an empty build the schema accepts, with the fixture’s metadata and arena and no ids claimed', () => {
    expect(plan.fixture).toBe(fixture.name);
    expect(plan.start.parts).toEqual([]);
    expect(plan.start.wires).toEqual([]);
    expect(plan.start.arena).toEqual(fixture.blueprint.arena);
    expect(plan.start.meta).toEqual({ ...fixture.blueprint.meta, highWater: { parts: 0, wires: 0 } });
    expect(validateBlueprint(plan.start, catalogue).ok).toBe(true);
  });

  it('places every part once, each after the part that holds it, a loose part on the free spot', () => {
    expect(places.map((step) => step.ref).sort()).toEqual(fixture.blueprint.parts.map((part) => part.id).sort());
    const types = new Map(fixture.blueprint.parts.map((part) => [part.id, part.part]));
    const seen = new Set<string>();
    for (const step of places) {
      expect(step.part, step.ref).toBe(types.get(step.ref));
      if (step.attach) expect(seen.has(step.attach.onto.part), `${step.ref} after ${step.attach.onto.part}`).toBe(true);
      seen.add(step.ref);
    }
    expect(places[0]?.attach).toBeUndefined();
  });

  it('makes every wire once: a mount or a drive linkage that holds a part by its placement, any other by a connect', () => {
    for (const wire of fixture.blueprint.wires) expect(stepsMaking(plan.steps, wire), wire.id).toHaveLength(1);
    const made = plan.steps.filter((step) => (step.kind === 'place' && step.attach) || step.kind === 'connect');
    expect(made).toHaveLength(fixture.blueprint.wires.length);
    const parts = indexPlacedParts(fixture.blueprint.parts);
    for (const step of plan.steps) {
      if (step.kind !== 'connect') continue;
      const from = resolvePort(parts, catalogue, step.from);
      const to = resolvePort(parts, catalogue, step.to);
      const pair = from.found && to.found ? checkPortPair(from.spec, to.spec) : undefined;
      expect(pair?.legal && pair.kind, describeStep(step)).toBe(step.wire);
    }
  });

  it('sets every setting the fixture changes', () => {
    const settings = plan.steps.flatMap((step) => (step.kind === 'setting' ? [`${step.ref}.${step.setting}=${String(step.value)}`] : []));
    const expected = fixture.blueprint.parts.flatMap((part) => Object.entries(part.settings).map(([id, value]) => `${part.id}.${id}=${String(value)}`));
    expect(settings.sort()).toEqual(expected.sort());
  });

  it('places, then sets, then wires, then ends the build with the refused drop when the fixture has one, then edits', () => {
    const built = plan.steps.filter(isBuildStep);
    const order = built.map((step) => STEP_KINDS.indexOf(step.kind));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(plan.steps.slice(0, built.length)).toEqual(built);
    const refused = plan.steps.filter((step) => step.kind === 'refuse');
    const expected = fixture.expect.refused;
    expect(refused).toEqual(expected ? [{ kind: 'refuse', from: expected.from, to: expected.to, code: expected.code }] : []);
    expect(planFor(fixture, catalogue, new Set()).steps).toEqual(built);
  });

  it('edits only parts it placed and a line it drew, and puts back what it removes before the next edit', () => {
    const placed = new Set(places.map((step) => step.ref));
    const lines = plan.steps.filter((step) => step.kind === 'connect' && (step.wire === 'power' || step.wire === 'signal'));
    const edits = plan.steps.filter((step) => !isBuildStep(step));
    for (const [index, step] of edits.entries()) {
      if ('ref' in step) expect(placed.has(step.ref), describeStep(step)).toBe(true);
      if (step.kind === 'disconnect') {
        expect(step.lines).toHaveLength(lines.length);
        for (const each of step.lines) expect(lines.some((line) => line.kind === 'connect' && samePort(line.from, each.from) && samePort(line.to, each.to))).toBe(true);
      }
      if (step.kind === 'disconnect' || step.kind === 'remove') expect(edits[index + 1], describeStep(step)).toEqual({ kind: 'undo' });
    }
  });
});

describe('the edits after the build', () => {
  const fixtureNamed = (name: string) => {
    const fixture = fixtures.find((candidate) => candidate.name === name);
    if (!fixture) throw new Error(`No fixture '${name}'.`);
    return fixture;
  };

  it('takes every tour on the Rolling Start robot: a line, a move, a turn, a removal, the props, a tidy, the selection and the switch', () => {
    const plan = planFor(fixtureNamed('kit-rolling-start'), catalogue);
    expect(plan.steps.filter((step) => !isBuildStep(step))).toEqual([
      {
        kind: 'disconnect',
        lines: [
          { from: { part: 'battery', port: 'plus' }, to: { part: 'switch', port: 'a' } },
          { from: { part: 'battery', port: 'minus' }, to: { part: 'motor-left', port: 'minus' } },
          { from: { part: 'battery', port: 'minus' }, to: { part: 'motor-right', port: 'minus' } },
          { from: { part: 'motor-left', port: 'plus' }, to: { part: 'switch', port: 'b' } },
          { from: { part: 'motor-right', port: 'plus' }, to: { part: 'switch', port: 'b' } },
        ],
      },
      { kind: 'undo' },
      { kind: 'move', ref: 'switch' },
      { kind: 'turn', ref: 'chassis' },
      { kind: 'remove', ref: 'battery' },
      { kind: 'undo' },
      { kind: 'place-prop', prop: PLAN_PROP },
      { kind: 'place-prop', prop: PLAN_PROP },
      { kind: 'remove-prop', index: 0 },
      { kind: 'move-prop', index: 0 },
      { kind: 'reset-arena' },
      { kind: 'tidy' },
      { kind: 'clear-selection', ref: 'chassis' },
      { kind: 'flip', ref: 'switch' },
    ]);
  });

  it('flips only a manual switch, places props only on an open floor with none, and moves only a part held by a mount', () => {
    for (const fixture of fixtures) {
      const kinds = new Set(planFor(fixture, catalogue).steps.map((step) => step.kind));
      const parts = fixture.blueprint.parts;
      expect(kinds.has('flip'), fixture.name).toBe(parts.some((part) => part.part === 'switch'));
      expect(kinds.has('place-prop'), fixture.name).toBe(fixture.blueprint.arena.preset === 'open-floor' && fixture.blueprint.arena.props.length === 0);
      const mounted = planFor(fixture, catalogue, new Set()).steps.some((step) => {
        if (step.kind !== 'place' || !step.attach) return false;
        const port = catalogue.parts.get(step.part)?.ports.find((candidate) => candidate.id === step.attach?.port);
        return port?.type === 'mechanical' && port.role === 'mount';
      });
      expect(kinds.has('move'), fixture.name).toBe(mounted);
    }
  });
});

describe('assignTours', () => {
  const tours = assignTours(fixtures, catalogue);
  const kindsOf = (name: string): StepKind[] => {
    const fixture = fixtures.find((candidate) => candidate.name === name);
    return fixture ? planFor(fixture, catalogue, tours.get(name)).steps.filter((step) => !isBuildStep(step)).map((step) => step.kind) : [];
  };

  it('gives every fixture one tour that fits it, the same each time', () => {
    expect([...tours.keys()].sort()).toEqual(fixtures.map((fixture) => fixture.name).sort());
    for (const fixture of fixtures) {
      expect(tours.get(fixture.name)?.size, fixture.name).toBe(1);
      expect(kindsOf(fixture.name).length, fixture.name).toBeGreaterThan(0);
    }
    expect(assignTours([...fixtures].reverse(), catalogue)).toEqual(tours);
  });

  it('takes every tour on several fixtures, and so every kind of edit', () => {
    for (const tour of TOURS) {
      const taking = [...tours].filter(([, chosen]) => chosen.has(tour)).length;
      expect(taking, tour).toBeGreaterThanOrEqual(5);
    }
    const kinds = new Set(fixtures.flatMap((fixture) => kindsOf(fixture.name)));
    expect([...kinds].sort()).toEqual([...EDIT_KINDS].sort());
  });
});

describe('the placement order', () => {
  const planOf = (name: string) => {
    const fixture = fixtures.find((candidate) => candidate.name === name);
    if (!fixture) throw new Error(`No fixture '${name}'.`);
    return planFor(fixture, catalogue);
  };

  it('places a robot’s chassis first, so it takes the empty canvas’s free spot, the origin, as the fixtures have it', () => {
    for (const name of ['kit-rolling-start', 'kit-circuit-crew', 'busy-workbench', 'broken-loose-caster']) {
      expect(planOf(name).steps[0], name).toEqual({ kind: 'place', ref: 'chassis', part: 'chassis' });
    }
  });

  it('places everything a loose part holds before the next loose part', () => {
    const plan = planOf('busy-workbench');
    const loose = plan.steps.flatMap((step, index) => (step.kind === 'place' && !step.attach ? [index] : []));
    const held = plan.steps.flatMap((step, index) => (step.kind === 'place' && step.attach ? [index] : []));
    // The chassis holds the whole robot; the bench parts are loose and come after every held part.
    expect(loose[0]).toBe(0);
    expect(Math.max(...held)).toBeLessThan(loose[1] ?? Number.POSITIVE_INFINITY);
  });
});

describe('commandFor', () => {
  const ids = new Map([
    ['chassis', 'p1'],
    ['motor-left', 'p2'],
    ['battery', 'p3'],
  ]);

  it('gives a loose placement no spot, so the placement rule picks the free spot', () => {
    expect(commandFor({ kind: 'place', ref: 'chassis', part: 'chassis' }, ids)).toEqual({ kind: 'place-part', part: 'chassis' });
  });

  it('names the parts by the ids this path’s placements claimed', () => {
    expect(commandFor({ kind: 'place', ref: 'motor-left', part: 'dc-motor', attach: { port: 'mount', onto: { part: 'chassis', port: 'motor-left' } } }, ids)).toEqual({
      kind: 'place-part',
      part: 'dc-motor',
      attach: { port: 'mount', onto: { part: 'p1', port: 'motor-left' } },
    });
    expect(commandFor({ kind: 'setting', ref: 'motor-left', setting: 'direction', value: 'reverse' }, ids)).toEqual({
      kind: 'set-setting',
      partId: 'p2',
      setting: 'direction',
      value: 'reverse',
    });
    const wire = { from: { part: 'battery', port: 'plus' }, to: { part: 'motor-left', port: 'plus' } };
    const connect = { kind: 'connect', from: { part: 'p3', port: 'plus' }, to: { part: 'p2', port: 'plus' } };
    expect(commandFor({ kind: 'connect', ...wire, wire: 'power' }, ids)).toEqual(connect);
    expect(commandFor({ kind: 'refuse', ...wire, code: 'wire.type_mismatch' }, ids)).toEqual(connect);
  });

  it('refuses to name a part this path has not placed', () => {
    expect(() => mapPart(ids, 'caster')).toThrow(/not been placed/);
  });
});
