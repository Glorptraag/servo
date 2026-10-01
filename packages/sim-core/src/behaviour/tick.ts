import { RUN_SOUNDS, TICK_RATE, controlId } from '@servo/schema';
import type { FailureModeId, Need, PlacedPartId, PortId, PositionActuator, Primitive, RunSound, SoundPayload, WireId } from '@servo/schema';
import { effectsOf } from './effects.ts';
import {
  FLOWING_MILLIAMPS,
  channelCommand,
  clean,
  loadLevel,
  magnitude,
  positionRule,
  ratedSweep,
  regulating,
  signalLevel,
  speedRule,
  switchedOn,
} from './primitives.ts';
import type {
  BehaviourInputs,
  BehaviourModel,
  BehaviourPart,
  BehaviourState,
  BehaviourTick,
  BehaviourValues,
  BehaviourVerdict,
  PartBehaviour,
  PositionOutput,
  PrimitiveOutput,
  PrimitiveRef,
  SpeedOutput,
} from './types.ts';

const finite = (value: number | undefined): number => (value !== undefined && Number.isFinite(value) ? value : 0);

const refKey = (part: PlacedPartId, primitive: string): string => `${part}/${primitive}`;

const armSpec = (model: BehaviourModel, arm: PrimitiveRef): PositionActuator | undefined => {
  const spec = model.parts.find((part) => part.id === arm.part)?.primitives.find((each) => each.id === arm.primitive);
  return spec?.kind === 'actuator' && spec.mode === 'position' ? spec : undefined;
};

/** The state a Run starts from: every arm at its `restDeg`. */
export const startBehaviour = (model: BehaviourModel): BehaviourState => ({
  arms: model.arms.map((arm) => armSpec(model, arm)?.restDeg ?? 0),
});

/** What one part's ports read this tick. */
interface Reader {
  /** Volts across a pair of ports: the first's net volts less the second's. */
  readonly across: (pos: PortId, neg: PortId) => number;
  /** Whether current flows through either of two ports. */
  readonly flowing: (a: PortId, b: PortId) => boolean;
  readonly level: (port: PortId) => number | undefined;
  readonly load: (primitive: string) => number;
}

const readerOf = (inputs: BehaviourInputs, part: PlacedPartId): Reader => {
  const ports = inputs.power?.get(part)?.ports;
  const levels = inputs.signals?.get(part);
  const loads = inputs.loads?.get(part);
  const flows = (port: PortId): boolean => magnitude(finite(ports?.get(port)?.milliamps)) > FLOWING_MILLIAMPS;
  return {
    across: (pos, neg) => finite(ports?.get(pos)?.volts) - finite(ports?.get(neg)?.volts),
    flowing: (a, b) => flows(a) || flows(b),
    level: (port) => signalLevel(levels?.[port]),
    // A wall can resist without limit, so an infinite load stalls the actuator; NaN reads as no load.
    load: (primitive) => {
      const load = loads?.[primitive];
      return load !== undefined && load > 0 ? load : 0;
    },
  };
};

/** Everything the actuators do this tick, run first so the gearboxes and wheels they drive can follow. */
interface Actuators {
  readonly outputs: ReadonlyMap<string, SpeedOutput | PositionOutput>;
  /** Each actuator's drive speed, rpm, by `part/primitive`. */
  readonly turning: ReadonlyMap<string, number>;
  readonly arms: readonly number[];
}

