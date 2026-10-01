import { RUN_SOUNDS, controlId } from '@servo/schema';
import type {
  ControlId,
  ControlState,
  EventSubject,
  FailureModeId,
  MotionPayload,
  PlacedPartId,
  PrimitiveId,
  SoundPayload,
  ValuePayload,
  WireId,
} from '@servo/schema';
import { behaviourTick, startBehaviour } from '../behaviour/index.ts';
import type { BehaviourState, BehaviourTick, PartBehaviour } from '../behaviour/index.ts';
import { initialElectricalState, solveElectrical, stepElectrical } from '../electrical/index.ts';
import type { ElectricalState, ElectricalTick, PartFlow } from '../electrical/index.ts';
import type { LiveState, WireFlow } from '../interface.ts';
import { electricalActuators, mechanicalTick, startMechanics } from '../mechanical/index.ts';
import type { ActuatorMotion, MechanicalState, MechanicalTick, PartMechanics } from '../mechanical/index.ts';
import { programTick, startProgram } from '../program/index.ts';
import type { ProgramSlotState, ProgramTick, SignalLevels } from '../program/index.ts';
import type { Models } from './models.ts';

/**
 * Everything a Run carries from one tick to the next, apart from its logs (inputs, events and faults seen), which the
 * Simulation appends to. Plain data: `snapshot.ts` writes it as bytes.
 */
export interface LoopState {
  readonly tick: number;
  readonly electrical: ElectricalState;
  readonly behaviour: BehaviourState;
  readonly program: ProgramSlotState;
  readonly mechanical: MechanicalState;
  /** Each manual switch's position as the child last set it, by control id: what the next step solves with. */
  readonly manual: Readonly<Record<ControlId, boolean>>;
  /** Each contact switch as this tick's mechanics left it, by control id: the next step's position. */
  readonly contact: Readonly<Record<ControlId, boolean>>;
  /** Each motor-driver channel's command this tick, by control id: the next electrical solve's (a signal's level reaches it a tick late). */
  readonly channels: Readonly<Record<ControlId, number>>;
  /** Each actuator's actual drive this tick, by part and primitive: the next electrical solve's back-EMF and draw. */
  readonly actuators: ReadonlyMap<PlacedPartId, Readonly<Record<PrimitiveId, ActuatorMotion>>>;
  /** Each actuator's load this tick, Infinity where held: the next behaviour tick's `loads`. */
  readonly loads: ReadonlyMap<PlacedPartId, Readonly<Record<PrimitiveId, number>>>;
  /** What the sensors sampled as this tick ended: the next program step's `samples`. None at Levels 1–2. */
  readonly samples: SignalLevels;
  /** `frame.live` at this tick. */
  readonly live: ReadonlyMap<EventSubject, LiveState>;
  /** `frame.flows` at this tick. */
  readonly flows: ReadonlyMap<WireId, WireFlow>;
}

/** One subject's readouts at a tick, before they are compared with what the last frame showed. */
export interface Readout {
  readonly values: ValuePayload;
  readonly motion?: MotionPayload;
  /** At most one of each sound, level above 0, in RUN_SOUNDS order. */
  readonly sounds: readonly SoundPayload[];
  /** Its own failure modes active now, in its record's order. */
  readonly faults: readonly FailureModeId[];
}

/** One tick solved: the next state (with the frame's live state still to fold in) and each subject's readouts. */
export interface Solved {
  readonly state: Omit<LoopState, 'live'>;
  /** In the order of `models.subjects`. */
  readonly readouts: readonly Readout[];
}

const NOTHING = new Map<never, never>();

/** The state before tick 0: every battery full, every arm at rest, each brain at its start, the world as built, every switch at rest. Needs the physics engine. */
export const startState = (models: Models): LoopState => ({
  tick: -1,
  electrical: initialElectricalState(models.electrical),
  behaviour: startBehaviour(models.behaviour),
  program: startProgram(models.program),
  mechanical: startMechanics(models.mechanical),
  manual: models.manualRest,
  contact: {},
  channels: {},
  actuators: NOTHING,
  loads: NOTHING,
  samples: NOTHING,
  live: NOTHING,
  flows: NOTHING,
});

