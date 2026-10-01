import fs from 'node:fs';
import path from 'node:path';
import type { AssetKey } from '@servo/schema';
import { REGISTRY_FILE, resolveRegistry } from './registry.ts';
import type { ArtRegistry, RegistryResult } from './registry.ts';

const posix = (file: string): string => file.split(path.sep).join('/');

/**
 * Every file under `folder`, as sorted paths relative to it with `/` separators. Hidden files and
 * folders (`.gitkeep`, `.DS_Store`) are left out. A folder that does not exist has no files.
 */
export const listFiles = (folder: string): string[] => {
  if (!fs.existsSync(folder)) return [];
  const found: string[] = [];
  const walk = (relative: string): void => {
    for (const entry of fs.readdirSync(path.join(folder, relative), { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const inner = relative === '' ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory()) walk(inner);
      else if (entry.isFile()) found.push(inner);
    }
  };
  walk('');
  return found.sort();
};

export interface RegistryFolders {
  /** The art key of every part. */
  readonly keys: readonly AssetKey[];
  /** Where the placeholders are, and where registry.json goes. */
  readonly generatedFolder: string;
  /** Where final renders are dropped in. */
  readonly finalFolder: string;
}

/** Resolves every key against the files on disk. Throws an ArtError when a key resolves to nothing. */
export const buildRegistry = ({ keys, generatedFolder, finalFolder }: RegistryFolders): RegistryResult => {
  const finalFromGenerated = posix(path.relative(generatedFolder, finalFolder));
  return resolveRegistry({
    keys,
    generated: listFiles(generatedFolder),
    finals: listFiles(finalFolder),
    finalFromGenerated: finalFromGenerated === '' ? '' : `${finalFromGenerated}/`,
  });
};

/** registry.json as written: keys in order, two-space indents, a final newline. */
export const registryJson = (registry: ArtRegistry): string =>
  `${JSON.stringify(Object.fromEntries(Object.entries(registry).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))), null, 2)}\n`;

/** Writes registry.json into the generated folder and returns its path. */
export const writeRegistry = (generatedFolder: string, registry: ArtRegistry): string => {
  const file = path.join(generatedFolder, REGISTRY_FILE);
  fs.mkdirSync(generatedFolder, { recursive: true });
  fs.writeFileSync(file, registryJson(registry));
  return file;
};
