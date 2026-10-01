import { explainByControls } from '@servo/schema';
import type { ControlState, Explanation, FailureMode, FailureModeId, NeedId, PlacedPartId, PowerNeed } from '@servo/schema';
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
/** A kept fault (a need nothing explained) is searched again whenever a battery's charge crosses into another band this wide. */
export const CHARGE_BAND = 0.05;

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
 * record's need order): a power need with its supply's ports as power-port numbers and the motor-driver
 * channels it powers, an isolation need with its first port (which places a shorted part in its circuit).
 */
interface Slot {
  readonly partId: PlacedPartId;
  readonly need: NeedId;
  readonly power?: { readonly need: PowerNeed; readonly pos: number; readonly neg: number; readonly channels: readonly number[] };
  readonly isolation?: number;
}

interface Needs {
  readonly slots: readonly Slot[];
  readonly modes: ReadonlyMap<PlacedPartId, readonly FailureMode[]>;
}

const needsCache = new WeakMap<Model, Needs>();

const keyOf = (part: PlacedPartId, need: NeedId, way: VoltageWay): string => `${part} ${need} ${way}`;

const needsOf = (model: Model): Needs => {
  const known = needsCache.get(model);
  if (known) return known;
  const slots: Slot[] = [];
  const modes = new Map<PlacedPartId, readonly FailureMode[]>();
  for (const part of model.graph.parts.values()) {
    modes.set(part.id, part.record.failureModes);
    for (const need of part.record.needs) {
      if (need.kind === 'power') {
        const pos = portOf(model, part.id, need.supply.pos);
        const neg = portOf(model, part.id, need.supply.neg);
        const channels = model.sources.flatMap((source, index) => (source.part === part.id && source.kind === 'channel' && source.feederPos === pos && source.feederNeg === neg ? [index] : []));
        slots.push({ partId: part.id, need: need.id, power: { need, pos, neg, channels } });
      } else if (need.kind === 'isolation') slots.push({ partId: part.id, need: need.id, isolation: portOf(model, part.id, need.ports[0]) });
      else if (need.kind === 'loop') slots.push({ partId: part.id, need: need.id });
    }
  }
  const made = { slots, modes };
  needsCache.set(model, made);
  return made;
};

/**
 * The key kept answers live under: the control state, and which motor drivers brown out. So the search runs
 * again, in the rule's order, when a brown-out starts or ends (review R-1.2, round 2, finding 2).
 */
const keepKey = (model: Model, situation: Situation, solved: Solved): string => {
  const browned = [...new Set(model.sources.flatMap((source, index) => (solved.browned[index] === true ? [source.part] : [])))].sort(compareText);
  return `${situation.key}#${browned.join(' ')}`;
};

/** The band each battery's charge is in. A kept fault is searched again when it changes. */
const bandsOf = (model: Model, charge: readonly number[]): string =>
  model.sources.flatMap((source, index) => (source.kind === 'battery' ? [Math.floor(at(charge, index) / CHARGE_BAND)] : [])).join('.');

