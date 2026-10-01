import path from 'node:path';
import {
  makeCatalogue,
  validateArenaPreset,
  validateBlueprint,
  validateChallenge,
  validateKit,
  validatePartRecord,
} from '@servo/schema';
import type { Catalogue, ValidationResult } from '@servo/schema';
import { exampleArenas, exampleChallenges, exampleParts, validBlueprints, validKits } from '@servo/schema/fixtures';
import { afterEach, describe, expect, it } from 'vitest';
import type { RecordKind } from '../src/validate-content/records.ts';
import { systemText } from '../src/validate-content/system-text.ts';
import {
  bannedFindings,
  compileTerminology,
  glossFindings,
  loadTerminology,
  partNameFindings,
  wordsOf,
} from '../src/validate-content/terminology.ts';
import type { Terminology } from '../src/validate-content/terminology.ts';
import { idOf, removeTempFolders, tempFolder, TERMINOLOGY, write } from './validate-content/support.ts';

afterEach(removeTempFolders);

const lists = loadTerminology(TERMINOLOGY);
const matcher = compileTerminology(lists.terminology);
const codes = (findings: readonly { readonly code: string }[]): string[] => findings.map((finding) => finding.code);

describe('loading the terminology folder', () => {
  it('reads the test lists with no issues', () => {
    expect(lists.issues).toEqual([]);
    expect(lists.missing).toEqual([]);
    expect(lists.terminology.components).toContainEqual({ name: 'chassis', glosses: ['frame'] });
    expect(lists.terminology.components).toContainEqual({ name: 'DC motor', glosses: [] });
    expect(lists.terminology.banned.map((entry) => entry.phrase)).toContain('points');
    expect(lists.terminology.allowed).toEqual(['mount point', 'mount points']);
  });

  it('treats a missing folder as empty lists, with both files missing and no issues', () => {
    const folder = path.join(tempFolder(), 'terminology');
    const loaded = loadTerminology(folder);
    expect(loaded.terminology).toEqual({ components: [], banned: [], allowed: [] });
    expect(loaded.missing).toEqual([path.join(folder, 'components.json'), path.join(folder, 'banned.json')]);
    expect(loaded.issues).toEqual([]);
  });

  it('treats one missing file as an empty list and still reads the other', () => {
    const folder = tempFolder();
    write(folder, 'banned.json', { banned: [{ phrase: 'coins', reason: 'No score.' }] });
    const loaded = loadTerminology(folder);
    expect(loaded.missing).toEqual([path.join(folder, 'components.json')]);
    expect(loaded.terminology.banned).toEqual([{ phrase: 'coins', reason: 'No score.' }]);
    expect(loaded.terminology.allowed).toEqual([]);
  });

  const problems = (files: Record<string, unknown>): string[] => {
    const folder = tempFolder();
    for (const [name, data] of Object.entries(files)) write(folder, name, data);
    return loadTerminology(folder).issues.map((issue) => `${path.basename(issue.file)} ${issue.code} at ${issue.path}: ${issue.message}`);
  };

  it('reports a file that is not JSON', () => {
    expect(problems({ 'banned.json': '{ "banned": [ }' })).toEqual([
      expect.stringMatching(/^banned\.json terminology\.bad_file at \$: Not valid JSON: /),
    ]);
  });

  it('reports missing, unknown and mistyped fields at their JSONPaths', () => {
    expect(
      problems({
        'components.json': { parts: [], 'odd key': 1 },
        'banned.json': { banned: [{ word: 'coins' }, { phrase: 7, reason: ['No score.'] }], allowed: 'mount point' },
      }),
    ).toEqual([
      "components.json terminology.bad_file at $.components: Missing 'components'.",
      "components.json terminology.bad_file at $.parts: Unknown field 'parts'.",
      "components.json terminology.bad_file at $['odd key']: Unknown field 'odd key'.",
      "banned.json terminology.bad_file at $.banned[0].phrase: Missing 'phrase'.",
      "banned.json terminology.bad_file at $.banned[0].reason: Missing 'reason'.",
      "banned.json terminology.bad_file at $.banned[0].word: Unknown field 'word'.",
      'banned.json terminology.bad_file at $.banned[1].phrase: Expected a banned word or phrase as a string.',
      'banned.json terminology.bad_file at $.banned[1].reason: Expected a reason as a string.',
      'banned.json terminology.bad_file at $.allowed: Expected a list.',
    ]);
  });

  it('reports a file whose top level is not an object', () => {
    expect(problems({ 'components.json': ['DC motor'] })).toEqual(['components.json terminology.bad_file at $: Expected an object.']);
  });

  it('reports a phrase with no words, pointing exclamation marks at the schema', () => {
    expect(problems({ 'banned.json': { banned: [{ phrase: '!', reason: 'Shouting.' }] } })).toEqual([
      'banned.json terminology.bad_file at $.banned[0].phrase: Expected a banned word or phrase with at least one word. Exclamation marks need no entry: the schema refuses them in all system text.',
    ]);
  });

  it('reports text that is not one trimmed line', () => {
    expect(problems({ 'components.json': { components: [{ name: ' wheel' }, { name: 'gear\nbox' }, { name: '' }] } })).toEqual([
      'components.json terminology.bad_file at $.components[0].name: Expected a real component name on one line, without spaces at either end.',
      'components.json terminology.bad_file at $.components[1].name: Expected a real component name on one line, without spaces at either end.',
      'components.json terminology.bad_file at $.components[2].name: Expected a real component name on one line, without spaces at either end.',
    ]);
  });

  it('reports repeats, compared as words', () => {
    expect(
      problems({
        'components.json': { components: [{ name: 'DC motor', glosses: ['motor', 'Motor'] }, { name: 'dc-motor' }] },
        'banned.json': { banned: [{ phrase: 'coins', reason: 'No score.' }, { phrase: 'Coins', reason: 'No score.' }], allowed: ['mount point', 'mount point'] },
      }),
    ).toEqual([
      "components.json terminology.bad_file at $.components[0].glosses[1]: 'Motor' is already listed.",
      "components.json terminology.bad_file at $.components[1].name: 'dc-motor' is already listed.",
      "banned.json terminology.bad_file at $.banned[1].phrase: 'Coins' is already listed.",
      "banned.json terminology.bad_file at $.allowed[1]: 'mount point' is already listed.",
    ]);
  });

  it('reports a banned phrase that is also allowed, a real name or a gloss', () => {
    expect(
      problems({
        'components.json': { components: [{ name: 'microcontroller', glosses: ['brain'] }] },
        'banned.json': {
          banned: [
            { phrase: 'Brain', reason: 'Too cute.' },
            { phrase: 'microcontroller', reason: 'Too long.' },
            { phrase: 'mount points', reason: 'Scoring.' },
          ],
          allowed: ['mount points'],
        },
      }),
    ).toEqual([
      "banned.json terminology.bad_file at $.banned[0].phrase: 'Brain' is banned but is also a gloss for 'microcontroller' in components.json.",
      "banned.json terminology.bad_file at $.banned[1].phrase: 'microcontroller' is banned but is also a real component name in components.json.",
      "banned.json terminology.bad_file at $.banned[2].phrase: 'mount points' is banned but is also an allowed phrase.",
    ]);
  });

  it('keeps the good entries of a file that has bad ones', () => {
    const folder = tempFolder();
    write(folder, 'components.json', { components: [{ name: 'wheel' }, { name: 3 }, { name: 'caster', glosses: ['', 'swivel wheel'] }] });
    const loaded = loadTerminology(folder);
    expect(loaded.terminology.components).toEqual([
      { name: 'wheel', glosses: [] },
      { name: 'caster', glosses: ['swivel wheel'] },
    ]);
    expect(loaded.issues.map((issue) => issue.path)).toEqual(['$.components[1].name', '$.components[2].glosses[0]']);
  });
});

