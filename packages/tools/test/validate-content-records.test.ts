import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { exampleArenas, exampleChallenges, exampleParts, exampleRunRecords, validBlueprints, validKits } from '@servo/schema/fixtures';
import { afterEach, describe, expect, it } from 'vitest';
import {
  classify,
  findRecordFiles,
  foldersOf,
  isConfigFile,
  isSkippedFolder,
  KIND_FIELDS,
  kindFromFolders,
  kindsFromFields,
  readJson,
  RECORD_KINDS,
} from '../src/validate-content/records.ts';
import { partFixture, removeTempFolders, REPO_ROOT, tempFolder, write } from './validate-content/support.ts';

afterEach(removeTempFolders);

describe('record kinds from folders', () => {
  it('takes the nearest record folder above the file', () => {
    expect(kindFromFolders(['packages', 'content', 'parts', 'level-1'])).toBe('part');
    expect(kindFromFolders(['packages', 'content', 'fixtures', 'blueprints'])).toBe('blueprint');
    expect(kindFromFolders(['packages', 'schema', 'fixtures', 'kits', 'valid'])).toBe('kit');
    expect(kindFromFolders(['kits', 'parts'])).toBe('part');
    expect(kindFromFolders(['packages', 'content', 'arenas'])).toBe('arena');
    expect(kindFromFolders(['challenges'])).toBe('challenge');
    expect(kindFromFolders(['run-records'])).toBe('run-record');
    expect(kindFromFolders(['packages', 'content', 'constructor'])).toBeUndefined();
    expect(kindFromFolders([])).toBeUndefined();
  });

  it('counts folders below the repository root only, for files inside it', () => {
    expect(foldersOf(path.join(REPO_ROOT, 'packages/content/parts/level-1/led.json'), REPO_ROOT)).toEqual([
      'packages',
      'content',
      'parts',
      'level-1',
    ]);
    expect(foldersOf(path.join(REPO_ROOT, 'led.json'), REPO_ROOT)).toEqual([]);
    const outside = path.join(path.dirname(path.resolve(REPO_ROOT)), 'parts', 'led.json');
    expect(foldersOf(outside, path.join(REPO_ROOT, 'packages'))).toContain('parts');
    expect(foldersOf('/parts/kits/led.json', '/parts')).toEqual(['kits']);
  });
});

describe('record kinds from fields (the shape check)', () => {
  const fixtures = [
    ['part', exampleParts],
    ['arena', exampleArenas],
    ['kit', validKits.map((kit) => kit.data)],
    ['challenge', exampleChallenges.map((challenge) => challenge.data)],
    ['blueprint', validBlueprints.map((blueprint) => blueprint.data)],
    ['run-record', exampleRunRecords.map((run) => run.data)],
  ] as const;

  it.each(fixtures)('recognises every %s fixture by its fields', (kind, records) => {
    for (const record of records) expect(kindsFromFields(record)).toEqual([kind]);
  });

  it('gives each kind fields that no other kind has at the top level', () => {
    for (const kind of RECORD_KINDS) {
      for (const other of RECORD_KINDS.filter((candidate) => candidate !== kind)) {
        expect(KIND_FIELDS[kind].filter((key) => KIND_FIELDS[other].includes(key))).toEqual([]);
      }
    }
  });

  it('finds no kind, or several, for other shapes', () => {
    expect(kindsFromFields({ name: 'thing' })).toEqual([]);
    expect(kindsFromFields([{ identity: {} }])).toEqual([]);
    expect(kindsFromFields('parts')).toEqual([]);
    expect(kindsFromFields({ tray: [], goalLine: 'Go' })).toEqual(['kit', 'challenge']);
    expect(kindsFromFields(Object.create({ tray: [] }))).toEqual([]);
  });

  it('lets the folder win over the fields', () => {
    const kit = validKits[0]?.data;
    expect(classify(path.join(REPO_ROOT, 'packages/content/parts/odd.json'), kit, REPO_ROOT)).toEqual({ kind: 'part', by: 'folder' });
    expect(classify(path.join(REPO_ROOT, 'packages/content/odd.json'), kit, REPO_ROOT)).toEqual({ kind: 'kit', by: 'fields' });
    expect(classify(path.join(REPO_ROOT, 'packages/content/odd.json'), { tray: [], title: 'x' }, REPO_ROOT)).toEqual({
      kind: undefined,
      candidates: ['kit', 'challenge'],
    });
  });
});

