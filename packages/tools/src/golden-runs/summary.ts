// The per-tick summary a golden file keeps: each subject's readouts, pose, sounds and faults at one tick, from
// `frame.live`, as text rounded to a fixed precision per field. Rounding keeps the files small and their diffs about
// real changes; each tick's hash and the run record's hash in the same file catch whatever the rounding hides.
import { RUN_SOUNDS } from '@servo/schema';
import type { EventSubject, MotionPayload, SoundPayload, ValuePayload } from '@servo/schema';
import type { LiveState, WireFlow } from '@servo/sim-core';

/** One subject's summarized state: field name to text, in FIELD_ORDER. A field that is absent is silent or has no fault. */
export type SubjectState = ReadonlyMap<string, string>;

/** Every subject's summarized state at one tick, in `frame.live`'s order: placed parts by id, then props. */
export type TickState = ReadonlyMap<EventSubject, SubjectState>;

/** Written for a sound that stopped or a fault list that emptied, so a line can say a field went away. */
export const NONE = 'none';

/** Decimal places kept for each number: millivolts, tenths of a milliamp, tenths of a millimetre, hundredths of a degree. */
export const PRECISION: Readonly<Record<string, number>> = {
  volts: 3,
  milliamps: 1,
  charge: 4,
  rpm: 1,
  angle: 1,
  light: 3,
  signal: 3,
  x: 1,
  y: 1,
  heading: 2,
  pitch: 2,
  roll: 2,
  sound: 3,
};

const VALUE_FIELDS = ['volts', 'milliamps', 'charge', 'rpm', 'angle', 'light', 'signal', 'closed'] as const satisfies readonly (keyof ValuePayload)[];
const MOTION_FIELDS = ['x', 'y', 'heading', 'pitch', 'roll'] as const satisfies readonly (keyof MotionPayload)[];

/** The order of a subject's fields on a line: readouts in ValuePayload's order, the pose, sounds in RUN_SOUNDS order, faults. */
export const FIELD_ORDER: readonly string[] = [...VALUE_FIELDS, ...MOTION_FIELDS, ...RUN_SOUNDS.map((sound) => `sound.${sound}`), 'faults'];

/** A number to `decimals` places, trailing zeros dropped, never `-0`. toFixed rounds the same way on every engine. */
export const formatNumber = (value: number, decimals: number): string => {
  if (!Number.isFinite(value)) return String(value);
  const text = value.toFixed(decimals);
  const trimmed = text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
  return trimmed === '-0' ? '0' : trimmed;
};

const soundText = (sound: SoundPayload): string =>
  `${formatNumber(sound.level, PRECISION.sound ?? 3)}${sound.hz === undefined ? '' : `@${formatNumber(sound.hz, 0)}hz`}`;

/** One subject's live state as summary fields. Its faults are the debounced ones `frame.live` carries. */
export const summarizeSubject = (live: LiveState): SubjectState => {
  const fields = new Map<string, string>();
  for (const key of VALUE_FIELDS) {
    const value = live.values[key];
    if (typeof value === 'number') fields.set(key, formatNumber(value, PRECISION[key] ?? 3));
    else if (typeof value === 'boolean') fields.set(key, String(value));
  }
  const motion = live.motion;
  if (motion) {
    for (const key of MOTION_FIELDS) {
      const value = motion[key];
      if (value !== undefined) fields.set(key, formatNumber(value, PRECISION[key] ?? 3));
    }
  }
  for (const name of RUN_SOUNDS) {
    const sound = live.sounds.find((each) => each.sound === name);
    if (sound) fields.set(`sound.${name}`, soundText(sound));
  }
  if (live.faults.length > 0) fields.set('faults', live.faults.join(','));
  return fields;
};

/** Wires are kept as subjects `wire:<id>`, after the parts and props: never a placed part's id or a prop's. */
export const WIRE_PREFIX = 'wire:';

const FLOW_FIELDS = ['milliamps', 'signal', 'rpm'] as const satisfies readonly (keyof WireFlow)[];

/**
 * What flows along one wire (D78): a power line's milliamps, signed from its `from` port to its `to` port, a signal
 * line's level, a drive linkage's rpm. The canvas's moving dots follow these, so a change that reversed every power
 * line's current now shows in a diff. A signal line carrying none has no field.
 */
export const summarizeFlow = (flow: WireFlow): SubjectState => {
  const fields = new Map<string, string>();
  for (const key of FLOW_FIELDS) {
    const value = flow[key];
    if (value !== undefined) fields.set(key, formatNumber(value, PRECISION[key] ?? 3));
  }
  return fields;
};

/** A frame's flows as the golden file keeps them, in `frame.flows`' order (wire id order). */
export const summarizeFlows = (flows: ReadonlyMap<string, WireFlow>): TickState =>
  new Map([...flows].map(([wire, flow]) => [`${WIRE_PREFIX}${wire}`, summarizeFlow(flow)]));

/** A frame's live state as the golden file keeps it. */
export const summarizeLive = (live: ReadonlyMap<EventSubject, LiveState>): TickState =>
  new Map([...live].map(([subject, state]) => [subject, summarizeSubject(state)]));

/** What changed in one subject since the tick before: each field that differs, and NONE for each that went away. */
export const changedFields = (now: SubjectState, was: SubjectState | undefined): Map<string, string> => {
  const changed = new Map<string, string>();
  for (const field of FIELD_ORDER) {
    const value = now.get(field);
    const before = was?.get(field);
    if (value !== undefined && value !== before) changed.set(field, value);
    else if (value === undefined && before !== undefined) changed.set(field, NONE);
  }
  return changed;
};

/** The state after a tick's changes: each field set, and each NONE taken away. */
export const applyChanges = (was: SubjectState | undefined, changes: ReadonlyMap<string, string>): SubjectState => {
  const fields = new Map(was ?? []);
  for (const [field, value] of changes) {
    if (value === NONE) fields.delete(field);
    else fields.set(field, value);
  }
  return new Map(FIELD_ORDER.flatMap((field) => {
    const value = fields.get(field);
    return value === undefined ? [] : [[field, value] as const];
  }));
};