describe('words', () => {
  it('splits on spaces, hyphens, apostrophes and punctuation, and compares without case or accents', () => {
    expect(wordsOf("Brain-y bit, the robot's ＰＯＩＮＴＳ: café").map((word) => word.key)).toEqual([
      'brain',
      'y',
      'bit',
      'the',
      'robot',
      's',
      'points',
      'cafe',
    ]);
    expect(wordsOf('Plus (+), long leg').map((word) => [word.raw, word.start, word.end])).toEqual([
      ['Plus', 0, 4],
      ['long', 10, 14],
      ['leg', 15, 18],
    ]);
  });
});

describe('banned words in system text', () => {
  const banned = (text: string): string[] => bannedFindings(text, matcher).map((finding) => finding.message);

  it('refuses a banned word as a whole word, in any case, quoting it as written', () => {
    expect(banned('Collect points to win')).toEqual(["'points' is on the banned list: Servo keeps no score (ground rule 7, D22)."]);
    expect(banned('Points for every wire')).toEqual(["'Points' is on the banned list: Servo keeps no score (ground rule 7, D22)."]);
    expect(banned('The checkpoints and pointsy bits')).toEqual([]);
  });

  it('allows a banned word inside an allowed phrase (D22), but not beside it', () => {
    expect(banned('Needs: parts fixed to its mount points (grey).')).toEqual([]);
    expect(banned('Mount point for the caster')).toEqual([]);
    expect(banned('Score points on the mount points')).toEqual(["'points' is on the banned list: Servo keeps no score (ground rule 7, D22)."]);
  });

  it('matches phrases across case, hyphens and punctuation', () => {
    for (const text of ['Great job.', 'great-job', 'A GREAT JOB']) expect(codes(bannedFindings(text, matcher))).toEqual(['terminology.banned']);
    for (const text of ['Plug in the brain-y bit', 'The Brain-Y Bit', 'brain y bit']) {
      expect(banned(text)).toEqual([expect.stringMatching(/^'brain.y bit' is on the banned list: A character-style name/i)]);
    }
    expect(banned('A brainy bit of wire')).toEqual([]);
    expect(banned('A great, job')).toEqual(["'great, job' is on the banned list: System text never praises the child (brief Section 12)."]);
  });

  it('matches accented and full-width forms', () => {
    expect(codes(bannedFindings('Win pöints', matcher))).toEqual(['terminology.banned']);
    expect(codes(bannedFindings('Win ｃｏｉｎｓ', matcher))).toEqual(['terminology.banned']);
  });

  it('gives one finding per banned entry, in list order', () => {
    expect(banned('No lives, no coins, no lives')).toEqual([
      "'coins' is on the banned list: Servo keeps no score (ground rule 7).",
      "'lives' is on the banned list: A challenge can never be failed, so there are no lives (ground rule 7).",
    ]);
  });

  it('never refuses a word inside a real name or a gloss', () => {
    const custom: Terminology = {
      components: [{ name: 'mount plate', glosses: ['bolt plate'] }],
      banned: [{ phrase: 'plate', reason: 'Test.' }],
      allowed: [],
    };
    const own = compileTerminology(custom);
    expect(bannedFindings('Fix it to the mount plate or the bolt plate', own)).toEqual([]);
    expect(codes(bannedFindings('A plate', own))).toEqual(['terminology.banned']);
  });

  it('checks nothing with an empty list', () => {
    expect(bannedFindings('Points, coins and a great job', compileTerminology({ components: [], banned: [], allowed: [] }))).toEqual([]);
  });
});

