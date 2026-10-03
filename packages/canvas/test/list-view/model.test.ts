// The list view's model (task 3.6): whole fixtures built from the list view alone, byte-identical to the same build
// made by touch and pointer (the canvas e2e, test/browser/placement-e2e.test.ts, proves those equal these commands);
// every action it offers is legal and every legal wire is offered; the words; Run mode and read-only. See README.md.
import { describe, expect, it } from 'vitest';
import { applyEdit } from '../../src/index.ts';
import { canonicalJson, planWire, serializeBlueprint } from '@servo/schema';
import type { Blueprint, PortRef } from '@servo/schema';
import type { EditCommand, ListAction, ListSubject, PropTemplate } from '../../src/interface.ts';
import { wireKindOf } from '../../src/wiring/commands.ts';
import { catalogue, fixture } from '../helpers/catalogue.ts';
import { connectCommands, fixtureNames, placeCommands, planFor, settingCommands, startOf, wiredFixture } from '../helpers/plans.ts';
import type { Plan } from '../helpers/plans.ts';
import { actionDoing, benchOf } from './bench.ts';
import type { Bench } from './bench.ts';

/** The fixtures whose loose parts all stand where the list view places a part: one root, at the canvas origin, square on. */
const LIST_BUILDABLE = ['rolling-start', 'reversed-motor', 'short-circuit'];

/** Every command the canvas e2e makes by hand for a fixture, applied: what touch and pointer give, byte for byte. */
const byHand = (plan: Plan, commands: readonly EditCommand[]): Blueprint =>
  commands.reduce((build, command) => {
    const result = applyEdit(build, command, catalogue);
    if (!result.ok) throw new Error(`${plan.name}: ${result.refusal.code}`);
    return result.blueprint;
  }, startOf(plan));

/** Builds a fixture as a screen-reader user would: each part from the tray's list-view path, then each wire from its port. */
const buildFromList = (plan: Plan, bench: Bench, settings: boolean): void => {
  const placements = placeCommands(plan);
  for (const [index, step] of plan.steps.entries()) {
    const actions = bench.model.placementsFor(step.part);
    const command = placements[index] as EditCommand;
    const action = step.attach ? actionDoing(actions, command) : actions.find((candidate) => candidate.id === `place:${step.part}:free`);
    if (!action) throw new Error(`${plan.name}: no placement for ${step.fixtureId}: ${actions.map((a) => a.id).join(', ')}`);
    expect(bench.model.perform(action), action.label).toBe(true);
  }
  for (const command of connectCommands(plan)) {
    const action = actionDoing(bench.model.actionsFor({ kind: 'port', port: command.from }), command);
    if (!action) throw new Error(`${plan.name}: no wire ${canonicalJson(command)}`);
    expect(bench.model.perform(action), action.label).toBe(true);
  }
  if (!settings) return;
  for (const command of settingCommands(plan)) {
    if (command.kind !== 'set-setting') continue;
    const action = actionDoing(bench.model.actionsFor({ kind: 'part', partId: command.partId }), command);
    if (!action) throw new Error(`${plan.name}: no setting ${canonicalJson(command)}`);
    expect(bench.model.perform(action), action.label).toBe(true);
  }
};

describe('a fixture built entirely from the list view (task 3.6 done-when)', () => {
  it.each(LIST_BUILDABLE)('%s: byte-identical to the same build placed and wired on canvas', (name) => {
    const plan = planFor(name);
    for (const step of plan.steps) if (!step.attach) expect([step.position, step.rotation ?? 0], `${name} stands at the free spot`).toEqual([{ x: 0, y: 0 }, 0]);
    const bench = benchOf(startOf(plan));
    buildFromList(plan, bench, false);
    const bytes = serializeBlueprint(bench.blueprint as Blueprint);
    expect(bytes).toBe(serializeBlueprint(byHand(plan, [...placeCommands(plan), ...connectCommands(plan)])));
    expect(bytes).toBe(serializeBlueprint(wiredFixture(plan, false)));
    // The same wires, by the same commands, as the hand draws them on canvas.
    expect(bench.edits.slice(plan.steps.length)).toEqual(connectCommands(plan));
  });

  it.each(LIST_BUILDABLE)('%s: with its settings from the list view, byte-identical to the whole fixture', (name) => {
    const plan = planFor(name);
    const bench = benchOf(startOf(plan));
    buildFromList(plan, bench, true);
    expect(serializeBlueprint(bench.blueprint as Blueprint)).toBe(serializeBlueprint(wiredFixture(plan)));
  });
});