describe('finding record files', () => {
  it('walks folders in name order and leaves out dependencies, hidden folders, terminology, art and package configuration', () => {
    const folder = tempFolder();
    const keep = [
      write(folder, 'arenas/open-floor.json', {}),
      write(folder, 'parts/level-1/led.json', {}),
      write(folder, 'parts/level-1/wheel.json', {}),
      write(folder, 'parts/level-2/buzzer.json', {}),
      write(folder, 'parts/z.json', {}),
    ];
    write(folder, 'node_modules/pkg/parts/led.json', {});
    write(folder, '.cache/parts/led.json', {});
    write(folder, 'terminology/banned.json', {});
    write(folder, 'art/generated/registry.json', {});
    write(folder, 'art/final/part/led.json', {});
    write(folder, 'package.json', {});
    write(folder, 'tsconfig.json', {});
    write(folder, 'tsconfig.build.json', {});
    write(folder, 'parts/README.md', '# Parts');
    expect(findRecordFiles(folder)).toEqual(keep);
  });

  it('returns a file named directly, whatever it is', () => {
    const folder = tempFolder();
    const file = write(folder, 'package.json', {});
    expect(findRecordFiles(file)).toEqual([file]);
  });

  it.skipIf(process.getuid?.() === 0)('passes on a folder it cannot list, and keeps walking', () => {
    const folder = tempFolder();
    write(folder, 'a/locked/led.json', {});
    const kept = write(folder, 'b/led.json', {});
    const locked = path.join(folder, 'a/locked');
    fs.chmodSync(locked, 0o000);
    try {
      const unlisted: string[] = [];
      expect(findRecordFiles(folder, (where, code) => unlisted.push(`${where} ${code}`))).toEqual([kept]);
      expect(unlisted).toEqual([`${locked} EACCES`]);
    } finally {
      fs.chmodSync(locked, 0o755);
    }
  });

  it('does not follow symbolic links', () => {
    const folder = tempFolder();
    write(folder, 'real/parts/led.json', {});
    fs.symlinkSync(path.join(folder, 'real'), path.join(folder, 'link'));
    expect(findRecordFiles(folder)).toEqual([path.join(folder, 'real/parts/led.json')]);
  });

  it('names what it skips', () => {
    expect(['node_modules', '.git', 'terminology', 'art'].every(isSkippedFolder)).toBe(true);
    expect(['parts', 'fixtures', 'level-1', 'generated', 'final', 'artwork'].some(isSkippedFolder)).toBe(false);
    expect(['package.json', 'tsconfig.json', 'tsconfig.test.json'].every(isConfigFile)).toBe(true);
    expect(['packages.json', 'my-tsconfig.json', 'led.json'].some(isConfigFile)).toBe(false);
  });
});

describe('reading JSON', () => {
  it('reads a record, ignoring a byte-order mark', () => {
    const folder = tempFolder();
    const led = partFixture('led');
    const file = write(folder, 'led.json', `${String.fromCodePoint(0xfeff)}${JSON.stringify(led)}`);
    expect(readJson(file)).toEqual({ ok: true, value: led });
  });

  it('reports text that is not JSON', () => {
    const folder = tempFolder();
    const result = readJson(write(folder, 'broken.json', '{ "id": "led", }'));
    expect(result).toMatchObject({ ok: false, code: 'file.bad_json' });
    expect(!result.ok && result.message).toMatch(/^Not valid JSON: .+\.$/);
    expect(readJson(write(folder, 'empty.json', ''))).toMatchObject({ ok: false, code: 'file.bad_json' });
  });

  it('reports a file it cannot read', () => {
    const folder = tempFolder();
    fs.mkdirSync(path.join(folder, 'folder.json'));
    expect(readJson(path.join(folder, 'folder.json'))).toEqual({ ok: false, code: 'file.unreadable', message: 'Could not read the file (EISDIR).' });
    expect(readJson(path.join(folder, 'missing.json'))).toEqual({ ok: false, code: 'file.unreadable', message: 'Could not read the file (ENOENT).' });
  });
});
