/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import { exampleArenas, exampleChallenges, exampleParts, validBlueprints, validKits } from '@servo/schema/fixtures';
import type { RunInput } from '@servo/schema';
import { FIXTURES, fixturesFrom, loadFixtures } from '../src/fixtures.ts';
import type { FixtureSpec } from '../src/fixtures.ts';
import {
  contentFrom,
  loadArenas,
  loadArtRegistry,
  loadCatalogue,
  loadChallenges,
  loadContent,
  loadKits,
  loadParts,
  loadTerminology,
} from '../src/index.ts';
import type { ContentIssue, ContentLoad } from '../src/index.ts';

type Json = Record<string, unknown>;

const json = (value: unknown): Json => JSON.parse(JSON.stringify(value)) as Json;
const idOf = (value: unknown): string => String(json(value).id);
const levelOf = (part: unknown): unknown => (json(part).identity as Json).level;
const shown = (issues: readonly ContentIssue[]): string[] => issues.map(({ file, code, path }) => `${file} ${code} at ${path}`);

/** The schema's example records laid out as packages/content lays out its own. */
const exampleTree = (): Record<string, unknown> => ({
  ...Object.fromEntries(exampleParts.map((part) => [`parts/level-${String(levelOf(part))}/${idOf(part)}.json`, json(part)])),
  ...Object.fromEntries(exampleArenas.map((arena) => [`arenas/${idOf(arena)}.json`, json(arena)])),
  ...Object.fromEntries(validKits.map((kit) => [`kits/${kit.name}.json`, json(kit.data)])),
  ...Object.fromEntries(exampleChallenges.map((challenge) => [`challenges/level-${String(json(challenge.data).level)}/${challenge.name}.json`, json(challenge.data)])),
});

const ids = (load: ContentLoad) => ({
  parts: load.content.parts.map((part) => part.id),
  arenas: load.content.arenas.map((arena) => arena.id),
  kits: load.content.kits.map((kit) => kit.id),
  challenges: load.content.challenges.map((challenge) => challenge.id),
});

const fileNames = (files: Record<string, unknown>): string[] => Object.keys(files).map((file) => file.slice(file.lastIndexOf('/') + 1));

describe('the content in this package', () => {
  it('loads with no issues', () => {
    expect(loadContent().issues.map(({ file, code, path, message }) => `${file} ${code} at ${path}: ${message}`)).toEqual([]);
  });

  it('loads one record from every file in each record folder', () => {
    const counts = {
      parts: fileNames(import.meta.glob('../parts/**/*.json')).length,
      arenas: fileNames(import.meta.glob('../arenas/**/*.json')).length,
      kits: fileNames(import.meta.glob('../kits/**/*.json')).length,
      challenges: fileNames(import.meta.glob('../challenges/**/*.json')).length,
    };
    const loaded = ids(loadContent());
    expect({
      parts: loaded.parts.length,
      arenas: loaded.arenas.length,
      kits: loaded.kits.length,
      challenges: loaded.challenges.length,
    }).toEqual(counts);
    expect(loaded.arenas.length).toBeGreaterThan(0);
  });

  it('gives the single loaders the same content', () => {
    const { content } = loadContent();
    expect(loadParts()).toBe(content.parts);
    expect(loadArenas()).toBe(content.arenas);
    expect(loadKits()).toBe(content.kits);
    expect(loadChallenges()).toBe(content.challenges);
    expect(loadCatalogue()).toBe(content.catalogue);
    expect(loadTerminology()).toBe(content.terminology);
    expect(loadArtRegistry()).toBe(content.art);
    expect([...(content.catalogue.arenas?.keys() ?? [])].sort()).toEqual(content.arenas.map((arena) => arena.id));
  });

  it('resolves every art key pnpm art has written to a URL, and has none before it runs', () => {
    for (const [key, entry] of loadArtRegistry()) {
      expect(key).toMatch(/^[a-z]/);
      expect(entry.src.length).toBeGreaterThan(0);
    }
  });

  it('has a valid fixture for every entry in FIXTURES, and uses every fixture blueprint', () => {
    const load = loadFixtures();
    expect(shown(load.issues)).toEqual([]);
    expect(load.fixtures.map((fixture) => fixture.name)).toEqual(Object.keys(FIXTURES).sort());
  });

  it('has a picture for every part once pnpm art has written the registry', () => {
    const { content } = loadContent();
    const missing = content.art.size === 0 ? [] : content.parts.filter((part) => !content.art.has(part.identity.art)).map((part) => part.identity.art);
    expect(missing).toEqual([]);
  });
});

