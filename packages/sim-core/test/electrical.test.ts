import { describe, expect, it, vi } from 'vitest';
import { TICK_RATE } from '@servo/schema';
import type { Blueprint, PartRecord, SourcePrimitive, SpeedActuator } from '@servo/schema';
import { validBlueprints } from '@servo/schema/fixtures';
import { buildGraph } from '../src/graph/index.ts';
import type { SimGraph } from '../src/graph/index.ts';
import { electricalModel, initialElectricalState, solveElectrical, stepElectrical, steadyRpm } from '../src/electrical/index.ts';
import type { ActuatorState, ElectricalModel, ElectricalSolution, ElectricalState } from '../src/electrical/index.ts';
import type { Model } from '../src/electrical/model.ts';
import { catalogue, fixture, parts, workbench } from './electrical-support.ts';

// Circuits settled and stepped over many ticks take seconds on a machine running many agents' tests; generous for that.
// The per-tick cost test is electrical.perf.ts, run by `pnpm perf`.
vi.setConfig({ testTimeout: 120_000 });

/** A blueprint with one part's type swapped, its wires and place kept. */
const swapped = (blueprint: Blueprint, id: string, type: string): Blueprint => ({
  ...blueprint,
  parts: blueprint.parts.map((part) => (part.id === id ? { ...part, part: type } : part)),
});

const record = (id: string): PartRecord => {
  const found = parts.find((part) => part.id === id);
  if (!found) throw new Error(`No example part ${id}`);
  return found;
};
const sourceOf = (id: string): SourcePrimitive => record(id).behaviour.find((primitive) => primitive.kind === 'source') as SourcePrimitive;
const DC_MOTOR = record('dc-motor').behaviour[0] as SpeedActuator;

interface Steady {
  readonly model: ElectricalModel;
  readonly graph: SimGraph;
  readonly solution: ElectricalSolution;
  readonly rpm: ReadonlyMap<string, number>;
}

/**
 * The circuit settled with no load on any motor: each DC motor's speed fed back from the volts across it
 * (`steadyRpm`, the record's "speed ∝ voltage") until nothing moves, at full charge, with no time passing.
 */
const steady = (blueprint: Blueprint): Steady => {
  const graph = buildGraph(blueprint, catalogue);
  const model = electricalModel(graph);
  const state = initialElectricalState(model);
  const motors = graph.uses.flatMap((use, index) => (use.spec.kind === 'actuator' && use.spec.mode === 'speed' ? [{ index, part: use.part, spec: use.spec }] : []));
  let actuators: ActuatorState[] = graph.uses.map(() => ({}));
  let solution = solveElectrical(model, state, { actuators }).solution;
  for (let round = 0; round < 60; round += 1) {
    const next: ActuatorState[] = graph.uses.map(() => ({}));
    for (const motor of motors) next[motor.index] = { rpm: steadyRpm(motor.spec, solution.uses[motor.index]?.volts ?? 0) };
    actuators = next;
    solution = solveElectrical(model, state, { actuators }).solution;
  }
  return { model, graph, solution, rpm: new Map(motors.map((motor) => [motor.part, actuators[motor.index]?.rpm ?? 0])) };
};

const motorOn = (pack: string): Blueprint =>
  workbench(
    [
      ['battery', pack],
      ['motor', 'dc-motor'],
    ],
    [
      ['battery.plus', 'motor.plus'],
      ['motor.minus', 'battery.minus'],
    ],
  );

