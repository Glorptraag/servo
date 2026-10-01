import type { ControlState, Explanation, FailureModeId, NeedId, PlacedPartId, PortId, WireId } from '@servo/schema';
import type { LiveNets, SimGraph } from '../graph/index.ts';

/**
 * The electrical solver's view of one graph, made once per Run by `electricalModel`. It holds the graph and
 * the solver's own lookups and caches; every cache is keyed by what decides its value, so a model gives the
 * same answers whatever was asked of it before. See docs/electrical.md.
 */
export interface ElectricalModel {
  readonly graph: SimGraph;
}

/** What one actuator did last tick, as the behaviour runtime and the mechanical solver left it. Missing fields are 0. */
export interface ActuatorState {
  /** How fast its drive turned, rpm, signed as the shaft turns: positive is right-handed about the drive's axis. */
  readonly rpm?: number;
  /** The torque its drive gave against what it turns, N·mm. A position actuator's draw rises with it. */
  readonly loadNmm?: number;
}

/** What one tick of the electrical solver reads beside its state. */
export interface ElectricalInputs {
  /** Switch positions and driver-channel commands now, as the schema's ControlState. A control left out sits at rest. */
  readonly controls?: ControlState;
  /** Each actuator's state last tick, indexed like `graph.uses`. Other uses, and missing entries, are at rest. */
  readonly actuators?: readonly (ActuatorState | undefined)[];
}

/** An unmet power need that only the voltages show, and why it is not a fault, as found under one key. */
export interface ExplainedNeed {
  readonly partId: PlacedPartId;
  readonly need: NeedId;
  readonly unmet: VoltageWay;
  /** Absent when nothing explains it: then it is a fault. */
  readonly explainedBy?: Explanation;
  /** For an explanation by the controls: the setting that meets the need, so the answer can be checked each tick. */
  readonly alternative?: ControlState;
  /** For a fault (nothing explains it): the batteries' charge bands it was found in, as a key the solver makes. */
  readonly band?: string;
}

/**
 * What the solver carries from one tick to the next. Plain data in a fixed order, so a snapshot of it gives
 * equal bytes for equal states (task 1.5 keeps it in the Run's snapshot).
 */
export interface ElectricalState {
  /** Each source's charge left, 0–1, indexed like `graph.sources`. A driver channel's or regulator's output stays at 1. */
  readonly charge: readonly number[];
  /**
   * The answers already found for needs the voltages leave unmet, under `key`: the control state and which
   * motor drivers brown out. A kept explanation is checked again every tick and searched again when it no longer
   * holds; a kept fault is searched again when a battery's charge enters another band, 5% wide, or when a
   * motor driver or regulator that feeds it loses power; a new key starts afresh.
   */
  readonly explained: { readonly key: string; readonly needs: readonly ExplainedNeed[] };
}

/** The ways only the voltages show. The wiring decides `open` and `shorted` (the schema's `wiredNeeds`). */
export type VoltageWay = 'low' | 'high' | 'reversed';

/** One battery, or one driver channel's or regulator's output. */
export interface SourceFlow {
  /**
   * Its open-circuit volts now: a battery's falls from `volts` to `emptyVolts` with its charge; an output's follows
   * its supply, signed the way it drives, and is 0 when it has nothing to give.
   */
  readonly emfVolts: number;
  /** Volts between its + and − ports. */
  readonly volts: number;
  /** Current out of its + port into the circuit. */
  readonly milliamps: number;
  /** How far it sags under load: `emfVolts − volts`, which is current × internalOhms for a battery. */
  readonly sagVolts: number;
  /** Its charge, 0–1, when the tick began. Always 1 for an output. */
  readonly charge: number;
  /** Whether it gives power now: a battery with charge left, or an output that is on with volts to give. */
  readonly giving: boolean;
  /**
   * A motor driver channel's duty: the share of the time it is on. Below 1 while its driver browns out (its
   * supply would sag below onVolts), as the lumped average of the stutter a real one makes. 1 for any other source.
   */
  readonly duty: number;
}

/** One use: a load, an actuator, a program, or a driver's or regulator's supply. */
export interface UseFlow {
  /** Volts across its supply, + port minus − port. */
  readonly volts: number;
  /** Current into its + port. A driver's or regulator's supply includes what its output passes on. */
  readonly milliamps: number;
}

/** One power port. */
export interface PortFlow {
  /** Its net's volts, measured from its circuit's reference net (see `ElectricalSolution.netVolts`). */
  readonly volts: number;
  /** Current from the net into the part through this port. */
  readonly milliamps: number;
}

/** One placed part, read the way the schema's ValuePayload reads. Parts without power ports have empty `ports`. */
export interface PartFlow {
  /** Across a battery's terminals, a part's first supply, or a switch's terminals. */
  readonly volts?: number;
  /** Out of a battery's +, into a part's first supply, or through a switch from its first terminal to its second. */
  readonly milliamps?: number;
  /** A battery's charge, 0–1, when the tick began. */
  readonly charge?: number;
  readonly ports: ReadonlyMap<PortId, PortFlow>;
}

/** A power, loop or isolation need judged on the wiring and the voltages, by the schema's rule. */
export interface ElectricalVerdict {
  readonly partId: PlacedPartId;
  readonly need: NeedId;
  readonly kind: 'power' | 'loop' | 'isolation';
  /** `open` and `shorted` come from the wiring; `low`, `high` and `reversed` from the voltages. */
  readonly unmet?: 'open' | 'shorted' | VoltageWay;
  /** Why an unmet need is not a fault. An unmet need without it is a fault; a short never has one. */
  readonly explainedBy?: Explanation;
}

/** A part with a short circuit through it (its isolation need is unmet). */
export interface ShortCircuit {
  readonly partId: PlacedPartId;
  readonly need: NeedId;
}

/** Everything one tick of the electrical solver gives. Arrays are indexed like the graph's lists. */
export interface ElectricalSolution {
  /** The control state it was solved at, with every control written out (commands clamped to −1..1, NaN read as stop). */
  readonly controls: ControlState;
  /** The graph's live state at those controls (`liveAt`). */
  readonly live: LiveNets;
  /**
   * Volts on each net. Each separate circuit is measured from one reference net at 0 V: the − net of its first
   * source in graph order, or its first net when it has no source. A net that nothing drives reads 0.
   */
  readonly netVolts: readonly number[];
  readonly sources: readonly SourceFlow[];
  readonly uses: readonly UseFlow[];
  /** Current through each switch from its first terminal to its second; 0 while it is open. */
  readonly switches: readonly number[];
  /** Current along each power line from its `from` port to its `to` port, in wire id order. */
  readonly wires: ReadonlyMap<WireId, number>;
  /** Every placed part, in id order. */
  readonly parts: ReadonlyMap<PlacedPartId, PartFlow>;
  /** Parts on a short circuit, in id order. */
  readonly shorts: readonly ShortCircuit[];
  /** Every power, loop and isolation need, in part id order and then the record's need order. */
  readonly verdicts: readonly ElectricalVerdict[];
  /** Each part's own failure modes active now from those needs, in the record's order. Parts with none are left out. */
  readonly faults: ReadonlyMap<PlacedPartId, readonly FailureModeId[]>;
  /** How many linear solves the tick's operating point took, and whether it settled (it always has, so far). */
  readonly iterations: number;
  readonly settled: boolean;
}

/** A tick's answer and the state for the next tick. */
export interface ElectricalTick {
  readonly solution: ElectricalSolution;
  readonly state: ElectricalState;
}
