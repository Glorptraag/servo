// Shared by the tick loop's and the recorder's tests (task 1.5): the schema's example catalogue and blueprints, a Run
// stepped with switch flips, frames as text, and an independent fold of the event stream.
import { RUN_SOUNDS, makeCatalogue, validateArenaPreset, validateBlueprint, validatePartRecord } from '@servo/schema';
import type { ArenaPreset, Blueprint, EventSubject, PartRecord, RunEvent, RunInput, SoundPayload, ValidationResult } from '@servo/schema';
import { exampleArenas, exampleParts, validBlueprints } from '@servo/schema/fixtures';
import { createSimulation } from '../src/index.ts';
import type { LiveState, ProgramRuntime, RunFrame, RunRecordContext, Simulation } from '../src/index.ts';

export const unwrap = <T>(result: ValidationResult<T>): T => {
  if (!result.ok) throw new Error(`Expected valid data:\n${JSON.stringify(result.issues, null, 2)}`);
  return result.value;
};

export const parts: readonly PartRecord[] = exampleParts.map((part) => unwrap(validatePartRecord(part)));
export const arenas: readonly ArenaPreset[] = exampleArenas.map((arena) => unwrap(validateArenaPreset(arena)));
export const catalogue = makeCatalogue({ parts, arenas });

export const fixture = (name: string): Blueprint => {
  const found = validBlueprints.find((entry) => entry.name === name)?.data;
  if (!found) throw new Error(`No valid blueprint fixture '${name}'.`);
  return found as Blueprint;
};

export const arenaOf = (blueprint: Blueprint): ArenaPreset => {
  const found = arenas.find((arena) => arena.id === blueprint.arena.preset);
  if (!found) throw new Error(`No arena '${blueprint.arena.preset}'.`);
  return found;
};

/** A fixture with parts removed (and every wire on them), validated against the example catalogue. */
export const without = (name: string, removed: readonly string[]): Blueprint => {
  const base = fixture(name);
  return unwrap(
    validateBlueprint(
      {
        ...base,
        parts: base.parts.filter((part) => !removed.includes(part.id)),
        wires: base.wires.filter((wire) => !removed.includes(wire.from.part) && !removed.includes(wire.to.part)),
      },
      catalogue,
    ),
  );
};

/** A fixture with wires removed, validated against the example catalogue. */
export const unlinked = (name: string, wires: readonly string[]): Blueprint => {
  const base = fixture(name);
  return unwrap(validateBlueprint({ ...base, wires: base.wires.filter((wire) => !wires.includes(wire.id)) }, catalogue));
};

/**
 * A brain on the workbench with a servo motor on its out-1, both on two 2-cell packs in series (about 6 V), so the
 * brain is on (3 V) and the servo motor turns (from 3.5 V).
 */
export const brainBench = (): Blueprint => {
  const base = fixture('led-circuit');
  const at = (x: number, y: number) => ({ position: { x, y }, rotation: 0, settings: {} });
  const ends = (from: string, to: string) => {
    const [fromPart = '', fromPort = ''] = from.split('.');
    const [toPart = '', toPort = ''] = to.split('.');
    return { from: { part: fromPart, port: fromPort }, to: { part: toPart, port: toPort } };
  };
  const wires = [
    ['pack-a.plus', 'pack-b.minus'],
    ['brain.plus', 'pack-b.plus'],
    ['brain.minus', 'pack-a.minus'],
    ['pack-b.plus', 'servo.plus'],
    ['pack-a.minus', 'servo.minus'],
    ['brain.out-1', 'servo.signal'],
  ] as const;
  return unwrap(
    validateBlueprint(
      {
        ...base,
        parts: [
          { id: 'brain', part: 'microcontroller', ...at(200, 0) },
          { id: 'pack-a', part: 'battery-pack-2-cell', ...at(0, 0) },
          { id: 'pack-b', part: 'battery-pack-2-cell', ...at(0, 120) },
          { id: 'servo', part: 'servo-motor', ...at(400, 0) },
        ],
        wires: wires.map(([from, to], index) => ({ id: `w${index + 1}`, ...ends(from, to) })),
        meta: { ...base.meta, highWater: { parts: 0, wires: wires.length } },
      },
      catalogue,
    ),
  );
};

