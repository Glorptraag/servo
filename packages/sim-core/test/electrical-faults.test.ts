import { describe, expect, it } from 'vitest';
import { makeCatalogue, validateArenaPreset, validatePartRecord, wiredNeeds } from '@servo/schema';
import type { Blueprint, ControlState, Explanation, PartRecord, PortRef, ValidationResult } from '@servo/schema';
import { exampleArenas, exampleParts, validBlueprints } from '@servo/schema/fixtures';
import { buildGraph } from '../src/graph/index.ts';
import { electricalModel, initialElectricalState, solveElectrical, stepElectrical, steadyRpm } from '../src/electrical/index.ts';
import type { ActuatorState, ElectricalModel, ElectricalSolution, ElectricalState } from '../src/electrical/index.ts';

const unwrap = <T>(result: ValidationResult<T>): T => {
  if (!result.ok) throw new Error(`Expected valid data:\n${JSON.stringify(result.issues, null, 2)}`);
  return result.value;
};

const parts: readonly PartRecord[] = exampleParts.map((part) => unwrap(validatePartRecord(part)));
const catalogue = makeCatalogue({ parts, arenas: exampleArenas.map((arena) => unwrap(validateArenaPreset(arena))) });
const fixture = (name: string): Blueprint => {
  const found = validBlueprints.find((entry) => entry.name === name)?.data;
  if (!found) throw new Error(`No schema fixture ${name}`);
  return found as Blueprint;
};

type Placed = readonly [id: string, type: string, settings?: Readonly<Record<string, string>>];

/** A small build on the workbench: parts as [id, type, settings], power wires as ['part.port', 'part.port']. */
const workbench = (placed: readonly Placed[], wires: readonly (readonly [string, string])[]): Blueprint => {
  const base = fixture('led-circuit');
  const ref = (end: string): PortRef => {
    const [part = '', port = ''] = end.split('.');
    return { part, port };
  };
  return {
    ...base,
    parts: placed.map(([id, type, settings = {}], index) => ({ id, part: type, position: { x: index * 80, y: 0 }, rotation: 0, settings })),
    wires: wires.map(([from, to], index) => ({ id: `w${index + 1}`, from: ref(from), to: ref(to) })),
    meta: { ...base.meta, level: 2, highWater: { parts: 0, wires: wires.length } },
  };
};

const opened = (...ids: readonly string[]): ControlState => ({ switches: Object.fromEntries(ids.map((id) => [`${id}/contacts`, false])) });

const solve = (blueprint: Blueprint, controls: ControlState = {}): ElectricalSolution => {
  const model = electricalModel(buildGraph(blueprint, catalogue));
  return solveElectrical(model, initialElectricalState(model), { controls }).solution;
};

/** The faults: `part: failure mode`, sorted. */
const faults = (solution: ElectricalSolution): string[] => [...solution.faults].flatMap(([part, modes]) => modes.map((mode) => `${part}: ${mode}`)).sort();

const describeExplanation = (explanation: Explanation): string => {
  if (explanation.by === 'controls') return `controls ${explanation.controls.join(', ')}`;
  if (explanation.by === 'short') return `short ${explanation.parts.join(', ')}`;
  return `feeder ${explanation.part}`;
};

/** The unmet needs that are not faults: `part need way: why`, sorted. */
const explained = (solution: ElectricalSolution): string[] =>
  solution.verdicts.flatMap((verdict) => (verdict.explainedBy ? [`${verdict.partId} ${verdict.need} ${verdict.unmet}: ${describeExplanation(verdict.explainedBy)}`] : [])).sort();

const battery: Placed = ['battery', 'battery-pack-2-cell'];
const motor: Placed = ['motor', 'dc-motor'];