describe('glosses in system text', () => {
  const alone = (text: string, own = matcher): string[] => glossFindings(text, own).map((finding) => finding.message);

  it('refuses a gloss with no real name in the same field, quoting it as written', () => {
    expect(alone('Loose: the frame drags on the floor.')).toEqual([
      "'frame' is a gloss for 'chassis' and never stands alone: write the real name beside it, as in 'chassis (frame)'.",
    ]);
    expect(alone('Frame on the floor: the robot drags.')).toEqual([
      "'Frame' is a gloss for 'chassis' and never stands alone: write the real name beside it, as in 'chassis (frame)'.",
    ]);
    expect(codes(glossFindings('Plug it into the brain', matcher))).toEqual(['terminology.gloss_alone']);
  });

  it('accepts a gloss beside its real name anywhere in the same field, in any case', () => {
    expect(alone('Loose: the chassis (frame) drags on the floor.')).toEqual([]);
    expect(alone('A car has a chassis too: the frame its engine, seats and wheels bolt to.')).toEqual([]);
    expect(alone('The Frame of the robot is its Chassis.')).toEqual([]);
    expect(alone('Loose: the chassis drags on the floor.')).toEqual([]);
  });

  it('gives one finding per gloss per field, and checks whole words only', () => {
    expect(alone('The frame and the frame and the brain')).toHaveLength(2);
    expect(alone('A framed picture and a brainstorm')).toEqual([]);
  });

  it('ignores a gloss inside a real name, an allowed phrase or a banned phrase', () => {
    const own = compileTerminology({
      components: [
        { name: 'DC motor', glosses: ['motor'] },
        { name: 'servo motor', glosses: [] },
        { name: 'microcontroller', glosses: ['brain'] },
      ],
      banned: [{ phrase: 'brain-y bit', reason: 'Test.' }],
      allowed: ['motor oil'],
    });
    expect(alone('The servo motor turns its arm', own)).toEqual([]);
    expect(alone('Like motor oil in a car', own)).toEqual([]);
    expect(alone('Plug in the brain-y bit', own)).toEqual([]);
    expect(alone('The servo motor and the motor', own)).toEqual([
      "'motor' is a gloss for 'DC motor' and never stands alone: write the real name beside it, as in 'DC motor (motor)'.",
    ]);
  });

  it('accepts a gloss shared by several components beside any of their real names', () => {
    const own = compileTerminology({
      components: [
        { name: 'DC motor', glosses: ['motor'] },
        { name: 'servo motor', glosses: ['motor'] },
      ],
      banned: [],
      allowed: [],
    });
    expect(alone('The servo motor is a motor that holds an angle', own)).toEqual([]);
    expect(alone('A motor turns', own)).toEqual([
      "'motor' is a gloss for 'DC motor' or 'servo motor' and never stands alone: write the real name beside it, as in 'DC motor (motor)'.",
    ]);
  });

  it('checks nothing without glosses', () => {
    expect(glossFindings('The frame', compileTerminology({ components: [{ name: 'chassis', glosses: [] }], banned: [], allowed: [] }))).toEqual([]);
  });
});