/** Finite numbers only, with −0 as 0: a run record holds nothing else. */
const reading = (value: number | undefined): number | undefined => (value !== undefined && Number.isFinite(value) ? (value === 0 ? 0 : value) : undefined);

/** A part's readouts in ValuePayload's order: volts, milliamps and charge from the electrical solver, the rest from the behaviour runtime. */
const valuesOf = (flow: PartFlow | undefined, part: PartBehaviour | undefined): ValuePayload => {
  const values: { volts?: number; milliamps?: number; charge?: number; rpm?: number; angle?: number; light?: number; closed?: boolean } = {};
  const volts = reading(flow?.volts);
  if (volts !== undefined) values.volts = volts;
  const milliamps = reading(flow?.milliamps);
  if (milliamps !== undefined) values.milliamps = milliamps;
  const charge = reading(flow?.charge);
  if (charge !== undefined) values.charge = charge;
  const rpm = reading(part?.values.rpm);
  if (rpm !== undefined) values.rpm = rpm;
  const angle = reading(part?.values.angle);
  if (angle !== undefined) values.angle = angle;
  const light = reading(part?.values.light);
  if (light !== undefined) values.light = light;
  const closed = part?.values.closed;
  if (closed !== undefined) values.closed = closed;
  return Object.freeze(values);
};

const SILENT: readonly SoundPayload[] = Object.freeze([]);
const NO_FAULTS: readonly FailureModeId[] = Object.freeze([]);

/** The behaviour runtime's sounds (motor, hum, buzz) and the mechanics' (squeal, knock): the loudest of each, at most 1, in RUN_SOUNDS order. */
const soundsOf = (lists: readonly (readonly SoundPayload[] | undefined)[]): readonly SoundPayload[] => {
  const sounds = lists.flatMap((list) => list ?? []);
  if (sounds.length === 0) return SILENT;
  return Object.freeze(
    RUN_SOUNDS.flatMap((name) => {
      let loudest: SoundPayload | undefined;
      for (const sound of sounds) {
        const level = reading(sound.level);
        if (sound.sound !== name || level === undefined || !(level > 0)) continue;
        const capped = level > 1 ? 1 : level;
        if (loudest && capped <= loudest.level) continue;
        const hz = reading(sound.hz);
        loudest = { sound: name, level: capped, ...(hz !== undefined && hz > 0 ? { hz } : {}) };
      }
      return loudest ? [Object.freeze(loudest)] : [];
    }),
  );
};

/** The part's own failure modes that any solver makes active, in its record's order. */
const faultsOf = (order: readonly FailureModeId[], lists: readonly (readonly FailureModeId[] | undefined)[]): readonly FailureModeId[] => {
  if (lists.every((list) => list === undefined || list.length === 0)) return NO_FAULTS;
  return Object.freeze(order.filter((failure) => lists.some((list) => list?.includes(failure) === true)));
};

/**
 * Every subject's readouts at this tick: each placed part's values, sounds and faults merged from the three solvers, and
 * each body's pose. The faults merge by the schema's rule as each solver applies it: the electrical solver's power, loop
 * and isolation verdicts (the control search, with the short and feeder steps, review N10), the behaviour runtime's
 * signal, torque, drive and mount needs, and the mechanics' floor and balance needs. Each solver judges its own needs, so
 * a failure mode is active when its solver makes it so.
 */
const readoutsOf = (models: Models, electrical: ElectricalTick, behaviour: BehaviourTick, mechanics: MechanicalTick): Readout[] =>
  models.subjects.map((subject): Readout => {
    const motion = mechanics.bodies.get(subject.id);
    const part: PartBehaviour | undefined = behaviour.parts.get(subject.id);
    const mechanical: PartMechanics | undefined = mechanics.parts.get(subject.id);
    return {
      values: valuesOf(electrical.solution.parts.get(subject.id), part),
      ...(motion ? { motion } : {}),
      sounds: soundsOf([part?.sounds, mechanical?.sounds]),
      faults: faultsOf(subject.failures, [electrical.solution.faults.get(subject.id), part?.faults, mechanical?.faults]),
    };
  });

