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
    const seen: { readonly tick: number; readonly faults: string[]; readonly charge: number }[] = [];
    for (let tick = 0; tick < ticks; tick += 1) {
      const result = stepElectrical(model, now, { actuators });
      seen.push({ tick, faults: faults(result.solution), charge: now.charge[0] ?? 0 });
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

  it('keeps an explanation it found until a control changes (review N14)', () => {
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
    expect(first.state.explained.needs).toEqual([{ partId: 'motor', need: 'power', unmet: 'reversed', explainedBy: { by: 'controls', controls: ['driver/channel-a'] } }]);
    // At the same controls the kept answer stands, without searching again: a kept "nothing explains it" stays a fault.
    const kept: ElectricalState = { ...first.state, explained: { ...first.state.explained, needs: [{ partId: 'motor', need: 'power', unmet: 'reversed' }] } };
    expect(faults(solveElectrical(model, kept).solution)).toEqual(['motor: reversed']);
    // A control changes, so the search runs again.
    const flipped = solveElectrical(model, kept, { controls: opened('switch') });
    expect(flipped.state.explained.controls).not.toBe(kept.explained.controls);
    const back = solveElectrical(model, flipped.state, { controls: { switches: { 'switch/contacts': true } } });
    expect(faults(back.solution)).toEqual([]);
    expect(explained(back.solution)).toEqual(['motor power reversed: controls driver/channel-a']);
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
