import { TICK_RATE } from '@servo/schema';
import type { SimGraph } from '../graph/index.ts';
import { solveCircuit } from './circuit.ts';
import { flowsOf, milliamps } from './flows.ts';
import { at, buildModel } from './model.ts';
import type { Model } from './model.ts';
import { judgeNeeds } from './needs.ts';
import { settle, situationOf } from './situation.ts';
import type { ElectricalInputs, ElectricalModel, ElectricalSolution, ElectricalState, ElectricalTick } from './types.ts';

/** Milliamp-seconds in a milliamp-hour. */
const SECONDS_PER_HOUR = 3600;

/** The electrical model of a graph, made once per Run. */
export const electricalModel = (graph: SimGraph): ElectricalModel => buildModel(graph);

/** The state a Run starts in: every battery full, nothing explained yet. */
export const initialElectricalState = (model: ElectricalModel): ElectricalState => ({
  charge: model.graph.sources.map(() => 1),
  explained: { key: '', needs: [] },
});

/** A charge read from a state: 1 when missing or not a number, and within 0–1. */
const chargesOf = (model: Model, state: ElectricalState): number[] =>
  model.sources.map((_, index) => {
    const value = state.charge[index];
    if (value === undefined || !Number.isFinite(value)) return 1;
    return value > 1 ? 1 : value < 0 ? 0 : value;
  });

const tick = (electrical: ElectricalModel, state: ElectricalState, inputs: ElectricalInputs, drain: boolean): ElectricalTick => {
  const model = electrical as Model;
  const charge = chargesOf(model, state);
  const settled = settle(model, inputs.controls);
  const situation = situationOf(model, settled);
  const solved = solveCircuit(model, situation, charge, inputs.actuators);
  const flows = flowsOf(model, situation, solved, charge);
  const judged = judgeNeeds(model, situation, solved, charge, inputs.actuators, state.explained);
  const solution: ElectricalSolution = {
    controls: settled.state,
    live: situation.live,
    netVolts: flows.netVolts,
    sources: model.sources.map((source, index) => {
      const volts = at(flows.netVolts, at(model.portNet, source.pos)) - at(flows.netVolts, at(model.portNet, source.neg));
      const emfVolts = at(solved.sourceEmf, index);
      const giving = solved.giving[index] === true;
      return {
        emfVolts,
        volts,
        milliamps: milliamps(at(solved.sourceAmps, index)),
        // Measured the way it drives, so a channel driving backwards sags by a positive amount too.
        sagVolts: giving ? (emfVolts < 0 ? volts - emfVolts : emfVolts - volts) : 0,
        charge: at(charge, index),
        giving,
        duty: at(solved.duty, index),
      };
    }),
    uses: model.uses.map((use, index) => ({
      volts: at(flows.netVolts, at(model.portNet, use.pos)) - at(flows.netVolts, at(model.portNet, use.neg)),
      milliamps: milliamps(at(solved.useAmps, index)),
    })),
    switches: Array.from(flows.switchAmps, milliamps),
    wires: flows.wires,
    parts: flows.parts,
    shorts: judged.shorts,
    verdicts: judged.verdicts,
    faults: judged.faults,
    iterations: solved.solves,
    settled: solved.settled,
  };
  // Any current through a battery uses its charge, whichever way it flows: a pack pushed backwards by a
  // stronger one drains too. One tick is 1/TICK_RATE s of simulated time.
  const next = drain
    ? model.sources.map((source, index) => {
        const left = at(charge, index);
        const spec = source.spec;
        if (spec.kind !== 'source' || !(left > 0)) return left;
        const current = milliamps(at(solved.sourceAmps, index));
        const used = (current < 0 ? -current : current) / (TICK_RATE * SECONDS_PER_HOUR * spec.capacityMah);
        return left > used ? left - used : 0;
      })
    : charge;
  return { solution, state: { charge: next, explained: judged.explained } };
};

/**
 * Solves the circuit at the state's charges with no time passing: tick 0's frame. The state it returns keeps
 * the same charges, with any explanations found.
 */
export const solveElectrical = (model: ElectricalModel, state: ElectricalState, inputs: ElectricalInputs = {}): ElectricalTick => tick(model, state, inputs, false);

/**
 * One tick of the electrical solver: solves the circuit at the state's charges, then drains each battery by
 * the current through it over the tick (1/30 s). Pure: the same model, state and inputs give the same answer.
 */
export const stepElectrical = (model: ElectricalModel, state: ElectricalState, inputs: ElectricalInputs = {}): ElectricalTick => tick(model, state, inputs, true);
