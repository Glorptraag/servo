// @servo/sim-core/interface: the contract the app, the canvas and tools build against (task 0.4).
// Types only. The canvas imports this file and nothing else from sim-core, so it never imports sim-core's
// internals or the physics engine. `createSimulation` is exported from '@servo/sim-core' (src/index.ts,
// task 1.5) with the `CreateSimulation` type below. See packages/sim-core/README.md.

import type {
  ArenaPreset,
  Blueprint,
  Catalogue,
  ChallengeId,
  EventSubject,
  FailureModeId,
  HintUse,
  Issue,
  MotionPayload,
  PlacedPartId,
  PortId,
  PrimitiveId,
  ProfileId,
  RunEvent,
  RunId,
  RunInput,
  RunRecord,
  SoundPayload,
  Timestamp,
  ValuePayload,
  WireId,
} from '@servo/schema';

/** What a Run needs. Same blueprint, catalogue, arena, seed, inputs and program give the same run, tick for tick (ground rule 2). */
export interface SimulationOptions {
  /**
   * The build to run. It is validated against `catalogue` (validateBlueprint) and copied in canonical form:
   * the Run reads that snapshot and never writes back (ground rule 4). The caller's object is never touched.
   */
  readonly blueprint: Blueprint;
  /** The part records the blueprint uses: the schema's `makeCatalogue` result, passed in. sim-core never imports content. */
  readonly catalogue: Catalogue;
  /** The arena preset that `blueprint.arena.preset` names. The props the child added come from `blueprint.arena.props`. */
  readonly arena: ArenaPreset;
  /** Unsigned 32-bit, recorded in the run record. The run's only source of chance. */
  readonly seed: number;
  /**
   * The brain's program slot (Level 3). Omitted, every brain is the v1 no-op: it runs no rules and drives no
   * outputs, so a servo motor on a brain's output gets no signal (D41).
   */
  readonly program?: ProgramRuntime;
}

/**
 * Builds the wired graph, solves tick 0 and resolves with a Simulation at tick 0. Asynchronous so the physics
 * engine's WebAssembly can initialise on the first call (D11: loaded at the first Run, not at start-up).
 * Rejects with a SimulationSetupError when the blueprint or arena does not validate, or the arena is not the
 * one the blueprint names. A legal build always simulates, however wrong it is: its failure is the lesson.
 */
export type CreateSimulation = (options: SimulationOptions) => Promise<Simulation>;

/** Why createSimulation refused its inputs: every issue, as the schema's validators report them. */
export interface SimulationSetupError extends Error {
  readonly name: 'SimulationSetupError';
  readonly issues: readonly Issue[];
}

/**
 * One Run in progress. The caller steps it; it never reads the wall clock. Each tick is 1/30 s of simulated
 * time (the schema's TICK_RATE). How fast ticks play (1–30 a second) and the one-second spin-up are the app's
 * clock, never sim-core's.
 */
export interface Simulation {
  /** The canonical blueprint snapshot this Run reads. It never changes. */
  readonly blueprint: Blueprint;
  readonly seed: number;
  /** Ticks simulated so far: 0 before the first step. */
  readonly tick: number;
  /** The frame for the current tick. At tick 0 it holds every subject's starting state, so the wires can light before anything moves. */
  readonly frame: RunFrame;
  /**
   * Advances one tick and returns its frame. Inputs made at the previous tick apply first; then the solvers run
   * in order: electrical (power nets and battery drain), program (brain rules, reading the sensor samples of the
   * previous tick), mechanical (drive, collisions, tipping); last, sensors sample the arena. Never throws for a
   * build validateBlueprint accepts.
   */
  step(): RunFrame;
  /**
   * A child's control during the Run: flipping a manual switch. It is recorded as a RunInput with the current
   * tick and takes effect in the next step. Returns false, and records nothing, when the part has no manual
   * switch or the switch is already that way. Faults follow the schema's rule (packages/schema/docs/parts.md):
   * what a flip leaves unmet is behaviour, while a short it closes is a fault for as long as it lasts.
   */
  input(control: ControlInput): boolean;
  /** The whole state at the current tick: solvers, physics world, chance, program states, inputs and the events so far. */
  snapshot(): SimSnapshot;
  /**
   * Returns to exactly the state `snapshot` holds, and that tick's frame. The app snapshots at tick 0 and
   * restores on Stop, so the next Run of an unchanged build starts from the identical state. Throws when the
   * snapshot came from another Simulation.
   */
  restore(snapshot: SimSnapshot): RunFrame;
  /** The run record of the ticks so far, built with the schema's RunRecord. */
  record(context: RunRecordContext): RunRecord;
  /** Frees the physics world. The Simulation cannot be used afterwards. */
  dispose(): void;
}