describe('contentFrom', () => {
  it('types, checks and keeps every valid record, each list in id order', () => {
    const load = contentFrom({ records: exampleTree() });
    expect(shown(load.issues)).toEqual([]);
    const loaded = ids(load);
    expect(loaded.parts).toHaveLength(14);
    expect(loaded.arenas).toEqual(['open-floor', 'ramp', 'wall-stop']);
    expect(loaded.kits).toEqual(['circuit-crew', 'rolling-start']);
    expect(loaded.challenges).toEqual(['cross-and-stop', 'drive-and-light', 'meet-the-switch', 'one-motor-backwards']);
    expect(loaded.parts).toEqual(loaded.parts.toSorted());
    expect(load.content.catalogue.parts.size).toBe(14);
    expect(load.content.catalogue.kits?.size).toBe(2);
  });

  it('types a file by its nearest record folder, at any depth, as the content validator does', () => {
    const led = exampleTree()['parts/level-1/led.json'];
    const kit = json(validKits[0]?.data);
    const load = contentFrom({ records: { 'parts/deep/er/led.json': led, 'parts/level-1/a-kit.json': kit } });
    expect(ids(load).parts).toEqual(['led']);
    expect(ids(load).kits).toEqual([]);
    // A kit filed in parts/ is a part record, and the part validator refuses it.
    expect(load.issues.every((issue) => issue.file === 'parts/level-1/a-kit.json')).toBe(true);
    expect(load.issues.map((issue) => issue.path)).toContain('$.identity');
  });

  it('types a file below no record folder by the fields only one kind has', () => {
    const led = exampleTree()['parts/level-1/led.json'];
    const load = contentFrom({ records: { 'misc/led.json': led, 'misc/odd.json': { hello: 1 }, 'misc/both.json': { tray: [], wires: [] } } });
    expect(ids(load).parts).toEqual(['led']);
    expect(shown(load.issues)).toEqual(['misc/both.json file.unknown_kind at $', 'misc/odd.json file.unknown_kind at $']);
    expect(load.issues[0]?.message).toContain('kit, blueprint');
  });

  it("keeps the first of two records with one id in the content validator's walk order", () => {
    const first = json(exampleTree()['parts/level-1/led.json']);
    const second = { ...first, card: { ...(first.card as Json), does: 'A second copy.' } };
    // The walk visits folder a/ before the file a-b.json, though '-' sorts before '/'.
    const load = contentFrom({ records: { 'parts/a-b.json': second, 'parts/a/led.json': first } });
    expect(load.content.parts.map((part) => part.card.does)).toEqual([(first.card as Json).does]);
    expect(shown(load.issues)).toEqual(['parts/a-b.json content.duplicate_id at $.id']);
    expect(load.issues[0]?.message).toContain('parts/a/led.json');
  });

  it('checks kits against the parts and arenas, and challenges against all three', () => {
    const records = exampleTree();
    const broken = { ...json(records['kits/rolling-start.json']), tray: undefined };
    const load = contentFrom({ records: { ...records, 'kits/rolling-start.json': broken } });
    expect(ids(load).kits).toEqual(['circuit-crew']);
    expect(ids(load).challenges).toEqual(['cross-and-stop', 'drive-and-light']);
    expect(load.issues.filter((issue) => issue.code === 'ref.unknown_kit').map((issue) => issue.file)).toEqual([
      'challenges/level-1/meet-the-switch.json',
      'challenges/level-2/one-motor-backwards.json',
    ]);
  });

  it('leaves out a record with issues, keeps the rest, and lists issues file by file in walk order', () => {
    const records = exampleTree();
    const led = json(records['parts/level-1/led.json']);
    const load = contentFrom({
      records: { ...records, 'parts/level-1/led.json': { ...led, identity: undefined }, 'arenas/ramp.json': { ...json(records['arenas/ramp.json']), size: 3 } },
    });
    expect(ids(load).parts).toHaveLength(13);
    expect(ids(load).arenas).toEqual(['open-floor', 'wall-stop']);
    const files = load.issues.map((issue) => issue.file);
    expect(files[0]).toBe('arenas/ramp.json');
    expect(files).toContain('parts/level-1/led.json');
    expect(files).toEqual(files.toSorted());
  });

  it('types blueprints and run records and leaves them alone', () => {
    const blueprint = validBlueprints[0]?.data;
    const load = contentFrom({ records: { ...exampleTree(), 'blueprints/a.json': blueprint, 'run-records/b.json': { anything: true } } });
    expect(shown(load.issues)).toEqual([]);
    expect(ids(load).parts).toHaveLength(14);
  });

  it('reads terminology files as authored, in name order', () => {
    const load = contentFrom({ records: {}, terminology: { 'terminology/components.json': { components: [] }, 'terminology/banned.json': { banned: [] } } });
    expect(load.content.terminology).toEqual([
      { id: 'banned', data: { banned: [] } },
      { id: 'components', data: { components: [] } },
    ]);
  });
});

