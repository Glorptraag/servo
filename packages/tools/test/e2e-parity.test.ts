// The parity check's logic (src/e2e/parity.ts) with paths faked in memory: which steps are compared, which wait and
// for which task, which path differs and how the report says so. The browser half drives the real canvas.
import { describe, expect, it, vi } from 'vitest';
import { loadFixtures } from '@servo/content/fixtures';
import type { Blueprint } from '@servo/schema';
import { BUILT_BY, READY, attempt, checkParity, describeDifference, fixtureGroups, passes, pendingTasks, reportLine, waitingLike } from '../src/e2e/parity.ts';
import { reportSummary } from '../src/e2e/report.ts';
import type { Capability, InputPath, PathBuild, PathFamily } from '../src/e2e/parity.ts';
import type { BuildPlan, Step, StepKind } from '../src/e2e/plan.ts';

const [fixture] = loadFixtures().fixtures;
if (!fixture) throw new Error('No content fixture.');
const start: Blueprint = { ...fixture.blueprint, parts: [], wires: [], meta: { ...fixture.blueprint.meta, highWater: { parts: 0, wires: 0 } } };

const steps: readonly Step[] = [
  { kind: 'place', ref: 'chassis', part: 'chassis' },
  { kind: 'place', ref: 'motor', part: 'dc-motor', attach: { port: 'mount', onto: { part: 'chassis', port: 'motor-left' } } },
  { kind: 'place', ref: 'battery', part: 'battery-pack-2-cell', attach: { port: 'mount', onto: { part: 'chassis', port: 'deck-rear' } } },
  { kind: 'setting', ref: 'motor', setting: 'direction', value: 'reverse' },
  { kind: 'connect', from: { part: 'battery', port: 'plus' }, to: { part: 'motor', port: 'plus' }, wire: 'power' },
  { kind: 'refuse', from: { part: 'battery', port: 'plus' }, to: { part: 'motor', port: 'shaft' }, code: 'wire.type_mismatch' },
];
const plan: BuildPlan = { fixture: 'test-robot', start, steps };

/** What a path builds from `taken`: each placed part at x = its step number; `nudge` moves one part. */
const buildOf = (taken: readonly Step[], nudge?: { readonly index: number; readonly x: number }): Blueprint => {
  const places = taken.filter((step) => step.kind === 'place');
  return {
    ...start,
    parts: places.map((step, index) => ({
      id: `p${index + 1}`,
      part: step.kind === 'place' ? step.part : '',
      position: { x: nudge?.index === index ? nudge.x : index * 10, y: 0 },
      rotation: 0,
      settings: {},
    })),
    meta: { ...start.meta, highWater: { parts: places.length, wires: 0 } },
  };
};

const all = (capability: Capability): Record<StepKind, Capability> => ({ place: capability, setting: capability, connect: capability, refuse: capability });
const waiting = (...tasks: string[]): Capability => ({ ready: false, tasks });

const fake = (
  name: string,
  family: PathFamily,
  can: Record<StepKind, Capability>,
  build: (taken: readonly Step[]) => PathBuild = (taken) => ({ ok: true, blueprint: buildOf(taken) }),
): InputPath & { readonly calls: (readonly Step[])[] } => {
  const calls: (readonly Step[])[] = [];
  return {
    name,
    family,
    can,
    calls,
    build: async (_plan, taken, signal) => {
      calls.push(taken);
      return signal?.aborted ? { ok: false, step: 0, reason: 'stopped' } : build(taken);
    },
  };
};