describe("a part's name", () => {
  const name = (text: string): string[] => partNameFindings(text, matcher).map((finding) => `${finding.code}: ${finding.message}`);

  it.each(exampleParts.map((part) => [(part as { identity: { name: string } }).identity.name]))('accepts the fixture name %s', (text) => {
    expect(name(text)).toEqual([]);
  });

  it('refuses a character-style name with no real component name', () => {
    expect(name('Sparky')).toEqual([
      "terminology.not_real_name: 'Sparky' contains no real component name. A part's name is built on a real name from the components list.",
    ]);
    expect(name('zappy wire')).toEqual([
      "terminology.not_real_name: 'zappy wire' contains no real component name. A part's name is built on a real name from the components list.",
    ]);
  });

  it('refuses a gloss in place of the real name, and accepts it beside the real name', () => {
    expect(codes(partNameFindings('frame', matcher))).toEqual(['terminology.not_real_name']);
    expect(codes(glossFindings('frame', matcher))).toEqual(['terminology.gloss_alone']);
    expect(name('chassis (frame)')).toEqual([]);
    expect(glossFindings('chassis (frame)', matcher)).toEqual([]);
  });

  it('refuses a real name written another way', () => {
    expect(name('Dc motor')).toEqual(["terminology.name_form: Write the real name as 'DC motor', not 'Dc motor'."]);
    expect(name('DC-motor')).toEqual(["terminology.name_form: Write the real name as 'DC motor', not 'DC-motor'."]);
    expect(name('large led')).toEqual(["terminology.name_form: Write the real name as 'LED', not 'led'."]);
    expect(name('Bumper switch')).toEqual(["terminology.name_form: Write the real name as 'bumper switch', not 'Bumper switch'."]);
  });

  it('refuses a capitalised word beside the real name, which reads as a character name', () => {
    expect(name('Sparky the DC motor')).toEqual([
      "terminology.proper_name: 'Sparky' is capitalised outside the real name, so it reads as a character's name. A part's name reads mid-sentence: lower case apart from the real name's own capitals.",
    ]);
    expect(codes(partNameFindings('Large wheel', matcher))).toEqual(['terminology.proper_name']);
    expect(codes(partNameFindings('Mr Buzz buzzer', matcher))).toEqual(['terminology.proper_name', 'terminology.proper_name']);
  });

  it('accepts lower-case qualifiers and all-capital marks beside the real name', () => {
    expect(name('small wheel')).toEqual([]);
    expect(name('2-cell battery pack')).toEqual([]);
    expect(name('AA battery pack')).toEqual([]);
  });

  it('checks nothing without a components list, or with an empty name', () => {
    expect(partNameFindings('Sparky', compileTerminology({ components: [], banned: [], allowed: [] }))).toEqual([]);
    expect(name('')).toEqual([]);
  });
});

