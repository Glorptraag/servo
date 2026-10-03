// The electrical tests' catalogue and builds, shared by electrical.test.ts and its cost test, electrical.perf.ts.
import { makeCatalogue, validateArenaPreset, validatePartRecord } from '@servo/schema';
import type { Blueprint, PartRecord, PortRef, ValidationResult } from '@servo/schema';
import { exampleArenas, exampleParts, validBlueprints } from '@servo/schema/fixtures';

const unwrap = <T>(result: ValidationResult<T>): T => {
  if (!result.ok) throw new Error(`Expected valid data:\n${JSON.stringify(result.issues, null, 2)}`);
  return result.value;
};

export const parts: readonly PartRecord[] = exampleParts.map((part) => unwrap(validatePartRecord(part)));
export const catalogue = makeCatalogue({ parts, arenas: exampleArenas.map((arena) => unwrap(validateArenaPreset(arena))) });
export const fixture = (name: string): Blueprint => {
  const found = validBlueprints.find((entry) => entry.name === name)?.data;
  if (!found) throw new Error(`No schema fixture ${name}`);
  return found as Blueprint;
};

export type Placed = readonly [id: string, type: string, settings?: Readonly<Record<string, string>>];

/** A small build on the workbench: parts as [id, type, settings], power wires as ['part.port', 'part.port']. */
export const workbench = (placed: readonly Placed[], wires: readonly (readonly [string, string])[]): Blueprint => {
  const base = fixture('led-circuit');
  const ref = (end: string): PortRef => {
    const [part = '', port = ''] = end.split('.');
    return { part, port };
  };
  return {
    ...base,
    parts: placed.map(([id, type, settings = {}], index) => ({ id, part: type, position: { x: index * 80, y: 0 }, rotation: 0, settings })),
    wires: wires.map(([from, to], index) => ({ id: `w${index + 1}`, from: ref(from), to: ref(to) })),
    meta: { ...base.meta, level: 2, highWater: { parts: 0, wires: wires.length } },
  };
};