describe('a DC motor on a 1-cell pack against a 2-cell pack (task 1.2 done-when)', () => {
  const twoCell = sourceOf('battery-pack-2-cell');
  const oneCell = sourceOf('battery-pack-1-cell');
  // From the records alone: with no load a motor draws noLoadMilliamps whatever its voltage, so each pack sags
  // by that current × its internalOhms, and speed ∝ voltage (noLoadRpm at ratedVolts).
  const sagged = (pack: SourcePrimitive, motors: number): number => pack.volts - ((motors * DC_MOTOR.noLoadMilliamps) / 1000) * pack.internalOhms;

  it('turns at the speed ratio its record gives: the ratio of the two packs’ volts after sag', () => {
    const fast = steady(motorOn('battery-pack-2-cell'));
    const slow = steady(motorOn('battery-pack-1-cell'));
    expect(fast.solution.uses[0]?.volts).toBeCloseTo(sagged(twoCell, 1), 12);
    expect(slow.solution.uses[0]?.volts).toBeCloseTo(sagged(oneCell, 1), 12);
    expect(fast.rpm.get('motor')).toBeCloseTo((DC_MOTOR.noLoadRpm * sagged(twoCell, 1)) / DC_MOTOR.ratedVolts, 9);
    const ratio = (slow.rpm.get('motor') ?? 0) / (fast.rpm.get('motor') ?? 1);
    expect(ratio).toBeCloseTo(sagged(oneCell, 1) / sagged(twoCell, 1), 12);
    expect(ratio).toBeCloseTo(1.464 / 2.952, 12);
    // Both draw the no-load current, whatever their voltage.
    expect(fast.solution.uses[0]?.milliamps).toBeCloseTo(DC_MOTOR.noLoadMilliamps, 9);
    expect(slow.solution.uses[0]?.milliamps).toBeCloseTo(DC_MOTOR.noLoadMilliamps, 9);
  });

  it('gives the same ratio for the Rolling Start robot with its pack swapped, both motors sharing the sag', () => {
    const robot = fixture('rolling-start');
    const fast = steady(robot);
    const slow = steady(swapped(robot, 'battery', 'battery-pack-1-cell'));
    for (const motor of ['motor-left', 'motor-right']) {
      expect(fast.solution.parts.get(motor)?.volts).toBeCloseTo(sagged(twoCell, 2), 12);
      expect(slow.solution.parts.get(motor)?.volts).toBeCloseTo(sagged(oneCell, 2), 12);
      expect((slow.rpm.get(motor) ?? 0) / (fast.rpm.get(motor) ?? 1)).toBeCloseTo(sagged(oneCell, 2) / sagged(twoCell, 2), 12);
    }
  });

  it('drains the 1-cell pack more for each revolution (D17)', () => {
    const perRevolution = (blueprint: Blueprint): number => {
      const { model, graph, rpm } = steady(blueprint);
      const actuators = graph.uses.map((use) => ({ rpm: rpm.get(use.part) ?? 0 }));
      const { state } = stepElectrical(model, initialElectricalState(model), { actuators });
      const capacity = sourceOf(graph.parts.get('battery')?.record.id ?? '').capacityMah;
      const used = (1 - (state.charge[0] ?? 1)) * capacity;
      const revolutions = (rpm.get('motor') ?? 0) / 60 / TICK_RATE;
      return used / revolutions;
    };
    const fast = perRevolution(motorOn('battery-pack-2-cell'));
    const slow = perRevolution(motorOn('battery-pack-1-cell'));
    // The same current for half the speed (both packs hold 40 mAh): twice the drain per revolution.
    expect(slow / fast).toBeCloseTo(sagged(twoCell, 1) / sagged(oneCell, 1), 9);
    expect(slow).toBeGreaterThan(fast * 2);
  });

  it('shows the 1-cell motor’s low-voltage fault, which no control can fix, and none on the 2-cell', () => {
    expect([...steady(motorOn('battery-pack-1-cell')).solution.faults]).toEqual([['motor', ['low-voltage']]]);
    expect([...steady(motorOn('battery-pack-2-cell')).solution.faults]).toEqual([]);
  });
});