describe('the art registry', () => {
  const pictures = { 'art/generated/part/led.svg': 'url:led', 'art/final/part/dc-motor.PNG': 'url:dc-motor' };

  it("reads registry.json as task 0.6 writes it: src relative to the generated folder, finals through '../final/'", () => {
    const registry = {
      'part/dc-motor': { src: '../final/part/dc-motor.PNG', isPlaceholder: false },
      'part/led': { src: 'part/led.svg', isPlaceholder: true },
    };
    const load = contentFrom({ records: {}, registry, pictures });
    expect(shown(load.issues)).toEqual([]);
    expect([...load.content.art]).toEqual([
      ['part/dc-motor', { src: 'url:dc-motor', isPlaceholder: false }],
      ['part/led', { src: 'url:led', isPlaceholder: true }],
    ]);
  });

  it('gives nothing for a key the registry lacks, so the canvas draws a neutral tile', () => {
    const load = contentFrom({ records: {}, registry: { 'part/led': { src: 'part/led.svg', isPlaceholder: true } }, pictures });
    expect(load.content.art.get('part/servo-motor')).toBeUndefined();
  });

  it('has no art and no issue before pnpm art has run', () => {
    const load = contentFrom({ records: {}, pictures });
    expect(load.content.art.size).toBe(0);
    expect(load.issues).toEqual([]);
  });

  it('leaves out an entry whose picture is missing or outside art/, with an issue', () => {
    const registry = {
      'part/gone': { src: 'part/gone.svg', isPlaceholder: true },
      'part/escape': { src: '../../package.json', isPlaceholder: true },
      'part/led': { src: 'part/led.svg', isPlaceholder: true },
    };
    const load = contentFrom({ records: {}, registry, pictures });
    expect([...load.content.art.keys()]).toEqual(['part/led']);
    expect(shown(load.issues)).toEqual([
      "art/generated/registry.json value.missing at $['part/escape'].src",
      "art/generated/registry.json value.missing at $['part/gone'].src",
    ]);
  });

  it('refuses a registry that is not a map of { src, isPlaceholder }', () => {
    expect(shown(contentFrom({ records: {}, registry: [] }).issues)).toEqual(['art/generated/registry.json value.wrong_type at $']);
    const entry = contentFrom({ records: {}, registry: { 'part/led': { src: 'part/led.svg' } }, pictures });
    expect(shown(entry.issues)).toEqual(["art/generated/registry.json value.wrong_type at $['part/led']"]);
  });
});

