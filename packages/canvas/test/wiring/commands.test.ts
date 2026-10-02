// The wiring commands (task 3.3): applyEdit's `connect` and `disconnect`, and whole fixtures built by commands. Each
// success is checked to be a blueprint validateBlueprint accepts, in canonical form. See docs/wiring.md.
import { describe, expect, it } from 'vitest';
import { canonicalizeBlueprint, placeParts, serializeBlueprint, validateBlueprint } from '@servo/schema';
import type { Blueprint, PlacedPart, Wire } from '@servo/schema';
import { applyEdit } from '../../src/index.ts';
import type { Connect, EditCommand, EditResult } from '../../src/interface.ts';
import { blueprintOf, catalogue, fixture } from '../helpers/catalogue.ts';
import { connectCommands, fixtureNames, placeCommands, planFor, settingCommands, startOf, wiredFixture } from '../helpers/plans.ts';

const ok = (build: Blueprint, command: EditCommand): Blueprint => {
  const before = serializeBlueprint(build);
  const result = applyEdit(build, command, catalogue);
  if (!result.ok) throw new Error(`${command.kind} refused: ${result.refusal.code} ${result.refusal.message}`);
  expect(serializeBlueprint(build), 'the input is untouched').toBe(before);
  const checked = validateBlueprint(result.blueprint, catalogue);
  expect(checked.ok && serializeBlueprint(canonicalizeBlueprint(checked.value, catalogue))).toBe(serializeBlueprint(result.blueprint));
  return result.blueprint;
};

const refused = (build: Blueprint, command: EditCommand): Extract<EditResult, { ok: false }>['refusal'] => {
  const result = applyEdit(build, command, catalogue);
  if (result.ok) throw new Error(`${command.kind} was not refused`);
  return result.refusal;
};

const run = (build: Blueprint, commands: readonly EditCommand[]): Blueprint => commands.reduce((current, command) => ok(current, command), build);

const part = (build: Blueprint, id: string): PlacedPart => {
  const found = build.parts.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`no part ${id}`);
  return found;
};

const at = (build: Blueprint, id: string): [number, number, number] => {
  const { position, rotation } = part(build, id);
  return [position.x, position.y, rotation];
};

/** A wire by id: canonical form keeps wires in id text order, so `w10` comes before `w2`. */
const wire = (build: Blueprint, id: string): Wire | undefined => build.wires.find((candidate) => candidate.id === id);

const connect = (from: string, to: string): Connect => {
  const [a, b] = [from.split('.'), to.split('.')] as [[string, string], [string, string]];
  return { kind: 'connect', from: { part: a[0], port: a[1] }, to: { part: b[0], port: b[1] } };
};

