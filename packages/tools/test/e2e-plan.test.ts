// The parity check's plans (src/e2e/plan.ts): each content fixture as the steps that build it from an empty canvas.
// The browser half (test/e2e/parity.e2e.ts) takes these steps on every input path; here, in Node, the plans themselves
// are held to the fixtures: every part placed once after its holder, every wire made once, every setting set.
import { describe, expect, it } from 'vitest';
import { loadCatalogue } from '@servo/content';
import { loadFixtures } from '@servo/content/fixtures';
import { checkPortPair, indexPlacedParts, resolvePort, validateBlueprint } from '@servo/schema';
import type { PortRef, Wire } from '@servo/schema';
import { STEP_KINDS, commandFor, describeStep, mapPart, planFor } from '../src/e2e/plan.ts';
import type { PlaceStep, Step } from '../src/e2e/plan.ts';

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

  it('places, then sets, then wires, then ends with the refused drop when the fixture has one', () => {
    const order = plan.steps.map((step) => STEP_KINDS.indexOf(step.kind));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    const refused = plan.steps.filter((step) => step.kind === 'refuse');
    const expected = fixture.expect.refused;
    expect(refused).toEqual(expected ? [{ kind: 'refuse', from: expected.from, to: expected.to, code: expected.code }] : []);
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
