import { explainByControls } from '@servo/schema';
import type { Explanation, FailureMode, FailureModeId, NeedId, PlacedPartId, PowerNeed } from '@servo/schema';
import { solveCircuit } from './circuit.ts';
import type { Solved } from './circuit.ts';
import { at, compareText, portOf } from './model.ts';
import type { Model, Situation } from './model.ts';
import { feederOf, healedOf, nearShorts, nodeOf, powerClosed, settle, situationOf, wiredAt } from './situation.ts';
import type { ActuatorState, ElectricalState, ElectricalVerdict, ExplainedNeed, ShortCircuit, VoltageWay } from './types.ts';

/** A part reads reversed when its supply is more than this far the wrong way round. */
export const REVERSED_VOLTS = 1e-6;
/** How far outside its range a supply may sit and still meet the need: rounding, never a teaching value. */
const RANGE_VOLTS = 1e-9;

/** How the voltages leave a power need unmet: the wrong way round first, then below or above its range. */
export const voltageWay = (need: PowerNeed, volts: number): VoltageWay | undefined => {
  if (volts < -REVERSED_VOLTS) return 'reversed';
  if (volts < need.minVolts - RANGE_VOLTS) return 'low';
  if (volts > need.maxVolts + RANGE_VOLTS) return 'high';
  return undefined;
};

export interface Judged {
  readonly verdicts: readonly ElectricalVerdict[];
  readonly faults: ReadonlyMap<PlacedPartId, readonly FailureModeId[]>;
  readonly shorts: readonly ShortCircuit[];
  readonly explained: ElectricalState['explained'];
}

/**
 * Every power, loop and isolation need, in the order `wiredNeeds` gives its verdicts (part id, then the
 * record's need order): a power need with its supply's ports as power-port numbers, an isolation need with
 * its first port (which places a shorted part in its circuit).
 */
interface Slot {
  readonly partId: PlacedPartId;
  readonly need: NeedId;
  readonly power?: { readonly need: PowerNeed; readonly pos: number; readonly neg: number };
  readonly isolation?: number;
}

interface Needs {
  readonly slots: readonly Slot[];
  readonly modes: ReadonlyMap<PlacedPartId, readonly FailureMode[]>;
}

const needsCache = new WeakMap<Model, Needs>();

const keyOf = (part: PlacedPartId, need: NeedId): string => `${part} ${need}`;

const needsOf = (model: Model): Needs => {
  const known = needsCache.get(model);
  if (known) return known;
  const slots: Slot[] = [];
  const modes = new Map<PlacedPartId, readonly FailureMode[]>();
  for (const part of model.graph.parts.values()) {
    modes.set(part.id, part.record.failureModes);
    for (const need of part.record.needs) {
      if (need.kind === 'power') slots.push({ partId: part.id, need: need.id, power: { need, pos: portOf(model, part.id, need.supply.pos), neg: portOf(model, part.id, need.supply.neg) } });
      else if (need.kind === 'isolation') slots.push({ partId: part.id, need: need.id, isolation: portOf(model, part.id, need.ports[0]) });
      else if (need.kind === 'loop') slots.push({ partId: part.id, need: need.id });
    }
  }
  const made = { slots, modes };
  needsCache.set(model, made);
  return made;
};

/**
 * Every power, loop and isolation need at this tick, by the schema's rule: a fault is what the child's
 * controls cannot fix (packages/schema/docs/parts.md).
 * - The wiring decides `open` and `shorted` and explains them (`wiredNeeds`, cached per control state).
 * - A power need the wiring meets is judged on the solved volts across its supply: `reversed`, `low`, `high`.
 * - Such a need is explained in the schema's order: by a short that starves it (it would be met with the
 *   short's wires and closed switches taken away), by the controls (`explainByControls`, each other setting
 *   solved with this tick's charges), or by a motor driver or regulator without power that feeds it (review N10).
 * - The search for an explanation runs once per need and way at a control state; its answer is kept in the
 *   state until a control changes (review N14).
 */