/** What one tick gives the app (spec card, sound, challenge runner) and the canvas (`applyRunFrame`). */
export interface RunFrame {
  readonly tick: number;
  /**
   * What changed, started or stopped at this tick, as the schema's RunEvent, each with this frame's tick. Tick 0's
   * events give every subject's starting values and pose. The order within a tick is fixed by sim-core (task 1.5
   * documents it) and never depends on wire order, insertion order or the platform.
   */
  readonly events: readonly RunEvent[];
  /**
   * Every subject's state at this tick, exactly what folding every event from tick 0 gives: one entry per placed
   * part and per prop (`arena:<propId>`). The spec card's live readouts come from here.
   */
  readonly live: ReadonlyMap<EventSubject, LiveState>;
  /** What flows along each power line, signal line and drive linkage at this tick, for the canvas's moving dots and wire labels. Not recorded: a replay recomputes it. */
  readonly flows: ReadonlyMap<WireId, WireFlow>;
}

/** One subject's state now. */
export interface LiveState {
  /** The latest value of every readout the part reports (volts, milliamps, charge, rpm, angle, light, signal, closed). */
  readonly values: ValuePayload;
  /**
   * A body's pose on the arena floor. Bodies are the robot's root part (schema `robotRoot`), loose parts and
   * props. Parts fixed to or carried by a body have no motion of their own: they ride with it, placed by the
   * schema's `placeParts`.
   */
  readonly motion?: MotionPayload;
  /** Machine sounds playing now (level above 0), at most one of each sound. */
  readonly sounds: readonly SoundPayload[];
  /** The part's own failure modes active now, in the part record's order. */
  readonly faults: readonly FailureModeId[];
}

/** Flow along one wire. Only the field for the wire's kind is present. Mounts carry nothing and have no entry. */
export interface WireFlow {
  /** Power line: current along it, positive from the wire's `from` port to its `to` port. */
  readonly milliamps?: number;
  /** Signal line: the level it carries, 0–1. */
  readonly signal?: number;
  /** Drive linkage: how fast it turns, signed as its drive-out turns. */
  readonly rpm?: number;
}

/** A child's control, as the run record keeps it without its tick: `{ partId, kind: 'switch', closed }`. */
export type ControlInput = Omit<RunInput, 'tick'>;

/** Opaque. Equal states give equal bytes, so Stop's restore can be proved byte for byte. */
export interface SimSnapshot {
  readonly tick: number;
  readonly bytes: Uint8Array;
}

/** What only the app knows when it records a Run: identity, wall-clock times, the challenge's verdict and hint use. */
export interface RunRecordContext {
  /** A UUID v4 the app generates. */
  readonly id: RunId;
  /** Wall-clock times from the app, as toISOString writes them. */
  readonly startedAt: Timestamp;
  readonly endedAt: Timestamp;
  /** This Run's place, from 1, among the child's Runs of this challenge, or of this blueprint in the sandbox. */
  readonly runNumber: number;
  readonly profile?: ProfileId;
  readonly challenge?: ChallengeId;
  /** The challenge runner's verdict on this Run; only with `challenge`. */
  readonly goal?: { readonly met: boolean; readonly tick?: number };
  /** Hint steps used since the previous Run. */
  readonly hints: readonly HintUse[];
  /**
   * The previous Run of the same challenge, or of the same blueprint in the sandbox. Gives `fixed`: each of its
   * faults this Run did not show, with the build changes since that touch the faulted part, its ports or its wires (D31).
   */
  readonly previous?: RunRecord;
  /** 'drop' records a summary without `events`. Default 'keep'. */
  readonly events?: 'keep' | 'drop';
}

/**
 * The brain's program slot: the block-rule interface Level 3 fills (task 1.6 documents it; the rule vocabulary is
 * Level 3's). Each tick, for each part with a `program` primitive whose supply is at or above its `onVolts`, the
 * loop calls `run` after the electrical solver and before the mechanical solver. A brain's variables and timers
 * live in its ProgramState, which the loop holds between ticks and keeps in snapshots, so a Run replays and
 * restores exactly. Both methods must be pure: the same brain gives the same start, and the same tick and state
 * give the same step.
 */
export interface ProgramRuntime {
  /** A brain's state as a Run starts. */
  start(brain: BrainInfo): ProgramState;
  run(tick: BrainTick, state: ProgramState): BrainStep;
}

/**
 * Plain JSON, so a snapshot can hold it. The loop writes each state with the schema's `canonicalJson` (keys in
 * code-unit order), so equal states give equal bytes however their keys were ordered.
 */
export type ProgramState = null | boolean | number | string | readonly ProgramState[] | { readonly [key: string]: ProgramState };

export interface BrainInfo {
  readonly partId: PlacedPartId;
  /** The part's `program` primitive. */
  readonly primitive: PrimitiveId;
}

export interface BrainTick extends BrainInfo {
  readonly tick: number;
  /** The level, 0–1, on each of the primitive's inputs, as sampled at the end of the previous tick. An input nothing drives is absent. */
  readonly inputs: Readonly<Record<PortId, number>>;
}

export interface BrainStep {
  /** The level, 0–1, to drive on each of the primitive's outputs this tick. An output left out carries no signal. */
  readonly outputs: Readonly<Record<PortId, number>>;
  /** The state for the next tick. */
  readonly state: ProgramState;
}
