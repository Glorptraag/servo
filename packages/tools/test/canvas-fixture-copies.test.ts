// The canvas never imports content (its package map), so its tests carry copies of content's fixtures: the busy
// workbench (task 3.7's routing test) and the Circuit Crew kit robot (task 3.3). Tools may read both packages, so
// this checks each copy still matches content: its blueprint, every part record and every arena (review R-3.7,
// finding 7). When content changes, refresh the copy from it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const read = (relative: string): unknown => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));

interface Copy {
  readonly parts: readonly { readonly id: string }[];
  readonly arenas: readonly { readonly id: string }[];
  readonly blueprint: unknown;
}

/** Every record in a content folder, by id. */
const recordsIn = (folder: string): Map<string, unknown> => {
  const found = new Map<string, unknown>();
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const relative = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(relative);
      else if (entry.name.endsWith('.json')) {
        const record = read(relative) as { readonly id: string };
        found.set(record.id, record);
      }
    }
  };
  walk(folder);
  return found;
};

const copies: readonly [string, string][] = [
  ['packages/canvas/test/fixtures/busy-workbench.json', 'packages/content/fixtures/blueprints/busy-workbench.json'],
  ['packages/canvas/test/fixtures/circuit-crew.json', 'packages/content/fixtures/blueprints/kit-circuit-crew.json'],
];

describe.each(copies)('the canvas test copy %s', (copyPath, blueprintPath) => {
  const copy = read(copyPath) as Copy;

  it('has the content fixture’s blueprint', () => {
    expect(copy.blueprint).toEqual(read(blueprintPath));
  });

  it('has every part record the blueprint uses, as content has it', () => {
    const records = recordsIn('packages/content/parts');
    const used = new Set((copy.blueprint as { readonly parts: readonly { readonly part: string }[] }).parts.map((part) => part.part));
    expect(new Set(copy.parts.map((part) => part.id))).toEqual(used);
    for (const part of copy.parts) expect(part, part.id).toEqual(records.get(part.id));
  });

  it('has its arenas as content has them', () => {
    const arenas = recordsIn('packages/content/arenas');
    for (const arena of copy.arenas) expect(arena, arena.id).toEqual(arenas.get(arena.id));
  });
});
