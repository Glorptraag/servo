import fs from 'node:fs';
import path from 'node:path';
import { ISSUE_CODES } from '@servo/schema';
import { exampleArenas, exampleParts, invalidBlueprints, invalidKits, validKits } from '@servo/schema/fixtures';
import { afterEach, describe, expect, it } from 'vitest';
import * as tools from '../src/index.ts';
import { CONTENT_ISSUE_CODES } from '../src/validate-content/codes.ts';
import { validateContent } from '../src/validate-content/validate.ts';
import {
  changed,
  cli,
  idOf,
  partFixture,
  removeTempFolders,
  shown,
  spawnCli,
  tempFolder,
  TERMINOLOGY,
  write,
  writeSchemaFixtures,
} from './validate-content/support.ts';

afterEach(removeTempFolders);

const SUMMARY = /^validate-content: \d+ records? checked, /;
const issueLines = (out: readonly string[]): string[] => out.filter((line) => !line.startsWith('note: ') && !SUMMARY.test(line));
const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** An issue line for a code at a path, whatever the file and message. */
const issueAt = (code: string, at: string): RegExp => new RegExp(`^.+: ${escape(code)} at ${escape(at)}: `);

/** A part record with one thing changed, written under parts/ in a fresh folder. */
const partFile = (name: string, change: (part: Record<string, unknown>) => void): string =>
  write(tempFolder(), `parts/${name}.json`, changed(partFixture('dc-motor'), change));

const identity = (part: Record<string, unknown>): Record<string, unknown> => part.identity as Record<string, unknown>;
const ports = (part: Record<string, unknown>): Record<string, unknown>[] => part.ports as Record<string, unknown>[];
const card = (part: Record<string, unknown>): Record<string, unknown> => part.card as Record<string, unknown>;

describe('done when: rejects a character-style name or a missing port type, with a readable message and a non-zero exit', () => {
  it('rejects a part named like a character', () => {
    const file = partFile('sparky', (part) => {
      identity(part).name = 'Sparky';
    });
    const run = spawnCli([file, '--terminology', TERMINOLOGY], path.dirname(path.dirname(file)));
    expect(run.status).toBe(1);
    expect(run.stdout.split('\n')).toContain(
      "parts/sparky.json: terminology.not_real_name at $.identity.name: 'Sparky' contains no real component name. A part's name is built on a real name from the components list.",
    );
    expect(run.stdout).toMatch(/^validate-content: 1 record checked, 1 issue in 1 file\.$/m);
  });

  it('rejects the brief\'s banned character-style names', () => {
    for (const name of ['brain-y bit', 'zappy wire']) {
      const run = cli([partFile('character', (part) => (identity(part).name = name)), '--terminology', TERMINOLOGY]);
      expect(run.status).toBe(1);
      expect(issueLines(run.out).map((line) => line.split(': ')[1])).toEqual([
        'terminology.banned at $.identity.name',
        'terminology.not_real_name at $.identity.name',
      ]);
    }
  });

  it('rejects a character name beside the real name', () => {
    const run = cli([partFile('sparky', (part) => (identity(part).name = 'Sparky the DC motor')), '--terminology', TERMINOLOGY]);
    expect(run.status).toBe(1);
    expect(issueLines(run.out)).toEqual([expect.stringMatching(/: terminology\.proper_name at \$\.identity\.name: 'Sparky' is capitalised outside the real name/)]);
  });

  it('rejects a port with no type', () => {
    const file = partFile('no-port-type', (part) => {
      delete ports(part)[0]?.type;
    });
    const run = spawnCli([file, '--terminology', TERMINOLOGY], path.dirname(path.dirname(file)));
    expect(run.status).toBe(1);
    expect(run.stdout.split('\n')).toContain("parts/no-port-type.json: value.missing at $.ports[0].type: Missing 'type'.");
  });

  it('rejects a banned word in system text, but not a real term that holds it (D22)', () => {
    const file = partFile('scoring', (part) => {
      card(part).popularMechanics = 'Score points with it, like the mount points on a go-kart.';
    });
    const run = cli([file, '--terminology', TERMINOLOGY]);
    expect(run.status).toBe(1);
    expect(issueLines(run.out)).toEqual([
      `${shown(file)}: terminology.banned at $.card.popularMechanics: 'points' is on the banned list: Servo keeps no score (ground rule 7, D22).`,
    ]);
  });

  it('leaves exclamation marks to the schema', () => {
    const run = cli([partFile('shout', (part) => (card(part).does = 'Spins fast!')), '--terminology', TERMINOLOGY]);
    expect(run.status).toBe(1);
    expect(issueLines(run.out)).toEqual([expect.stringContaining(': text.exclamation at $.card.does: ')]);
  });
});