describe('a shorted pack (task 1.2 done-when)', () => {
  /** Ticks until the pack's charge is gone, stepping with nothing else changing. */
  const drain = (blueprint: Blueprint): { readonly ticks: number; readonly first: ElectricalSolution } => {
    const graph = buildGraph(blueprint, catalogue);
    const model = electricalModel(graph);
    let state: ElectricalState = initialElectricalState(model);
    let first: ElectricalSolution | undefined;
    let ticks = 0;
    while ((state.charge[0] ?? 0) > 0 && ticks < 10000) {
      const result = stepElectrical(model, state);
      first ??= result.solution;
      state = result.state;
      ticks += 1;
    }
    if (!first) throw new Error('No tick');
    return { ticks, first };
  };

  /**
   * The drain time from the record. A short draws the pack's open-circuit volts ÷ internalOhms, so it starts
   * at volts ÷ internalOhms, which alone would empty capacityMah in capacityMah ÷ (volts ÷ internalOhms). The
   * open-circuit volts fall in a straight line to emptyVolts as the charge goes (the source primitive), so the
   * current falls with them: dq/dt = −(emptyVolts + (volts − emptyVolts)·q) ÷ (internalOhms × capacity), which
   * empties in (internalOhms × capacity ÷ (volts − emptyVolts)) × ln(volts ÷ emptyVolts).
   */
  const expected = (pack: SourcePrimitive) => {
    const coulombs = (pack.capacityMah / 1000) * 3600;
    return {
      amps: pack.volts / pack.internalOhms,
      firstOrder: coulombs / (pack.volts / pack.internalOhms),
      seconds: ((pack.internalOhms * coulombs) / (pack.volts - pack.emptyVolts)) * Math.log(pack.volts / pack.emptyVolts),
    };
  };

  it.each([
    ['the short-circuit fixture: a wire across the 1-cell pack', 'short-circuit', 'battery-pack-1-cell'],
    ['the switch-across-pack fixture: a closed switch across the 2-cell pack', 'switch-across-pack', 'battery-pack-2-cell'],
  ] as const)('%s draws volts ÷ internalOhms and drains in the time the record gives', (_, name, pack) => {
    const spec = sourceOf(pack);
    const { ticks, first } = drain(fixture(name));
    const want = expected(spec);
    expect(first.sources[0]?.milliamps).toBeCloseTo(want.amps * 1000, 9);
    expect(first.sources[0]?.volts).toBe(0);
    expect(first.sources[0]?.sagVolts).toBe(spec.volts);
    // Within one tick of the closed form; the first-order figure is a lower bound.
    expect(Math.abs(ticks / TICK_RATE - want.seconds)).toBeLessThanOrEqual(1 / TICK_RATE);
    expect(ticks / TICK_RATE).toBeGreaterThan(want.firstOrder);
    expect(want.seconds / want.firstOrder).toBeCloseTo((spec.volts / (spec.volts - spec.emptyVolts)) * Math.log(spec.volts / spec.emptyVolts), 12);
  });

  it('takes 35.0 s for the 1-cell pack and 23.4 s for the 2-cell (first-order 28.8 s and 19.2 s)', () => {
    expect(drain(fixture('short-circuit')).ticks).toBe(1051);
    expect(drain(fixture('switch-across-pack')).ticks).toBe(701);
    expect(expected(sourceOf('battery-pack-1-cell')).firstOrder).toBeCloseTo(28.8, 12);
    expect(expected(sourceOf('battery-pack-2-cell')).firstOrder).toBeCloseTo(19.2, 12);
  });
});

describe('the battery pack', () => {
  const ledOn = (charge: number) => {
    const graph = buildGraph(fixture('led-circuit'), catalogue);
    const model = electricalModel(graph);
    return stepElectrical(model, { ...initialElectricalState(model), charge: [charge] });
  };

  it('sags by its current × internalOhms, below open-circuit volts that fall with its charge', () => {
    for (const charge of [1, 0.5, 0.1]) {
      const { solution } = ledOn(charge);
      const pack = sourceOf('battery-pack-2-cell');
      const flow = solution.sources[0];
      expect(flow?.emfVolts).toBeCloseTo(pack.emptyVolts + (pack.volts - pack.emptyVolts) * charge, 12);
      expect(flow?.sagVolts).toBeCloseTo(((flow?.milliamps ?? 0) / 1000) * pack.internalOhms, 12);
      expect(flow?.volts).toBeCloseTo((flow?.emfVolts ?? 0) - (flow?.sagVolts ?? 0), 12);
    }
  });

  it('loses current × 1/30 s of its capacity each tick', () => {
    const { solution, state } = ledOn(1);
    const used = (solution.sources[0]?.milliamps ?? 0) / TICK_RATE / 3600;
    expect(1 - (state.charge[0] ?? 0)).toBeCloseTo(used / sourceOf('battery-pack-2-cell').capacityMah, 15);
  });

  it('gives nothing once drained: its LED goes dark, and its open terminals still read emptyVolts', () => {
    const { solution, state } = ledOn(0);
    expect(solution.sources[0]).toMatchObject({ milliamps: 0, giving: false, charge: 0 });
    expect(solution.uses[0]?.milliamps).toBe(0);
    expect(state.charge).toEqual([0]);
    const open = buildGraph(workbench([['battery', 'battery-pack-2-cell']], []), catalogue);
    const model = electricalModel(open);
    expect(solveElectrical(model, { ...initialElectricalState(model), charge: [0] }).solution.sources[0]?.volts).toBeCloseTo(2, 9);
  });

  it('keeps its charge on tick 0, when no time passes', () => {
    const graph = buildGraph(fixture('led-circuit'), catalogue);
    const model = electricalModel(graph);
    const { state } = solveElectrical(model, initialElectricalState(model));
    expect(state.charge).toEqual([1]);
  });
});

