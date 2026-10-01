import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePartRecord } from '@servo/schema';
import type { PartRecord } from '@servo/schema';
import { exampleParts } from '@servo/schema/fixtures';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ArtError,
  DEFAULT_ART_OPTIONS,
  REGISTRY_FILE,
  buildRegistry,
  generateArt,
  listFiles,
  parseArtArgs,
  placeholderPath,
  placeholderSvg,
  registryJson,
  resolveArt,
  resolveRegistry,
  runArt,
} from '../src/index.ts';
import type { ArtOptions, ArtRegistry } from '../src/index.ts';

const parts: readonly PartRecord[] = exampleParts.map((data) => {
  const result = validatePartRecord(data);
  if (!result.ok) throw new Error(`Expected a valid part record:\n${JSON.stringify(result.issues, null, 2)}`);
  return result.value;
});
const keys = parts.map((record) => record.identity.art);

/** Calls `run` and returns the ArtError it throws. */
const artError = (run: () => unknown): ArtError => {
  try {
    run();
  } catch (error) {
    if (error instanceof ArtError) return error;
    throw error;
  }
  throw new Error('Expected an ArtError.');
};

describe('swap registry: resolving keys', () => {
  const allPlaceholders = { keys, generated: keys.map(placeholderPath), finalFromGenerated: '../final/' };

  it('resolves every key to its placeholder until a final render is dropped in', () => {
    const { registry, unused } = resolveRegistry({ ...allPlaceholders, finals: [] });
    expect(Object.keys(registry)).toEqual([...keys].sort());
    for (const key of keys) expect(resolveArt(registry, key)).toEqual({ src: `${key}.svg`, isPlaceholder: true });
    expect(unused).toEqual([]);
  });

  it('resolves a key to its final render once one is dropped in, and the rest to their placeholders', () => {
    const { registry } = resolveRegistry({ ...allPlaceholders, finals: ['part/dc-motor.png', 'part/led.WEBP'] });
    expect(resolveArt(registry, 'part/dc-motor')).toEqual({ src: '../final/part/dc-motor.png', isPlaceholder: false });
    expect(resolveArt(registry, 'part/led')).toEqual({ src: '../final/part/led.WEBP', isPlaceholder: false });
    const placeholders = keys.filter((key) => key !== 'part/dc-motor' && key !== 'part/led');
    for (const key of placeholders) expect(resolveArt(registry, key)).toEqual({ src: placeholderPath(key), isPlaceholder: true });
  });

  it('falls back to the placeholder when a final render is missing', () => {
    const before = resolveRegistry({ ...allPlaceholders, finals: ['part/caster.svg'] }).registry;
    const after = resolveRegistry({ ...allPlaceholders, finals: [] }).registry;
    expect(resolveArt(before, 'part/caster').isPlaceholder).toBe(false);
    expect(resolveArt(after, 'part/caster')).toEqual({ src: 'part/caster.svg', isPlaceholder: true });
  });

  it('fails with a readable error when a key resolves to nothing', () => {
    const error = artError(() =>
      resolveRegistry({ ...allPlaceholders, generated: allPlaceholders.generated.filter((file) => file !== 'part/led.svg'), finals: [] }),
    );
    expect(error.problems).toHaveLength(1);
    expect(error.message).toContain("'part/led' resolves to nothing");
    expect(error.message).toContain('part/led.svg');
    expect(error.message).toContain('pnpm art');
  });

  it('refuses a key with two final renders', () => {
    const error = artError(() => resolveRegistry({ ...allPlaceholders, finals: ['part/gearbox.png', 'part/gearbox.svg'] }));
    expect(error.problems).toEqual(["'part/gearbox' has 2 final renders (part/gearbox.png, part/gearbox.svg). Keep one."]);
  });

  it('reports final files that no key uses, with the reason', () => {
    const { unused } = resolveRegistry({ ...allPlaceholders, finals: ['part/dc-motr.png', 'notes.txt', 'part/led'] });
    expect(unused).toEqual([
      { file: 'notes.txt', reason: 'not a picture type the registry takes (avif, jpeg, jpg, png, svg, webp)' },
      { file: 'part/dc-motr.png', reason: "no part has the art key 'part/dc-motr'" },
      { file: 'part/led', reason: 'not a picture type the registry takes (avif, jpeg, jpg, png, svg, webp)' },
    ]);
  });

  it('fails with a readable error for a key the registry does not have', () => {
    const { registry } = resolveRegistry({ ...allPlaceholders, finals: [] });
    expect(() => resolveArt(registry, 'part/flux-capacitor')).toThrow(ArtError);
    expect(() => resolveArt(registry, 'part/flux-capacitor')).toThrow("No art for 'part/flux-capacitor'.");
    expect(() => resolveArt(registry, 'toString')).toThrow(ArtError);
  });

  it('writes registry.json with keys in order, two-space indents and a final newline', () => {
    const registry: ArtRegistry = { 'part/b': { src: 'part/b.svg', isPlaceholder: true }, 'part/a': { src: '../final/part/a.png', isPlaceholder: false } };
    expect(registryJson(registry)).toBe(
      '{\n  "part/a": {\n    "src": "../final/part/a.png",\n    "isPlaceholder": false\n  },\n  "part/b": {\n    "src": "part/b.svg",\n    "isPlaceholder": true\n  }\n}\n',
    );
  });
});