/** Every subject in a build: its parts, their ports, its wires and the arena's props. */
const subjectsOf = (bench: Bench): ListSubject[] => [
  ...bench.model.parts.flatMap((part): ListSubject[] => [{ kind: 'part', partId: part.partId }, ...part.ports.map((port): ListSubject => ({ kind: 'port', port: port.ref }))]),
  ...bench.model.wires.map((wire): ListSubject => ({ kind: 'wire', wireId: wire.wireId })),
  ...bench.model.props.map((prop): ListSubject => ({ kind: 'prop', propId: prop.propId })),
];

const BOX: PropTemplate = { shape: 'box', size: { x: 80, y: 80, z: 80 }, grams: 200, fixed: false };

describe('only legal actions (it never meets an impossible drop)', () => {
  it.each(fixtureNames)('%s: every edit it offers applies through applyEdit and changes the build, but tidy wires', (name) => {
    const build = fixture(name);
    const bench = benchOf(build);
    const edits: ListAction[] = [
      ...subjectsOf(bench).flatMap((subject) => bench.model.actionsFor(subject)),
      ...[...catalogue.parts.keys()].flatMap((type) => bench.model.placementsFor(type)),
      ...bench.model.propPlacementsFor(BOX),
    ].filter((action) => action.does.kind === 'edit');
    expect(edits.length).toBeGreaterThan(10);
    for (const action of edits) {
      if (action.does.kind !== 'edit') continue;
      const result = applyEdit(build, action.does.command, catalogue);
      expect(result.ok, `${action.id}: ${result.ok ? '' : result.refusal.code}`).toBe(true);
      // Tidy wires changes the routes, view state, and never the build (task 3.7).
      if (!result.ok) continue;
      if (action.does.command.kind === 'tidy-wires') expect(serializeBlueprint(result.blueprint), action.id).toBe(serializeBlueprint(build));
      else expect(serializeBlueprint(result.blueprint), action.id).not.toBe(serializeBlueprint(build));
    }
    // Ids are unique within a subject's actions.
    for (const subject of subjectsOf(bench)) {
      const ids = bench.model.actionsFor(subject).map((action) => action.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  }, 60_000);

  it.each(fixtureNames)('%s: every wire planWire allows between two ports is offered from both of them', (name) => {
    const build = fixture(name);
    const bench = benchOf(build);
    const ports: PortRef[] = bench.model.parts.flatMap((part) => part.ports.map((port) => port.ref));
    for (const a of ports) {
      const offered = bench.model.actionsFor({ kind: 'port', port: a });
      for (const b of ports) {
        if (a === b || !planWire(build, catalogue, a, b).legal || wireKindOf(build, catalogue, a, b) === 'mount') continue;
        expect(actionDoing(offered, { kind: 'connect', from: a, to: b }), `${a.part}.${a.port} to ${b.part}.${b.port}`).toBeDefined();
      }
    }
  }, 60_000);
});

describe('the words: real names, one plain line each (ground rule 7)', () => {
  const bench = benchOf(fixture('rolling-start'));

  it('reads parts, wires and ports with the names from the part records, numbering twins', () => {
    const motor = bench.model.parts.find((part) => part.partId === 'motor-left');
    expect(motor?.name).toBe('DC motor');
    expect(motor?.description).toBe(
      'DC motor 1, mounted on chassis left motor mount, plus (+) connected to switch side B, minus (−) connected to 2-cell battery pack minus (−), shaft connected to large wheel 1 hub',
    );
    expect(motor?.ports.map((port) => [port.label, port.type])).toEqual([
      ['plus (+)', 'power'],
      ['minus (−)', 'power'],
      ['shaft', 'mechanical'],
      ['mount', 'mechanical'],
    ]);
    expect(bench.model.parts.find((part) => part.partId === 'battery')?.description).toBe(
      '2-cell battery pack, mounted on chassis rear deck, plus (+) connected to switch side A, minus (−) connected to DC motor 1 minus (−) and DC motor 2 minus (−)',
    );
    expect(bench.model.parts.find((part) => part.partId === 'wheel-left')?.description).toBe('large wheel 1, on DC motor 1 shaft');
    expect(bench.model.wires.map((wire) => wire.description)).toContain('power line from 2-cell battery pack plus (+) to switch side A');
    expect(bench.model.wires.map((wire) => wire.description)).toContain('drive linkage from DC motor 1 shaft to large wheel 1 hub');
    expect(bench.model.wires.map((wire) => wire.description)).toContain('mount: switch fixed to chassis front deck');
  });

  it('lists parts and wires in id order, as a child counts them', () => {
    const build = benchOf(byHand(planFor('rolling-start'), [...placeCommands(planFor('rolling-start')), ...connectCommands(planFor('rolling-start'))]));
    expect(build.model.parts.map((part) => part.partId)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8']);
    expect(build.model.wires.map((wire) => wire.wireId).slice(8, 11)).toEqual(['w9', 'w10', 'w11']);
  });

  it('says a loose part is loose, and lists every prop in the arena', () => {
    const led = benchOf(fixture('led-circuit'));
    expect(led.model.parts.find((part) => part.partId === 'battery')?.description).toMatch(/^2-cell battery pack, loose, /);
    expect(led.model.parts.find((part) => part.partId === 'led')?.description).toMatch(/^LED, plus \(\+\), long leg connected to /);
    const bumper = benchOf(fixture('bumper-robot'));
    expect(bumper.model.props.map((prop) => prop.description)).toEqual([
      'box, 80 by 80 millimetres, ahead and to the left of the robot, part of the arena',
      'cylinder, 60 millimetres across, ahead and to the right of the robot',
    ]);
  });

  it.each(fixtureNames)('%s: no exclamation marks, no praise, in any line or label', (name) => {
    const each = benchOf(fixture(name));
    const lines = [
      ...each.model.parts.map((part) => part.description),
      ...each.model.wires.map((wire) => wire.description),
      ...each.model.props.map((prop) => prop.description),
      ...subjectsOf(each).flatMap((subject) => each.model.actionsFor(subject).map((action) => action.label)),
      ...[...catalogue.parts.keys()].flatMap((type) => each.model.placementsFor(type).map((action) => action.label)),
    ];
    for (const line of lines) {
      expect(line).not.toMatch(/!|great|well done|awesome/i);
      expect(line.trim()).toBe(line);
    }
  }, 60_000);
});

describe('the canvas’s actions, from the list', () => {
  it('re-snaps a mounted switch onto the free middle deck with the command the Move handle gives (D34)', () => {
    const bench = benchOf(fixture('rolling-start'));
    bench.act({ kind: 'part', partId: 'switch' }, 'mount:switch.mount:chassis.deck-middle');
    expect(bench.edits).toEqual([{ kind: 'mount', partId: 'switch', port: 'mount', onto: { part: 'chassis', port: 'deck-middle' } }]);
  });

  it('moves a part to a free spot, turns it a quarter turn either way, and takes it off its mount', () => {
    const bench = benchOf(fixture('rolling-start'));
    bench.act({ kind: 'part', partId: 'switch' }, 'move:switch:free');
    const moved = bench.edits[0];
    expect(moved?.kind).toBe('move-part');
    expect(bench.model.heldOf('switch')).toBe('loose');
    bench.act({ kind: 'part', partId: 'switch' }, 'turn:switch:clockwise');
    bench.act({ kind: 'part', partId: 'switch' }, 'turn:switch:clockwise');
    bench.act({ kind: 'part', partId: 'switch' }, 'turn:switch:anticlockwise');
    expect(bench.blueprint?.parts.find((part) => part.id === 'switch')?.rotation).toBe(90);
    bench.act({ kind: 'port', port: { part: 'caster', port: 'mount' } }, 'unmount:caster.mount');
    expect(bench.model.heldOf('caster')).toBe('loose');
  });

  it('removes a part with its wires and says what it leaves loose (D35)', () => {
    const bench = benchOf(fixture('rolling-start'));
    const remove = bench.model.actionsFor({ kind: 'part', partId: 'motor-left' }).find((action) => action.id === 'remove:motor-left');
    expect(remove?.label).toBe('Remove DC motor 1 and its 2 wires, leaving large wheel 1 loose');
    bench.act({ kind: 'part', partId: 'motor-left' }, 'remove:motor-left');
    expect(bench.model.heldOf('wheel-left')).toBe('loose');
  });

  it('removes a wire, and offers only the settings unlocked at the child’s level, a step at a time', () => {
    const bench = benchOf(fixture('rolling-start'));
    const wire = bench.model.wires.find((candidate) => candidate.kind === 'power');
    bench.act({ kind: 'wire', wireId: wire?.wireId as string }, `disconnect:${wire?.wireId}`);
    expect(bench.model.wires.some((candidate) => candidate.wireId === wire?.wireId)).toBe(false);
    const settingIds = (): string[] =>
      bench.model.actionsFor({ kind: 'part', partId: 'motor-left' }).filter((action) => action.id.startsWith('setting:')).map((action) => action.id);
    expect(settingIds()).toEqual(['setting:motor-left:direction:backward']);
    bench.level = 3;
    bench.model.changed();
    expect(settingIds()).toEqual(['setting:motor-left:direction:backward', 'setting:motor-left:speed:down']);
    bench.act({ kind: 'part', partId: 'motor-left' }, 'setting:motor-left:speed:down');
    expect(bench.blueprint?.parts.find((part) => part.id === 'motor-left')?.settings).toEqual({ speed: 90 });
    expect(settingIds()).toEqual(['setting:motor-left:direction:backward', 'setting:motor-left:speed:up', 'setting:motor-left:speed:down']);
  });

  it('offers a setting named by unlockSettings before its level, and no other (task 6.6)', () => {
    const bench = benchOf(fixture('rolling-start'), { level: 2, unlockSettings: (record, setting) => record.id === 'dc-motor' && setting.id === 'speed' });
    const settingIds = (partId: string): string[] =>
      bench.model.actionsFor({ kind: 'part', partId }).filter((action) => action.id.startsWith('setting:')).map((action) => action.id);
    expect(settingIds('motor-left')).toEqual(['setting:motor-left:direction:backward', 'setting:motor-left:speed:down']);
    bench.act({ kind: 'part', partId: 'motor-left' }, 'setting:motor-left:speed:down');
    expect(bench.blueprint?.parts.find((part) => part.id === 'motor-left')?.settings).toEqual({ speed: 90 });
    expect(benchOf(fixture('rolling-start'), { level: 2 }).model.actionsFor({ kind: 'part', partId: 'motor-left' }).map((action) => action.id)).not.toContain(
      'setting:motor-left:speed:down',
    );
  });

  it('places a large wheel on a free motor shaft, or moves a loose one there, as a wire to the shaft does', () => {
    const bench = benchOf(fixture('rolling-start'));
    bench.act({ kind: 'part', partId: 'wheel-left' }, 'remove:wheel-left');
    const placements = bench.model.placementsFor('wheel-large').map((action) => action.label);
    expect(placements).toEqual(['Place large wheel on the workbench', 'Place large wheel on DC motor 1 shaft']);
    const place = bench.model.placementsFor('wheel-large')[0] as ListAction;
    expect(bench.model.perform(place)).toBe(true);
    const wheel = bench.blueprint?.parts.find((part) => /^p\d+$/.test(part.id))?.id as string;
    expect(bench.model.heldOf(wheel)).toBe('loose');
    bench.act({ kind: 'part', partId: wheel }, `carry:${wheel}.hub:motor-left.shaft`);
    expect(bench.model.heldOf(wheel)).toBe('on DC motor 1 shaft');
  });

  it('places a prop from the arena strip at a free spot, then moves or removes only the child’s own props (D36)', () => {
    const bench = benchOf(fixture('bumper-robot'));
    const preset = bench.model.props[0];
    expect(bench.model.actionsFor({ kind: 'prop', propId: preset?.propId as string }).map((action) => action.id)).toEqual([`select:prop:${preset?.propId}`]);
    const [place] = bench.model.propPlacementsFor(BOX);
    expect(place?.label).toBe('Place a box in the arena');
    expect(bench.model.perform(place as ListAction)).toBe(true);
    const added = bench.model.props.at(-1)?.propId as string;
    expect(bench.model.actionsFor({ kind: 'prop', propId: added }).map((action) => action.id)).toContain(`remove-prop:${added}`);
    bench.act({ kind: 'prop', propId: added }, `remove-prop:${added}`);
    expect(bench.model.props.some((prop) => prop.propId === added)).toBe(false);
  });

  it('tells its subscribers after every change, until they unsubscribe', () => {
    const bench = benchOf(fixture('rolling-start'));
    let calls = 0;
    const stop = bench.model.subscribe(() => (calls += 1));
    bench.act({ kind: 'part', partId: 'switch' }, 'turn:switch:clockwise');
    expect(calls).toBe(1);
    stop();
    bench.act({ kind: 'part', partId: 'switch' }, 'turn:switch:clockwise');
    expect(calls).toBe(1);
  });
});

describe('Run mode and read-only (D42, D43)', () => {
  it('in Run mode offers inspecting and flipping a manual switch, which fires control and nothing else', () => {
    const bench = benchOf(fixture('rolling-start'));
    bench.mode = 'run';
    bench.model.changed();
    expect(bench.model.mode).toBe('run');
    expect(bench.model.placementsFor('led')).toEqual([]);
    expect(bench.model.actionsFor({ kind: 'port', port: { part: 'switch', port: 'a' } })).toEqual([]);
    expect(bench.model.actionsFor({ kind: 'part', partId: 'motor-left' }).map((action) => action.id)).toEqual(['select:part:motor-left']);
    const flip = (): ListAction => bench.model.actionsFor({ kind: 'part', partId: 'switch' }).find((action) => action.id === 'flip:switch') as ListAction;
    // Rolling Start's switch starts closed.
    expect(flip().label).toBe('Open switch');
    expect(bench.model.perform(flip())).toBe(true);
    expect(flip().label).toBe('Close switch');
    expect(bench.model.perform(flip())).toBe(true);
    expect(bench.controls).toEqual([
      { partId: 'switch', kind: 'switch', closed: false },
      { partId: 'switch', kind: 'switch', closed: true },
    ]);
    // A frame's readout wins over what the list sent.
    bench.live.set('switch', { values: { closed: false }, sounds: [], faults: [] });
    bench.model.changed();
    expect(flip().label).toBe('Close switch');
    expect(bench.model.parts.find((part) => part.partId === 'switch')?.live?.values.closed).toBe(false);
    // Stop: Build mode forgets what the list sent.
    bench.live.clear();
    bench.mode = 'build';
    bench.model.changed();
    bench.mode = 'run';
    expect(flip().label).toBe('Open switch');
    // An edit from a stale action changes nothing in Run mode.
    const before = bench.blueprint;
    expect(bench.model.perform({ id: 'x', label: 'x', does: { kind: 'edit', command: { kind: 'remove-part', partId: 'switch' } } })).toBe(false);
    expect(bench.blueprint).toBe(before);
    expect(bench.edits).toEqual([]);
  });

  it('selects through the canvas, in either mode', () => {
    const bench = benchOf(fixture('rolling-start'));
    bench.act({ kind: 'part', partId: 'battery' }, 'select:part:battery');
    expect(bench.selections).toEqual([{ kind: 'part', partId: 'battery' }]);
  });

  it('read-only offers inspecting only, and never fires control', () => {
    const bench = benchOf(fixture('rolling-start'), { readOnly: true });
    for (const subject of subjectsOf(bench)) {
      for (const action of bench.model.actionsFor(subject)) expect(action.does.kind, action.id).toBe('select');
    }
    expect(bench.model.placementsFor('led')).toEqual([]);
    bench.mode = 'run';
    bench.model.changed();
    expect(bench.model.actionsFor({ kind: 'part', partId: 'switch' }).map((action) => action.id)).toEqual(['select:part:switch']);
    expect(bench.model.perform({ id: 'flip:switch', label: 'Open switch', does: { kind: 'control', input: { partId: 'switch', kind: 'switch', closed: false } } })).toBe(false);
    expect(bench.controls).toEqual([]);
  });

  it('is empty before a build is loaded', () => {
    const bench = benchOf(undefined);
    expect([bench.model.parts, bench.model.wires, bench.model.props, bench.model.placementsFor('led')]).toEqual([[], [], [], []]);
  });
});