describe('the other parts as the circuit sees them', () => {
  it('lights an LED by its record: nothing below onVolts, ratedMilliamps at ratedVolts', () => {
    const { solution } = solveElectrical(...start(fixture('led-circuit')));
    const led = record('led').behaviour[0];
    if (led?.kind !== 'load') throw new Error('Expected a load');
    const volts = solution.uses[0]?.volts ?? 0;
    expect(solution.uses[0]?.milliamps).toBeCloseTo((led.ratedMilliamps * (volts - led.onVolts)) / (led.ratedVolts - led.onVolts), 12);
    // 2-cell pack and LED: i = 0.0125 S × (3 − 0.4 i − 1.8). To 1e-6 mA: the solver's curve for the LED runs
    // 1e-9 S × 1.8 V above the LED's own once it conducts (the leak along its dark stretch).
    expect(solution.uses[0]?.milliamps).toBeCloseTo(15 / 1.005, 6);
  });

  it('draws a stalled motor’s current as volts over its winding, the record’s stall current at its rated volts', () => {
    // At tick 0 nothing turns yet: both Rolling Start motors draw 3 V ÷ (0.4 Ω + 5 Ω ÷ 2) between them.
    const { solution } = solveElectrical(...start(fixture('rolling-start')));
    expect(solution.sources[0]?.milliamps).toBeCloseTo((3 / (0.4 + 2.5)) * 1000, 9);
    expect(solution.parts.get('motor-left')?.milliamps).toBeCloseTo((3 / (0.4 + 2.5) / 2) * 1000, 9);
  });

  it('passes a motor driver’s supply, less dropVolts, to each channel, and the output current back to the supply', () => {
    const { solution, graph } = solvedAt(fixture('bumper-robot'));
    const supply = solution.parts.get('driver')?.volts ?? 0;
    const motor = solution.parts.get('motor-left');
    // The output sits behind 0.01 Ω so it stays a source with limited current. (To 1e-9 V: the output's leak,
    // 1e-9 S, also draws a nanoamp through those 0.01 Ω.)
    expect(motor?.volts).toBeCloseTo(supply - 0.3 - ((motor?.milliamps ?? 0) / 1000) * 0.01, 9);
    const channels = graph.uses.filter((use) => use.part === 'driver').map((use) => graph.uses.indexOf(use));
    const into = channels.reduce((sum, index) => sum + (solution.uses[index]?.milliamps ?? 0), 0);
    // Both motors' current and each channel's 1 mA idle draw; to 1e-5 mA, the outputs' leaks.
    expect(into).toBeCloseTo((solution.parts.get('motor-left')?.milliamps ?? 0) + (solution.parts.get('motor-right')?.milliamps ?? 0) + 2, 5);
  });

  it('limits the microcontroller’s 3V pin to its maxMilliamps, so a motor on it barely turns', () => {
    const { solution } = solvedAt(fixture('motor-off-pin'));
    // To 1e-6 mA: the pin's leak, 1e-9 S across 0.45 V, takes half a nanoamp of the 90 mA.
    expect(solution.parts.get('motor')?.milliamps).toBeCloseTo(90, 6);
    expect(solution.parts.get('motor')?.volts).toBeCloseTo(0.09 * 5, 8);
  });

  it('reads an output with too little supply as giving nothing, never a negative emf (review R-1.2, finding 5)', () => {
    // A microcontroller wired the wrong way round: its 3V pin's regulator sees −3 V.
    const { solution, graph } = solvedAt(
      workbench(
        [
          ['battery', 'battery-pack-2-cell'],
          ['brain', 'microcontroller'],
          ['led', 'led'],
        ],
        [
          ['battery.plus', 'brain.minus'],
          ['brain.plus', 'battery.minus'],
          ['brain.pin-3v', 'led.plus'],
          ['led.minus', 'brain.minus'],
        ],
      ),
    );
    const pin = graph.sources.findIndex((source) => source.part === 'brain');
    expect(solution.sources[pin]).toMatchObject({ emfVolts: 0, giving: false, milliamps: 0, duty: 1 });
  });

  it('runs a motor backwards from a reversed supply, and turns the shaft the other way with its direction set backward', () => {
    expect(steadyRpm(DC_MOTOR, -3)).toBeCloseTo(-100, 12);
    expect(steadyRpm(DC_MOTOR, 3, 0, 1, true)).toBeCloseTo(-100, 12);
    expect(steadyRpm(DC_MOTOR, 0.9)).toBe(0);
    expect(steadyRpm(DC_MOTOR, 3, DC_MOTOR.stallTorqueNmm / 2)).toBe(0);
    expect(steadyRpm(DC_MOTOR, 6, DC_MOTOR.stallTorqueNmm / 2)).toBeCloseTo(100, 12);
  });
});