const runActuators = (model: BehaviourModel, state: BehaviourState, readers: ReadonlyMap<PlacedPartId, Reader>, seconds: number): Actuators => {
  const outputs = new Map<string, SpeedOutput | PositionOutput>();
  const turning = new Map<string, number>();
  const arms = model.arms.map((arm, index) => state.arms[index] ?? armSpec(model, arm)?.restDeg ?? 0);
  const armIndex = new Map(model.arms.map((arm, index) => [refKey(arm.part, arm.primitive), index]));
  for (const part of model.parts) {
    const reader = readers.get(part.id) as Reader;
    for (const spec of part.primitives) {
      if (spec.kind !== 'actuator') continue;
      const key = refKey(part.id, spec.id);
      const volts = reader.across(spec.supply.pos, spec.supply.neg);
      const load = reader.load(spec.id);
      if (spec.mode === 'speed') {
        const rule = speedRule(spec, volts, load);
        turning.set(key, rule.rpm);
        outputs.set(key, {
          kind: 'actuator',
          mode: 'speed',
          primitive: spec.id,
          volts,
          state: rule.state,
          rpm: clean(rule.rpm),
          ratedRpm: clean(speedRule(spec, spec.ratedVolts, load).rpm),
          reversed: rule.reversed,
          capacityNmm: rule.capacityNmm,
          working: rule.state !== 'idle',
        });
        continue;
      }
      const index = armIndex.get(key) ?? -1;
      const angle = arms[index] ?? spec.restDeg;
      const rule = positionRule(spec, angle, volts, reader.level(spec.command), load, seconds);
      const next = clean(rule.angle);
      if (index >= 0) arms[index] = next;
      const rpm = seconds > 0 ? clean((next - angle) / seconds / 6) : 0;
      turning.set(key, rpm);
      outputs.set(key, {
        kind: 'actuator',
        mode: 'position',
        primitive: spec.id,
        volts,
        state: rule.state,
        angle: next,
        ...(rule.commanded === undefined ? {} : { commanded: rule.commanded }),
        sweep: rule.sweep,
        ratedSweep: ratedSweep(spec, load),
        rpm,
        capacityNmm: rule.capacityNmm,
        working: rule.state !== 'idle',
      });
    }
  }
  return { outputs, turning, arms };
};

/** A drive port's speed now: the speed of the actuator its route starts at, scaled through the gearboxes. */
const rpmAt = (part: BehaviourPart, port: PortId, turning: ReadonlyMap<string, number>): number => {
  const route = part.routes.get(port);
  return route ? clean(route.speed * (turning.get(refKey(route.part, route.primitive)) ?? 0)) : 0;
};

/** One primitive's output this tick, by its kind. */
const outputOf = (
  part: BehaviourPart,
  spec: Primitive,
  reader: Reader,
  inputs: BehaviourInputs,
  rest: ReadonlyMap<string, boolean | number>,
  actuators: Actuators,
): PrimitiveOutput => {
  switch (spec.kind) {
    case 'source':
      return { kind: 'source', primitive: spec.id, working: reader.flowing(spec.output.pos, spec.output.neg) };
    case 'switch': {
      const id = controlId(part.id, spec.id);
      const closed = (inputs.controls?.switches?.[id] ?? rest.get(id)) === true;
      return { kind: 'switch', primitive: spec.id, closed, working: reader.flowing(spec.terminals[0], spec.terminals[1]) };
    }
    case 'load': {
      const volts = reader.across(spec.supply.pos, spec.supply.neg);
      const level = loadLevel(spec, volts);
      const emits = spec.emits;
      return {
        kind: 'load',
        primitive: spec.id,
        volts,
        level,
        working: level > 0,
        ...(emits?.kind === 'light' ? { emits: 'light' as const, colour: emits.colour } : {}),
        ...(emits?.kind === 'sound' ? { emits: 'sound' as const, hz: emits.hz } : {}),
      };
    }
    case 'actuator':
      return actuators.outputs.get(refKey(part.id, spec.id)) as SpeedOutput | PositionOutput;
    case 'driver': {
      const volts = reader.across(spec.supply.pos, spec.supply.neg);
      const id = controlId(part.id, spec.id);
      const setting = inputs.controls?.channels?.[id] ?? rest.get(id);
      const level = spec.signal === undefined ? undefined : reader.level(spec.signal);
      const command = clean(channelCommand(level, typeof setting === 'number' ? setting : spec.command));
      return { kind: 'driver', primitive: spec.id, volts, command, working: switchedOn(spec, volts) };
    }
    case 'regulator': {
      const volts = reader.across(spec.supply.pos, spec.supply.neg);
      return { kind: 'regulator', primitive: spec.id, volts, working: regulating(spec, volts) };
    }
    case 'program': {
      const volts = reader.across(spec.supply.pos, spec.supply.neg);
      return { kind: 'program', primitive: spec.id, volts, working: switchedOn(spec, volts) };
    }
    case 'ratio':
      return { kind: 'ratio', primitive: spec.id, rpm: rpmAt(part, spec.output, actuators.turning), driven: part.linked.has(spec.input), fixed: part.fixed.has(spec.mount) };
    case 'wheel':
      return { kind: 'wheel', primitive: spec.id, rpm: rpmAt(part, spec.hub, actuators.turning), driven: part.linked.has(spec.hub) };
    case 'support':
      return { kind: 'support', primitive: spec.id, fixed: part.fixed.has(spec.mount) };
  }
};

