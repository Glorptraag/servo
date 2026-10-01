import { describe, expect, it } from 'vitest';
import { makeCatalogue, validateArenaPreset, validatePartRecord, wiredNeeds } from '@servo/schema';
import type { Blueprint, ControlState, PartRecord, PortRef, ValidationResult } from '@servo/schema';
import { exampleArenas, exampleParts, validBlueprints } from '@servo/schema/fixtures';
import { buildGraph } from '../src/graph/index.ts';
import type { SimGraph } from '../src/graph/index.ts';
import { electricalModel, initialElectricalState, solveElectrical, stepElectrical, voltageWay } from '../src/electrical/index.ts';
import type { ActuatorState, ElectricalSolution } from '../src/electrical/index.ts';
import type { Model } from '../src/electrical/model.ts';
import { powerClosed, settle, situationOf } from '../src/electrical/situation.ts';

const unwrap = <T>(result: ValidationResult<T>): T => {
  if (!result.ok) throw new Error(`Expected valid data:\n${JSON.stringify(result.issues, null, 2)}`);
  return result.value;
};

const parts: readonly PartRecord[] = exampleParts.map((part) => unwrap(validatePartRecord(part)));
const catalogue = makeCatalogue({ parts, arenas: exampleArenas.map((arena) => unwrap(validateArenaPreset(arena))) });
const base = validBlueprints.find((entry) => entry.name === 'led-circuit')?.data as Blueprint;

/** A seeded linear congruential generator, so any failure replays exactly. */
const generator = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
};

const pick = <T>(next: () => number, list: readonly T[]): T => list[Math.floor(next() * list.length)] as T;

const BATTERIES = ['battery-pack-2-cell', 'battery-pack-1-cell'];
const OTHERS = ['battery-pack-1-cell', 'switch', 'bumper-switch', 'led', 'dc-motor', 'buzzer', 'servo-motor', 'motor-driver', 'microcontroller'];

/**
 * A random workbench circuit, as the graph's own random test makes them: a battery pack and up to four other
 * parts joined by random power wires, with a motor driver or microcontroller often fed straight from the
 * first pack, so its outputs give power often enough to test them.
 */
const randomCircuit = (next: () => number): Blueprint => {
  const types = [pick(next, BATTERIES), ...Array.from({ length: 1 + Math.floor(next() * 4) }, () => pick(next, OTHERS))];
  const placed = types.map((type, index) => ({ id: `p${index + 1}`, part: type, position: { x: index * 80, y: 0 }, rotation: 0, settings: {} }));
  const ports: PortRef[] = placed.flatMap((part) =>
    (catalogue.parts.get(part.part)?.ports ?? []).filter((spec) => spec.type === 'power').map((spec) => ({ part: part.id, port: spec.id })),
  );
  const pairs = new Set<string>();
  const wires: (readonly [PortRef, PortRef])[] = [];
  const wire = (a: PortRef, b: PortRef): void => {
    const key = [`${a.part}.${a.port}`, `${b.part}.${b.port}`].sort().join('|');
    if ((a.part === b.part && a.port === b.port) || pairs.has(key)) return;
    pairs.add(key);
    wires.push([a, b]);
  };
  for (const part of placed) {
    if ((part.part === 'motor-driver' || part.part === 'microcontroller') && next() < 0.6) {
      wire({ part: 'p1', port: 'plus' }, { part: part.id, port: 'plus' });
      wire({ part: 'p1', port: 'minus' }, { part: part.id, port: 'minus' });
    }
  }
  const wanted = wires.length + 1 + Math.floor(next() * 8);
  for (let attempt = 0; attempt < wanted * 4 && wires.length < wanted; attempt += 1) wire(pick(next, ports), pick(next, ports));
  return {
    ...base,
    parts: placed,
    wires: wires.map(([from, to], index) => ({ id: `w${index + 1}`, from, to })),
    meta: { ...base.meta, level: 2, highWater: { parts: placed.length, wires: wires.length } },
  };
};

const randomState = (graph: SimGraph, next: () => number): ControlState => {
  const switches: Record<string, boolean> = {};
  const channels: Record<string, number> = {};
  for (const control of graph.controls) {
    const roll = next();
    if (control.kind === 'switch') {
      if (roll < 0.45) switches[control.id] = true;
      else if (roll < 0.9) switches[control.id] = false;
    } else {
      const commands = [1, 0, -1, 0.5];
      const index = Math.floor(roll * (commands.length + 1));
      if (index < commands.length) channels[control.id] = commands[index] as number;
    }
  }
  return { switches, channels };
};