describe('swap registry and pnpm art on disk', () => {
  const made: string[] = [];
  afterEach(() => {
    for (const folder of made.splice(0)) fs.rmSync(folder, { recursive: true, force: true });
  });

  /** A temp art setup: part records written as JSON, and the generated and final folders beside them. */
  const setup = (records: readonly unknown[] = exampleParts): ArtOptions => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'servo-art-'));
    made.push(root);
    const options = { parts: path.join(root, 'parts'), out: path.join(root, 'art', 'generated'), final: path.join(root, 'art', 'final') };
    fs.mkdirSync(path.join(options.parts, 'level-1'), { recursive: true });
    records.forEach((record, index) => fs.writeFileSync(path.join(options.parts, 'level-1', `part-${index}.json`), JSON.stringify(record)));
    return options;
  };

  const drop = (folder: string, file: string, content = 'final render'): void => {
    fs.mkdirSync(path.dirname(path.join(folder, file)), { recursive: true });
    fs.writeFileSync(path.join(folder, file), content);
  };

  const readRegistry = (options: ArtOptions): ArtRegistry =>
    JSON.parse(fs.readFileSync(path.join(options.out, REGISTRY_FILE), 'utf8')) as ArtRegistry;

  it('runs over the schema fixtures: one SVG per part, and a registry that resolves every key', () => {
    const options = setup();
    const report = generateArt(options);
    expect(report.records).toBe(parts.length);
    expect(listFiles(options.out)).toEqual([...keys.map(placeholderPath), REGISTRY_FILE].sort());
    for (const record of parts) {
      expect(fs.readFileSync(path.join(options.out, placeholderPath(record.identity.art)), 'utf8')).toBe(placeholderSvg(record));
    }
    const registry = readRegistry(options);
    expect(registry).toEqual(report.registry);
    for (const key of keys) {
      const entry = resolveArt(registry, key);
      expect(entry.isPlaceholder).toBe(true);
      expect(fs.existsSync(path.join(options.out, entry.src))).toBe(true);
    }
  });

  it('swaps in a final render when one is dropped in, and falls back when it is removed', () => {
    const options = setup();
    drop(options.final, 'part/dc-motor.png');
    drop(options.final, '.gitkeep', '');
    generateArt(options);
    const swapped = readRegistry(options);
    expect(resolveArt(swapped, 'part/dc-motor')).toEqual({ src: '../final/part/dc-motor.png', isPlaceholder: false });
    expect(fs.readFileSync(path.join(options.out, resolveArt(swapped, 'part/dc-motor').src), 'utf8')).toBe('final render');
    expect(Object.values(swapped).filter((entry) => entry.isPlaceholder)).toHaveLength(parts.length - 1);

    fs.rmSync(path.join(options.final, 'part/dc-motor.png'));
    generateArt(options);
    expect(resolveArt(readRegistry(options), 'part/dc-motor')).toEqual({ src: 'part/dc-motor.svg', isPlaceholder: true });
  });

  it('fails with a readable error when a key on disk resolves to nothing', () => {
    const options = setup();
    generateArt(options);
    fs.rmSync(path.join(options.out, 'part/buzzer.svg'));
    const error = artError(() => buildRegistry({ keys, generatedFolder: options.out, finalFolder: options.final }));
    expect(error.message).toMatch(/^The swap registry cannot resolve every art key\.\n {2}- 'part\/buzzer' resolves to nothing/);
  });

  it('refuses invalid records, listing each problem, and writes nothing', () => {
    const [first, ...rest] = exampleParts;
    const options = setup([...rest, { ...(first as object), identity: undefined }, { id: 'Not A Part' }]);
    fs.writeFileSync(path.join(options.parts, 'broken.json'), '{ "id": ');
    const error = artError(() => generateArt(options));
    expect(error.message).toMatch(/^Some part records under .+ are not valid, so no art was written\./);
    expect(error.problems[0]).toMatch(/^broken\.json: not readable as JSON/);
    expect(error.problems).toContain("level-1/part-13.json $.identity: Missing 'identity'. (value.missing)");
    expect(error.problems.some((problem) => problem.startsWith('level-1/part-14.json $.id:'))).toBe(true);
    expect(fs.existsSync(options.out)).toBe(false);
  });

  it('refuses a missing or empty parts folder, saying where records go', () => {
    const options = setup([]);
    expect(artError(() => generateArt(options)).message).toMatch(/^No part records: .+ has no \.json files\.\n {2}- Part records are JSON files under packages\/content\/parts\//);
    expect(artError(() => generateArt({ ...options, parts: path.join(options.parts, 'missing') })).message).toMatch(/does not exist\./);
  });

  it('refuses two parts that share an art key but draw differently, and allows identical twins', () => {
    const [pack] = exampleParts.filter((data) => (data as PartRecord).id === 'battery-pack-2-cell') as PartRecord[];
    const twin = { ...pack, id: 'battery-pack-twin' };
    const other = { ...pack, id: 'battery-pack-other', identity: { ...pack?.identity, colours: { main: '#000000', accent: '#ffffff' } } };
    expect(generateArt(setup([pack, twin])).placeholders).toEqual(['part/battery-pack-2-cell.svg']);
    const error = artError(() => generateArt(setup([pack, other])));
    expect(error.problems).toEqual([
      "level-1/part-0.json and level-1/part-1.json both use the art key 'part/battery-pack-2-cell' but draw different placeholders. One key holds one picture.",
    ]);
  });

  it('refuses a key with two final renders before writing anything', () => {
    const options = setup();
    drop(options.final, 'part/led.png');
    drop(options.final, 'part/led.webp');
    expect(artError(() => generateArt(options)).problems).toEqual(["'part/led' has 2 final renders (part/led.png, part/led.webp). Keep one."]);
    expect(fs.existsSync(options.out)).toBe(false);
  });

  it('refuses an out folder that holds other files, or that overlaps the final folder', () => {
    const options = setup();
    drop(options.out, 'notes.md');
    expect(artError(() => generateArt(options)).problems[0]).toBe('notes.md is not a placeholder or registry.json');
    expect(listFiles(options.out)).toEqual(['notes.md']);
    expect(artError(() => generateArt({ ...options, out: path.join(options.final, 'generated') })).message).toMatch(/^The generated and final folders overlap/);
    expect(artError(() => generateArt({ ...options, out: options.final })).message).toMatch(/^The generated and final folders overlap/);
  });

  it('leaves hidden files out when listing a folder', () => {
    const options = setup();
    drop(options.final, '.gitkeep', '');
    drop(options.final, '.cache/part/led.png');
    drop(options.final, 'part/led.png');
    expect(listFiles(options.final)).toEqual(['part/led.png']);
    expect(listFiles(path.join(options.final, 'missing'))).toEqual([]);
  });
});