const capped = (level: number): number => (level > 1 ? 1 : level);

/** The sounds a primitive makes now, before a part's sounds are merged. */
const soundsOf = (spec: Primitive, output: PrimitiveOutput): SoundPayload[] => {
  if (spec.kind === 'actuator' && spec.mode === 'speed' && output.kind === 'actuator' && output.mode === 'speed') {
    if (output.state === 'turning') return [{ sound: 'motor', level: capped(magnitude(output.rpm) / spec.noLoadRpm) }];
    if (output.state === 'stalled') return [{ sound: 'hum', level: capped(magnitude(spec.throttle * output.volts) / spec.ratedVolts) }];
  }
  if (spec.kind === 'actuator' && spec.mode === 'position' && output.kind === 'actuator' && output.mode === 'position') {
    if (output.state === 'sweeping') return [{ sound: 'motor', level: capped(output.sweep / spec.degPerSecond) }];
    if (output.state === 'holding' || output.state === 'stalled') return [{ sound: 'hum', level: capped(output.volts / spec.ratedVolts) }];
  }
  if (output.kind === 'load' && output.emits === 'sound' && output.level > 0) {
    return [{ sound: 'buzz', level: output.level, ...(output.hz === undefined ? {} : { hz: output.hz }) }];
  }
  return [];
};

/** At most one of each sound, the loudest (the first on a tie), in RUN_SOUNDS order. */
const mergeSounds = (sounds: readonly SoundPayload[]): readonly SoundPayload[] => {
  const loudest = new Map<RunSound, SoundPayload>();
  for (const sound of sounds) {
    const known = loudest.get(sound.sound);
    if (sound.level > 0 && (!known || sound.level > known.level)) loudest.set(sound.sound, sound);
  }
  return RUN_SOUNDS.flatMap((name) => {
    const sound = loudest.get(name);
    return sound ? [sound] : [];
  });
};

/** A drive's speed for the readouts: a speed actuator's shaft, a gearbox's output or a wheel's hub. */
const driveRpm = (output: PrimitiveOutput): number | undefined =>
  (output.kind === 'actuator' && output.mode === 'speed') || output.kind === 'ratio' || output.kind === 'wheel' ? output.rpm : undefined;

const valuesOf = (outputs: readonly PrimitiveOutput[]): BehaviourValues => {
  const rpm = outputs.map(driveRpm).find((each) => each !== undefined);
  const arm = outputs.find((output): output is PositionOutput => output.kind === 'actuator' && output.mode === 'position');
  const light = outputs.find((output) => output.kind === 'load' && output.emits === 'light');
  const closed = outputs.find((output) => output.kind === 'switch');
  return {
    ...(rpm === undefined ? {} : { rpm }),
    ...(arm ? { angle: arm.angle } : {}),
    ...(light?.kind === 'load' ? { light: light.level } : {}),
    ...(closed?.kind === 'switch' ? { closed: closed.closed } : {}),
  };
};

/** The index of the primitive that reads a signal in, or −1. */
const signalReader = (primitives: readonly Primitive[], port: PortId): number =>
  primitives.findIndex(
    (spec) =>
      (spec.kind === 'actuator' && spec.mode === 'position' && spec.command === port) ||
      (spec.kind === 'driver' && spec.signal === port) ||
      (spec.kind === 'program' && spec.inputs.includes(port)),
  );