/** Random actuator states: motors turning either way at up to 300 rpm, servo motors under random loads. */
const randomActuators = (graph: SimGraph, next: () => number): ActuatorState[] =>
  graph.uses.map(() => ({ rpm: Math.round((next() * 2 - 1) * 300), loadNmm: Math.round(next() * 200) }));

/** Every number in a solution, so none can be NaN or infinite. */
const numbers = (solution: ElectricalSolution): number[] => [
  ...solution.netVolts,
  ...solution.sources.flatMap((flow) => [flow.emfVolts, flow.volts, flow.milliamps, flow.sagVolts, flow.charge]),
  ...solution.uses.flatMap((flow) => [flow.volts, flow.milliamps]),
  ...solution.switches,
  ...solution.wires.values(),
  ...[...solution.parts.values()].flatMap((flow) => [...flow.ports.values()].flatMap((port) => [port.volts, port.milliamps])),
];

describe('the solver on random circuits', () => {
  // A bulk property test: it takes a few seconds, more on a busy machine.
  it('settles, keeps current, and agrees with the schema on the wiring, on 300 circuits at 900 states', { timeout: 60_000 }, () => {
    const next = generator(20261002);
    const seen = { states: 0, shorts: 0, outputs: 0, limited: 0, reversed: 0, low: 0, browned: 0, reversedDriver: 0, controls: 0, short: 0, feeder: 0, solves: 0, most: 0 };
    for (let circuit = 0; circuit < 300; circuit += 1) {
      const blueprint = randomCircuit(next);
      const graph = buildGraph(blueprint, catalogue);
      const model = electricalModel(graph);
      for (const controls of [{}, randomState(graph, next), randomState(graph, next)]) {
        const actuators = randomActuators(graph, next);
        const charge = graph.sources.map(() => (next() < 0.15 ? 0 : 0.2 + 0.8 * next()));
        const { solution } = solveElectrical(model, { ...initialElectricalState(model), charge }, { controls, actuators });
        const where = `circuit ${circuit}: ${JSON.stringify({ parts: blueprint.parts.map((part) => [part.id, part.part]), wires: blueprint.wires, controls })}`;
        expect(solution.settled, where).toBe(true);
        expect(numbers(solution).every(Number.isFinite), where).toBe(true);

        // Every net passes on what flows in: the parts' currents at its ports sum to nothing (but for the leak
        // conductance, under 1e-9 S per element, which is never reported), and the currents along its power
        // lines at each port add up to the part's.
        graph.nets.forEach((net, index) => {
          const into = net.ports.reduce((sum, ref) => sum + (solution.parts.get(ref.part)?.ports.get(ref.port)?.milliamps ?? 0), 0);
          expect(Math.abs(into), `${where} net ${index}`).toBeLessThan(1e-4);
          for (const ref of net.ports) {
            const lines = graph.powerLines.reduce((sum, line) => {
              const mA = solution.wires.get(line.wire) ?? 0;
              if (line.to.part === ref.part && line.to.port === ref.port) return sum + mA;
              if (line.from.part === ref.part && line.from.port === ref.port) return sum - mA;
              return sum;
            }, 0);
            const part = solution.parts.get(ref.part)?.ports.get(ref.port)?.milliamps ?? 0;
            expect(Math.abs(lines - part), `${where} port ${ref.part}.${ref.port}`).toBeLessThan(1e-4);
          }
        });

        // The wiring's verdicts are the schema's, and the solver's own check of a closed path agrees with them.
        const settled = settle(model as Model, controls);
        // The schema's own verdicts at this state, as the model cached them from wiredNeeds (electrical-faults.test.ts
        // checks that cache against fresh wiredNeeds calls).
        const verdicts = (model as Model).wired.get(settled.key) ?? wiredNeeds(blueprint, catalogue, settled.state);
        const situation = situationOf(model as Model, settled);
        for (const verdict of verdicts) {
          const judged = solution.verdicts.find((each) => each.partId === verdict.partId && each.need === verdict.need);
          if (verdict.unmet !== undefined || verdict.kind !== 'power') {
            expect(judged, where).toEqual(verdict);
            continue;
          }
          const need = graph.parts.get(verdict.partId)?.record.needs.find((each) => each.id === verdict.need);
          if (need?.kind !== 'power') throw new Error('Expected a power need');
          const port = (id: string) => (model as Model).portIndex.get(`${verdict.partId} ${id}`) as number;
          expect(powerClosed(situation, verdict.partId, port(need.supply.pos), port(need.supply.neg)), where).toBe(true);
          const flow = solution.parts.get(verdict.partId)?.ports;
          const volts = (flow?.get(need.supply.pos)?.volts ?? 0) - (flow?.get(need.supply.neg)?.volts ?? 0);
          // Every need reads its volts, except that a motor driver browning out, its supply held at onVolts, reads
          // low. A reversed or high supply reads so whatever its channels do (R-1.2 round 2, finding 1).
          const measured = voltageWay(need, volts);
          const throttled = graph.sources.some((source, index) => source.part === verdict.partId && source.spec.kind === 'driver' && (solution.sources[index]?.duty ?? 1) < 1);
          const browning = (measured === undefined || measured === 'low') && throttled;
          expect(judged?.unmet, where).toBe(browning ? 'low' : measured);
          if (browning) seen.browned += 1;
          // A driver's reversed supply leaves its channels at duty 0, and must still read reversed.
          if (measured === 'reversed' && throttled) seen.reversedDriver += 1;
          if (judged?.unmet === 'reversed') seen.reversed += 1;
          if (judged?.unmet === 'low') seen.low += 1;
          if (judged?.explainedBy?.by === 'controls') seen.controls += 1;
          if (judged?.explainedBy?.by === 'short') seen.short += 1;
          if (judged?.explainedBy?.by === 'feeder') seen.feeder += 1;
        }
        for (const verdict of verdicts) {
          if (verdict.kind !== 'power' || verdict.unmet !== 'open') continue;
          const need = graph.parts.get(verdict.partId)?.record.needs.find((each) => each.id === verdict.need);
          if (need?.kind !== 'power') continue;
          const port = (id: string) => (model as Model).portIndex.get(`${verdict.partId} ${id}`) as number;
          expect(powerClosed(situation, verdict.partId, port(need.supply.pos), port(need.supply.neg)), where).toBe(false);
        }

        seen.states += 1;
        seen.solves += solution.iterations;
        seen.most = Math.max(seen.most, solution.iterations);
        if (solution.shorts.length > 0) seen.shorts += 1;
        if (graph.sources.some((source, index) => source.feeder && solution.sources[index]?.giving)) seen.outputs += 1;
        if (graph.sources.some((source, index) => source.feeder && Math.abs(Math.abs(solution.sources[index]?.milliamps ?? 0) - (source.spec.kind === 'source' ? 0 : source.spec.maxMilliamps)) < 1e-6)) seen.limited += 1;
      }
    }
    // How often the sample reaches the cases it is meant to test, and how few solves each state took.
    expect(seen.states).toBe(900);
    expect(seen.shorts).toBeGreaterThan(100);
    expect(seen.outputs).toBeGreaterThan(50);
    expect(seen.limited).toBeGreaterThan(5);
    expect(seen.reversed).toBeGreaterThan(10);
    expect(seen.low).toBeGreaterThan(50);
    expect(seen.feeder).toBeGreaterThan(0);
    expect(seen.browned).toBeGreaterThan(10);
    expect(seen.reversedDriver).toBeGreaterThan(0);
    // A handful of solves, or a few dozen while a motor driver browns out and its duty is searched for.
    expect(seen.most).toBeLessThanOrEqual(64);
  });

  it('never raises a battery’s charge, and drains one only while current flows through it', { timeout: 60_000 }, () => {
    const next = generator(7);
    for (let circuit = 0; circuit < 100; circuit += 1) {
      const graph = buildGraph(randomCircuit(next), catalogue);
      const model = electricalModel(graph);
      let state = initialElectricalState(model);
      for (let tick = 0; tick < 5; tick += 1) {
        const { solution, state: after } = stepElectrical(model, state, { controls: randomState(graph, next) });
        graph.sources.forEach((source, index) => {
          const before = state.charge[index] ?? 1;
          const left = after.charge[index] ?? 1;
          expect(left).toBeLessThanOrEqual(before);
          if (source.feeder) expect(left).toBe(1);
          else if (Math.abs(solution.sources[index]?.milliamps ?? 0) === 0) expect(left).toBe(before);
          else if (Math.abs(solution.sources[index]?.milliamps ?? 0) > 1e-6) expect(left).toBeLessThan(before);
        });
        state = after;
      }
    }
  });
});