describe('pnpm art', () => {
  const made: string[] = [];
  afterEach(() => {
    for (const folder of made.splice(0)) fs.rmSync(folder, { recursive: true, force: true });
  });

  const capture = (): { readonly log: (line: string) => void; readonly error: (line: string) => void; readonly lines: string[]; readonly errors: string[] } => {
    const lines: string[] = [];
    const errors: string[] = [];
    return { log: (line) => lines.push(line), error: (line) => errors.push(line), lines, errors };
  };

  it('defaults to the content package: parts/, art/generated/ and art/final/', () => {
    const root = fileURLToPath(new URL('../../../', import.meta.url));
    expect(path.relative(root, DEFAULT_ART_OPTIONS.parts)).toBe(path.join('packages', 'content', 'parts'));
    expect(path.relative(root, DEFAULT_ART_OPTIONS.out)).toBe(path.join('packages', 'content', 'art', 'generated'));
    expect(path.relative(root, DEFAULT_ART_OPTIONS.final)).toBe(path.join('packages', 'content', 'art', 'final'));
  });

  it('reads --parts, --out and --final against the working folder', () => {
    expect(parseArtArgs(['--parts', 'a', '--out=b', '--', '--final', '/c'], '/work')).toEqual({ parts: path.resolve('/work', 'a'), out: path.resolve('/work', 'b'), final: path.resolve('/c') });
    expect(parseArtArgs([], '/work')).toEqual(DEFAULT_ART_OPTIONS);
    expect(() => parseArtArgs(['--colour', 'red'], '/work')).toThrow("Unknown argument '--colour'.");
    expect(() => parseArtArgs(['--out'], '/work')).toThrow('--out needs a folder.');
    expect(() => parseArtArgs(['--out', '--final', 'x'], '/work')).toThrow('--out needs a folder.');
  });

  it('prints a summary and exits 0, warning about final files it does not use', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'servo-art-'));
    made.push(root);
    const partsFolder = path.join(root, 'parts');
    fs.mkdirSync(partsFolder);
    exampleParts.forEach((record, index) => fs.writeFileSync(path.join(partsFolder, `${index}.json`), JSON.stringify(record)));
    fs.mkdirSync(path.join(root, 'final', 'part'), { recursive: true });
    fs.writeFileSync(path.join(root, 'final', 'part', 'wheel-large.png'), 'final render');
    fs.writeFileSync(path.join(root, 'final', 'part', 'whee-large.png'), 'final render');
    const output = capture();
    expect(runArt(['--parts', 'parts', '--out', 'generated', '--final', 'final'], root, output)).toBe(0);
    expect(output.lines).toEqual([
      expect.stringMatching(/^Read 14 part records from .*parts\.$/),
      expect.stringMatching(/^Wrote 14 placeholders and registry\.json to .*generated\.$/),
      expect.stringMatching(/^14 art keys: 13 show the placeholder, 1 a final render from .*final\.$/),
    ]);
    expect(output.errors).toEqual([expect.stringMatching(/^Not used: part\/whee-large\.png in .*final: no part has the art key 'part\/whee-large'\.$/)]);
  });

  it('prints problems and exits 1 instead of throwing', () => {
    const output = capture();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'servo-art-'));
    made.push(root);
    expect(runArt(['--parts', 'nowhere'], root, output)).toBe(1);
    expect(output.errors).toEqual([expect.stringMatching(/^No part records: .*nowhere does not exist\.\n {2}- Part records are JSON files/)]);
    expect(runArt(['--colour'], root, output)).toBe(1);
  });

  it('prints its usage for --help', () => {
    const output = capture();
    expect(runArt(['--help'], '/work', output)).toBe(0);
    expect(output.lines[0]).toMatch(/^Usage: pnpm art \[--parts <folder>\] \[--out <folder>\] \[--final <folder>\]/);
  });
});
