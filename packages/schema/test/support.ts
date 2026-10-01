import { exampleArenas, exampleParts, validKits } from '../src/fixtures.ts';
import { makeCatalogue, validateArenaPreset, validateKit, validatePartRecord } from '../src/index.ts';
import type { Issue, PartRecord, ValidationResult } from '../src/index.ts';

export const unwrap = <T>(result: ValidationResult<T>): T => {
  if (!result.ok) throw new Error(`Expected valid data:\n${JSON.stringify(result.issues, null, 2)}`);
  return result.value;
};

export const issuesOf = <T>(result: ValidationResult<T>): readonly Issue[] => (result.ok ? [] : result.issues);

/** `code at path` for each issue, which reads well in a failing assertion. */
export const reasons = <T>(result: ValidationResult<T>): string[] => issuesOf(result).map((issue) => `${issue.code} at ${issue.path}`);

/** A deep, plain copy to mutate in a test. */
export const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export const parts: readonly PartRecord[] = exampleParts.map((part) => unwrap(validatePartRecord(part)));
export const arenas = exampleArenas.map((arena) => unwrap(validateArenaPreset(arena)));
export const kits = validKits.map((kit) => unwrap(validateKit(kit.data, makeCatalogue({ parts, arenas }))));
export const catalogue = makeCatalogue({ parts, arenas, kits });

export const part = (id: string): PartRecord => {
  const found = parts.find((record) => record.id === id);
  if (!found) throw new Error(`No example part '${id}'.`);
  return found;
};

// Path-based edits for "one change" tests on plain JSON copies.
type Key = string | number;
type Node = Record<Key, unknown>;
export type Change = (document: unknown) => void;

const nodeAt = (document: unknown, path: readonly Key[]): Node =>
  path.reduce<Node>((current, key) => current[key] as Node, document as Node);

export const set =
  (path: readonly Key[], value: unknown): Change =>
  (document) => {
    nodeAt(document, path.slice(0, -1))[path[path.length - 1] as Key] = value;
  };

export const remove =
  (path: readonly Key[]): Change =>
  (document) => {
    delete nodeAt(document, path.slice(0, -1))[path[path.length - 1] as Key];
  };

export const push =
  (path: readonly Key[], value: unknown): Change =>
  (document) => {
    (nodeAt(document, path) as unknown as unknown[]).push(copy(value));
  };

/** A copy of `document` with the changes applied, in order. */
export const edited = (document: unknown, ...changes: readonly Change[]): unknown => {
  const result = copy(document);
  for (const change of changes) change(result);
  return result;
};
