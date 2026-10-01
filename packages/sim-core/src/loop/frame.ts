import { RUN_SOUNDS } from '@servo/schema';
import type { EventSubject, MotionPayload, RunEvent, RunSound, SoundPayload, ValuePayload } from '@servo/schema';
import type { LiveState } from '../interface.ts';
import type { Models } from './models.ts';
import type { Readout } from './tick.ts';

/** ValuePayload's fields, in its order: the order of every value payload and of `LiveState.values`. */
const VALUE_KEYS = ['volts', 'milliamps', 'charge', 'rpm', 'angle', 'light', 'signal', 'closed'] as const;

type ValueKey = (typeof VALUE_KEYS)[number];

type Values = { -readonly [K in ValueKey]?: ValuePayload[K] };

const copyValue = <K extends ValueKey>(to: Values, from: ValuePayload, key: K): void => {
  to[key] = from[key];
};

/** A subject before its first event: no readouts, no pose, silent and with no fault. */
export const UNSEEN: LiveState = Object.freeze({ values: Object.freeze({}), sounds: Object.freeze([]), faults: Object.freeze([]) });

/** The readouts that differ from the last frame's, in ValuePayload's order; undefined when none does. */
const changedValues = (now: ValuePayload, was: ValuePayload): ValuePayload | undefined => {
  let changed: Values | undefined;
  for (const key of VALUE_KEYS) {
    if (now[key] === undefined || was[key] === now[key]) continue;
    changed ??= {};
    copyValue(changed, now, key);
  }
  return changed;
};

const sameMotion = (a: MotionPayload, b: MotionPayload | undefined): boolean =>
  b !== undefined && a.x === b.x && a.y === b.y && a.heading === b.heading && a.pitch === b.pitch && a.roll === b.roll;

const sameSound = (a: SoundPayload, b: SoundPayload | undefined): boolean => b !== undefined && a.level === b.level && a.hz === b.hz;

const soundNamed = (sounds: readonly SoundPayload[], name: RunSound): SoundPayload | undefined => sounds.find((sound) => sound.sound === name);

/**
 * This tick's events: what changed, started or stopped since the last frame, each with this tick. The order is fixed:
 * subjects as `models.subjects` lists them (placed parts in id order, then props in id order), and for each subject its
 * `value` event (only the readouts that changed), its `motion` event (the whole pose, when any of it changed), its
 * `sound` events in RUN_SOUNDS order (a sound that stopped has level 0), and its `fault` events in its record's order.
 * At tick 0 the last frame is empty, so every readout, pose, sound and fault is an event.
 */
export const eventsOf = (models: Models, tick: number, readouts: readonly Readout[], live: ReadonlyMap<EventSubject, LiveState>): RunEvent[] => {
  const events: RunEvent[] = [];
  models.subjects.forEach((subject, index) => {
    const now = readouts[index];
    if (!now) return;
    const partId = subject.id;
    const was = live.get(partId) ?? UNSEEN;
    const values = changedValues(now.values, was.values);
    if (values) events.push({ tick, partId, kind: 'value', payload: values });
    if (now.motion && !sameMotion(now.motion, was.motion)) events.push({ tick, partId, kind: 'motion', payload: now.motion });
    for (const name of RUN_SOUNDS) {
      const playing = soundNamed(now.sounds, name);
      const before = soundNamed(was.sounds, name);
      if (playing && !sameSound(playing, before)) events.push({ tick, partId, kind: 'sound', payload: playing });
      else if (!playing && before) events.push({ tick, partId, kind: 'sound', payload: { sound: name, level: 0 } });
    }
    for (const failure of subject.failures) {
      const active = now.faults.includes(failure);
      if (active !== was.faults.includes(failure)) events.push({ tick, partId, kind: 'fault', payload: { failure, active } });
    }
  });
  return events;
};

/** The fold of a value event into readouts: each field it carries replaces the one before, in ValuePayload's order. */
const mergedValues = (was: ValuePayload, now: ValuePayload): ValuePayload => {
  const values: Values = {};
  for (const key of VALUE_KEYS) {
    if (now[key] !== undefined) copyValue(values, now, key);
    else if (was[key] !== undefined) copyValue(values, was, key);
  }
  return Object.freeze(values);
};

/**
 * This tick's live state, as a reader that joins late would fold this tick's events into the last frame's. A subject no
 * event names keeps its state, object and all. For any other, each kind of event it has takes this tick's readouts of
 * that kind: a value event merges the readouts (only changed ones are sent, and none ever disappears), a motion event the
 * pose, sound events the sounds playing, fault events the failure modes active. That is exactly the fold, because the
 * events carry every difference, so `frame.live` is the fold of every event from tick 0. A test folds the whole stream at
 * every tick to prove it.
 */
export const liveOf = (models: Models, readouts: readonly Readout[], live: ReadonlyMap<EventSubject, LiveState>, events: readonly RunEvent[]): ReadonlyMap<EventSubject, LiveState> => {
  const changed = new Map<EventSubject, Set<RunEvent['kind']>>();
  for (const event of events) {
    const kinds = changed.get(event.partId);
    if (kinds) kinds.add(event.kind);
    else changed.set(event.partId, new Set([event.kind]));
  }
  return new Map(
    models.subjects.map((subject, index): [EventSubject, LiveState] => {
      const was = live.get(subject.id) ?? UNSEEN;
      const now = readouts[index];
      const kinds = changed.get(subject.id);
      if (!now || !kinds) return [subject.id, was];
      const motion = kinds.has('motion') ? now.motion : was.motion;
      return [
        subject.id,
        Object.freeze({
          values: kinds.has('value') ? mergedValues(was.values, now.values) : was.values,
          ...(motion ? { motion } : {}),
          sounds: kinds.has('sound') ? now.sounds : was.sounds,
          faults: kinds.has('fault') ? now.faults : was.faults,
        }),
      ];
    }),
  );
};

/** An event frozen, payload and all, so neither a frame's reader nor a run record's can change the Run's own copy. */
export const frozenEvent = (event: RunEvent): RunEvent => {
  Object.freeze(event.payload);
  return Object.freeze(event);
};
