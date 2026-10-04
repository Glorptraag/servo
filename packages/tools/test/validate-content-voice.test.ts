// The voice checks R-7.2 added (R-6.4 CON-1 to CON-3 and TLS-1 to TLS-2): character names in any system text,
// reward words, questions, levels, emoji and exclamation marks in blueprint names. Every probe string from
// docs/reviews/content.md and docs/reviews/tools.md is refused through the real lists.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TextField } from '../src/validate-content/system-text.ts';
import { capitalFindings, compileTerminology, levelFindings, loadTerminology } from '../src/validate-content/terminology.ts';
import { textFindings } from '../src/validate-content/validate.ts';
import { markFindings } from '../src/validate-content/voice.ts';
import { cli, CONTENT_TERMINOLOGY, removeTempFolders, REPO_ROOT, tempFolder, write } from './validate-content/support.ts';

vi.setConfig({ testTimeout: 120_000 });

afterEach(removeTempFolders);

const lists = loadTerminology(CONTENT_TERMINOLOGY);
const matcher = compileTerminology(lists.terminology);
const codesOf = (text: string, field: Partial<TextField> = {}): string[] =>
  textFindings({ path: '$', text, ...field }, matcher).map((finding) => finding.code);

const CONTENT = path.join(REPO_ROOT, 'packages', 'content');
const record = (relative: string): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(path.join(CONTENT, relative), 'utf8')) as Record<string, unknown>;

/** Writes a copy of a real content record with one change, and runs the validator on it against content's catalogue. */
const issuesFor = (relative: string, change: (data: Record<string, unknown>) => void): string[] => {
  const data = record(relative);
  change(data);
  const file = write(tempFolder(), relative, data);
  const run = cli([file, '--catalogue', CONTENT, '--terminology', CONTENT_TERMINOLOGY]);
  return run.out.filter((line) => line.startsWith(`${file}: `)).map((line) => line.slice(file.length + 2).split(': ')[0] ?? '');
};

describe('the words list', () => {
  it('loads with no issues', () => {
    expect(lists.issues).toEqual([]);
    expect(lists.missing).toEqual([]);
    expect(matcher.checksCapitals).toBe(true);
  });

  it('names the kit names and the Run button', () => {
    expect(lists.terminology.names).toEqual(expect.arrayContaining(['Circuit Crew', 'Rolling Start', 'Line Runner', 'Run']));
  });
});

describe('R-6.4 CON-1 and TLS-1: character names in any system text', () => {
  it.each([
    ['Great job: Sparky the buzzer buzzes when power flows.', ['terminology.banned', 'terminology.proper_name']],
    ['Buzzy says the wires are swapped', ['terminology.proper_name']],
    ['Level 2: meet Buzzy', ['terminology.proper_name', 'text.level']],
    ['Sparky the robot', ['terminology.proper_name']],
  ])('refuses %s', (text, codes) => {
    expect(codesOf(text)).toEqual(codes);
  });

  it('names the word in its message', () => {
    expect(capitalFindings('Buzzy says the wires are swapped', matcher).map((finding) => finding.message)).toEqual([
      "'Buzzy' is capitalised and is not a listed term or name or an opener, so it reads as a character's name. If it is an ordinary word or a real name, add it to words.json.",
    ]);
  });

  it('passes ordinary openers, listed terms, kit names and Run', () => {
    for (const text of [
      'Wired: the DC motor turns. This motor needs a return path.',
      'Take one large wheel off, then Run the robot and watch where it goes',
      'Circuit Crew',
      'Rolling Start',
      'LED: the LED lights when power flows round',
      'Needs: power (red). Gives: a turning shaft.',
    ]) {
      expect(codesOf(text)).toEqual([]);
    }
  });

  it('refuses an opener in the middle of a sentence', () => {
    expect(codesOf('Wire the Robot to the battery pack')).toEqual(['terminology.proper_name']);
  });

  it("leaves a part's name to its own check", () => {
    expect(codesOf('Sparky the DC motor', { partName: true })).toEqual(['terminology.proper_name', 'terminology.not_qualifier']);
  });

  it('refuses the kit name probe, and a character name in a challenge title, a goal line and a hint', () => {
    expect(issuesFor('kits/circuit-crew.json', (kit) => (kit.name = 'Sparky and friends, great job!'))).toEqual([
      'text.exclamation at $.name',
      'terminology.banned at $.name',
      'terminology.proper_name at $.name',
    ]);
    expect(
      issuesFor('challenges/level-1/drive-forward.json', (challenge) => {
        challenge.title = 'Level 2: meet Buzzy';
        challenge.goalLine = 'Make Sparky drive forward';
        const [ladder] = challenge.hints as { steps: { line: string }[] }[];
        const [step] = ladder?.steps ?? [];
        if (step) step.line = 'Buzzy says the wires are swapped';
      }),
    ).toEqual([
      'terminology.proper_name at $.title',
      'text.level at $.title',
      'terminology.proper_name at $.goalLine',
      'terminology.proper_name at $.hints[0].steps[0].line',
    ]);
  });

  it.each([
    ['challenges/level-1/drive-forward.json', 'start', 'Super robot!', ['terminology.proper_name at $.start.meta.name', 'text.exclamation at $.start.meta.name']],
    ['fixtures/blueprints/broken-loose-caster.json', undefined, 'Zoom robot!', ['terminology.proper_name at $.meta.name', 'text.exclamation at $.meta.name']],
    ['fixtures/blueprints/broken-loose-caster.json', undefined, 'Sparky the robot', ['terminology.proper_name at $.meta.name']],
  ])('refuses the blueprint name probe in %s: %s', (relative, key, name, expected) => {
    const issues = issuesFor(relative, (data) => {
      const blueprint = (key === undefined ? data : data[key]) as { meta: { name: string } };
      blueprint.meta.name = name;
    });
    expect(issues).toEqual(expected);
  });
});