describe('checkParity', () => {
  it('finds the paths identical when each gives the reference’s bytes', async () => {
    const reference = fake('commands', 'commands', all(READY));
    const touch = fake('touch drag', 'touch', all(READY));
    const pointer = fake('pointer click-click', 'pointer', all(READY));
    const result = await checkParity(plan, reference, [touch, pointer]);
    expect(result.verdict).toBe('identical');
    expect(result.identical).toEqual(['commands', 'touch drag', 'pointer click-click']);
    expect(result.compared).toEqual({ place: 3, setting: 1, connect: 1, refuse: 1 });
    expect(touch.calls).toEqual([steps]);
    expect(reportLine(result)).toBe(
      'test-robot: identical on commands, touch drag and pointer click-click (3 placements, 1 setting, 1 wire and 1 refused drop)',
    );
  });

  it('leaves out every step the reference cannot take yet, for every path, by the tasks it waits for: partial', async () => {
    const can = { place: READY, setting: READY, connect: waiting('3.3'), refuse: waiting('3.3') };
    const reference = fake('commands', 'commands', can);
    const touch = fake('touch drag', 'touch', can);
    const result = await checkParity(plan, reference, [touch]);
    expect(result.verdict).toBe('partial');
    expect(touch.calls).toEqual([steps.slice(0, 4)]);
    expect(result.pending).toEqual([
      { kind: 'connect', count: 1, tasks: ['3.3'] },
      { kind: 'refuse', count: 1, tasks: ['3.3'] },
    ]);
    expect(reportLine(result)).toBe(
      'test-robot: partial: identical on commands and touch drag (3 placements and 1 setting); pending: needs task 3.3 (1 wire and 1 refused drop)',
    );
  });

  it('leaves out a step that names a part left out, waiting for the task that part waits for', async () => {
    const can = { place: waiting('3.2'), setting: READY, connect: waiting('3.2', '3.3'), refuse: waiting('3.2', '3.3') };
    const reference = fake('commands', 'commands', can);
    const list = fake('list view', 'list view', all(waiting('3.6')));
    const result = await checkParity(plan, reference, [list]);
    expect(result.verdict).toBe('pending');
    expect(reference.calls).toEqual([]);
    expect(result.pending).toEqual([
      { kind: 'place', count: 3, tasks: ['3.2'] },
      { kind: 'setting', count: 1, tasks: ['3.2'] },
      { kind: 'connect', count: 1, tasks: ['3.2', '3.3'] },
      { kind: 'refuse', count: 1, tasks: ['3.2', '3.3'] },
    ]);
    expect(reportLine(result)).toBe(
      'test-robot: pending: needs task 3.2 (3 placements and 1 setting), needs tasks 3.2 and 3.3 (1 wire and 1 refused drop); list view needs task 3.6',
    );
  });

  it('lets a path that cannot take a compared step wait, builds nothing on it, and calls the fixture partial', async () => {
    const reference = fake('commands', 'commands', all(READY));
    const touch = fake('touch drag', 'touch', all(READY));
    const list = fake('list view', 'list view', all(waiting('3.6')));
    const result = await checkParity(plan, reference, [touch, list]);
    expect(result.verdict).toBe('partial');
    expect(list.calls).toEqual([]);
    expect(result.waiting).toEqual([{ path: 'list view', tasks: ['3.6'] }]);
    expect(reportLine(result)).toBe(
      'test-robot: partial: identical on commands and touch drag (3 placements, 1 setting, 1 wire and 1 refused drop); list view needs task 3.6',
    );
  });

  it('passes a partial fixture, and fails it in strict mode (gate G3); a mismatch fails either way', async () => {
    const reference = fake('commands', 'commands', all(READY));
    const partial = await checkParity(plan, reference, [fake('touch drag', 'touch', all(READY)), fake('list view', 'list view', all(waiting('3.6')))]);
    const whole = await checkParity(plan, reference, [fake('touch drag', 'touch', all(READY))]);
    const differs = await checkParity(plan, reference, [fake('touch drag', 'touch', all(READY), (taken) => ({ ok: true, blueprint: buildOf(taken, { index: 0, x: 1 }) }))]);
    expect([passes(partial, false), passes(partial, true)]).toEqual([true, false]);
    expect([passes(whole, false), passes(whole, true)]).toEqual([true, true]);
    expect([passes(differs, false), passes(differs, true)]).toEqual([false, false]);
  });

  it('reports a path whose build differs, part by part, and keeps both builds’ bytes for the diff', async () => {
    const reference = fake('commands', 'commands', all(READY));
    const touch = fake('touch drag', 'touch', all(READY), (taken) => ({ ok: true, blueprint: buildOf(taken, { index: 1, x: 10.1 }) }));
    const pointer = fake('pointer drag', 'pointer', all(READY));
    const result = await checkParity(plan, reference, [touch, pointer]);
    expect(result.verdict).toBe('mismatch');
    expect(result.mismatches).toEqual([{ path: 'touch drag', detail: 'p2 position (10.1, 0) here, (10, 0) in commands' }]);
    expect(result.identical).toEqual(['commands', 'pointer drag']);
    expect(result.bytes.get('touch drag')).not.toBe(result.bytes.get('commands'));
    expect(reportLine(result)).toBe(
      'test-robot: MISMATCH: touch drag: p2 position (10.1, 0) here, (10, 0) in commands; identical on commands and pointer drag (3 placements, 1 setting, 1 wire and 1 refused drop)',
    );
  });

  it('reports a path that fails a step, naming the step', async () => {
    const reference = fake('commands', 'commands', all(READY));
    const touch = fake('touch tap-then-tap', 'touch', all(READY), () => ({ ok: false, step: 1, reason: 'no placement after the tap' }));
    const result = await checkParity(plan, reference, [touch]);
    expect(result.verdict).toBe('mismatch');
    expect(result.mismatches).toEqual([
      { path: 'touch tap-then-tap', detail: 'step 2, place dc-motor motor by its mount on chassis.motor-left: no placement after the tap' },
    ]);
  });

  it('reports the reference failing, and builds no other path against it', async () => {
    const reference = fake('commands', 'commands', all(READY), () => ({ ok: false, step: -1, reason: 'the start did not load: value.missing' }));
    const touch = fake('touch drag', 'touch', all(READY));
    const result = await checkParity(plan, reference, [touch]);
    expect(result.verdict).toBe('mismatch');
    expect(result.mismatches).toEqual([{ path: 'commands', detail: 'loading the start: the start did not load: value.missing' }]);
    expect(touch.calls).toEqual([]);
  });

  it('passes the test’s abort signal to every path, which stops between steps once it aborts', async () => {
    const controller = new AbortController();
    controller.abort();
    const reference = fake('commands', 'commands', all(READY));
    const result = await checkParity(plan, reference, [fake('touch drag', 'touch', all(READY))], controller.signal);
    expect(result.verdict).toBe('mismatch');
    expect(result.mismatches).toEqual([{ path: 'commands', detail: 'step 1, place chassis chassis on the free spot: stopped' }]);
  });

  it('sums up the fixtures', async () => {
    const reference = fake('commands', 'commands', all(READY));
    const identical = await checkParity(plan, reference, [fake('touch drag', 'touch', all(READY))]);
    const pending = await checkParity(plan, fake('commands', 'commands', all(waiting('3.2'))), []);
    expect(reportSummary([identical.verdict, pending.verdict, pending.verdict])).toBe('3 fixtures: 1 identical, 0 partial, 0 mismatched, 2 pending');
  });
});

