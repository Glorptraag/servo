import { canonicalJson, canonicalizeBlueprint, serializeBlueprint, validateArenaPreset } from '@servo/schema';
import type { ArenaPreset, Blueprint, Catalogue, Issue } from '@servo/schema';
import { GraphInputError, buildGraph } from '../graph/index.ts';
import type { SimGraph } from '../graph/index.ts';
import type { SimulationOptions, SimulationSetupError } from '../interface.ts';

/** Why createSimulation refused its inputs: the first input refused, with every issue its validator gives. */
export class SetupError extends Error implements SimulationSetupError {
  override readonly name = 'SimulationSetupError' as const;
  readonly issues: readonly Issue[];

  constructor(subject: string, issues: readonly Issue[]) {
    super(`${subject} is not valid: ${issues.map((issue) => `${issue.code} at ${issue.path} (${issue.message})`).join('; ')}`);
    this.issues = issues;
  }
}

/** What a Run is made from, checked. */
export interface Setup {
  /** The canonical copy of the caller's blueprint, deeply frozen: the snapshot the Run reads (ground rule 4). */
  readonly blueprint: Blueprint;
  /** The wired graph of that copy. */
  readonly graph: SimGraph;
  /** A deeply frozen copy of the arena preset. */
  readonly arena: ArenaPreset;
  readonly seed: number;
  /** A fingerprint of everything the Run is made from: a snapshot restores only into a Run with the same one. */
  readonly print: number;
}

const deepFrozen = <T>(value: T): T => {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFrozen(child);
  }
  return value;
};

/** 32-bit FNV-1a over text. */
const fnv1a = (text: string): number => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193) >>> 0;
  return hash;
};

/**
 * The fingerprint of a Run: its canonical blueprint, the records of the parts it uses (in id order), its arena preset and
 * its seed, as canonical JSON. Two Runs with the same fingerprint are the same Run (ground rule 2).
 */
const fingerprintOf = (blueprint: Blueprint, graph: SimGraph, arena: ArenaPreset, seed: number): number => {
  const records = [...new Map([...graph.parts.values()].map((part) => [part.record.id, part.record])).values()].sort((p, q) => (p.id < q.id ? -1 : p.id > q.id ? 1 : 0));
  return fnv1a(canonicalJson({ blueprint: serializeBlueprint(blueprint), records, arena, seed }));
};

/** The graph of a blueprint, with a refusal as a SimulationSetupError carrying the graph builder's issues. */
const graphOf = (blueprint: Blueprint, catalogue: Catalogue): SimGraph => {
  try {
    return buildGraph(blueprint, catalogue);
  } catch (error) {
    if (error instanceof GraphInputError) throw new SetupError(error.subject, error.issues);
    throw error;
  }
};

/**
 * Checks createSimulation's inputs, in this order: the blueprint (its structure, the part records it uses, then the whole
 * build against the catalogue, as the graph builder does), the arena preset, that the preset is the one the blueprint
 * names, and the seed. The first refused throws a SimulationSetupError with every issue its validator gives. A legal
 * build always passes, however wrong it is. Then the blueprint is copied in canonical form and the graph built from the
 * copy; the caller's objects are never touched.
 */
export const prepare = (options: SimulationOptions): Setup => {
  const checked = graphOf(options.blueprint, options.catalogue);
  const preset = validateArenaPreset(options.arena);
  if (!preset.ok) throw new SetupError('The arena preset', preset.issues);
  const named = checked.blueprint.arena.preset;
  if (preset.value.id !== named) {
    throw new SetupError('The arena preset', [{ code: 'value.inconsistent', path: '$.id', message: `The blueprint names the arena preset '${named}', not '${preset.value.id}'.` }]);
  }
  const seed: unknown = options.seed;
  if (typeof seed !== 'number' || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    const code = typeof seed !== 'number' || !Number.isFinite(seed) ? 'value.wrong_type' : Number.isInteger(seed) ? 'value.out_of_range' : 'value.not_integer';
    throw new SetupError('The seed', [{ code, path: '$', message: 'A seed is an unsigned 32-bit whole number, from 0 to 4294967295.' }]);
  }
  const blueprint = deepFrozen(JSON.parse(serializeBlueprint(canonicalizeBlueprint(checked.blueprint, options.catalogue))) as Blueprint);
  const graph = graphOf(blueprint, options.catalogue);
  const arena = deepFrozen(JSON.parse(canonicalJson(preset.value)) as ArenaPreset);
  return { blueprint, graph, arena, seed, print: fingerprintOf(blueprint, graph, arena, seed) };
};