export const judgeNeeds = (
  model: Model,
  situation: Situation,
  solved: Solved,
  charge: readonly number[],
  actuators: readonly (ActuatorState | undefined)[] | undefined,
  prior: ElectricalState['explained'],
): Judged => {
  const graph = model.graph;
  const needs = needsOf(model);
  const wired = wiredAt(model, situation);
  const volts = (where: Situation, solution: Solved, pos: number, neg: number): number =>
    at(solution.volts, nodeOf(where, pos)) - at(solution.volts, nodeOf(where, neg));

  const verdicts: ElectricalVerdict[] = [];
  const pending: { readonly index: number; readonly part: PlacedPartId; readonly need: PowerNeed; readonly pos: number; readonly neg: number; readonly way: VoltageWay }[] = [];
  const shorted = new Map<PlacedPartId, number>();
  const shorts: ShortCircuit[] = [];
  wired.forEach((verdict, index) => {
    const slot = needs.slots[index];
    // wiredNeeds lists the same needs in the same order at every control state.
    if (slot?.partId !== verdict.partId || slot.need !== verdict.need) throw new Error(`Unexpected verdict for ${verdict.partId} ${verdict.need}.`);
    if (verdict.kind === 'isolation' && verdict.unmet === 'shorted') {
      if (slot.isolation !== undefined && !shorted.has(verdict.partId)) shorted.set(verdict.partId, slot.isolation);
      shorts.push({ partId: verdict.partId, need: verdict.need });
    }
    const power = verdict.kind === 'power' && verdict.unmet === undefined ? slot.power : undefined;
    const way = power ? voltageWay(power.need, volts(situation, solved, power.pos, power.neg)) : undefined;
    if (!power || way === undefined) {
      verdicts.push(verdict);
      return;
    }
    pending.push({ index: verdicts.length, part: verdict.partId, need: power.need, pos: power.pos, neg: power.neg, way });
    verdicts.push({ ...verdict, unmet: way });
  });

  const sameControls = prior.controls === situation.key;
  const known = new Map<string, ExplainedNeed>(sameControls ? prior.needs.map((entry) => [`${keyOf(entry.partId, entry.need)} ${entry.unmet}`, entry]) : []);
  let found = false;
  if (pending.length > 0) {
    const unpowered = new Set(verdicts.filter((verdict) => verdict.kind === 'power' && verdict.unmet !== undefined).map((verdict) => verdict.partId));
    const solutions = new Map<string, Solved>([[situation.key, solved]]);
    const solvedAt = (where: Situation): Solved => {
      const done = solutions.get(where.key);
      if (done) return done;
      const solution = solveCircuit(model, where, charge, actuators);
      solutions.set(where.key, solution);
      return solution;
    };
    const metAt = (where: Situation, part: PlacedPartId, need: PowerNeed, pos: number, neg: number): boolean =>
      powerClosed(where, part, pos, neg) && voltageWay(need, volts(where, solvedAt(where), pos, neg)) === undefined;
    const explain = (part: PlacedPartId, need: PowerNeed, pos: number, neg: number): Explanation | undefined => {
      if (shorted.size > 0) {
        const healed = healedOf(model, situation, new Set(shorted.keys()));
        if (healed && metAt(healed, part, need, pos, neg)) return { by: 'short', parts: nearShorts(model, situation, pos, shorted) };
      }
      const controls = explainByControls(graph.controls, situation.state, (state) => metAt(situationOf(model, settle(model, state)), part, need, pos, neg));
      if (controls) return { by: 'controls', controls };
      const feeder = feederOf(situation, part, pos, neg, unpowered);
      return feeder === undefined ? undefined : { by: 'feeder', part: feeder };
    };
    for (const { index, part, need, pos, neg, way } of pending) {
      const key = `${keyOf(part, need.id)} ${way}`;
      let entry = known.get(key);
      if (!entry) {
        const explainedBy = explain(part, need, pos, neg);
        entry = { partId: part, need: need.id, unmet: way, ...(explainedBy ? { explainedBy } : {}) };
        known.set(key, entry);
        found = true;
      }
      if (entry.explainedBy) verdicts[index] = { ...(verdicts[index] as ElectricalVerdict), explainedBy: entry.explainedBy };
    }
  }

  const faults = new Map<PlacedPartId, FailureModeId[]>();
  for (const verdict of verdicts) {
    if (verdict.unmet === undefined || verdict.explainedBy !== undefined) continue;
    const modes = needs.modes.get(verdict.partId) ?? [];
    const list = faults.get(verdict.partId) ?? [];
    for (const mode of modes) if (mode.need === verdict.need && mode.unmet === verdict.unmet && !list.includes(mode.id)) list.push(mode.id);
    if (list.length > 0) faults.set(verdict.partId, list);
  }
  for (const [part, list] of faults) {
    const order = (needs.modes.get(part) ?? []).map((mode) => mode.id);
    list.sort((p, q) => order.indexOf(p) - order.indexOf(q));
  }
  // Only a new explanation changes the state: otherwise it is handed on as it came.
  const explained =
    sameControls && !found
      ? prior
      : {
          controls: situation.key,
          needs: [...known.values()].sort((p, q) => compareText(p.partId, q.partId) || compareText(p.need, q.need) || compareText(p.unmet, q.unmet)),
        };
  return { verdicts, faults, shorts, explained };
};