describe('fixtureGroups', () => {
  it('splits fixtures into groups of about equal work, heaviest first, each in one group', () => {
    const weights = { a: 59, b: 24, c: 24, d: 20, e: 17, f: 17, g: 16, h: 12, i: 6 };
    const names = Object.keys(weights) as (keyof typeof weights)[];
    const groups = fixtureGroups(names, 3, (name) => weights[name]);
    expect(groups).toEqual([['a', 'i'], ['b', 'd', 'g'], ['c', 'e', 'f', 'h']]);
    const loads = groups.map((group) => group.reduce((sum, name) => sum + weights[name], 0));
    expect(Math.max(...loads) - Math.min(...loads)).toBeLessThanOrEqual(weights.a);
    expect(groups.flat().sort()).toEqual([...names].sort());
  });

  it('gives the same groups for the same fixtures, and empty groups when there are fewer fixtures than groups', () => {
    expect(fixtureGroups(['x', 'y'], 3, () => 1)).toEqual([['x'], ['y'], []]);
    expect(fixtureGroups(['x', 'y', 'z'], 2, () => 1)).toEqual(fixtureGroups(['x', 'y', 'z'], 2, () => 1));
  });
});

describe('describeDifference', () => {
  const base = buildOf(steps);

  it('names parts and wires on one side only, a different type, turn or settings, and different ends', () => {
    const wire = { id: 'w1', from: { part: 'p3', port: 'plus' }, to: { part: 'p2', port: 'plus' } };
    const want: Blueprint = { ...base, wires: [wire] };
    const got: Blueprint = {
      ...base,
      parts: [
        { ...(base.parts[0] as Blueprint['parts'][number]), rotation: 90 },
        { ...(base.parts[1] as Blueprint['parts'][number]), settings: { direction: 'reverse' } },
      ],
      wires: [{ ...wire, to: { part: 'p2', port: 'minus' } }],
    };
    expect(describeDifference(got, want, 'commands')).toBe(
      'p1 rotation 90 here, 0 in commands; p2 settings {"direction":"reverse"} here, {} in commands; p3 (battery-pack-2-cell) only in commands; w1 joins p3.plus–p2.minus here, p3.plus–p2.plus in commands',
    );
  });

  it('names only the metadata that differs, says when the builds agree but not byte for byte, and counts what it leaves out', () => {
    expect(describeDifference(base, base, 'commands')).toBe('the same build in different bytes from commands');
    const renamed: Blueprint = { ...base, meta: { ...base.meta, name: 'Other' } };
    expect(describeDifference(renamed, base, 'commands')).toBe(`meta.name "Other" here, ${JSON.stringify(base.meta.name)} in commands`);
    const many: Blueprint = { ...base, parts: [], meta: { ...base.meta, name: 'Other', level: 1 } };
    expect(describeDifference(many, base, 'commands')).toMatch(/^meta\.level 1 here, 2 in commands; meta\.name .*; and 1 more$/);
  });
});

