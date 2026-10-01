import { describe, expect, it } from 'vitest';
import { validBlueprints } from '../src/fixtures.ts';
import {
  SOCKET_CAPACITY,
  checkPortPair,
  makeCatalogue,
  planWire,
  socketOf,
  validateBlueprint,
  validatePartRecord,
} from '../src/index.ts';
import type { Blueprint, PartRecord, PortRef, PortSpec, Socket } from '../src/index.ts';
import { arenas, catalogue, copy, part, parts, reasons, unwrap } from './support.ts';

const SPECS: Record<Socket, PortSpec> = {
  power: { id: 'p', type: 'power', label: 'p', polarity: 'positive' },
  'signal-in': { id: 'si', type: 'signal', label: 'si', direction: 'in' },
  'signal-out': { id: 'so', type: 'signal', label: 'so', direction: 'out' },
  'drive-in': { id: 'di', type: 'mechanical', label: 'di', role: 'drive-in', at: { x: 0, y: 0, z: 0 }, axis: '+y' },
  'drive-out': { id: 'do', type: 'mechanical', label: 'do', role: 'drive-out', at: { x: 0, y: 0, z: 0 }, axis: '+y' },
  mount: { id: 'm', type: 'mechanical', label: 'm', role: 'mount', at: { x: 0, y: 0, z: 0 }, yaw: 0 },
  'mount-point': { id: 'mp', type: 'mechanical', label: 'mp', role: 'mount-point', at: { x: 0, y: 0, z: 0 }, yaw: 0, mirrored: false },
};

const SOCKETS = Object.keys(SPECS) as Socket[];
const typeOf = (socket: Socket): string => SPECS[socket].type;
const isDrive = (socket: Socket): boolean => socket.startsWith('drive');

/** The rule, written out independently of the implementation. */
const expected = (a: Socket, b: Socket): string => {
  if (typeOf(a) !== typeOf(b)) return 'wire.type_mismatch';
  if (a === 'power') return 'power';
  if (typeOf(a) === 'signal') return a === b ? 'wire.signal_direction' : 'signal';
  if (isDrive(a) !== isDrive(b)) return 'wire.mechanical_mismatch';
  if (a === b) return 'wire.mechanical_direction';
  return isDrive(a) ? 'drive' : 'mount';
};

const SOURCES: readonly Socket[] = ['signal-out', 'drive-out', 'mount'];

describe('the socket rule (checkPortPair)', () => {
  const pairs = SOCKETS.flatMap((a) => SOCKETS.map((b) => ({ a, b, verdict: expected(a, b) })));

  it.each(pairs)('$a with $b: $verdict', ({ a, b, verdict }) => {
    const result = checkPortPair(SPECS[a], SPECS[b]);
    if (result.legal) {
      expect(result.kind).toBe(verdict);
      expect(result.swap).toBe(SOURCES.includes(b) && !SOURCES.includes(a));
    } else {
      expect(result.code).toBe(verdict);
      expect(result.message).not.toContain('!');
    }
  });

  it('maps every port spec to its socket', () => {
    for (const socket of SOCKETS) expect(socketOf(SPECS[socket])).toBe(socket);
  });

  it('lets power nets and signal fan-out take many wires, and everything else one', () => {
    expect(SOCKET_CAPACITY).toEqual({
      power: null,
      'signal-out': null,
      'signal-in': 1,
      'drive-out': 1,
      'drive-in': 1,
      mount: 1,
      'mount-point': 1,
    });
  });
});

const fixture = (name: string): Blueprint => {
  const found = validBlueprints.find((entry) => entry.name === name);
  if (!found) throw new Error(`No fixture ${name}`);
  return unwrap(validateBlueprint(found.data, catalogue));
};

const port = (text: string): PortRef => {
  const [part = '', portId = ''] = text.split('.');
  return { part, port: portId };
};

const withoutWires = (blueprint: Blueprint): Blueprint => ({ ...blueprint, wires: [] });