describe('done when: accepts the schema fixtures', () => {
  it('accepts every valid schema fixture, laid out as content, against its own catalogue', () => {
    const folder = tempFolder();
    const files = writeSchemaFixtures(folder);
    const run = cli([folder, '--catalogue', folder, '--terminology', TERMINOLOGY]);
    expect(issueLines(run.out)).toEqual([]);
    expect(run.out).toContain(`validate-content: ${files.length} records checked, no issues.`);
    expect(run.status).toBe(0);
  });

  it('accepts them from the command line too', () => {
    const folder = tempFolder();
    writeSchemaFixtures(folder);
    const run = spawnCli(['.', '--catalogue', '.', '--terminology', TERMINOLOGY], folder);
    expect(run.stderr).toBe('');
    expect(run.stdout).toMatch(/^validate-content: \d+ records checked, no issues\.$/m);
    expect(run.status).toBe(0);
  });

  it.each(invalidBlueprints.map((fixture) => [fixture.name, fixture] as const))('refuses the invalid blueprint %s for its one recorded reason', (name, fixture) => {
    const folder = tempFolder();
    writeSchemaFixtures(folder);
    const file = write(folder, `fixtures/blueprints/invalid/${name}.json`, fixture.data);
    const run = cli([file, '--catalogue', folder, '--terminology', TERMINOLOGY]);
    expect(run.status).toBe(1);
    expect(issueLines(run.out)).toEqual([expect.stringMatching(issueAt(fixture.expect.code, fixture.expect.path))]);
  });

  it.each(invalidKits.map((fixture) => [fixture.name, fixture] as const))('refuses the invalid kit %s for its one recorded reason', (name, fixture) => {
    const folder = tempFolder();
    writeSchemaFixtures(folder);
    const file = write(folder, `kits/invalid/${name}.json`, fixture.data);
    const run = cli([file, '--catalogue', folder, '--terminology', TERMINOLOGY]);
    expect(run.status).toBe(1);
    expect(issueLines(run.out)).toEqual([expect.stringMatching(issueAt(fixture.expect.code, fixture.expect.path))]);
  });
});

