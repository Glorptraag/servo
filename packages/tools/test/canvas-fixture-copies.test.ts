// The canvas never imports content or tools (its package map), so its tests carry copies: content's busy workbench
// (task 3.7's routing test) and Circuit Crew kit robot (task 3.3), and the placeholder pictures `pnpm art` draws for
// the part records its tests use (task 3.7: tidy wires routes round the pictures as drawn). Tools may read every
// package, so this checks each copy still matches its source (review R-3.7, findings 7 and 11). When a source
// changes, refresh the copy; for the pictures, run this file with UPDATE_CANVAS_ART=1.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validatePartRecord } from '@servo/schema';
import type { PartRecord } from '@servo/schema';
import { exampleParts } from '@servo/schema/fixtures';
import { placeholderSvg } from '../src/placeholder-art/index.ts';

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

describe('the canvas test copy of the placeholder pictures', () => {
  const artPath = 'packages/canvas/test/fixtures/placeholder-art.json';
  const valid = (data: unknown): PartRecord => {
    const result = validatePartRecord(data);
    if (!result.ok) throw new Error(result.issues.map((issue) => issue.code).join(', '));
    return result.value;
  };
  const pictures = (records: readonly PartRecord[]): Record<string, string> =>
    Object.fromEntries(records.map((record) => [record.identity.art, placeholderSvg(record)] as const).sort(([a], [b]) => (a < b ? -1 : 1)));
  const contentRecords = [...new Map(copies.flatMap(([copyPath]) => (read(copyPath) as Copy).parts.map((part) => [part.id, part] as const))).values()];
  const expected = {
    about:
      "The placeholder pictures `pnpm art` draws (packages/tools, placeholderSvg) for the part records the canvas's tests use: the schema's example parts, and content's records in the canvas's fixture copies. Checked against the generator by packages/tools/test/canvas-fixture-copies.test.ts; refresh with UPDATE_CANVAS_ART=1.",
    schema: pictures(exampleParts.map(valid)),
    content: pictures(contentRecords.map(valid)),
  };

  it('has the picture the generator draws for every part record the canvas tests use', () => {
    if (process.env.UPDATE_CANVAS_ART === '1') fs.writeFileSync(path.join(root, artPath), `${JSON.stringify(expected, null, 2)}\n`);
    expect(read(artPath)).toEqual(expected);
  });
});