/** What flows along each power line, signal line and drive linkage this tick, in wire id order. */
const flowsOf = (models: Models, electrical: ElectricalTick, program: ProgramTick, behaviour: BehaviourTick): ReadonlyMap<WireId, WireFlow> =>
  new Map(
    models.wires.map(({ wire, kind }): [WireId, WireFlow] => {
      if (kind === 'power') return [wire, { milliamps: reading(electrical.solution.wires.get(wire)) ?? 0 }];
      if (kind === 'drive') return [wire, { rpm: reading(behaviour.drives.get(wire)) ?? 0 }];
      const signal = reading(program.lines.get(wire));
      return [wire, signal === undefined ? {} : { signal }];
    }),
  );

/** Each motor-driver channel's command this tick, by control id in id order: a driven signal's level, otherwise its setting. */
const commandsOf = (behaviour: BehaviourTick): Record<ControlId, number> => {
  const channels: Record<ControlId, number> = {};
  for (const part of behaviour.parts.values()) {
    for (const output of part.primitives) if (output.kind === 'driver') channels[controlId(part.id, output.primitive)] = output.command;
  }
  return channels;
};

/**
 * The last step of a tick: the sensors sample the arena where this tick left it, for the brains to read next tick. No
 * Level 1–2 part has a sensor primitive (the schema's vocabulary has none yet), so nothing is sampled; Level 3 fills this
 * step and the loop's order stays as it is.
 */
const sampleSensors = (): SignalLevels => NOTHING;

/**
 * One tick of a Run, in the order brief Section 6 gives:
 * 1. controls: the child's manual switches as they stand (an input made at the last tick applies now), and each contact
 *    switch as the last tick's mechanics left it;
 * 2. the electrical solver, with each actuator's back-EMF and draw from the last tick (tick 0 solves with no time passing);
 * 3. the program slot: each powered brain, reading what the sensors sampled as the last tick ended;
 * 4. the behaviour runtime, with the loads the last tick's mechanics gave;
 * 5. the mechanical solver;
 * 6. sensor sampling (none at Levels 1–2).
 * Pure in its results: the same models, state and tick give the same answer. Only the solvers' own caches change, and they
 * are keyed by what decides their value.
 */
export const solveTick = (models: Models, state: LoopState, tick: number): Solved => {
  const switches = { ...state.contact, ...state.manual };
  const controls: ControlState = { switches, channels: state.channels };
  const first = tick === 0;
  const electrical = (first ? solveElectrical : stepElectrical)(models.electrical, state.electrical, {
    controls,
    actuators: electricalActuators(models.graph.uses, state.actuators),
  });
  const power = electrical.solution.parts;
  const program = programTick(models.program, state.program, { tick, power, samples: state.samples });
  // Channels left out: a channel takes this tick's signal, or else its setting (the behaviour runtime's rule).
  const behaviour = behaviourTick(models.behaviour, state.behaviour, {
    power,
    controls: { switches },
    signals: program.signals,
    loads: state.loads,
    ...(first ? { seconds: 0 } : {}),
  });
  const mechanics = mechanicalTick(models.mechanical, state.mechanical, { behaviour, ...(first ? { seconds: 0 } : {}) });
  return {
    state: {
      tick,
      electrical: electrical.state,
      behaviour: behaviour.state,
      program: program.state,
      mechanical: mechanics.state,
      manual: state.manual,
      contact: mechanics.switches,
      channels: commandsOf(behaviour),
      actuators: mechanics.actuators,
      loads: mechanics.loads,
      samples: sampleSensors(),
      flows: flowsOf(models, electrical, program, behaviour),
    },
    readouts: readoutsOf(models, electrical, behaviour, mechanics),
  };
};
