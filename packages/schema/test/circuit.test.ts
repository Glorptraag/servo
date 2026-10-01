import { describe, expect, it } from 'vitest';
import { validBlueprints } from '../src/fixtures.ts';
import { CONTROL_COMBINATION_CAP, controlsOf, explainByControls, validateBlueprint, wiredNeeds } from '../src/index.ts';
import type { Blueprint, Control, ControlState, Explanation, Wire } from '../src/index.ts';
import { catalogue, unwrap } from './support.ts';

const fixture = (name: string): Blueprint => {
  const found = validBlueprints.find((entry) => entry.name === name);
  if (!found) throw new Error(`No fixture ${name}`);
  return unwrap(validateBlueprint(found.data, catalogue));
};

/** The faults the wiring shows: `part: failure mode` for every unmet need nothing explains, sorted. */
const faults = (blueprint: Blueprint, state: ControlState = {}): string[] =>
  wiredNeeds(blueprint, catalogue, state)
    .filter((verdict) => verdict.unmet !== undefined && verdict.explainedBy === undefined)
    .map((verdict) => {
      const type = blueprint.parts.find((placed) => placed.id === verdict.partId)?.part ?? '';
      const mode = catalogue.parts.get(type)?.failureModes.find((failure) => failure.need === verdict.need && failure.unmet === verdict.unmet);
      return `${verdict.partId}: ${mode?.id ?? `${verdict.need} ${verdict.unmet ?? ''}`}`;
    })
    .sort();

const describeExplanation = (explanation: Explanation): string => {
  if (explanation.by === 'controls') return `controls ${explanation.controls.join(', ')}`;
  if (explanation.by === 'short') return `short ${explanation.parts.join(', ')}`;
  return `feeder ${explanation.part}`;
};

/** The unmet needs that are not faults: `part need: why`, sorted. */
const explained = (blueprint: Blueprint, state: ControlState = {}): string[] =>
  wiredNeeds(blueprint, catalogue, state)
    .flatMap((verdict) => (verdict.explainedBy ? [`${verdict.partId} ${verdict.need}: ${describeExplanation(verdict.explainedBy)}`] : []))
    .sort();

type Placed = readonly [id: string, type: string, settings?: Readonly<Record<string, string>>];