/** Whether a primitive that gives, carries or takes power has it now. */
const hasPower = (output: PrimitiveOutput | undefined): boolean =>
  output !== undefined && output.kind !== 'ratio' && output.kind !== 'wheel' && output.kind !== 'support' && output.working;

/**
 * The needs judged on behaviour, in the record's order. A signal need is judged only while the primitive that
 * reads it has power, and a torque need only while its actuator is driven: without power the part shows its power
 * need's failure instead. Drive and mount needs are the graph's: a linked drive-in, a fixed mount.
 */
const verdictsOf = (part: BehaviourPart, outputs: readonly PrimitiveOutput[], reader: Reader): BehaviourVerdict[] =>
  part.record.needs.flatMap((need: Need): BehaviourVerdict[] => {
    switch (need.kind) {
      case 'signal': {
        const index = signalReader(part.primitives, need.port);
        const judged = index === -1 || hasPower(outputs[index]);
        return [{ need: need.id, kind: 'signal', ...(judged && reader.level(need.port) === undefined ? { unmet: 'absent' as const } : {}) }];
      }
      case 'torque': {
        const user = outputs[part.primitives.findIndex((spec) => spec.kind === 'actuator' && spec.drive === need.port)];
        return [{ need: need.id, kind: 'torque', ...(user?.kind === 'actuator' && user.state === 'stalled' ? { unmet: 'exceeded' as const } : {}) }];
      }
      case 'drive':
        return [{ need: need.id, kind: 'drive', ...(part.linked.has(need.port) ? {} : { unmet: 'absent' as const }) }];
      case 'mount':
        return [{ need: need.id, kind: 'mount', ...(part.fixed.has(need.port) ? {} : { unmet: 'absent' as const }) }];
      default:
        return [];
    }
  });

const faultsOf = (part: BehaviourPart, verdicts: readonly BehaviourVerdict[]): FailureModeId[] =>
  part.record.failureModes.filter((mode) => verdicts.some((verdict) => verdict.need === mode.need && verdict.unmet === mode.unmet)).map((mode) => mode.id);

/**
 * One tick of the behaviour runtime. Each part's primitives run by kind from their parameters: the actuators
 * first, turning this tick's port volts, signal levels and loads into shaft speeds and arm angles; then every
 * other primitive, with gearboxes and wheels turning as the actuators that drive them. Then each part's readouts,
 * sounds, needs, active failure modes and effects follow. Pure and deterministic: parts in id order, primitives
 * in the record's order, and plain arithmetic.
 */
export const behaviourTick = (model: BehaviourModel, state: BehaviourState, inputs: BehaviourInputs = {}): BehaviourTick => {
  const given = finite(inputs.seconds);
  const seconds = inputs.seconds === undefined ? 1 / TICK_RATE : given > 0 ? given : 0;
  const rest = new Map(model.graph.controls.map((control) => [control.id, control.rest]));
  const readers = new Map(model.parts.map((part) => [part.id, readerOf(inputs, part.id)]));
  const actuators = runActuators(model, state, readers, seconds);

  const parts = new Map<PlacedPartId, PartBehaviour>();
  for (const part of model.parts) {
    const reader = readers.get(part.id) as Reader;
    const outputs = part.primitives.map((spec) => outputOf(part, spec, reader, inputs, rest, actuators));
    const sounds = mergeSounds(part.primitives.flatMap((spec, index) => soundsOf(spec, outputs[index] as PrimitiveOutput)));
    const needs = verdictsOf(part, outputs, reader);
    parts.set(part.id, { id: part.id, values: valuesOf(outputs), sounds, primitives: outputs, needs, faults: faultsOf(part, needs), effects: effectsOf(outputs, sounds) });
  }

  const byId = new Map(model.parts.map((part) => [part.id, part]));
  const drives = new Map<WireId, number>();
  for (const link of model.graph.drives) {
    const from = byId.get(link.from.part);
    drives.set(link.wire, from ? rpmAt(from, link.from.port, actuators.turning) : 0);
  }
  return { parts, drives, state: { arms: actuators.arms } };
};