const start = (blueprint: Blueprint): [ElectricalModel, ElectricalState] => {
  const model = electricalModel(buildGraph(blueprint, catalogue));
  return [model, initialElectricalState(model)];
};

const solvedAt = (blueprint: Blueprint) => {
  const graph = buildGraph(blueprint, catalogue);
  const model = electricalModel(graph);
  return { graph, model, solution: solveElectrical(model, initialElectricalState(model)).solution };
};

describe('what flows', () => {
  it('reads every net from the − of its circuit’s first pack, and every port from its net', () => {
    const { solution, graph } = solvedAt(fixture('led-circuit'));
    const names = graph.nets.map((net) => `${net.ports[0]?.part}.${net.ports[0]?.port}`);
    expect(names).toEqual(['battery.minus', 'battery.plus', 'led.plus']);
    expect(solution.netVolts[0]).toBe(0);
    expect(solution.netVolts[1]).toBeCloseTo(3 - 0.4 * (0.015 / 1.005), 8);
    expect(solution.netVolts[2]).toBe(solution.netVolts[1]);
    expect(solution.parts.get('led')?.ports.get('plus')?.volts).toBe(solution.netVolts[2]);
  });

  it('carries each part’s current along the power lines, from `from` to `to`, and through the closed switch', () => {
    const { solution } = solvedAt(fixture('led-circuit'));
    const led = solution.uses[0]?.milliamps ?? 0;
    // w1: battery.plus → switch.a; w2: switch.b → led.plus (as stored); w3 joins the minuses.
    expect([...solution.wires.keys()]).toEqual(['w1', 'w2', 'w3']);
    expect(solution.wires.get('w1')).toBeCloseTo(led, 12);
    expect(solution.switches[0]).toBeCloseTo(led, 12);
    expect(solution.parts.get('switch')).toMatchObject({ volts: 0 });
    expect(solution.parts.get('switch')?.milliamps).toBeCloseTo(led, 12);
  });

  it('carries nothing along a line to a part with no way back', () => {
    const { solution } = solvedAt(
      workbench(
        [
          ['battery', 'battery-pack-2-cell'],
          ['led', 'led'],
          ['motor', 'dc-motor'],
        ],
        [
          ['battery.plus', 'led.plus'],
          ['led.minus', 'battery.minus'],
          ['battery.plus', 'motor.plus'],
        ],
      ),
    );
    expect(solution.wires.get('w3')).toBe(0);
    expect(solution.parts.get('motor')?.milliamps).toBe(0);
  });
});

describe('determinism', () => {
  it('gives the same answer, bit for bit, whatever order the wires are listed in and however often it is asked', () => {
    for (const entry of validBlueprints) {
      const blueprint = entry.data as Blueprint;
      const once = solvedAt(blueprint).solution;
      const again = solvedAt(blueprint).solution;
      const reversed = solvedAt({ ...blueprint, wires: [...blueprint.wires].reverse() }).solution;
      expect(again, entry.name).toEqual(once);
      expect(reversed, entry.name).toEqual(once);
    }
  });

  it('caches the wiring’s verdicts per control state: the schema’s control search runs once for each (review N14)', () => {
    const graph = buildGraph(fixture('bumper-robot'), catalogue);
    const model = electricalModel(graph);
    let state = initialElectricalState(model);
    for (let tick = 0; tick < 50; tick += 1) {
      const touching = tick >= 20 && tick < 30;
      state = stepElectrical(model, state, { controls: { switches: { 'bumper/contacts': !touching } } }).state;
    }
    expect([...(model as Model).wired.keys()]).toEqual(['closed,1,1', 'open,1,1']);
  });
});