/** A small build on the workbench: parts as [id, type, settings], power wires as ['part.port', 'part.port']. */
const build = (placed: readonly Placed[], wires: readonly (readonly [string, string])[]): Blueprint => {
  const base = fixture('led-circuit');
  const ref = (text: string) => {
    const [part = '', port = ''] = text.split('.');
    return { part, port };
  };
  return unwrap(
    validateBlueprint(
      {
        ...base,
        parts: placed.map(([id, type, settings = {}], index) => ({ id, part: type, position: { x: index * 80, y: 0 }, rotation: 0, settings })),
        wires: wires.map(([from, to], index) => ({ id: `w${index + 1}`, from: ref(from), to: ref(to) })),
        meta: { ...base.meta, level: 2, highWater: { parts: 0, wires: wires.length } },
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

const battery: Placed = ['battery', 'battery-pack-2-cell'];
const motor: Placed = ['motor', 'dc-motor'];
const opened = (...ids: readonly string[]): ControlState => ({ switches: Object.fromEntries(ids.map((id) => [`${id}/contacts`, false])) });

describe('a fault is something the controls cannot fix', () => {
  it('a series switch: open, the motor and the pack wait on it; closed, every need is met', () => {
    const series = build([battery, motor, ['switch', 'switch']], [['battery.plus', 'switch.a'], ['switch.b', 'motor.plus'], ['motor.minus', 'battery.minus']]);
    expect(faults(series)).toEqual([]);
    expect(explained(series)).toEqual([]);
    expect(faults(series, opened('switch'))).toEqual([]);
    expect(explained(series, opened('switch'))).toEqual(['battery loop: controls switch/contacts', 'motor power: controls switch/contacts']);
  });

  it('a switch across the pack with a motor beside it: open, nothing is wrong; closed, the short is the fault', () => {
    const across = build(
      [battery, motor, ['switch', 'switch']],
      [['battery.plus', 'switch.a'], ['switch.b', 'battery.minus'], ['battery.plus', 'motor.plus'], ['motor.minus', 'battery.minus']],
    );
    expect(faults(across, opened('switch'))).toEqual([]);
    expect(explained(across, opened('switch'))).toEqual([]);
    // The switch rests closed.
    expect(faults(across)).toEqual(['battery: short-circuit', 'switch: across-the-pack']);
    expect(explained(across)).toEqual(['motor power: short battery, switch']);
  });

  it('two series switches: whichever is open, the rest wait on it', () => {
    const two = build(
      [battery, motor, ['s1', 'switch'], ['s2', 'switch']],
      [['battery.plus', 's1.a'], ['s1.b', 's2.a'], ['s2.b', 'motor.plus'], ['motor.minus', 'battery.minus']],
    );
    expect(faults(two)).toEqual([]);
    expect(faults(two, opened('s1'))).toEqual([]);
    expect(explained(two, opened('s1'))).toEqual([
      'battery loop: controls s1/contacts',
      'motor power: controls s1/contacts',
      's2 in-loop: controls s1/contacts',
    ]);
    expect(faults(two, opened('s1', 's2'))).toEqual([]);
    expect(explained(two, opened('s1', 's2'))).toEqual([
      'battery loop: controls s1/contacts, s2/contacts',
      'motor power: controls s1/contacts, s2/contacts',
      's1 in-loop: controls s2/contacts',
      's2 in-loop: controls s1/contacts',
    ]);
  });

  it('a motor-driver channel at stop or backward, behind a switch, is control', () => {
    const driven = (command: string): Blueprint =>
      build(
        [battery, ['driver', 'motor-driver', { 'motor-a': command }], motor, ['switch', 'switch']],
        [
          ['battery.plus', 'switch.a'],
          ['switch.b', 'driver.plus'],
          ['driver.minus', 'battery.minus'],
          ['driver.a-plus', 'motor.plus'],
          ['driver.a-minus', 'motor.minus'],
        ],
      );
    expect(faults(driven('stop'))).toEqual([]);
    expect(explained(driven('stop'))).toEqual(['motor power: controls driver/channel-a']);
    expect(faults(driven('stop'), opened('switch'))).toEqual([]);
    expect(explained(driven('stop'), opened('switch'))).toEqual([
      'battery loop: controls switch/contacts',
      'driver power: controls switch/contacts',
      'motor power: controls driver/channel-a, switch/contacts',
    ]);
    // Backward, the wiring meets the motor's need. sim-core sees `reversed` on the voltages and explains it by
    // the same rule: here, setting channel A forward meets it.
    const backward = driven('backward');
    expect(faults(backward)).toEqual([]);
    expect(explained(backward)).toEqual([]);
    const controls = controlsOf(backward, catalogue);
    const forwardWithPower = (state: ControlState) => (state.channels?.['driver/channel-a'] ?? 0) > 0 && state.switches?.['switch/contacts'] === true;
    expect(explainByControls(controls, {}, forwardWithPower)).toEqual(['driver/channel-a']);
  });

  it('a switch across a motor in series with an LED: closing it stops the motor, which is control', () => {
    const bypass = build(
      [battery, ['led', 'led'], motor, ['switch', 'switch']],
      [['battery.plus', 'led.plus'], ['led.minus', 'motor.plus'], ['motor.minus', 'battery.minus'], ['motor.plus', 'switch.a'], ['switch.b', 'motor.minus']],
    );
    expect(faults(bypass)).toEqual([]);
    expect(explained(bypass)).toEqual(['motor power: controls switch/contacts']);
    expect(explained(bypass, opened('switch'))).toEqual([]);
  });

  it('treats the bumper switch as a control at its current state', () => {
    const touching = fixture('bumper-robot');
    expect(faults(touching, opened('bumper'))).toEqual([]);
    expect(explained(touching, opened('bumper'))).toEqual([
      'battery loop: controls bumper/contacts',
      'buzzer power: controls bumper/contacts',
      'driver power: controls bumper/contacts',
      'motor-left power: controls bumper/contacts',
      'motor-right power: controls bumper/contacts',
      'servo power: controls bumper/contacts',
    ]);
  });

  it('lists the controls and their resting settings', () => {
    const robot = fixture('bumper-robot');
    expect(controlsOf(robot, catalogue)).toEqual([
      { id: 'bumper/contacts', part: 'bumper', primitive: 'contacts', kind: 'switch', rest: true },
      { id: 'driver/channel-a', part: 'driver', primitive: 'channel-a', kind: 'channel', rest: 1 },
      { id: 'driver/channel-b', part: 'driver', primitive: 'channel-b', kind: 'channel', rest: 1 },
    ]);
  });
});

describe('short circuits: loops of sources whose voltages do not cancel', () => {
  it('shows only the short circuit on the short-circuit fixture: a closed path is still a loop', () => {
    expect(wiredNeeds(fixture('short-circuit'), catalogue)).toEqual([
      { partId: 'battery', need: 'no-short', kind: 'isolation', unmet: 'shorted' },
      { partId: 'battery', need: 'loop', kind: 'loop' },
    ]);
  });

  it('lets equal packs side by side share the load, and finds unequal packs shorting each other', () => {
    const sideBySide = (other: string): Blueprint =>
      build(
        [['big', 'battery-pack-2-cell'], ['led', 'led'], ['other', other]],
        [['big.plus', 'other.plus'], ['big.minus', 'other.minus'], ['big.plus', 'led.plus'], ['led.minus', 'big.minus']],
      );
    expect(faults(sideBySide('battery-pack-2-cell'))).toEqual([]);
    expect(faults(sideBySide('battery-pack-1-cell'))).toEqual(['big: short-circuit', 'other: short-circuit']);
    expect(explained(sideBySide('battery-pack-1-cell'))).toEqual([]);
  });

  it('finds packs joined end to end in a loop shorted, and packs in series powering an LED not', () => {
    const ring = build(
      [['one', 'battery-pack-2-cell'], ['two', 'battery-pack-1-cell']],
      [['one.plus', 'two.minus'], ['two.plus', 'one.minus']],
    );
    expect(faults(ring)).toEqual(['one: short-circuit', 'two: short-circuit']);
    const series = build(
      [['big', 'battery-pack-2-cell'], ['small', 'battery-pack-1-cell'], ['led', 'led']],
      [['big.plus', 'small.minus'], ['small.plus', 'led.plus'], ['led.minus', 'big.minus']],
    );
    expect(faults(series)).toEqual([]);
  });

  it('starves an LED on a pack with a bare wire across it, without a fault of its own', () => {
    const bare = build([battery, ['led', 'led']], [['battery.plus', 'led.plus'], ['led.minus', 'battery.minus'], ['battery.plus', 'battery.minus']]);
    expect(faults(bare)).toEqual(['battery: short-circuit']);
    expect(explained(bare)).toEqual(['led power: short battery']);
  });

  it('never puts a series switch outside the loop while another switch shorts the pack', () => {
    const shorted = build(
      [battery, motor, ['q', 'switch'], ['s', 'switch']],
      [['battery.plus', 's.a'], ['s.b', 'motor.plus'], ['motor.minus', 'battery.minus'], ['battery.plus', 'q.a'], ['q.b', 'battery.minus']],
    );
    expect(faults(shorted)).toEqual(['battery: short-circuit', 'q: across-the-pack']);
    expect(explained(shorted)).toEqual(['motor power: short battery, q', 's in-loop: short battery, q']);
    expect(faults(shorted, opened('q'))).toEqual([]);
    expect(explained(shorted, opened('q'))).toEqual([]);
  });

  it('gives a switch wired across the pack one fault, and the pack one', () => {
    expect(faults(fixture('switch-across-pack'))).toEqual(['battery: short-circuit', 'switch: across-the-pack']);
    expect(faults(fixture('switch-across-pack'), opened('switch'))).toEqual([]);
  });
});

describe('the other wiring mistakes', () => {
  it('shows outside-loop for a switch wired off to one side, or bypassed by a wire', () => {
    const sideways = build(
      [battery, ['led', 'led'], ['switch', 'switch']],
      [['battery.plus', 'led.plus'], ['led.minus', 'battery.minus'], ['battery.plus', 'switch.a']],
    );
    expect(faults(sideways)).toEqual(['switch: outside-loop']);
    expect(faults(sideways, opened('switch'))).toEqual(['switch: outside-loop']);
    const bypassed = build(
      [battery, ['led', 'led'], ['switch', 'switch']],
      [['battery.plus', 'switch.a'], ['switch.b', 'led.plus'], ['led.minus', 'battery.minus'], ['switch.a', 'switch.b']],
    );
    expect(faults(bypassed)).toEqual(['switch: outside-loop']);
  });

  it('shows the motor driver’s no-power fault, not the motors’, when the driver has no power', () => {
    const unpowered = without(fixture('bumper-robot'), 'bumper.b', 'driver.plus');
    expect(faults(unpowered)).toEqual(['driver: no-power']);
    expect(explained(unpowered)).toEqual(['motor-left power: feeder driver', 'motor-right power: feeder driver']);
  });

  it('shows the microcontroller’s fault for a motor on its 3V pin when it has no power', () => {
    const unpowered = without(fixture('motor-off-pin'), 'battery.plus', 'brain.plus');
    expect(faults(unpowered)).toEqual(['brain: no-power']);
    expect(explained(unpowered)).toEqual(['motor power: feeder brain']);
  });

  it('shows no circuit for a motor with a wire missing, whatever the switch does', () => {
    const missing = without(fixture('rolling-start'), 'battery.minus', 'motor-left.minus');
    expect(faults(missing)).toEqual(['motor-left: no-circuit']);
    expect(faults(missing, opened('switch'))).toEqual(['motor-left: no-circuit']);
  });

  it('keeps every valid fixture’s faults at rest', () => {
    const atRest = Object.fromEntries(validBlueprints.map((entry) => [entry.name, faults(fixture(entry.name))]));
    expect(atRest).toEqual({
      'rolling-start': [],
      'led-circuit': [],
      'reversed-motor': [],
      'short-circuit': ['battery: short-circuit'],
      'switch-across-pack': ['battery: short-circuit', 'switch: across-the-pack'],
      'bumper-robot': [],
      'motor-off-pin': [],
    });
    for (const entry of validBlueprints) expect(explained(fixture(entry.name)), entry.name).toEqual([]);
  });

  it('judges the same whatever the wire order', () => {
    const robot = fixture('bumper-robot');
    const reversed = { ...robot, wires: [...robot.wires].reverse() };
    expect(wiredNeeds(reversed, catalogue, opened('bumper'))).toEqual(wiredNeeds(robot, catalogue, opened('bumper')));
  });
});

describe('the order the controls are tried in', () => {
  const switches = (count: number): Control[] =>
    Array.from({ length: count }, (_, index) => ({ id: `s${index}/contacts`, part: `s${index}`, primitive: 'contacts', kind: 'switch', rest: false }));
  const closed =
    (...ids: readonly string[]) =>
    (state: ControlState): boolean =>
      ids.every((id) => state.switches?.[`${id}/contacts`] === true);

  it('tries every combination up to the cap, fewest changes first', () => {
    expect(CONTROL_COMBINATION_CAP).toBe(1024);
    expect(explainByControls(switches(10), {}, closed('s4'))).toEqual(['s4/contacts']);
    expect(explainByControls(switches(10), {}, closed('s0', 's1'))).toEqual(['s0/contacts', 's1/contacts']);
    expect(explainByControls(switches(10), { switches: { 's0/contacts': true } }, closed('s0', 's1'))).toEqual(['s1/contacts']);
  });

  it('tries single changes only above the cap', () => {
    expect(explainByControls(switches(11), {}, closed('s4'))).toEqual(['s4/contacts']);
    expect(explainByControls(switches(11), {}, closed('s0', 's1'))).toBeUndefined();
  });
});