describe('legal-but-wrong builds show exactly the faults the schema’s rule gives', () => {
  it('the reversed-motor fixture: the right motor reversed, which no control fixes; opened, the switch explains the rest', () => {
    const atRest = solve(fixture('reversed-motor'));
    expect(faults(atRest)).toEqual(['motor-right: reversed']);
    expect(explained(atRest)).toEqual([]);
    expect(atRest.parts.get('motor-right')?.volts).toBeCloseTo(-(atRest.parts.get('motor-left')?.volts ?? 0), 12);
    const open = solve(fixture('reversed-motor'), opened('switch'));
    expect(faults(open)).toEqual([]);
    expect(explained(open)).toEqual([
      'battery loop open: controls switch/contacts',
      'motor-left power open: controls switch/contacts',
      'motor-right power open: controls switch/contacts',
    ]);
  });

  it('a switch across the pack: closed, the pack’s short and the switch’s, one each; open, nothing is wrong', () => {
    const closed = solve(fixture('switch-across-pack'));
    expect(faults(closed)).toEqual(['battery: short-circuit', 'switch: across-the-pack']);
    expect(closed.shorts).toEqual([
      { partId: 'battery', need: 'no-short' },
      { partId: 'switch', need: 'no-short' },
    ]);
    const open = solve(fixture('switch-across-pack'), opened('switch'));
    expect(faults(open)).toEqual([]);
    expect(open.shorts).toEqual([]);
    expect(open.sources[0]?.milliamps).toBe(0);
  });

  it('a switch across the pack with a motor beside it: closed, the short starves the motor; open, the motor runs', () => {
    const across = workbench(
      [battery, motor, ['switch', 'switch']],
      [
        ['battery.plus', 'switch.a'],
        ['switch.b', 'battery.minus'],
        ['battery.plus', 'motor.plus'],
        ['motor.minus', 'battery.minus'],
      ],
    );
    const closed = solve(across);
    expect(faults(closed)).toEqual(['battery: short-circuit', 'switch: across-the-pack']);
    expect(explained(closed)).toEqual(['motor power open: short battery, switch']);
    expect(closed.parts.get('motor')?.milliamps).toBe(0);
    const open = solve(across, opened('switch'));
    expect(faults(open)).toEqual([]);
    expect(explained(open)).toEqual([]);
    expect(open.parts.get('motor')?.volts).toBeGreaterThan(2.2);
  });

  const sideBySide = (other: string, load: Placed): Blueprint =>
    workbench(
      [['big', 'battery-pack-2-cell'], load, ['other', other]],
      [
        ['big.plus', 'other.plus'],
        ['big.minus', 'other.minus'],
        ['big.plus', `${load[0]}.plus`],
        [`${load[0]}.minus`, 'big.minus'],
      ],
    );

  it('equal packs side by side share the load, with nothing flowing between them', () => {
    const shared = solve(sideBySide('battery-pack-2-cell', ['led', 'led']));
    expect(faults(shared)).toEqual([]);
    expect(shared.shorts).toEqual([]);
    const [big, other] = shared.sources;
    expect(big?.milliamps).toBeCloseTo(other?.milliamps ?? 0, 12);
    // To 1e-5 mA: the solver's curve for a lit LED runs 1.8 nA above the LED's own (its leak).
    expect((big?.milliamps ?? 0) + (other?.milliamps ?? 0)).toBeCloseTo(shared.parts.get('led')?.milliamps ?? 0, 5);
  });

  it('a 2-cell pack beside a 1-cell pack: both shorted, their leftover volts driving (3 − 1.5) ÷ (0.4 + 0.3) round them', () => {
    const fighting = solve(sideBySide('battery-pack-1-cell', ['led', 'led']));
    expect(faults(fighting)).toEqual(['big: short-circuit', 'other: short-circuit']);
    // The LED still sees about 2.14 V, inside its range: no fault of its own.
    expect(fighting.parts.get('led')?.volts).toBeGreaterThan(2);
    expect(fighting.sources[0]?.milliamps).toBeCloseTo((1.5 / 0.7) * 1000, -1);
    expect(fighting.sources[1]?.milliamps).toBeCloseTo((-1.5 / 0.7) * 1000, -1);
  });

  it('a motor on a 2-cell pack beside a 1-cell pack reads low, and the short explains it (review N10)', () => {
    const starved = solve(sideBySide('battery-pack-1-cell', motor));
    expect(starved.parts.get('motor')?.volts).toBeLessThan(2.2);
    expect(faults(starved)).toEqual(['big: short-circuit', 'other: short-circuit']);
    expect(explained(starved)).toEqual(['motor power low: short big, other']);
  });

  it('packs joined end to end in a ring short each other', () => {
    const ring = solve(
      workbench(
        [
          ['one', 'battery-pack-2-cell'],
          ['two', 'battery-pack-1-cell'],
        ],
        [
          ['one.plus', 'two.minus'],
          ['two.plus', 'one.minus'],
        ],
      ),
    );
    expect(faults(ring)).toEqual(['one: short-circuit', 'two: short-circuit']);
    expect(ring.sources[0]?.milliamps).toBeCloseTo((4.5 / 0.7) * 1000, 9);
  });

  const driven = (command: string, pack = 'battery-pack-2-cell'): Blueprint =>
    workbench(
      [['battery', pack], ['driver', 'motor-driver', { 'motor-a': command }], motor],
      [
        ['battery.plus', 'driver.plus'],
        ['driver.minus', 'battery.minus'],
        ['driver.a-plus', 'motor.plus'],
        ['driver.a-minus', 'motor.minus'],
      ],
    );

  it('a motor behind a motor-driver channel at stop: no circuit, which the channel’s control explains', () => {
    const stopped = solve(driven('stop'));
    expect(faults(stopped)).toEqual([]);
    expect(explained(stopped)).toEqual(['motor power open: controls driver/channel-a']);
    expect(stopped.parts.get('motor')).toMatchObject({ volts: 0, milliamps: 0 });
  });

  it('a motor behind a channel at backward: reversed, which setting the channel forward fixes', () => {
    const backward = solve(driven('backward'));
    expect(backward.parts.get('motor')?.volts).toBeLessThan(-2.2);
    expect(faults(backward)).toEqual([]);
    expect(explained(backward)).toEqual(['motor power reversed: controls driver/channel-a']);
    expect(faults(solve(driven('forward')))).toEqual([]);
  });

  it('a motor driver on a 1-cell pack: the driver’s own low voltage, and its motor explained by it', () => {
    const weak = solve(driven('forward', 'battery-pack-1-cell'));
    expect(weak.parts.get('driver')?.volts).toBeLessThan(2.5);
    expect(weak.sources[1]).toMatchObject({ giving: false, milliamps: 0 });
    expect(faults(weak)).toEqual(['driver: low-voltage']);
    expect(explained(weak)).toEqual(['motor power low: feeder driver']);
  });

  it('a motor driver with no power in: the driver’s no-power fault, and its motor explained by it', () => {
    const unpowered = workbench(
      [battery, ['driver', 'motor-driver'], motor],
      [
        ['battery.plus', 'driver.plus'],
        ['driver.a-plus', 'motor.plus'],
        ['driver.a-minus', 'motor.minus'],
      ],
    );
    expect(faults(solve(unpowered))).toEqual(['battery: no-loop', 'driver: no-power']);
    expect(explained(solve(unpowered))).toEqual(['motor power open: feeder driver']);
  });

  it('the motor-off-pin fixture: the 2-cell pack sags below the microcontroller’s 3 V, and the motor on its 3V pin is put down to it', () => {
    const pin = solve(fixture('motor-off-pin'));
    expect(pin.parts.get('brain')?.volts).toBeLessThan(3);
    expect(faults(pin)).toEqual(['brain: low-voltage', 'servo: low-voltage']);
    expect(explained(pin)).toEqual(['motor power low: feeder brain']);
  });

  it('the bumper-robot fixture: its 2-cell pack is too little for the buzzer (3 V) and the servo motor (4.8 V); pressed, the bumper explains everything', () => {
    const robot = solve(fixture('bumper-robot'));
    expect(faults(robot)).toEqual(['buzzer: low-voltage', 'servo: low-voltage']);
    expect(robot.parts.get('motor-left')?.volts).toBeGreaterThan(2.2);
    const pressed = solve(fixture('bumper-robot'), opened('bumper'));
    expect(faults(pressed)).toEqual([]);
    expect(explained(pressed)).toEqual([
      'battery loop open: controls bumper/contacts',
      'buzzer power open: controls bumper/contacts',
      'driver power open: controls bumper/contacts',
      'motor-left power open: controls bumper/contacts',
      'motor-right power open: controls bumper/contacts',
      'servo power open: controls bumper/contacts',
    ]);
  });

  it('keeps every wiring verdict the schema gives, at every control state of every fixture', () => {
    for (const entry of validBlueprints) {
      const blueprint = entry.data as Blueprint;
      const graph = buildGraph(blueprint, catalogue);
      const model = electricalModel(graph);
      for (let key = 0; key < 2 ** graph.controls.length; key += 1) {
        const switches: Record<string, boolean> = {};
        const channels: Record<string, number> = {};
        graph.controls.forEach((control, index) => {
          if (control.kind === 'switch') switches[control.id] = (key & (1 << index)) !== 0;
          else channels[control.id] = (key & (1 << index)) !== 0 ? 1 : 0;
        });
        const state = { switches, channels };
        const { solution } = solveElectrical(model, initialElectricalState(model), { controls: state });
        for (const verdict of wiredNeeds(blueprint, catalogue, state)) {
          const judged = solution.verdicts.find((each) => each.partId === verdict.partId && each.need === verdict.need);
          if (verdict.unmet !== undefined) expect(judged, `${entry.name} ${key}`).toEqual(verdict);
          else expect(judged?.unmet === undefined || ['low', 'high', 'reversed'].includes(judged.unmet), `${entry.name} ${key}`).toBe(true);
        }
      }
    }
  });
});