describe('R-6.4 CON-2 and TLS-2: reward words, robot sounds and cheering', () => {
  it.each([
    ['Here is a star for you, and a trophy, and a reward.', 3],
    ['Win coins here', 2],
    ['Earn a star', 2],
    ['wins you a reward', 2],
    ['three stars', 1],
    ['1 point', 1],
    ['Beep boop, turning the shaft', 2],
    ['Woo hoo the shaft turns', 1],
    ['you lose a life', 1],
    ['win the trophy', 2],
    ['Win a star', 2],
    ['Prize kit', 1],
    ['Trophy room', 1],
    ['Nearly there, you earn a reward', 2],
    ['A medal, a prize and confetti for the winner', 4],
    ['Unlocked: the servo motor', 1],
  ])('refuses %s', (text, count) => {
    expect(codesOf(text).filter((code) => code === 'terminology.banned')).toHaveLength(count);
  });

  it('still allows mount point and mount points (D22)', () => {
    expect(codesOf('The caster fixes to this mount point under the chassis')).toEqual([]);
    expect(codesOf('Needs: parts fixed to its mount points (grey).')).toEqual([]);
  });

  it('refuses emoji and the interrobang', () => {
    expect(codesOf('Turns the shaft 🎉')).toEqual(['text.symbol']);
    expect(codesOf('Turns the shaft‽')).toEqual(['text.symbol']);
    expect(codesOf('Turns the shaft 🇦🇺')).toEqual(['text.symbol']);
  });

  it('passes the symbols content uses', () => {
    expect(markFindings('4.8–6 V · 180° · holds 1.8 kg·cm, © and ™')).toEqual([]);
  });

  it('refuses the probes in a kit, an arena, a challenge title and a hint', () => {
    expect(issuesFor('kits/circuit-crew.json', (kit) => (kit.name = 'Prize kit'))).toEqual(['terminology.banned at $.name']);
    expect(issuesFor('arenas/open-floor.json', (arena) => (arena.name = 'Trophy room'))).toEqual(['terminology.banned at $.name']);
    expect(
      issuesFor('challenges/level-1/drive-forward.json', (challenge) => {
        challenge.title = 'Win a star';
        const [ladder] = challenge.hints as { steps: { line: string }[] }[];
        const [step] = ladder?.steps ?? [];
        if (step) step.line = 'unlock the next level';
      }),
    ).toEqual(['terminology.banned at $.title', 'terminology.banned at $.title', 'terminology.banned at $.hints[0].steps[0].line', 'text.level at $.hints[0].steps[0].line']);
  });
});

describe('R-6.4 CON-3: questions and levels', () => {
  it.each([
    ['Gives: a buzz. Does it work?', ['text.question']],
    ['Can you make the buzzer sound?', ['text.question']],
    ['You unlock this at Level 3.', ['terminology.banned', 'text.level']],
    ['Level 2: meet Buzzy', ['terminology.proper_name', 'text.level']],
    ['Is it on¿', ['text.question']],
  ])('refuses %s', (text, codes) => {
    expect(codesOf(text)).toEqual(codes);
  });

  it('leaves level up to the banned list', () => {
    expect(levelFindings('Level up to open new parts', matcher)).toEqual([]);
    expect(codesOf('Level up to open new parts')).toEqual(['terminology.banned']);
  });

  it('refuses levels in plural and in any case', () => {
    expect(codesOf('Both levels have a ramp')).toEqual(['text.level']);
    expect(codesOf('the LEVEL two kit')).toEqual(['text.level']);
  });
});

describe('the merged content', () => {
  it('passes every check', () => {
    const run = cli([CONTENT, '--catalogue', CONTENT, '--terminology', CONTENT_TERMINOLOGY]);
    expect(run.out.filter((line) => !line.startsWith('note: '))).toEqual([expect.stringMatching(/^validate-content: \d+ records checked, no issues\.$/)]);
    expect(run.status).toBe(0);
  });
});

describe('the words list format', () => {
  const issuesOf = (words: unknown, banned: unknown = { banned: [] }): string[] => {
    const folder = tempFolder();
    write(folder, 'words.json', words);
    write(folder, 'banned.json', banned);
    return loadTerminology(folder).issues.map((issue) => `${issue.path}: ${issue.message}`);
  };

  it('refuses an opener that is not one lower-case word, unknown fields and repeats', () => {
    expect(issuesOf({ names: ['Run', 'Run'], openers: ['the', 'The', 'two words', 'the'], extra: [] })).toEqual([
      "$.extra: Unknown field 'extra'.",
      "$.openers[1]: Expected an opener as one word in lower case, found 'The'.",
      "$.openers[2]: Expected an opener as one word in lower case, found 'two words'.",
      "$.names[1]: 'Run' is already listed.",
      "$.openers[3]: 'the' is already listed.",
    ]);
  });

  it('refuses a name or opener that holds a banned word', () => {
    expect(issuesOf({ names: ['Star Kit'], openers: ['win'] }, { banned: [{ phrase: 'star', reason: 'No rewards.' }, { phrase: 'win', reason: 'No winning.' }] })).toEqual([
      "$.names[0]: 'Star Kit' holds a banned word, so it could never be used.",
      "$.openers[0]: 'win' holds a banned word, so it could never be used.",
    ]);
  });

  it('turns the capitalised-word check off when it lists nothing', () => {
    const folder = tempFolder();
    write(folder, 'words.json', { names: [], openers: [] });
    const own = compileTerminology(loadTerminology(folder).terminology);
    expect(capitalFindings('Buzzy says hello', own)).toEqual([]);
  });
});