describe('files that are not records', () => {
  it('reports a file that is not JSON, and one whose kind is unknown', () => {
    const folder = tempFolder();
    write(folder, 'parts/broken.json', '{ "id": "led", ');
    write(folder, 'loose/thing.json', { name: 'thing' });
    write(folder, 'loose/both.json', { tray: [], goalLine: 'Go' });
    const run = cli([folder, '--terminology', TERMINOLOGY]);
    expect(run.status).toBe(1);
    expect(issueLines(run.out).map((line) => line.replace(/^.*?(loose|parts)\//, '$1/'))).toEqual([
      'loose/both.json: file.unknown_kind at $: Its kind is unknown: it is in no record folder and has fields of more than one kind (kit, challenge). Put it in one of parts/, arenas/, kits/, challenges/, blueprints/, run-records/.',
      'loose/thing.json: file.unknown_kind at $: Its kind is unknown: it is in no record folder and has the fields of no record. Put it in one of parts/, arenas/, kits/, challenges/, blueprints/, run-records/.',
      expect.stringMatching(/^parts\/broken\.json: file\.bad_json at \$: Not valid JSON: /),
    ]);
  });

  it('classifies a record outside the record folders by its fields', () => {
    const folder = tempFolder();
    write(folder, 'loose/dc-motor.json', partFixture('dc-motor'));
    const run = cli([folder, '--terminology', TERMINOLOGY]);
    expect(run.out).toEqual(['validate-content: 1 record checked, no issues.']);
  });

  it('reports a second record of the same kind with the same id', () => {
    const folder = tempFolder();
    write(folder, 'parts/level-1/dc-motor.json', partFixture('dc-motor'));
    const second = write(folder, 'parts/level-2/dc-motor-copy.json', partFixture('dc-motor'));
    write(folder, 'arenas/dc-motor.json', changed(exampleArenas[0] as Record<string, unknown>, (arena) => (arena.id = 'dc-motor')));
    write(folder, 'parts/level-2/broken-copy.json', changed(partFixture('dc-motor'), (part) => delete part.card));
    const run = cli([folder, '--terminology', TERMINOLOGY]);
    expect(run.status).toBe(1);
    // The broken copy claims no id: only records that pass the schema can enter a catalogue.
    expect(issueLines(run.out)).toEqual([
      expect.stringMatching(/broken-copy\.json: value\.missing at \$\.card: Missing 'card'\.$/),
      `${shown(second)}: content.duplicate_id at $.id: Another part record already uses the id 'dc-motor': ${shown(path.join(folder, 'parts/level-1/dc-motor.json'))}.`,
    ]);
  });
});

describe('the catalogue', () => {
  const kit = validKits.find((fixture) => fixture.name === 'rolling-start')?.data;

  it('falls back to the schema fixtures while the content folder has no part records, and says so', () => {
    const content = tempFolder();
    const file = write(tempFolder(), 'kits/rolling-start.json', kit);
    const run = cli([file, '--terminology', TERMINOLOGY], { contentDir: content });
    expect(run.status).toBe(0);
    expect(run.out).toContain(
      `note: Catalogue: 14 part records, 3 arena presets and 2 kits from @servo/schema/fixtures, because ${shown(content)} holds no part records.`,
    );
  });

  it('uses the content folder once it has part records, so a kit naming a missing part is refused', () => {
    const content = tempFolder();
    write(content, 'parts/level-1/dc-motor.json', partFixture('dc-motor'));
    write(content, 'parts/level-1/broken.json', '{');
    const file = write(tempFolder(), 'kits/rolling-start.json', kit);
    const run = cli([file, '--terminology', TERMINOLOGY], { contentDir: content });
    expect(run.status).toBe(1);
    expect(issueLines(run.out)).toContainEqual(expect.stringContaining(": ref.unknown_part_type at $.parts[0].part: No part record has the id 'battery-pack-2-cell'."));
    expect(run.out).toContain(`note: Catalogue: 1 part record, 0 arena presets and 0 kits from ${shown(content)}.`);
    expect(run.out).toContain(`note: The catalogue leaves out ${shown(path.join(content, 'parts/level-1/broken.json'))}, which cannot be read or does not validate.`);
  });

  it('uses --catalogue as given, without falling back', () => {
    const empty = tempFolder();
    const file = write(tempFolder(), 'kits/rolling-start.json', kit);
    const run = cli([file, '--catalogue', empty, '--terminology', TERMINOLOGY]);
    expect(run.status).toBe(1);
    expect(run.out).toContain(`note: Catalogue: 0 part records, 0 arena presets and 0 kits from ${shown(empty)}.`);
  });

  it('is not built when only parts and arenas are checked', () => {
    const run = cli([partFile('dc-motor', () => undefined), '--terminology', TERMINOLOGY]);
    expect(run.out.filter((line) => line.startsWith('note: Catalogue'))).toEqual([]);
  });

  it('checks its kits against its own parts, so a kit naming a missing part is left out', () => {
    const catalogue = tempFolder();
    for (const part of exampleParts.filter((record) => idOf(record) !== 'caster')) write(catalogue, `parts/${idOf(part)}.json`, part);
    const leftOut = write(catalogue, 'kits/rolling-start.json', kit);
    const challenge = write(tempFolder(), 'challenges/meet-the-kit.json', {});
    const run = cli([challenge, '--catalogue', catalogue, '--terminology', TERMINOLOGY]);
    expect(run.out).toContain(`note: Catalogue: 13 part records, 0 arena presets and 0 kits from ${shown(catalogue)}.`);
    expect(run.out).toContain(`note: The catalogue leaves out ${shown(leftOut)}, which cannot be read or does not validate.`);
  });
});

describe('terminology files', () => {
  it('runs with notes, not failures, while the terminology lists do not exist', () => {
    const content = tempFolder();
    const run = cli([partFile('sparky', (part) => (identity(part).name = 'Sparky'))], { contentDir: content });
    expect(run.status).toBe(0);
    expect(run.out).toEqual([
      `note: No components list at ${shown(path.join(content, 'terminology/components.json'))}, so part names are not checked against real component names.`,
      `note: No banned list at ${shown(path.join(content, 'terminology/banned.json'))}, so text is not checked for banned words.`,
      'validate-content: 1 record checked, no issues.',
    ]);
  });

  it('reads the default lists from the content folder', () => {
    const content = tempFolder();
    fs.cpSync(TERMINOLOGY, path.join(content, 'terminology'), { recursive: true });
    const run = cli([partFile('sparky', (part) => (identity(part).name = 'Sparky'))], { contentDir: content });
    expect(run.status).toBe(1);
    expect(issueLines(run.out)).toEqual([expect.stringContaining(': terminology.not_real_name at $.identity.name: ')]);
  });

  it('fails the run when a terminology file is malformed', () => {
    const terms = tempFolder();
    write(terms, 'banned.json', { banned: [{ phrase: 'coins' }] });
    const run = cli([partFile('dc-motor', () => undefined), '--terminology', terms]);
    expect(run.status).toBe(1);
    expect(issueLines(run.out)).toEqual([
      `${shown(path.join(terms, 'banned.json'))}: terminology.bad_file at $.banned[0].reason: Missing 'reason'.`,
    ]);
  });
});

describe('the command', () => {
  it('prints issues, then notes, then one summary line', () => {
    const content = tempFolder();
    const file = partFile('sparky', (part) => {
      identity(part).name = 'Sparky';
      delete ports(part)[0]?.type;
    });
    const run = cli([file], { contentDir: content });
    expect(run.out.map((line) => line.replace(/^.*parts\//, 'parts/'))).toEqual([
      "parts/sparky.json: value.missing at $.ports[0].type: Missing 'type'.",
      expect.stringMatching(/^note: No components list at /),
      expect.stringMatching(/^note: No banned list at /),
      'validate-content: 1 record checked, 1 issue in 1 file.',
    ]);
  });

  it('resolves paths, and shows them, from the folder it was run in', () => {
    const folder = tempFolder();
    write(folder, 'parts/a.json', changed(partFixture('led'), (part) => (identity(part).name = 'Sparky')));
    write(folder, 'parts/b.json', changed(partFixture('dc-motor'), (part) => delete ports(part)[0]?.type));
    const run = cli(['parts', '--terminology', TERMINOLOGY], { cwd: folder });
    expect(issueLines(run.out).map((line) => line.split(' at ')[0])).toEqual(['parts/a.json: terminology.not_real_name', 'parts/b.json: value.missing']);
    expect(run.out.at(-1)).toBe('validate-content: 2 records checked, 2 issues in 2 files.');
    const elsewhere = cli([path.join(folder, 'parts'), '--terminology', TERMINOLOGY], { cwd: tempFolder() });
    expect(issueLines(elsewhere.out).map((line) => line.split(': ')[0])).toEqual([path.join(folder, 'parts/a.json'), path.join(folder, 'parts/b.json')]);
  });

  it('checks several paths, each file once', () => {
    const file = partFile('dc-motor', () => undefined);
    const run = cli([file, path.dirname(file), file, '--terminology', TERMINOLOGY]);
    expect(run.out).toEqual(['validate-content: 1 record checked, no issues.']);
  });

  it.each([
    ['no path', [], /Name a record file, or a folder of records, to check/],
    ['an unknown option', ['--catalog', 'x', '.'], /Unknown option '--catalog'/],
    ['a missing option value', ['.', '--catalogue'], /--catalogue/],
    ['a path that does not exist', ['no-such-folder'], /No such file or folder: no-such-folder/],
    ['a folder with no records', ['empty'], /No \.json records in empty/],
    ['a catalogue that is not a folder', ['parts', '--catalogue', 'parts/led.json'], /--catalogue is not a folder: parts\/led\.json/],
    ['a terminology folder that does not exist', ['parts', '--terminology', 'nowhere'], /--terminology is not a folder: nowhere/],
  ])('exits 2 on misuse: %s', (_case, argv, message) => {
    const folder = tempFolder();
    write(folder, 'parts/led.json', partFixture('led'));
    fs.mkdirSync(path.join(folder, 'empty'));
    const run = cli(argv, { cwd: folder });
    expect(run.status).toBe(2);
    expect(run.out).toEqual([]);
    expect(run.err.join('\n')).toMatch(message);
  });

  it('prints help', () => {
    const run = cli(['--help']);
    expect(run.status).toBe(0);
    expect(run.out.join('\n')).toMatch(/^Usage: pnpm validate-content <path>\.\.\./);
  });

  it('is exported from the tools package', () => {
    expect(tools.runValidateContent).toBeTypeOf('function');
    expect(tools.validateContent).toBe(validateContent);
    expect(tools.CONTENT_ISSUE_CODES).toBe(CONTENT_ISSUE_CODES);
  });
});

describe('issue codes', () => {
  it.each(Object.entries(CONTENT_ISSUE_CODES))('%s is a stable dotted code with a plain meaning, apart from the schema codes', (code, meaning) => {
    expect(code).toMatch(/^[a-z]+\.[a-z_]+$/);
    expect(meaning).toMatch(/^[A-Z].*\.$/);
    expect(meaning).not.toContain('!');
    expect(Object.hasOwn(ISSUE_CODES, code)).toBe(false);
  });

  it('lists exactly these codes and meanings in the README', () => {
    const readme = fs.readFileSync(new URL('../src/validate-content/README.md', import.meta.url), 'utf8');
    const rows = readme
      .split('\n')
      .map((line) => /^\| `([a-z]+\.[a-z_]+)` \| (.*) \|$/.exec(line))
      .filter((match): match is RegExpExecArray => match !== null)
      .map(([, code, meaning]) => [code, meaning]);
    expect(Object.fromEntries(rows)).toEqual(CONTENT_ISSUE_CODES);
  });
});