describe('faults over a Run', () => {
  /** Steps a build with each DC motor's speed fed back as it settles with no load. */
  const run = (blueprint: Blueprint, state: (model: ElectricalModel) => ElectricalState, ticks: number) => {
    const graph = buildGraph(blueprint, catalogue);
    const model = electricalModel(graph);
    let now = state(model);
    let actuators: ActuatorState[] = graph.uses.map(() => ({}));
    const seen: { readonly tick: number; readonly faults: string[]; readonly explained: string[]; readonly charge: number }[] = [];
    for (let tick = 0; tick < ticks; tick += 1) {
      const result = stepElectrical(model, now, { actuators });
      seen.push({ tick, faults: faults(result.solution), explained: explained(result.solution), charge: now.charge[0] ?? 0 });
      actuators = graph.uses.map((use, index): ActuatorState => (use.spec.kind === 'actuator' && use.spec.mode === 'speed' ? { rpm: steadyRpm(use.spec, result.solution.uses[index]?.volts ?? 0) } : {}));
      now = result.state;
    }
    return seen;
  };

  it('shows a motor’s low voltage once its draining pack falls below the motor’s 2.2 V, and not before', () => {
    const motorOn = workbench(
      [battery, motor],
      [
        ['battery.plus', 'motor.plus'],
        ['motor.minus', 'battery.minus'],
      ],
    );
    // Settled at no load the motor sees 2 + charge − 0.12 A × 0.4 Ω, which is 2.2 V at a charge of 0.248.
    const seen = run(motorOn, (model) => ({ ...initialElectricalState(model), charge: [0.255] }), 3000);
    // At the start the motor is still, draws its stall current and sags this weak pack below 2.2 V: low, for
    // as long as it takes to spin up.
    expect(seen[0]?.faults).toEqual(['motor: low-voltage']);
    const spun = seen.findIndex((entry) => entry.faults.length === 0);
    expect(spun).toBeGreaterThan(0);
    expect(spun).toBeLessThan(10);
    const first = seen.findIndex((entry, index) => index > spun && entry.faults.length > 0);
    expect(first).toBeGreaterThan(30);
    expect(seen[first]?.faults).toEqual(['motor: low-voltage']);
    expect(seen[first]?.charge).toBeCloseTo(0.248, 3);
    expect(seen.slice(spun, first).every((entry) => entry.faults.length === 0)).toBe(true);
    expect(seen.slice(first).every((entry) => entry.faults.length === 1)).toBe(true);
  });

  it('keeps an answer under the controls and the charge bands, checks a kept explanation every tick, and searches again when it fails (review N14)', () => {
    const blueprint = workbench(
      [battery, ['switch', 'switch'], ['driver', 'motor-driver', { 'motor-a': 'backward' }], motor],
      [
        ['battery.plus', 'switch.a'],
        ['switch.b', 'driver.plus'],
        ['driver.minus', 'battery.minus'],
        ['driver.a-plus', 'motor.plus'],
        ['driver.a-minus', 'motor.minus'],
      ],
    );
    const model = electricalModel(buildGraph(blueprint, catalogue));
    const first = solveElectrical(model, initialElectricalState(model));
    expect(explained(first.solution)).toEqual(['motor power reversed: controls driver/channel-a']);
    const [entry] = first.state.explained.needs;
    expect(entry).toMatchObject({ partId: 'motor', need: 'power', unmet: 'reversed', explainedBy: { by: 'controls', controls: ['driver/channel-a'] } });
    expect(entry?.alternative?.channels).toEqual({ 'driver/channel-a': 1, 'driver/channel-b': 1 });
    expect(first.state.explained.key).toBe('-1,1,closed#20');
    // Under the same key a kept "nothing explains it" stands without a search: it stays a fault.
    const kept: ElectricalState = { ...first.state, explained: { ...first.state.explained, needs: [{ partId: 'motor', need: 'power', unmet: 'reversed' }] } };
    expect(faults(solveElectrical(model, kept).solution)).toEqual(['motor: reversed']);
    // A kept explanation is checked: opening the switch does not meet the motor's need, so it is searched again.
    const stale: ElectricalState = {
      ...first.state,
      explained: { ...first.state.explained, needs: [{ partId: 'motor', need: 'power', unmet: 'reversed', explainedBy: { by: 'controls', controls: ['switch/contacts'] }, alternative: opened('switch') }] },
    };
    const checked = solveElectrical(model, stale);
    expect(explained(checked.solution)).toEqual(['motor power reversed: controls driver/channel-a']);
    // Another key, a control or a charge band, starts afresh.
    expect(solveElectrical(model, kept, { controls: opened('switch') }).state.explained.key).toBe('-1,1,open#20');
    const drained = solveElectrical(model, { ...kept, charge: [0.9] });
    expect(drained.state.explained.key).toBe('-1,1,closed#18');
    expect(faults(drained.solution)).toEqual([]);
  });

  it('shows a motor that the switch explained as a fault of its own once the pack is too weak for any setting', () => {
    // Four DC motors on the pack, and a fifth behind a switch (the reviewer's build, with the schema's records).
    const motors = ['m1', 'm2', 'm3', 'm4'];
    const blueprint = workbench(
      [battery, ...motors.map((id): Placed => [id, 'dc-motor']), ['m5', 'dc-motor'], ['switch', 'switch']],
      [
        ...motors.flatMap((id): [string, string][] => [
          ['battery.plus', `${id}.plus`],
          [`${id}.minus`, 'battery.minus'],
        ]),
        ['battery.plus', 'switch.a'],
        ['switch.b', 'm5.plus'],
        ['m5.minus', 'battery.minus'],
      ],
    );
    const seen = run(blueprint, (model) => initialElectricalState(model), 4600);
    const explainedAt = (entry: (typeof seen)[number]): boolean => entry.explained.includes('m1 power low: controls switch/contacts');
    // At the start all five stall and sag the pack below 2.2 V: m1–m4 would run with m5's switch open.
    expect(explainedAt(seen[0] as (typeof seen)[number])).toBe(true);
    expect(seen[0]?.faults).toEqual(['m5: low-voltage']);
    // Settled at no load the motors see 2 + charge − 0.6 A × 0.4 Ω: low below a charge of 0.44. With m5's switch
    // open m1 would see 2 + charge − 0.2036 V, enough down to a charge of 0.4036; below that nothing helps.
    const low = seen.findIndex((entry, index) => index > 30 && explainedAt(entry));
    expect(seen[low]?.charge).toBeCloseTo(0.44, 3);
    const fault = seen.findIndex((entry) => entry.faults.includes('m1: low-voltage'));
    expect(fault).toBeGreaterThan(low);
    // Found by checking the kept answer each tick, inside the 0.40–0.45 charge band, not at its edge.
    expect(seen[fault]?.charge).toBeGreaterThan(0.4);
    expect(seen[fault]?.charge).toBeCloseTo(0.4036, 3);
    expect(seen[fault]?.faults).toEqual(['m1: low-voltage', 'm2: low-voltage', 'm3: low-voltage', 'm4: low-voltage', 'm5: low-voltage']);
    expect(seen.slice(low, fault).every((entry) => entry.faults.length === 1)).toBe(true);
  });

  it('starts every Run from the same state: the same steps give the same answers', () => {
    const blueprint = fixture('bumper-robot');
    const steps = (): string[] => {
      const model = electricalModel(buildGraph(blueprint, catalogue));
      let state = initialElectricalState(model);
      const out: string[] = [];
      for (let tick = 0; tick < 120; tick += 1) {
        const touching = tick >= 40 && tick < 70;
        const result = stepElectrical(model, state, { controls: { switches: { 'bumper/contacts': !touching } } });
        out.push(JSON.stringify([result.solution.netVolts, result.solution.sources, [...result.solution.faults], result.state]));
        state = result.state;
      }
      return out;
    };
    expect(steps()).toEqual(steps());
  });
});

