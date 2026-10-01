import { describe, expect, it } from 'vitest';
import { validBlueprints } from '../src/fixtures.ts';
import { makeCatalogue, validateBlueprint, wiredNeeds } from '../src/index.ts';
import type { Blueprint, Catalogue, PartRecord, Wire } from '../src/index.ts';
import { arenas, catalogue, copy, part, parts, reasons, unwrap } from './support.ts';

const fixture = (name: string): Blueprint => {
  const found = validBlueprints.find((entry) => entry.name === name);
  if (!found) throw new Error(`No fixture ${name}`);
  return unwrap(validateBlueprint(found.data, catalogue));
};

/** The failure modes the wiring alone shows, as `part: mode`, sorted. */
const shown = (blueprint: Blueprint, within: Catalogue = catalogue): string[] =>
  wiredNeeds(blueprint, within)
    .filter((verdict) => verdict.unmet !== undefined)
    .map((verdict) => {
      const type = blueprint.parts.find((placed) => placed.id === verdict.partId)?.part ?? '';
      const mode = within.parts.get(type)?.failureModes.find((failure) => failure.need === verdict.need && failure.unmet === verdict.unmet);
      return `${verdict.partId}: ${mode?.id ?? `${verdict.need} ${verdict.unmet ?? ''}`}`;
    })
    .sort();

/** A small build on the workbench: parts as [id, type], power wires as ['part.port', 'part.port']. */
const build = (placed: readonly (readonly [string, string])[], wires: readonly (readonly [string, string])[]): Blueprint => {
  const base = fixture('led-circuit');
  const ref = (text: string) => {
    const [partId = '', port = ''] = text.split('.');
    return { part: partId, port };
  };
  return unwrap(
    validateBlueprint(
      {
        ...base,
        parts: placed.map(([id, type], index) => ({ id, part: type, position: { x: index * 80, y: 0 }, rotation: 0, settings: {} })),
        wires: wires.map(([from, to], index) => ({ id: `w${index + 1}`, from: ref(from), to: ref(to) })),
        meta: { ...base.meta, highWater: { parts: 0, wires: wires.length } },
      },
      catalogue,
    ),
  );
};

const without = (blueprint: Blueprint, a: string, b: string): Blueprint => {
  const joins = (wire: Wire, x: string, y: string) => `${wire.from.part}.${wire.from.port}` === x && `${wire.to.part}.${wire.to.port}` === y;
  const wires = blueprint.wires.filter((wire) => !joins(wire, a, b) && !joins(wire, b, a));
  if (wires.length !== blueprint.wires.length - 1) throw new Error(`No wire ${a} to ${b}`);
  return { ...blueprint, wires };
};

describe('loop and isolation: one consistent fault for each wiring mistake', () => {
  it('shows only the short circuit on the short-circuit fixture: a closed path is still a loop', () => {
    expect(wiredNeeds(fixture('short-circuit'), catalogue)).toEqual([
      { partId: 'battery', need: 'no-short', kind: 'isolation', unmet: 'shorted' },
      { partId: 'battery', need: 'loop', kind: 'loop' },
    ]);
    expect(shown(fixture('short-circuit'))).toEqual(['battery: short-circuit']);
  });

  it('gives a switch wired across the pack one fault, and the pack one', () => {
    expect(shown(fixture('switch-across-pack'))).toEqual(['battery: short-circuit', 'switch: across-the-pack']);
    expect(shown(build([['battery', 'battery-pack-1-cell'], ['bumper', 'bumper-switch']], [['battery.plus', 'bumper.a'], ['bumper.b', 'battery.minus']]))).toEqual([
      'battery: short-circuit',
      'bumper: across-the-pack',
    ]);
  });

  it('shows no loop only when nothing closes the loop', () => {
    expect(shown(build([['battery', 'battery-pack-2-cell']], []))).toEqual(['battery: no-loop']);
    const sideways = build(
      [['battery', 'battery-pack-2-cell'], ['led', 'led'], ['switch', 'switch']],
      [['battery.plus', 'led.plus'], ['led.minus', 'battery.minus'], ['battery.plus', 'switch.a']],
    );
    expect(shown(sideways)).toEqual(['switch: outside-loop']);
    const bypassed = build(
      [['battery', 'battery-pack-2-cell'], ['led', 'led'], ['switch', 'switch']],
      [['battery.plus', 'switch.a'], ['switch.b', 'led.plus'], ['led.minus', 'battery.minus'], ['switch.a', 'switch.b']],
    );
    expect(shown(bypassed)).toEqual(['switch: outside-loop']);
  });

  it('lets two packs in series power an LED with no short', () => {
    const series = build(
      [['big', 'battery-pack-2-cell'], ['small', 'battery-pack-1-cell'], ['led', 'led']],
      [['big.plus', 'small.minus'], ['small.plus', 'led.plus'], ['led.minus', 'big.minus']],
    );
    expect(shown(series)).toEqual([]);
  });

  it('finds no wiring fault on the working fixtures', () => {
    for (const name of ['rolling-start', 'led-circuit', 'reversed-motor', 'bumper-robot', 'motor-off-pin']) {
      expect(shown(fixture(name)), name).toEqual([]);
    }
  });
});

