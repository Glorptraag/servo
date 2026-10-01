import { canonicalJson } from '@servo/schema';
import type { ControlId, EventSubject, FaultSeen, PlacedPartId, PortId, PrimitiveId, RunEvent, RunInput, WireId } from '@servo/schema';
import type { BehaviourState } from '../behaviour/index.ts';
import type { ElectricalState } from '../electrical/index.ts';
import type { LiveState, ProgramState, WireFlow } from '../interface.ts';
import { mechanicalSnapshot, restoreMechanics } from '../mechanical/index.ts';
import type { ActuatorMotion } from '../mechanical/index.ts';
import type { ProgramSlotState } from '../program/index.ts';
import { frozenEvent } from './frame.ts';
import type { Models } from './models.ts';
import type { LoopState } from './tick.ts';

/**
 * A Run's whole state as bytes (ground rule 4): a header of little-endian 32-bit words, then the loop's state as JSON
 * with every character past ASCII escaped, then the mechanical solver's own bytes (its header and Rapier's snapshot of the
 * world).
 * - JSON writes every finite double exactly, and −0 as 0 (the solvers write none).
 * - Each object keeps the order of its keys, which the code that builds it fixes, so a restored object is the one that
 *   was taken, key order and all, and a record of a restored Run is byte for byte a record of the unbroken one.
 * - Each brain's program state, whose keys a runtime may write in any order, goes through the schema's canonicalJson.
 * So equal states give equal bytes.
 */

/** Marks the format; a change to it is a new number. */
const FORMAT = 1_500_001;
/** Format, fingerprint, tick, then the lengths of the JSON and of the mechanical bytes. */
const HEADER_BYTES = 20;
const CHUNK = 8192;

/** What the Simulation logs as a Run goes: the switch flips, every event, and each fault's first tick. */
export interface Logs {
  readonly inputs: readonly RunInput[];
  readonly events: readonly RunEvent[];
  readonly faults: readonly FaultSeen[];
}

/** JSON with only ASCII characters: one byte each. */
const asciiJson = (value: unknown): string =>
  JSON.stringify(value).replace(/[\u007f-\uffff]/g, (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);

const textOf = (bytes: Uint8Array): string => {
  let text = '';
  for (let at = 0; at < bytes.length; at += CHUNK) text += String.fromCharCode(...bytes.subarray(at, at + CHUNK));
  return text;
};

/** The loop's state and logs as plain JSON data. Maps become [key, value] lists in their order; a held actuator's infinite load is written 'Infinity'. */
const plainOf = (state: LoopState, logs: Logs): unknown => ({
  tick: state.tick,
  electrical: state.electrical,
  behaviour: state.behaviour,
  program: { programs: state.program.programs.map((program) => canonicalJson(program)), driven: state.program.driven },
  manual: state.manual,
  contact: state.contact,
  channels: state.channels,
  actuators: [...state.actuators],
  loads: [...state.loads].map(([part, loads]) => [part, Object.fromEntries(Object.entries(loads).map(([primitive, load]) => [primitive, load === Number.POSITIVE_INFINITY ? 'Infinity' : load]))]),
  samples: [...state.samples],
  live: [...state.live],
  flows: [...state.flows],
  inputs: logs.inputs,
  events: logs.events,
  faults: logs.faults,
});

/** The state and logs as bytes, marked with the Run's fingerprint. */
export const encodeSnapshot = (print: number, state: LoopState, logs: Logs): Uint8Array => {
  const json = asciiJson(plainOf(state, logs));
  const mechanics = mechanicalSnapshot(state.mechanical);
  const bytes = new Uint8Array(HEADER_BYTES + json.length + mechanics.length);
  const view = new DataView(bytes.buffer);
  [FORMAT, print, state.tick, json.length, mechanics.length].forEach((word, index) => view.setUint32(index * 4, word, true));
  for (let index = 0; index < json.length; index += 1) bytes[HEADER_BYTES + index] = json.charCodeAt(index);
  bytes.set(mechanics, HEADER_BYTES + json.length);
  return bytes;
};

/** The parsed JSON, as `plainOf` wrote it. */
interface Plain {
  readonly tick: number;
  readonly electrical: ElectricalState;
  readonly behaviour: BehaviourState;
  readonly program: { readonly programs: readonly string[]; readonly driven: ProgramSlotState['driven'] };
  readonly manual: Readonly<Record<ControlId, boolean>>;
  readonly contact: Readonly<Record<ControlId, boolean>>;
  readonly channels: Readonly<Record<ControlId, number>>;
  readonly actuators: readonly [PlacedPartId, Readonly<Record<PrimitiveId, ActuatorMotion>>][];
  readonly loads: readonly [PlacedPartId, Readonly<Record<PrimitiveId, number | 'Infinity'>>][];
  readonly samples: readonly [PlacedPartId, Readonly<Record<PortId, number>>][];
  readonly live: readonly [EventSubject, LiveState][];
  readonly flows: readonly [WireId, WireFlow][];
  readonly inputs: readonly RunInput[];
  readonly events: readonly RunEvent[];
  readonly faults: readonly FaultSeen[];
}

const frozenLive = (state: LiveState): LiveState => {
  Object.freeze(state.values);
  if (state.motion) Object.freeze(state.motion);
  state.sounds.forEach((sound) => Object.freeze(sound));
  Object.freeze(state.sounds);
  Object.freeze(state.faults);
  return Object.freeze(state);
};

/** The fingerprint a snapshot's bytes carry, and its tick; undefined when the bytes are not a snapshot of this format. */
export const snapshotHeader = (bytes: Uint8Array): { readonly print: number; readonly tick: number } | undefined => {
  if (bytes.byteLength < HEADER_BYTES) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const word = (index: number): number => view.getUint32(index * 4, true);
  if (word(0) !== FORMAT || HEADER_BYTES + word(3) + word(4) !== bytes.byteLength) return undefined;
  return { print: word(1), tick: word(2) };
};

/** The state and logs `encodeSnapshot` wrote. The caller has checked the header: the fingerprint is this Run's. */
export const decodeSnapshot = (models: Models, bytes: Uint8Array): { readonly state: LoopState; readonly logs: Logs } => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jsonLength = view.getUint32(12, true);
  const plain = JSON.parse(textOf(bytes.subarray(HEADER_BYTES, HEADER_BYTES + jsonLength))) as Plain;
  const mechanical = restoreMechanics(models.mechanical, bytes.subarray(HEADER_BYTES + jsonLength));
  const state: LoopState = {
    tick: plain.tick,
    electrical: plain.electrical,
    behaviour: plain.behaviour,
    program: { programs: plain.program.programs.map((text) => JSON.parse(text) as ProgramState), driven: plain.program.driven },
    mechanical,
    manual: plain.manual,
    contact: plain.contact,
    channels: plain.channels,
    actuators: new Map(plain.actuators),
    loads: new Map(
      plain.loads.map(([part, loads]) => [
        part,
        Object.fromEntries(Object.entries(loads).map(([primitive, load]) => [primitive, load === 'Infinity' ? Number.POSITIVE_INFINITY : load])),
      ]),
    ),
    samples: new Map(plain.samples),
    live: new Map(plain.live.map(([subject, live]) => [subject, frozenLive(live)])),
    flows: new Map(plain.flows.map(([wire, flow]) => [wire, Object.freeze(flow)])),
  };
  return {
    state,
    logs: {
      inputs: plain.inputs.map((input) => Object.freeze(input)),
      events: plain.events.map(frozenEvent),
      faults: plain.faults.map((fault) => Object.freeze(fault)),
    },
  };
};
