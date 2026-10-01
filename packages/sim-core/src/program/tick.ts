import type { PlacedPartId, PortId } from '@servo/schema';
import { switchedOn } from '../behaviour/primitives.ts';
import type { BrainInfo, ProgramState } from '../interface.ts';
import { levelOf, levelsOn, routeSignals } from './signals.ts';
import type { Brain, BrainOutput, ProgramInputs, ProgramModel, ProgramSlotState, ProgramTick, SignalLevels } from './types.ts';

const finite = (value: number | undefined): number => (value !== undefined && Number.isFinite(value) ? value : 0);

/** Volts across a brain's supply, + port less − port, read as the behaviour runtime reads them: a port left out, or a reading that is not a finite number, is 0 V. */
const supplyVolts = (power: ProgramInputs['power'], brain: Brain): number => {
  const ports = power?.get(brain.partId)?.ports;
  return finite(ports?.get(brain.spec.supply.pos)?.volts) - finite(ports?.get(brain.spec.supply.neg)?.volts);
};

/** What a runtime is told about a brain: its part and its primitive, nothing more. */
const infoOf = (brain: Brain): BrainInfo => ({ partId: brain.partId, primitive: brain.primitive });

/** The levels the brains drive, by placed part. */
const outsOf = (model: ProgramModel, driven: ProgramSlotState['driven']): SignalLevels => {
  const outs = new Map<PlacedPartId, Record<PortId, number>>();
  model.brains.forEach((brain, index) => {
    const levels = driven[index];
    if (levels !== undefined && Object.keys(levels).length > 0) outs.set(brain.partId, { ...outs.get(brain.partId), ...levels });
  });
  return outs;
};

/** The state a Run starts from: each brain at its runtime's start state, driving nothing. */
export const startProgram = (model: ProgramModel): ProgramSlotState => ({
  programs: model.brains.map((brain) => model.runtime.start(infoOf(brain))),
  driven: model.brains.map(() => ({})),
});

/**
 * One tick of the program slot, after the electrical solver and before the behaviour runtime and the mechanical
 * solver. Each brain, in the model's order:
 * - is on while its supply is at or above its `onVolts`, by the same rule as the behaviour runtime's `program`;
 * - while on, the runtime runs it: it reads the levels on its inputs as sampled at the end of the previous tick
 *   (what the brains wired to them drove then, or `samples`) and gives the levels to drive on its outputs this tick
 *   and its next state;
 * - while off, it drives nothing and its state goes back to the runtime's start, so it starts again when power
 *   returns.
 * Levels are read as signals: clamped to 0–1, and a level that is not a finite number, or one on a port that is
 * not the primitive's, carries none. The outputs travel along the signal lines to the signal ins they feed in this
 * same tick. Pure and deterministic as long as the runtime is, and it never changes its model, state or inputs.
 */
export const programTick = (model: ProgramModel, state: ProgramSlotState, inputs: ProgramInputs): ProgramTick => {
  const fed = routeSignals(model.graph, outsOf(model, state.driven)).signals;
  const brains: BrainOutput[] = [];
  const programs: ProgramState[] = [];
  const driven: Readonly<Record<PortId, number>>[] = [];
  model.brains.forEach((brain, index) => {
    const info = infoOf(brain);
    const read = levelsOn(brain.spec.inputs, (port) => levelOf(fed.get(brain.partId), port) ?? levelOf(inputs.samples?.get(brain.partId), port));
    if (!switchedOn(brain.spec, supplyVolts(inputs.power, brain))) {
      brains.push({ ...info, on: false, inputs: read, outputs: {} });
      programs.push(model.runtime.start(info));
      driven.push({});
      return;
    }
    const held = state.programs[index];
    const step = model.runtime.run({ ...info, tick: inputs.tick, inputs: { ...read } }, held === undefined ? model.runtime.start(info) : held);
    const outputs = levelsOn(brain.spec.outputs, (port) => levelOf(step.outputs, port));
    brains.push({ ...info, on: true, inputs: read, outputs });
    programs.push(step.state);
    driven.push(outputs);
  });
  return { brains, ...routeSignals(model.graph, outsOf(model, driven)), state: { programs, driven } };
};