describe('fixturesFrom', () => {
  const content = contentFrom({ records: exampleTree() }).content;
  const blueprintOf = (name: string): Json => json(validBlueprints.find((fixture) => fixture.name === name)?.data);
  const start = json(exampleChallenges.find((challenge) => challenge.name === 'meet-the-switch')?.data).start as Json;
  /** Meet the switch, finished: the battery pack's plus to side A, and side B to the motor's plus. */
  const wired = {
    ...start,
    wires: [
      ...(start.wires as unknown[]),
      { id: 'w2', from: { part: 'battery', port: 'plus' }, to: { part: 'switch', port: 'a' } },
      { id: 'w3', from: { part: 'motor', port: 'plus' }, to: { part: 'switch', port: 'b' } },
    ],
    meta: { ...(start.meta as Json), highWater: { parts: 0, wires: 3 } },
  };
  const files = {
    'fixtures/blueprints/bumper-robot.json': blueprintOf('bumper-robot'),
    'fixtures/blueprints/meet-the-switch-wired.json': wired,
    'fixtures/blueprints/rolling-start.json': blueprintOf('rolling-start'),
    'fixtures/blueprints/short-circuit.json': blueprintOf('short-circuit'),
  };
  const press: RunInput = { tick: 30, partId: 'switch', kind: 'switch', closed: false };
  const noCircuit = { partId: 'motor', failure: 'no-circuit' };
  const shorted = { partId: 'battery', failure: 'short-circuit' };
  const specs: Record<string, FixtureSpec> = {
    'meet-the-switch-pressed': {
      description: 'Wired through the switch, then pressed: the motor turns, then stands still.',
      blueprint: 'meet-the-switch-wired',
      challenge: 'meet-the-switch',
      inputs: [press],
      ticks: 90,
      expect: { goal: { met: true }, faults: [] },
    },
    'meet-the-switch-not-pressed': {
      description: 'Wired through the switch, and never pressed.',
      blueprint: 'meet-the-switch-wired',
      challenge: 'meet-the-switch',
      inputs: [],
      ticks: 90,
      expect: { goal: { met: false }, faults: [] },
    },
    'meet-the-switch-start': {
      description: "The challenge's own starting build: the motor has no circuit.",
      challenge: 'meet-the-switch',
      inputs: [],
      ticks: 30,
      expect: { goal: { met: false }, faults: [noCircuit] },
    },
    'rolling-start': { description: 'A Rolling Start robot drives forward.', blueprint: 'rolling-start', inputs: [], ticks: 60, seed: 7, expect: { faults: [] } },
    'short-circuit': { description: 'A wire across the 1-cell pack.', blueprint: 'short-circuit', inputs: [], ticks: 30, expect: { faults: [shorted], namedFault: shorted } },
    'power-into-signal': {
      description: "A power line dropped on the servo motor's signal port.",
      blueprint: 'bumper-robot',
      inputs: [],
      ticks: 1,
      expect: { faults: [], refused: { from: { part: 'battery', port: 'plus' }, to: { part: 'servo', port: 'signal' }, code: 'wire.type_mismatch' } },
    },
  };

  it("holds a challenge's passing and failing Runs, with the switch press the passing one needs", () => {
    const load = fixturesFrom(files, specs, content);
    expect(shown(load.issues)).toEqual([]);
    expect(load.fixtures.map((fixture) => fixture.name)).toEqual(Object.keys(specs).sort());
    const pressed = load.fixtures.find((fixture) => fixture.name === 'meet-the-switch-pressed');
    expect(pressed).toMatchObject({ challenge: 'meet-the-switch', inputs: [press], ticks: 90, seed: 1, expect: { goal: { met: true } } });
    expect(pressed?.blueprint.wires).toHaveLength(3);
    // With no blueprint named, the Run starts from the challenge's own start.
    expect(load.fixtures.find((fixture) => fixture.name === 'meet-the-switch-start')?.blueprint.meta.id).toBe((start.meta as Json).id);
    expect(load.fixtures.find((fixture) => fixture.name === 'rolling-start')?.seed).toBe(7);
  });

  it('serves working and broken fixtures with no challenge (task 2.6)', () => {
    const load = fixturesFrom(files, specs, content);
    expect(load.fixtures.find((fixture) => fixture.name === 'short-circuit')?.expect).toEqual({ faults: [shorted], namedFault: shorted });
    expect(load.fixtures.find((fixture) => fixture.name === 'power-into-signal')?.expect.refused?.code).toBe('wire.type_mismatch');
  });

  it('reports every way a fixture disagrees with its blueprint or the content, and leaves it out', () => {
    const bad: Record<string, FixtureSpec> = {
      'no-such-blueprint': { description: 'x', blueprint: 'nowhere', inputs: [], ticks: 10, expect: { faults: [] } },
      'no-such-challenge': { description: 'x', blueprint: 'rolling-start', challenge: 'nowhere', inputs: [], ticks: 10, expect: { faults: [] } },
      'no-start': { description: 'x', challenge: 'drive-and-light', inputs: [], ticks: 10, expect: { faults: [] } },
      'wrong-arena': { description: 'x', blueprint: 'rolling-start', challenge: 'cross-and-stop', inputs: [], ticks: 10, expect: { goal: { met: false }, faults: [] } },
      'bad-run': {
        description: 'x',
        blueprint: 'meet-the-switch-wired',
        inputs: [press, { tick: 10, partId: 'motor', kind: 'switch', closed: true }, { tick: 99, partId: 'switch', kind: 'switch', closed: true }],
        ticks: 50.5,
        seed: -1,
        expect: {
          goal: { met: true },
          faults: [noCircuit, noCircuit, { partId: 'motor', failure: 'melted' }, { partId: 'ghost', failure: 'no-circuit' }],
          namedFault: { partId: 'battery', failure: 'no-loop' },
        },
      },
      'legal-wire': {
        description: 'x',
        blueprint: 'bumper-robot',
        inputs: [],
        ticks: 1,
        expect: { faults: [], refused: { from: { part: 'battery', port: 'plus' }, to: { part: 'buzzer', port: 'plus' }, code: 'wire.type_mismatch' } },
      },
    };
    const load = fixturesFrom({ ...files, 'fixtures/blueprints/broken.json': { version: 1 } }, bad, content);
    expect(load.fixtures).toEqual([]);
    const reasons = shown(load.issues);
    expect(reasons.filter((reason) => reason.startsWith('src/fixtures.ts'))).toEqual([
      "src/fixtures.ts value.out_of_range at $['bad-run'].ticks",
      "src/fixtures.ts value.out_of_range at $['bad-run'].seed",
      "src/fixtures.ts run.goal_without_challenge at $['bad-run'].expect.goal",
      "src/fixtures.ts run.event_order at $['bad-run'].inputs[1].tick",
      "src/fixtures.ts value.not_allowed at $['bad-run'].inputs[1].partId",
      "src/fixtures.ts run.tick_out_of_range at $['bad-run'].inputs[2].tick",
      "src/fixtures.ts value.duplicate at $['bad-run'].expect.faults[1]",
      "src/fixtures.ts ref.unknown_failure_mode at $['bad-run'].expect.faults[2].failure",
      "src/fixtures.ts ref.unknown_placed_part at $['bad-run'].expect.faults[3].partId",
      "src/fixtures.ts value.inconsistent at $['bad-run'].expect.namedFault",
      "src/fixtures.ts value.inconsistent at $['legal-wire'].expect.refused",
      "src/fixtures.ts fixture.unknown_blueprint at $['no-start']",
      "src/fixtures.ts fixture.unknown_blueprint at $['no-such-blueprint'].blueprint",
      "src/fixtures.ts fixture.unknown_challenge at $['no-such-challenge'].challenge",
      "src/fixtures.ts challenge.arena_mismatch at $['wrong-arena'].blueprint",
    ]);
    expect(reasons).toContain('fixtures/blueprints/short-circuit.json fixture.unused_blueprint at $');
    expect(reasons.some((reason) => reason.startsWith('fixtures/blueprints/broken.json value.'))).toBe(true);
  });
});
