// UI copy against the terminology lists (R-6.4 TLS-3, task 7.2). Every string a child or an adult can see in
// packages/app/src and packages/parent/src — string literals, template text, JSX text, aria-labels and text tables
// such as CARD_GAME_TEXT — is checked against content's banned list, for capitalised words that read as a character's
// name (the same words.json the content validator uses) and for exclamation marks, entity-encoded ones included, so a
// word added to banned.json reaches the UI too. Levels and questions are content-only rules: the app's shell shows "Level 1", and
// adult copy may ask a question.
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { bannedFindings, capitalFindings, compileTerminology, loadTerminology } from '../src/validate-content/terminology.ts';
import { uiStringsIn, uiStringsOf } from './ui-copy/collect.ts';
import type { UiString } from './ui-copy/collect.ts';
import { CONTENT_TERMINOLOGY, REPO_ROOT } from './validate-content/support.ts';

const matcher = compileTerminology(loadTerminology(CONTENT_TERMINOLOGY).terminology);
/** The schema's exclamation marks: `!`, `¡`, `！`, `‼`, `⁉`, `❗` and `❕`. */
const EXCLAMATIONS = /[!¡！‼⁉❗❕]/u;

/**
 * Banned words that are right where they stand, each with its reason. `characters` is banned as a mascot word, but
 * these lines count the characters in a typed name, for the adult who types it.
 */
const EXCEPTIONS: readonly { readonly file: string; readonly text: string; readonly reason: string }[] = [
  {
    file: 'packages/app/src/store/profiles.ts',
    text: 'A profile name is 1 to 60 characters on one line, without spaces at either end.',
    reason: 'a length in characters',
  },
  { file: 'packages/parent/src/accounts/model.ts', text: 'characters.', reason: 'a length in characters' },
];

const relative = (file: string): string => path.relative(REPO_ROOT, file).split(path.sep).join('/');
/** A string that is one CamelCase identifier, such as an Error subclass's `name`, is code, not copy. */
const IDENTIFIER = /^[A-Z][a-z]+(?:[A-Z][a-z]*)+$/u;

const excepted = (copy: UiString): boolean => EXCEPTIONS.some(({ file, text }) => file === relative(copy.file) && text === copy.text);

/** One line per problem: where it is, and what is wrong. */
const problemsIn = (strings: readonly UiString[]): string[] =>
  strings.flatMap((copy) => {
    const where = `${relative(copy.file)}:${copy.line}`;
    const banned = excepted(copy) ? [] : bannedFindings(copy.text, matcher).map((finding) => `${where}: ${finding.message}`);
    const exclamation = EXCLAMATIONS.test(copy.text) ? [`${where}: '${copy.text}' has an exclamation mark (ground rule 7).`] : [];
    const names = IDENTIFIER.test(copy.text) ? [] : capitalFindings(copy.text, matcher).map((finding) => `${where}: ${finding.message}`);
    return [...banned, ...names, ...exclamation];
  });

const APP = path.join(REPO_ROOT, 'packages', 'app', 'src');
const PARENT = path.join(REPO_ROOT, 'packages', 'parent', 'src');
const shown = [...uiStringsIn(APP), ...uiStringsIn(PARENT)];

describe('UI copy in app and parent', () => {
  it('uses no banned word, no character name and no exclamation mark', () => {
    expect(problemsIn(shown)).toEqual([]);
  });

  it('keeps every exception in use', () => {
    for (const exception of EXCEPTIONS) {
      expect(shown.some((copy) => relative(copy.file) === exception.file && copy.text === exception.text)).toBe(true);
    }
  });

  it('reads the text tables, JSX text and aria-labels', () => {
    const texts = new Set(shown.map((copy) => copy.text));
    for (const text of ['Start a round', 'Stop the round', 'Zoom in', 'Replay']) expect(texts).toContain(text);
    expect(shown.some((copy) => relative(copy.file) === 'packages/parent/src/card-game/view.tsx')).toBe(true);
  });
});

describe('a planted word fails the check', () => {
  const planted = (source: string, file = 'planted.tsx'): string[] => problemsIn(uiStringsOf(path.join(APP, file), source));

  it.each([
    ['a text table', "export const TEXT = { done: 'Great job, the round is over' };"],
    ['JSX text', 'export const View = () => <p>You win a star</p>;'],
    ['an aria-label', 'export const View = () => <button aria-label="Collect your reward">Go</button>;'],
    ['a title in a JSX expression', "export const View = () => <img alt='' title={'Earn points'} />;"],
    ['a template', 'export const line = (name: string) => `${name} unlocked a trophy`;'],
    ['a function in a text table', 'export const TEXT = { title: (n: number) => `Level ${n} high score` };'],
  ])('in %s', (_where, source) => {
    expect(planted(source)).not.toEqual([]);
  });

  it.each([
    ['a text table', "export const TEXT = { done: 'The round is over!' };"],
    ['JSX text', 'export const View = () => <p>Ready¡</p>;'],
    ['an aria-label', 'export const View = () => <button aria-label="Run it！">Go</button>;'],
    ['JSX text, as an entity', 'export const View = () => <p>Ready&#33;</p>;'],
    ['JSX text, as a hex entity', 'export const View = () => <p>Ready&#x21;</p>;'],
    ['an aria-label, as a named entity', 'export const View = () => <button aria-label="Run it&excl;">Go</button>;'],
  ])('an exclamation mark in %s', (_where, source) => {
    expect(planted(source)).toEqual([expect.stringContaining('has an exclamation mark')]);
  });

  it.each([
    ['JSX text', 'export const View = () => <p>Buzzy needs power</p>;'],
    ['an aria-label', 'export const View = () => <button aria-label="Give Sparky power">Go</button>;'],
    ['a text table', "export const TEXT = { hint: 'Ask Buzzy for a hint' };"],
  ])('a character name in %s', (_where, source) => {
    expect(planted(source)).toEqual([expect.stringContaining("reads as a character's name")]);
  });

  it('judges a sentence start after a list marker or a number, so a list item may open with a capital', () => {
    const items = (lines: readonly string[]): string => `export const NOTE = \`${lines.join('\n')}\`;`;
    expect(planted(items(['## The events', '- Each time a Run is kept.', '* Each hint shown.', '1. Each export.', '2) Each one again.', '• Each last one.']))).toEqual([]);
    expect(planted(items(['## The events', '- Buzzy needs power.']))).toEqual([expect.stringContaining("reads as a character's name")]);
  });

  it('in a .ts file', () => {
    expect(planted("throw new Error('Well done, nothing was kept.');", 'planted.ts')).toEqual([expect.stringContaining("'Well done' is on the banned list")]);
  });

  it('but not in code: imports, classes, ids, keys and types', () => {
    const source = [
      "import points from './great.ts';",
      "type Kind = 'winner' | 'star';",
      "const map = { great: 1 }; const x = map['great'];",
      "if (event.key === 'Escape' || event.key === 'Buzzy') close();",
      "class Refused extends Error { name = 'NameRefused'; }",
      'export const View = () => <div className="star-badge" id="trophy" data-kind="win" role="group">Zoom</div>;',
    ].join('\n');
    expect(planted(source)).toEqual([]);
  });
});