describe('power: judged as wired, so control never makes a fault', () => {
  it('counts every switch closed, whatever its state', () => {
    const openSwitch = copy(part('switch')) as unknown as { behaviour: { actuation: { initially: string } }[] };
    const first = openSwitch.behaviour[0];
    if (first) first.actuation.initially = 'open';
    const startsOpen = makeCatalogue({ parts: [openSwitch as unknown as PartRecord, ...parts], arenas });
    expect(wiredNeeds(fixture('rolling-start'), startsOpen)).toEqual(wiredNeeds(fixture('rolling-start'), catalogue));
    expect(shown(fixture('rolling-start'), startsOpen)).toEqual([]);
  });

  it('makes no fault of a motor-driver channel set to stop or backward', () => {
    const robot = fixture('bumper-robot');
    const driverIndex = robot.parts.findIndex((placed) => placed.id === 'driver');
    const commanded: Blueprint = {
      ...robot,
      parts: robot.parts.map((placed, index) => (index === driverIndex ? { ...placed, settings: { 'motor-a': 'stop', 'motor-b': 'backward' } } : placed)),
    };
    expect(reasons(validateBlueprint(commanded, catalogue))).toEqual([]);
    expect(wiredNeeds(commanded, catalogue)).toEqual(wiredNeeds(robot, catalogue));
    expect(shown(commanded)).toEqual([]);
  });

  it('shows the motor driver’s no-power fault, not the motors’, when the driver has no power', () => {
    const unpowered = without(fixture('bumper-robot'), 'bumper.b', 'driver.plus');
    expect(shown(unpowered)).toEqual(['driver: no-power']);
    const motors = wiredNeeds(unpowered, catalogue).filter((verdict) => verdict.partId.startsWith('motor-'));
    expect(motors).toEqual([
      { partId: 'motor-left', need: 'power', kind: 'power', explainedBy: 'driver' },
      { partId: 'motor-right', need: 'power', kind: 'power', explainedBy: 'driver' },
    ]);
  });

  it('shows the microcontroller’s fault for a motor on its 3V pin when it has no power', () => {
    const unpowered = without(fixture('motor-off-pin'), 'battery.plus', 'brain.plus');
    expect(shown(unpowered)).toEqual(['brain: no-power']);
    expect(wiredNeeds(unpowered, catalogue).find((verdict) => verdict.partId === 'motor')).toEqual({
      partId: 'motor',
      need: 'power',
      kind: 'power',
      explainedBy: 'brain',
    });
  });

  it('shows no circuit for a motor with a wire missing', () => {
    expect(shown(without(fixture('rolling-start'), 'battery.minus', 'motor-left.minus'))).toEqual(['motor-left: no-circuit']);
  });

  it('judges the same whatever the wire order', () => {
    const robot = fixture('bumper-robot');
    expect(wiredNeeds({ ...robot, wires: [...robot.wires].reverse() }, catalogue)).toEqual(wiredNeeds(robot, catalogue));
  });
});