export const make = (blueprint: Blueprint, seed = 7, program?: ProgramRuntime): Promise<Simulation> =>
  createSimulation({ blueprint, catalogue, arena: arenaOf(blueprint), seed, ...(program ? { program } : {}) });

/** Steps a Run to `ticks`, making each input at its tick before the step that applies it. Returns every frame from tick 0. */
export const stepTo = (simulation: Simulation, ticks: number, inputs: readonly RunInput[] = []): RunFrame[] => {
  const frames = [simulation.frame];
  while (simulation.tick < ticks) {
    for (const input of inputs.filter((each) => each.tick === simulation.tick)) simulation.input({ partId: input.partId, kind: input.kind, closed: input.closed });
    frames.push(simulation.step());
  }
  return frames;
};

export const CONTEXT: RunRecordContext = {
  id: '6f1c2d3e-4a5b-4c6d-8e7f-8091a2b3c4d5',
  startedAt: '2026-10-01T09:00:00.000Z',
  endedAt: '2026-10-01T09:00:05.000Z',
  runNumber: 1,
  hints: [],
};

/** Whether two snapshots' bytes are the same, byte for byte: a plain loop, far quicker than a deep equality on arrays. */
export const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return false;
  return true;
};

/** A frame as text, Maps written out in their order, so frames compare exactly. */
export const frameText = (frame: RunFrame): string => JSON.stringify({ tick: frame.tick, events: frame.events, live: [...frame.live], flows: [...frame.flows] });

/** Each placed part with a manual switch flips it at tick 10 and back at 20, so every Run has inputs to replay. */
export const flips = (blueprint: Blueprint): RunInput[] =>
  blueprint.parts
    .filter((part) => parts.find((record) => record.id === part.part)?.behaviour.some((primitive) => primitive.kind === 'switch' && primitive.actuation.kind === 'manual'))
    .flatMap((part): RunInput[] => {
      const record = parts.find((each) => each.id === part.part);
      const switchPrimitive = record?.behaviour.find((primitive) => primitive.kind === 'switch');
      const rest = switchPrimitive?.kind === 'switch' && switchPrimitive.actuation.kind === 'manual' && switchPrimitive.actuation.initially === 'closed';
      return [
        { tick: 10, partId: part.id, kind: 'switch', closed: !rest },
        { tick: 20, partId: part.id, kind: 'switch', closed: rest },
      ];
    })
    .sort((p, q) => p.tick - q.tick);

/**
 * The fold of an event stream, written here independently of the loop: what a reader that joins late rebuilds. Values
 * merge, a pose replaces, a sound at level 0 stops, a fault starts or ends. Sounds in RUN_SOUNDS order and faults in
 * the order they are listed in `order`.
 */
export const fold = (events: readonly RunEvent[], order: ReadonlyMap<EventSubject, readonly string[]>): Map<EventSubject, LiveState> => {
  interface Folded {
    values: Record<string, unknown>;
    motion?: unknown;
    sounds: Map<string, SoundPayload>;
    faults: Set<string>;
  }
  const live = new Map<EventSubject, Folded>();
  for (const event of events) {
    const state: Folded = live.get(event.partId) ?? { values: {}, sounds: new Map(), faults: new Set() };
    live.set(event.partId, state);
    if (event.kind === 'value') Object.assign(state.values, event.payload);
    else if (event.kind === 'motion') state.motion = event.payload;
    else if (event.kind === 'sound') {
      if (event.payload.level > 0) state.sounds.set(event.payload.sound, event.payload);
      else state.sounds.delete(event.payload.sound);
    } else if (event.payload.active) state.faults.add(event.payload.failure);
    else state.faults.delete(event.payload.failure);
  }
  return new Map(
    [...live].map(([subject, state]) => [
      subject,
      {
        values: state.values,
        ...(state.motion ? { motion: state.motion } : {}),
        sounds: RUN_SOUNDS.flatMap((name) => (state.sounds.has(name) ? [state.sounds.get(name) as SoundPayload] : [])),
        faults: (order.get(subject) ?? []).filter((failure) => state.faults.has(failure)),
      } as LiveState,
    ]),
  );
};

/** Each subject's failure modes in its record's order, for `fold`. */
export const failureOrder = (blueprint: Blueprint): Map<EventSubject, readonly string[]> =>
  new Map(blueprint.parts.map((part) => [part.id, parts.find((record) => record.id === part.part)?.failureModes.map((mode) => mode.id) ?? []]));