describe('a motor driver browning out (review R-1.2, finding 1)', () => {
  // The Level 2 kit robot on the workbench, with the schema's records: a 2-cell pack, a switch, a motor driver
  // with a DC motor on each channel, and an LED.
  const robot = workbench(
    [battery, ['switch', 'switch'], ['driver', 'motor-driver'], ['left', 'dc-motor'], ['right', 'dc-motor'], ['led', 'led']],
    [
      ['battery.plus', 'switch.a'],
      ['switch.b', 'driver.plus'],
      ['driver.minus', 'battery.minus'],
      ['driver.a-plus', 'left.plus'],
      ['driver.a-minus', 'left.minus'],
      ['driver.b-plus', 'right.plus'],
      ['driver.b-minus', 'right.minus'],
      ['switch.b', 'led.plus'],
      ['led.minus', 'battery.minus'],
    ],
  );

  /**
   * Drives the robot tick by tick. The motors have some inertia: each tick they cover 30% of the way to the speed
   * their volts give with no load, or run down towards still while `held`.
   */
  const driver = () => {
    const graph = buildGraph(robot, catalogue);
    const model = electricalModel(graph);
    let state = initialElectricalState(model);
    let rpm = graph.uses.map(() => 0);
    return (switchClosed: boolean, held = false) => {
      const result = stepElectrical(model, state, { controls: { switches: { 'switch/contacts': switchClosed } }, actuators: rpm.map((each) => ({ rpm: each })) });
      state = result.state;
      rpm = graph.uses.map((use, index) => {
        if (use.spec.kind !== 'actuator' || use.spec.mode !== 'speed') return 0;
        const target = held ? 0 : steadyRpm(use.spec, result.solution.uses[index]?.volts ?? 0);
        return (rpm[index] ?? 0) + (target - (rpm[index] ?? 0)) * 0.3;
      });
      const duty = result.solution.sources.find((_, index) => graph.sources[index]?.part === 'driver')?.duty ?? 1;
      const left = rpm[graph.uses.findIndex((use) => use.part === 'left')] ?? 0;
      return { solution: result.solution, faults: faults(result.solution), explained: explained(result.solution), duty, charge: state.charge[0] ?? 0, left };
    };
  };

  /** Drives with the switch closed until the pack is down to `charge`. Nothing is wrong on the way. */
  const driveTo = (step: ReturnType<typeof driver>, charge: number): void => {
    for (let last = step(true), tick = 0; last.charge > charge; last = step(true), tick += 1) {
      expect(last.faults, `tick ${tick}`).toEqual([]);
      expect(last.duty, `tick ${tick}`).toBe(1);
    }
  };

  it('restarts at 85% charge: browns out with the driver’s own fault, its motors put down to it, and comes back as they spin up', () => {
    const step = driver();
    driveTo(step, 0.85);
    // Switched off, the motors run down: no fault, the switch explains them.
    for (let tick = 0; tick < 60; tick += 1) expect(step(false).faults).toEqual([]);
    // Switched on, both stalled motors would sag the supply below the driver's 2.5 V: it browns out.
    const restart = step(true);
    expect(restart.duty).toBeGreaterThan(0);
    expect(restart.duty).toBeLessThan(1);
    expect(restart.solution.parts.get('driver')?.volts).toBeCloseTo(2.5, 5);
    expect(restart.faults).toEqual(['driver: low-voltage']);
    expect(restart.explained).toEqual(['left power low: feeder driver', 'right power low: feeder driver']);
    expect(restart.solution.parts.get('left')?.milliamps).toBeGreaterThan(0);
    // The motors still get the duty's share, so they spin up, the sag eases, and the driver is fully on again.
    let browned = 1;
    let last = restart;
    while (last.duty < 1 && browned < 100) {
      last = step(true);
      if (last.duty < 1) {
        browned += 1;
        expect(last.faults).toEqual(['driver: low-voltage']);
      }
    }
    expect(browned).toBeLessThan(30);
    expect(last.faults).toEqual([]);
    expect(last.explained).toEqual([]);
    expect(last.solution.parts.get('driver')?.volts).toBeGreaterThan(2.5);
    for (let tick = 0; tick < 60; tick += 1) last = step(true);
    expect(last.faults).toEqual([]);
    expect(last.left).toBeGreaterThan(50);
  });

  it('held against a wall, stays browned out with its own fault while held, and comes back once let go', () => {
    const step = driver();
    driveTo(step, 0.85);
    for (let tick = 0; tick < 60; tick += 1) {
      const held = step(true, true);
      if (tick < 5) continue;
      expect(held.duty).toBeLessThan(1);
      expect(held.faults).toEqual(['driver: low-voltage']);
    }
    let last = step(true);
    for (let tick = 0; tick < 60 && last.duty < 1; tick += 1) last = step(true);
    expect(last.duty).toBe(1);
    expect(last.faults).toEqual([]);
  });

  it('cannot run at all on a 1-cell pack: off, with its own fault, and its motors put down to it', () => {
    const weak = solve(
      workbench(
        [['battery', 'battery-pack-1-cell'], ['driver', 'motor-driver'], motor],
        [
          ['battery.plus', 'driver.plus'],
          ['driver.minus', 'battery.minus'],
          ['driver.a-plus', 'motor.plus'],
          ['driver.a-minus', 'motor.minus'],
        ],
      ),
    );
    expect(weak.sources[1]).toMatchObject({ duty: 0, giving: false, milliamps: 0 });
    expect(faults(weak)).toEqual(['driver: low-voltage']);
    expect(explained(weak)).toEqual(['motor power low: feeder driver']);
  });
});