describe('planWire: impossible drops are refused with a named reason', () => {
  it('refuses a power wire into a signal port', () => {
    const plan = planWire(fixture('motor-off-pin'), catalogue, port('battery.plus'), port('servo.signal'));
    expect(plan).toMatchObject({ legal: false, code: 'wire.type_mismatch' });
  });

  it('refuses a second wire into a signal in, a hub or a mount point', () => {
    expect(planWire(fixture('motor-off-pin'), catalogue, port('brain.out-2'), port('servo.signal'))).toMatchObject({ code: 'wire.port_full' });
    expect(planWire(fixture('rolling-start'), catalogue, port('motor-right.shaft'), port('wheel-left.hub'))).toMatchObject({ code: 'wire.port_full' });
    expect(planWire(fixture('rolling-start'), catalogue, port('battery.mount'), port('chassis.deck-front'))).toMatchObject({ code: 'wire.port_full' });
  });

  it('refuses a wire that is already there, from either end', () => {
    const blueprint = fixture('led-circuit');
    expect(planWire(blueprint, catalogue, port('battery.plus'), port('switch.a'))).toMatchObject({ code: 'wire.duplicate' });
    expect(planWire(blueprint, catalogue, port('switch.a'), port('battery.plus'))).toMatchObject({ code: 'wire.duplicate' });
  });

  it('refuses a port joined to itself and a part linked to itself', () => {
    expect(planWire(fixture('led-circuit'), catalogue, port('led.plus'), port('led.plus'))).toMatchObject({ code: 'wire.same_port' });
    const bumper = withoutWires(fixture('bumper-robot'));
    expect(planWire(bumper, catalogue, port('gear-left.output'), port('gear-left.input'))).toMatchObject({ code: 'wire.mechanical_same_part' });
  });

  it('refuses unknown parts and ports', () => {
    const blueprint = fixture('led-circuit');
    expect(planWire(blueprint, catalogue, port('lamp.plus'), port('led.plus'))).toMatchObject({ code: 'ref.unknown_placed_part' });
    expect(planWire(blueprint, catalogue, port('led.anode'), port('switch.b'))).toMatchObject({ code: 'ref.unknown_port' });
    const odd = { ...blueprint, parts: [...blueprint.parts, { id: 'mystery', part: 'flux-unit', position: { x: 0, y: 0 }, rotation: 0, settings: {} }] };
    expect(planWire(odd, catalogue, port('mystery.plus'), port('led.plus'))).toMatchObject({ code: 'ref.unknown_part_type' });
  });
});

