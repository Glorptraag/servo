// The electrical solver's cost: `pnpm perf` (vitest.perf.config.ts), apart from `pnpm test`, so a busy machine's
// timing never fails the correctness run.
import { describe, expect, it } from 'vitest';
import type { Blueprint } from '@servo/schema';
import { buildGraph } from '../src/graph/index.ts';
import { electricalModel, initialElectricalState, stepElectrical, steadyRpm } from '../src/electrical/index.ts';
import type { ActuatorState } from '../src/electrical/index.ts';
import { catalogue, workbench } from './electrical-support.ts';
import type { Placed } from './electrical-support.ts';

declare const performance: { now(): number };
declare const console: { log(...args: unknown[]): void };

describe('cost', () => {
  it('keeps a 25-part build well under 1 ms a tick', () => {
    const graph = buildGraph(twentyFive(), catalogue);
    expect(graph.parts.size).toBe(25);
    const model = electricalModel(graph);
    const motors = graph.uses.flatMap((use, index) => (use.spec.kind === 'actuator' && use.spec.mode === 'speed' ? [{ index, spec: use.spec }] : []));
    let state = initialElectricalState(model);
    let actuators: ActuatorState[] = graph.uses.map(() => ({}));
    const tick = (): void => {
      const result = stepElectrical(model, state, { actuators });
      state = result.state;
      const next: ActuatorState[] = graph.uses.map(() => ({}));
      for (const motor of motors) next[motor.index] = { rpm: steadyRpm(motor.spec, result.solution.uses[motor.index]?.volts ?? 0) };
      actuators = next;
    };
    for (let warm = 0; warm < 200; warm += 1) tick();
    // The fastest of 15 batches of 100 ticks: what the code costs when it has the processor, so a busy machine
    // does not decide it (review R-1.2, finding 8). The median is printed beside it.
    const batches = Array.from({ length: 15 }, () => {
      const begin = performance.now();
      for (let count = 0; count < 100; count += 1) tick();
      return (performance.now() - begin) / 100;
    }).sort((p, q) => p - q);
    const perTick = batches[0] ?? Number.POSITIVE_INFINITY;
    console.log(`electrical: ${perTick.toFixed(3)} ms a tick for a 25-part build (fastest of 15 batches; median ${(batches[7] ?? 0).toFixed(3)} ms)`);
    expect(perTick).toBeLessThan(1);
  });
});

/**
 * 25 parts on two 2-cell packs side by side: a switch and a bumper switch in the power line, a motor driver
 * with two DC motors, four more DC motors, six LEDs, four buzzers, two servo motors, and a microcontroller with
 * a DC motor on its 3V pin.
 */
const twentyFive = (): Blueprint => {
  const placed: Placed[] = [
    ['pack-a', 'battery-pack-2-cell'],
    ['pack-b', 'battery-pack-2-cell'],
    ['switch', 'switch'],
    ['bumper', 'bumper-switch'],
    ['driver', 'motor-driver'],
    ['brain', 'microcontroller'],
  ];
  const wires: [string, string][] = [
    ['pack-a.plus', 'pack-b.plus'],
    ['pack-a.minus', 'pack-b.minus'],
    ['pack-a.plus', 'switch.a'],
    ['switch.b', 'bumper.a'],
    ['bumper.b', 'driver.plus'],
    ['driver.minus', 'pack-a.minus'],
    ['bumper.b', 'brain.plus'],
    ['brain.minus', 'pack-a.minus'],
  ];
  const bus = (id: string, type: string): void => {
    placed.push([id, type]);
    wires.push(['bumper.b', `${id}.plus`], [`${id}.minus`, 'pack-a.minus']);
  };
  for (const channel of ['a', 'b']) {
    placed.push([`driven-${channel}`, 'dc-motor']);
    wires.push([`driver.${channel}-plus`, `driven-${channel}.plus`], [`driver.${channel}-minus`, `driven-${channel}.minus`]);
  }
  for (let index = 1; index <= 4; index += 1) bus(`motor-${index}`, 'dc-motor');
  for (let index = 1; index <= 6; index += 1) bus(`led-${index}`, 'led');
  for (let index = 1; index <= 4; index += 1) bus(`buzzer-${index}`, 'buzzer');
  for (let index = 1; index <= 2; index += 1) bus(`servo-${index}`, 'servo-motor');
  placed.push(['pin-motor', 'dc-motor']);
  wires.push(['brain.pin-3v', 'pin-motor.plus'], ['pin-motor.minus', 'pack-a.minus']);
  return workbench(placed, wires);
};