describe('finding what a path can do', () => {
  it('reads the tasks a canvas "not implemented yet" error names', () => {
    expect(pendingTasks(new Error('apply is not implemented yet (task 3.2).'))).toEqual(['3.2']);
    expect(pendingTasks(new Error('applyEdit is not implemented yet (tasks 3.2 and 3.3).'))).toEqual(['3.2', '3.3']);
    expect(pendingTasks(new Error('connect is not implemented yet (tasks 3.3, 3.4 and 3.6).'))).toEqual(['3.3', '3.4', '3.6']);
    expect(pendingTasks(new Error('No such part.'))).toBeUndefined();
    expect(pendingTasks('not implemented yet (task 3.2)')).toBeUndefined();
  });

  it('is ready when the member works, or fails any other way, and waits on the named tasks and its own builder', () => {
    expect(attempt('touch', 'place', () => 1)).toEqual(READY);
    expect(
      attempt('commands', 'place', () => {
        throw new TypeError('broken');
      }),
    ).toEqual(READY);
    expect(
      attempt('commands', 'connect', () => {
        throw new Error('apply is not implemented yet (task 3.2).');
      }),
    ).toEqual({ ready: false, tasks: ['3.2', '3.3'] });
    expect(
      attempt('list view', 'place', () => {
        throw new Error('listView is not implemented yet (task 3.6).');
      }),
    ).toEqual({ ready: false, tasks: ['3.6'] });
  });

  it('lets a gesture wait for what the command layer waits for, and for the task that builds the gesture', () => {
    expect(waitingLike(READY, 'touch', 'connect')).toEqual(READY);
    expect(waitingLike(waiting('3.2'), 'pointer', 'connect')).toEqual({ ready: false, tasks: ['3.2', '3.3'] });
    expect(BUILT_BY['list view'].connect).toBe('3.6');
  });

  it('runs a member it tries exactly once', () => {
    const member = vi.fn();
    attempt('touch', 'place', member);
    expect(member).toHaveBeenCalledTimes(1);
  });
});