// JSONPath in the schema's style, so paths compare with the schema's issue paths.
const at = (base: string, key: string | number): string =>
  typeof key === 'number' ? `${base}[${key}]` : /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? `${base}.${key}` : `${base}['${key}']`;

const stringLeaves = (value: unknown, base = '$'): { readonly path: string; readonly set: (root: unknown, text: string) => void }[] => {
  const leaves: { readonly path: string; readonly set: (root: unknown, text: string) => void }[] = [];
  const visit = (node: unknown, where: string, trail: readonly (string | number)[]): void => {
    if (typeof node === 'string') {
      leaves.push({
        path: where,
        set: (root, text) => {
          const parent = trail.slice(0, -1).reduce<unknown>((current, key) => (current as Record<string | number, unknown>)[key], root);
          (parent as Record<string | number, unknown>)[trail[trail.length - 1] as string | number] = text;
        },
      });
    } else if (Array.isArray(node)) {
      node.forEach((item: unknown, index) => visit(item, at(where, index), [...trail, index]));
    } else if (typeof node === 'object' && node !== null) {
      for (const [key, item] of Object.entries(node)) visit(item, at(where, key), [...trail, key]);
    }
  };
  visit(value, base, []);
  return leaves;
};

const parts = exampleParts.flatMap((part) => {
  const result = validatePartRecord(part);
  return result.ok ? [result.value] : [];
});
const arenas = exampleArenas.flatMap((arena) => {
  const result = validateArenaPreset(arena);
  return result.ok ? [result.value] : [];
});
const kits = validKits.flatMap((kit) => {
  const result = validateKit(kit.data, makeCatalogue({ parts, arenas }));
  return result.ok ? [result.value] : [];
});
const catalogue: Catalogue = makeCatalogue({ parts, arenas, kits });

const samples: readonly (readonly [RecordKind, string, unknown, (value: unknown) => ValidationResult<unknown>])[] = [
  ...exampleParts.map((part) => ['part', idOf(part), part, validatePartRecord] as const),
  ...exampleArenas.map((arena) => ['arena', idOf(arena), arena, validateArenaPreset] as const),
  ...validKits.map((kit) => ['kit', kit.name, kit.data, (value: unknown) => validateKit(value, catalogue)] as const),
  ...exampleChallenges.map((challenge) => ['challenge', challenge.name, challenge.data, (value: unknown) => validateChallenge(value, catalogue)] as const),
  ...validBlueprints.map((blueprint) => ['blueprint', blueprint.name, blueprint.data, (value: unknown) => validateBlueprint(value, catalogue)] as const),
];

describe('system text', () => {
  // A string field is system text when the schema refuses an exclamation mark in it (its Text rule).
  // Blueprint names are names, not Text, but in content they are authored, so the lists apply to them too.
  it.each(samples)('covers exactly the schema text fields of %s %s, plus authored blueprint names', (kind, _name, data, validate) => {
    expect(validate(data).ok).toBe(true);
    const schemaText = stringLeaves(data)
      .filter((leaf) => {
        const probe = structuredClone(data);
        leaf.set(probe, '!');
        const result = validate(probe);
        return !result.ok && result.issues.some((issue) => issue.code === 'text.exclamation' && issue.path === leaf.path);
      })
      .map((leaf) => leaf.path);
    const authoredNames = stringLeaves(data)
      .map((leaf) => leaf.path)
      .filter((leafPath) => leafPath === '$.meta.name' || leafPath === '$.start.meta.name');
    expect(systemText(kind, data).map((field) => field.path).toSorted()).toEqual([...schemaText, ...authoredNames].toSorted());
  });

  it("marks only a part's identity.name as its name", () => {
    const [first] = exampleParts;
    expect(systemText('part', first).filter((field) => field.partName).map((field) => field.path)).toEqual(['$.identity.name']);
  });

  it('skips fields that are not strings, and records of the wrong shape', () => {
    expect(systemText('part', { identity: { name: 7 }, ports: 'none', card: [] })).toEqual([]);
    expect(systemText('challenge', null)).toEqual([]);
    expect(systemText('run-record', { blueprint: { meta: { name: 'Points race' } } })).toEqual([]);
  });
});