/**
 * Every power, loop and isolation need at this tick, by the schema's rule: a fault is what the child's
 * controls cannot fix (packages/schema/docs/parts.md).
 * - The wiring decides `open` and `shorted` and explains them (`wiredNeeds`, cached per control state).
 * - A power need the wiring meets is judged on the solved volts across its supply: `reversed`, `low`, `high`.
 * - A motor driver that browns out is `low` (its record: "the fault is the driver's"). Only a short or a
 *   feeder can explain that: a child must see why its motors stopped, so the controls never do (D57). A supply
 *   that reads `reversed` or `high` stays so, whatever its channels do.
 * - Any other such need is explained in the schema's order: by a short that starves it (it would be met with
 *   the short's wires and closed switches taken away), by the controls (`explainByControls`, each other
 *   setting solved with this tick's charges), or by a motor driver or regulator without power that feeds it
 *   (review N10). A part a browned-out driver starves of volts is put down to that driver straight after the
 *   short step.
 * - An answer is kept in the state under the control state and which motor drivers brown out. A kept
 *   explanation is checked again every tick (one solve at the setting it names) and searched again when it no
 *   longer holds (review N14); a kept fault is searched again when a battery's charge band changes or a motor
 *   driver or regulator that feeds it loses power.
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

  interface Pending {
    readonly index: number;
    readonly part: PlacedPartId;
    readonly need: PowerNeed;
    readonly pos: number;
    readonly neg: number;
    readonly way: VoltageWay;
    /** The motor-driver channels this supply powers. */
    readonly channels: readonly number[];
    /** A motor driver browning out: its own fault unless a short or a feeder explains it. */
    readonly browned: boolean;
  }
  const verdicts: ElectricalVerdict[] = [];
  const pending: Pending[] = [];
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
    if (!power) {
      verdicts.push(verdict);
      return;
    }
    // The volts decide `reversed` and `high` whatever the channels do; a brown-out only reads a supply held at
    // onVolts as `low` (review R-1.2, round 2, finding 1).
    const measured = voltageWay(power.need, volts(situation, solved, power.pos, power.neg));
    const browned = (measured === undefined || measured === 'low') && power.channels.some((source) => solved.browned[source] === true);
    const way = browned ? 'low' : measured;
    if (way === undefined) {
      verdicts.push(verdict);
      return;
    }
    pending.push({ index: verdicts.length, part: verdict.partId, need: power.need, pos: power.pos, neg: power.neg, way, channels: power.channels, browned });
    verdicts.push({ ...verdict, unmet: way });
  });

  const key = keepKey(model, situation, solved);
  const band = bandsOf(model, charge);
  const same = prior.key === key;
  const known = new Map<string, ExplainedNeed>(same ? prior.needs.map((entry) => [keyOf(entry.partId, entry.need, entry.unmet), entry]) : []);
  let found = false;
  if (pending.length > 0) {
    const unpowered = new Set(verdicts.filter((verdict) => verdict.kind === 'power' && verdict.unmet !== undefined).map((verdict) => verdict.partId));
    const brownedOut = new Set(model.sources.flatMap((source, index) => (solved.browned[index] === true ? [source.part] : [])));
    const solutions = new Map<string, Solved>([[situation.key, solved]]);
    const solvedAt = (where: Situation): Solved => {
      const done = solutions.get(where.key);
      if (done) return done;
      const solution = solveCircuit(model, where, charge, actuators);
      solutions.set(where.key, solution);
      return solution;
    };
    const metAt = (where: Situation, task: Pending): boolean => {
      if (!powerClosed(where, task.part, task.pos, task.neg)) return false;
      const solution = solvedAt(where);
      if (task.channels.some((source) => solution.browned[source] === true)) return false;
      return voltageWay(task.need, volts(where, solution, task.pos, task.neg)) === undefined;
    };
    const healed = (): Situation | undefined => (shorted.size > 0 ? healedOf(model, situation, new Set(shorted.keys())) : undefined);
    /** The search, in the rule's order; with the setting the controls step found. */
    const explain = (task: Pending): { readonly by?: Explanation; readonly alternative?: ControlState } => {
      const mended = healed();
      if (mended && metAt(mended, task)) return { by: { by: 'short', parts: nearShorts(model, situation, task.pos, shorted) } };
      if (task.browned) {
        const feeder = feederOf(situation, task.part, task.pos, task.neg, unpowered);
        return feeder === undefined ? {} : { by: { by: 'feeder', part: feeder } };
      }
      if (task.way === 'low') {
        const starver = feederOf(situation, task.part, task.pos, task.neg, brownedOut);
        if (starver !== undefined) return { by: { by: 'feeder', part: starver } };
      }
      let alternative: ControlState | undefined;
      const controls = explainByControls(graph.controls, situation.state, (state) => {
        const met = metAt(situationOf(model, settle(model, state)), task);
        if (met) alternative = state;
        return met;
      });
      if (controls && alternative) return { by: { by: 'controls', controls }, alternative };
      const feeder = feederOf(situation, task.part, task.pos, task.neg, unpowered);
      return feeder === undefined ? {} : { by: { by: 'feeder', part: feeder } };
    };
    /** Whether a kept explanation still holds now: the setting, the healed circuit or the feeder it names. */
    const holds = (entry: ExplainedNeed, task: Pending): boolean => {
      const by = entry.explainedBy;
      if (!by) return true;
      if (by.by === 'controls') return entry.alternative !== undefined && metAt(situationOf(model, settle(model, entry.alternative)), task);
      if (by.by === 'short') {
        const mended = healed();
        return mended !== undefined && metAt(mended, task);
      }
      // A browned-out driver's own need is unmet too, so it is among the unpowered.
      return feederOf(situation, task.part, task.pos, task.neg, unpowered) === by.part;
    };
    for (const task of pending) {
      const name = keyOf(task.part, task.need.id, task.way);
      let entry = known.get(name);
      // A kept explanation stands while it still holds; a kept fault while the batteries stay in their bands and
      // nothing that feeds it loses power.
      if (entry && (entry.explainedBy ? !holds(entry, task) : entry.band !== band || feederOf(situation, task.part, task.pos, task.neg, unpowered) !== undefined)) entry = undefined;
      if (!entry) {
        const { by, alternative } = explain(task);
        entry = { partId: task.part, need: task.need.id, unmet: task.way, ...(by ? { explainedBy: by } : { band }), ...(alternative ? { alternative } : {}) };
        known.set(name, entry);
        found = true;
      }
      if (entry.explainedBy) verdicts[task.index] = { ...(verdicts[task.index] as ElectricalVerdict), explainedBy: entry.explainedBy };
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
  // Only a new answer changes the state: otherwise it is handed on as it came.
  const explained =
    same && !found
      ? prior
      : {
          key,
          needs: [...known.values()].sort((p, q) => compareText(p.partId, q.partId) || compareText(p.need, q.need) || compareText(p.unmet, q.unmet)),
        };
  return { verdicts, faults, shorts, explained };
};