describe('planWire: legal wires, including legal-but-wrong ones, come back in stored orientation', () => {
  it('accepts a DC motor straight off the microcontroller pin, because its failure is the lesson', () => {
    const blueprint = fixture('motor-off-pin');
    const bare = { ...blueprint, wires: blueprint.wires.filter((wire) => wire.to.part !== 'motor' && wire.from.part !== 'motor') };
    expect(planWire(bare, catalogue, port('motor.plus'), port('brain.pin-3v'))).toEqual({
      legal: true,
      kind: 'power',
      from: port('brain.pin-3v'),
      to: port('motor.plus'),
    });
  });

  it('accepts a short circuit and a reversed motor', () => {
    const battery = { ...fixture('short-circuit'), wires: [] };
    expect(planWire(battery, catalogue, port('battery.minus'), port('battery.plus'))).toMatchObject({ legal: true, kind: 'power' });
    const robot = fixture('rolling-start');
    const bare = { ...robot, wires: robot.wires.filter((wire) => ![wire.from.part, wire.to.part].includes('motor-right')) };
    expect(planWire(bare, catalogue, port('motor-right.plus'), port('battery.minus'))).toMatchObject({ legal: true, kind: 'power' });
  });

  it('writes power wires lower port reference first, whichever end was dragged', () => {
    const bare = withoutWires(fixture('led-circuit'));
    const forward = planWire(bare, catalogue, port('switch.b'), port('led.plus'));
    const backward = planWire(bare, catalogue, port('led.plus'), port('switch.b'));
    expect(forward).toEqual(backward);
    expect(forward).toMatchObject({ from: port('led.plus'), to: port('switch.b') });
  });

  it('writes signal wires out to in, drive linkages shaft to hub, and mounts part to mount point', () => {
    const pin = withoutWires(fixture('motor-off-pin'));
    expect(planWire(pin, catalogue, port('servo.signal'), port('brain.out-1'))).toEqual({
      legal: true,
      kind: 'signal',
      from: port('brain.out-1'),
      to: port('servo.signal'),
    });
    const robot = withoutWires(fixture('rolling-start'));
    expect(planWire(robot, catalogue, port('wheel-left.hub'), port('motor-left.shaft'))).toEqual({
      legal: true,
      kind: 'drive',
      from: port('motor-left.shaft'),
      to: port('wheel-left.hub'),
    });
    expect(planWire(robot, catalogue, port('chassis.caster'), port('caster.mount'))).toEqual({
      legal: true,
      kind: 'mount',
      from: port('caster.mount'),
      to: port('chassis.caster'),
    });
  });

  it('lets one signal out feed several inputs', () => {
    const blueprint = fixture('motor-off-pin');
    const second = {
      ...blueprint,
      parts: [...blueprint.parts, { id: 'servo-two', part: 'servo-motor', position: { x: 200, y: 0 }, rotation: 0, settings: {} }],
    };
    expect(planWire(second, catalogue, port('brain.out-1'), port('servo-two.signal'))).toMatchObject({ legal: true, kind: 'signal' });
  });

  it('gives wires that validate when added to the blueprint', () => {
    const robot = fixture('rolling-start');
    const bare = withoutWires(robot);
    let built: Blueprint = bare;
    for (const wire of robot.wires) {
      const plan = planWire(built, catalogue, wire.to, wire.from);
      if (!plan.legal) throw new Error(plan.message);
      built = { ...built, wires: [...built.wires, { id: wire.id, from: plan.from, to: plan.to }] };
    }
    expect(reasons(validateBlueprint(built, catalogue))).toEqual([]);
    expect(built.wires.map((wire) => [wire.from, wire.to])).toEqual(robot.wires.map((wire) => [wire.from, wire.to]));
  });
});

describe('mount loops', () => {
  const bracket: PartRecord = unwrap(
    validatePartRecord({
      ...copy(part('caster')),
      id: 'bracket',
      ports: [
        { id: 'mount', type: 'mechanical', label: 'mount', role: 'mount', at: { x: 0, y: 0, z: 0 }, yaw: 0 },
        { id: 'point', type: 'mechanical', label: 'mount point', role: 'mount-point', at: { x: 0, y: 0, z: 14 }, yaw: 0, mirrored: false },
      ],
    }),
  );
  const withBracket = makeCatalogue({ parts: [...parts, bracket], arenas });
  const placed = (id: string) => ({ id, part: 'bracket', position: { x: 0, y: 0 }, rotation: 0, settings: {} });
  const base: Blueprint = {
    ...fixture('led-circuit'),
    parts: [placed('one'), placed('three'), placed('two')],
    wires: [
      { id: 'w1', from: port('one.mount'), to: port('two.point') },
      { id: 'w2', from: port('two.mount'), to: port('three.point') },
    ],
  };

  it('refuses a mount that would close a loop', () => {
    expect(planWire(base, withBracket, port('three.mount'), port('one.point'))).toMatchObject({ legal: false, code: 'mount.cycle' });
    expect(planWire(base, withBracket, port('three.mount'), port('two.point'))).toMatchObject({ code: 'wire.port_full' });
  });

  it('reports a stored loop once, on the wire that closes it', () => {
    const looped = { ...base, wires: [...base.wires, { id: 'w3', from: port('three.mount'), to: port('one.point') }] };
    expect(reasons(validateBlueprint(looped, withBracket))).toEqual(['mount.cycle at $.wires[2]']);
  });
});
