import type { AssetKey } from '@servo/schema';

/** What the app shows for one art key. */
export interface ArtEntry {
  /** The picture's path relative to the folder that holds registry.json, with `/` separators. */
  readonly src: string;
  /** True until a final render for the key is dropped in. */
  readonly isPlaceholder: boolean;
}

/** The contents of registry.json: every art key, in key order, to its entry. */
export type ArtRegistry = Readonly<Record<AssetKey, ArtEntry>>;

/** File types a final render may have, matched without regard to case. */
export const FINAL_EXTENSIONS: readonly string[] = ['avif', 'jpeg', 'jpg', 'png', 'svg', 'webp'];

/** The registry's file name, in the generated folder beside the placeholders. */
export const REGISTRY_FILE = 'registry.json';

/** Where an art key's placeholder lives, relative to the generated folder: `part/dc-motor` → `part/dc-motor.svg`. */
export const placeholderPath = (key: AssetKey): string => `${key}.svg`;

/** A problem a person has to fix. The message lists every problem found, one per line. */
export class ArtError extends Error {
  readonly problems: readonly string[];

  constructor(summary: string, problems: readonly string[]) {
    super([summary, ...problems.map((problem) => `  - ${problem}`)].join('\n'));
    this.name = 'ArtError';
    this.problems = problems;
  }
}

export interface RegistryInput {
  /** The art key of every part. */
  readonly keys: readonly AssetKey[];
  /** Files in the generated folder, relative to it, with `/` separators. */
  readonly generated: readonly string[];
  /** Files in the final folder, relative to it, with `/` separators. */
  readonly finals: readonly string[];
  /** The final folder as written from the generated folder, ending in `/`: `../final/`. */
  readonly finalFromGenerated: string;
}

/** A file in the final folder that no key uses, and why. */
export interface UnusedFinal {
  readonly file: string;
  readonly reason: string;
}

export interface RegistryResult {
  readonly registry: ArtRegistry;
  readonly unused: readonly UnusedFinal[];
}

const extensionOf = (file: string): { readonly key: string; readonly extension: string } | undefined => {
  const dot = file.lastIndexOf('.');
  return dot > file.lastIndexOf('/') + 1 ? { key: file.slice(0, dot), extension: file.slice(dot + 1).toLowerCase() } : undefined;
};

/**
 * Resolves every art key to its final render (`final/<key>.<type>`) when there is one, otherwise to its
 * placeholder (`<key>.svg` in the generated folder). Pure. Throws an ArtError that names every key that
 * resolves to nothing and every key with more than one final render.
 */
export const resolveRegistry = (input: RegistryInput): RegistryResult => {
  const keys = [...new Set(input.keys)].sort();
  const known = new Set(keys);
  const finalsOf = new Map<AssetKey, string[]>();
  const unused: UnusedFinal[] = [];
  for (const file of [...input.finals].sort()) {
    const parts = extensionOf(file);
    if (!parts || !FINAL_EXTENSIONS.includes(parts.extension)) {
      unused.push({ file, reason: `not a picture type the registry takes (${FINAL_EXTENSIONS.join(', ')})` });
    } else if (!known.has(parts.key)) {
      unused.push({ file, reason: `no part has the art key '${parts.key}'` });
    } else {
      finalsOf.set(parts.key, [...(finalsOf.get(parts.key) ?? []), file]);
    }
  }
  const generated = new Set(input.generated);
  const problems: string[] = [];
  const entries: [AssetKey, ArtEntry][] = [];
  for (const key of keys) {
    const finals = finalsOf.get(key) ?? [];
    const [final] = finals;
    if (finals.length > 1) {
      problems.push(`'${key}' has ${finals.length} final renders (${finals.join(', ')}). Keep one.`);
    } else if (final !== undefined) {
      entries.push([key, { src: `${input.finalFromGenerated}${final}`, isPlaceholder: false }]);
    } else if (generated.has(placeholderPath(key))) {
      entries.push([key, { src: placeholderPath(key), isPlaceholder: true }]);
    } else {
      problems.push(
        `'${key}' resolves to nothing: there is no final render ${key}.<${FINAL_EXTENSIONS.join('|')}> and no placeholder ${placeholderPath(key)}. Run pnpm art to draw the placeholder.`,
      );
    }
  }
  if (problems.length > 0) throw new ArtError('The swap registry cannot resolve every art key.', problems);
  return { registry: Object.fromEntries(entries), unused };
};

/**
 * The picture for an art key. The app builds the same lookup from registry.json, since packages/tools is
 * dev-only and nothing at runtime imports it. Throws an ArtError for a key the registry does not have.
 */
export const resolveArt = (registry: ArtRegistry, key: AssetKey): ArtEntry => {
  const entry = Object.hasOwn(registry, key) ? registry[key] : undefined;
  if (entry === undefined) {
    throw new ArtError(`No art for '${key}'.`, [
      `registry.json has no entry for it. Check the part record's identity.art, then run pnpm art.`,
    ]);
  }
  return entry;
};