const deepFreeze = <T>(value: T): T => {
  if (typeof value === 'object' && value !== null) {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
};

/** A chassis with a DC motor on its left motor mount and a large wheel loose beside it. */
const motorAndLooseWheel = (): Blueprint =>
  run(blueprintOf({ parts: [], wires: [] }), [
    { kind: 'place-part', part: 'chassis', position: { x: 0, y: 0 } },
    { kind: 'place-part', part: 'dc-motor', attach: { port: 'mount', onto: { part: 'p1', port: 'motor-left' } } },
    { kind: 'place-part', part: 'wheel-large', position: { x: 150, y: 120 } },
  ]);

describe('the schema fixtures, built whole by commands (byte-identical)', () => {
  it.each(fixtureNames)('%s: every part placed, every wire connected, then its arena, name and settings', (name) => {
    const plan = planFor(name);
    const start: Blueprint = { ...startOf(plan), arena: { preset: 'open-floor', props: [] }, meta: { ...startOf(plan).meta, name: 'New build' } };
    const commands: EditCommand[] = [
      { kind: 'rename', name: plan.fixture.meta.name },
      { kind: 'set-arena', arena: plan.fixture.arena },
      ...placeCommands(plan),
      ...connectCommands(plan),
      ...settingCommands(plan),
    ];
    expect(serializeBlueprint(run(start, commands))).toBe(serializeBlueprint(wiredFixture(plan)));
  });

  it.each(fixtureNames)('%s: its placements and connects alone give the fixture without its settings, as the e2e builds it', (name) => {
    const plan = planFor(name);
    expect(serializeBlueprint(run(startOf(plan), [...placeCommands(plan), ...connectCommands(plan)]))).toBe(serializeBlueprint(wiredFixture(plan, false)));
  });

  it('gives the same bytes when the same commands run again, as one batch, and with each wire given the other way round', () => {
    const plan = planFor('bumper-robot');
    const commands = [...placeCommands(plan), ...connectCommands(plan)];
    const once = run(startOf(plan), commands);
    const turned = commands.map((command) => (command.kind === 'connect' ? { ...command, from: command.to, to: command.from } : command));
    expect(serializeBlueprint(run(startOf(plan), commands))).toBe(serializeBlueprint(once));
    expect(serializeBlueprint(ok(startOf(plan), { kind: 'batch', commands }))).toBe(serializeBlueprint(once));
    expect(serializeBlueprint(run(startOf(plan), turned))).toBe(serializeBlueprint(once));
  });

  it('never changes its input, even a frozen one', () => {
    const frozen = deepFreeze(fixture('led-circuit'));
    expect(applyEdit(frozen, connect('battery.plus', 'led.plus'), catalogue).ok).toBe(true);
    expect(applyEdit(frozen, { kind: 'disconnect', wireId: 'w2' }, catalogue).ok).toBe(true);
  });
});

describe('connect', () => {
  it('joins two power ports with the next w<n>, the lower port reference first, whichever end it starts from', () => {
    const build = fixture('led-circuit');
    const one = ok(build, connect('switch.b', 'battery.minus'));
    const other = ok(build, connect('battery.minus', 'switch.b'));
    expect(serializeBlueprint(one)).toBe(serializeBlueprint(other));
    expect(wire(one, 'w4')).toEqual({ id: 'w4', from: { part: 'battery', port: 'minus' }, to: { part: 'switch', port: 'b' } });
    expect(one.meta.highWater).toEqual({ parts: 0, wires: 4 });
  });

  it('stores a signal line from its out to its in, whichever end it starts from', () => {
    const build = run(fixture('motor-off-pin'), [{ kind: 'disconnect', wireId: 'w7' }]);
    const wired = ok(build, connect('servo.signal', 'brain.out-2'));
    expect(wire(wired, 'w8')).toEqual({ id: 'w8', from: { part: 'brain', port: 'out-2' }, to: { part: 'servo', port: 'signal' } });
  });

  it('carries a loose wheel onto the shaft it is joined to, wherever it was, from either end', () => {
    for (const command of [connect('p2.shaft', 'p3.hub'), connect('p3.hub', 'p2.shaft')]) {
      const build = ok(motorAndLooseWheel(), command);
      expect(at(build, 'p3')).toEqual([40, -79, 0]);
      expect(wire(build, 'w2')).toEqual({ id: 'w2', from: { part: 'p2', port: 'shaft' }, to: { part: 'p3', port: 'hub' } });
      expect(placeParts(build, catalogue).get('p3')?.by).toBe('carried');
    }
  });

  it('joins a motor shaft to a gearbox that is mounted, and moves neither', () => {
    const robot = fixture('bumper-robot');
    const loose = run(robot, [{ kind: 'disconnect', wireId: 'w10' }]);
    const build = ok(loose, connect('gear-left.input', 'motor-left.shaft'));
    expect(at(build, 'gear-left')).toEqual(at(robot, 'gear-left'));
    expect(at(build, 'motor-left')).toEqual(at(robot, 'motor-left'));
    expect(wire(build, 'w25')).toEqual({ id: 'w25', from: { part: 'motor-left', port: 'shaft' }, to: { part: 'gear-left', port: 'input' } });
  });

  it('joins a hub to a shaft it cannot line up with, a servo motor’s arm, and leaves the wheel where it is', () => {
    const build = run(blueprintOf({ parts: [], wires: [] }), [
      { kind: 'place-part', part: 'servo-motor', position: { x: 0, y: 0 } },
      { kind: 'place-part', part: 'wheel-large', position: { x: 120, y: 30 } },
      connect('p1.arm', 'p2.hub'),
    ]);
    expect(at(build, 'p2')).toEqual([120, 30, 0]);
    expect(build.wires).toEqual([{ id: 'w1', from: { part: 'p1', port: 'arm' }, to: { part: 'p2', port: 'hub' } }]);
  });

  it('accepts legal-but-wrong wiring: a reversed motor, a short across the pack, a motor on the microcontroller’s 3V pin', () => {
    const robot = run(fixture('rolling-start'), [{ kind: 'disconnect', wireId: 'w10' }, { kind: 'disconnect', wireId: 'w12' }]);
    const reversed = run(robot, [connect('motor-right.minus', 'switch.b'), connect('battery.minus', 'motor-right.plus')]);
    expect(wire(reversed, 'w13')).toEqual({ id: 'w13', from: { part: 'motor-right', port: 'minus' }, to: { part: 'switch', port: 'b' } });
    expect(wire(reversed, 'w14')).toEqual({ id: 'w14', from: { part: 'battery', port: 'minus' }, to: { part: 'motor-right', port: 'plus' } });
    const cell: PlacedPart = { id: 'p1', part: 'battery-pack-1-cell', position: { x: 0, y: 0 }, rotation: 0, settings: {} };
    const short = ok(blueprintOf({ parts: [cell], wires: [] }), connect('p1.plus', 'p1.minus'));
    expect(short.wires).toEqual([{ id: 'w1', from: { part: 'p1', port: 'minus' }, to: { part: 'p1', port: 'plus' } }]);
    const pin = run(fixture('motor-off-pin'), [{ kind: 'disconnect', wireId: 'w3' }]);
    expect(wire(ok(pin, connect('motor.plus', 'brain.pin-3v')), 'w8')).toEqual({ id: 'w8', from: { part: 'brain', port: 'pin-3v' }, to: { part: 'motor', port: 'plus' } });
  });

  it('refuses every impossible drop with the schema’s code', () => {
    const pin = fixture('motor-off-pin');
    const robot = fixture('bumper-robot');
    const cases: readonly [Blueprint, EditCommand, string][] = [
      [pin, connect('battery.plus', 'servo.signal'), 'wire.type_mismatch'],
      [pin, connect('brain.out-2', 'motor.plus'), 'wire.type_mismatch'],
      [robot, connect('servo.arm', 'battery.plus'), 'wire.type_mismatch'],
      [pin, connect('brain.out-1', 'brain.out-2'), 'wire.signal_direction'],
      [pin, connect('brain.in-1', 'brain.in-2'), 'wire.signal_direction'],
      [robot, connect('servo.arm', 'chassis.motor-left'), 'wire.mechanical_mismatch'],
      [robot, connect('servo.arm', 'motor-left.shaft'), 'wire.mechanical_direction'],
      [pin, connect('battery.plus', 'battery.plus'), 'wire.same_port'],
      [robot, connect('gear-left.output', 'gear-left.input'), 'wire.mechanical_same_part'],
      [pin, connect('brain.out-2', 'servo.signal'), 'wire.port_full'],
      [robot, connect('servo.arm', 'wheel-left.hub'), 'wire.port_full'],
      [pin, connect('servo.plus', 'battery.plus'), 'wire.duplicate'],
      [pin, connect('battery.plus', 'ghost.plus'), 'ref.unknown_placed_part'],
      [pin, connect('battery.lid', 'brain.plus'), 'ref.unknown_port'],
    ];
    for (const [build, command, code] of cases) expect(refused(build, command).code, JSON.stringify(command)).toBe(code);
  });

  it('leaves mounts to mount and unmount, and refuses a malformed command', () => {
    const build = run(fixture('led-circuit'), [{ kind: 'place-part', part: 'chassis', position: { x: 0, y: 150 } }]);
    const loose = run(blueprintOf({ parts: [], wires: [] }), [
      { kind: 'place-part', part: 'chassis', position: { x: 0, y: 0 } },
      { kind: 'place-part', part: 'battery-pack-2-cell', position: { x: 0, y: 150 } },
    ]);
    expect(refused(loose, connect('p2.mount', 'p1.deck-middle')).code).toBe('edit.wrong_command');
    expect(refused(build, { kind: 'connect', from: { part: 'battery' }, to: { part: 'led', port: 'plus' } } as never).code).toBe('value.wrong_type');
    expect(refused(build, { kind: 'connect', from: 'battery.plus', to: { part: 'led', port: 'plus' } } as never).code).toBe('value.wrong_type');
  });
});

describe('disconnect', () => {
  it('removes a power line and keeps every other id and the high-water mark', () => {
    const build = ok(fixture('led-circuit'), { kind: 'disconnect', wireId: 'w2' });
    expect(build.wires.map((wire) => wire.id)).toEqual(['w1', 'w3']);
    expect(build.meta.highWater).toEqual(fixture('led-circuit').meta.highWater);
    expect(wire(ok(build, connect('led.plus', 'switch.b')), 'w4')).toEqual({ id: 'w4', from: { part: 'led', port: 'plus' }, to: { part: 'switch', port: 'b' } });
  });

  it('takes a wheel off its shaft and leaves it where it was, loose', () => {
    const robot = fixture('rolling-start');
    const build = ok(robot, { kind: 'disconnect', wireId: 'w6' });
    expect(at(build, 'wheel-left')).toEqual(at(robot, 'wheel-left'));
    expect(placeParts(build, catalogue).get('wheel-left')?.by).toBe('root');
  });

  it('refuses a wire that is not there and a mount', () => {
    const robot = fixture('rolling-start');
    expect(refused(robot, { kind: 'disconnect', wireId: 'w99' }).code).toBe('edit.unknown_wire');
    expect(refused(robot, { kind: 'disconnect', wireId: 7 } as never).code).toBe('edit.unknown_wire');
    expect(refused(robot, { kind: 'disconnect', wireId: 'w3' }).code).toBe('edit.wrong_command');
  });
});

describe('batch', () => {
  it('places and wires as one change, naming the parts it places by the ids claimPartId predicts', () => {
    const build = ok(blueprintOf({ parts: [], wires: [] }), {
      kind: 'batch',
      commands: [
        { kind: 'place-part', part: 'battery-pack-2-cell', position: { x: 0, y: 0 } },
        { kind: 'place-part', part: 'led', position: { x: 100, y: 0 } },
        connect('p1.plus', 'p2.plus'),
        connect('p2.minus', 'p1.minus'),
      ],
    });
    expect(build.wires.map((wire) => [wire.id, `${wire.from.part}.${wire.from.port}`, `${wire.to.part}.${wire.to.port}`])).toEqual([
      ['w1', 'p1.plus', 'p2.plus'],
      ['w2', 'p1.minus', 'p2.minus'],
    ]);
  });

  it('is all or nothing: an impossible drop refuses the whole batch with its index', () => {
    const result = applyEdit(
      fixture('motor-off-pin'),
      { kind: 'batch', commands: [connect('battery.plus', 'brain.pin-3v'), connect('battery.plus', 'servo.signal')] },
      catalogue,
    );
    expect(result).toEqual({ ok: false, refusal: expect.objectContaining({ code: 'wire.type_mismatch', index: 1 }) });
  });
});
