import fs from 'node:fs';
import path from 'node:path';
import type { ContentIssue, Finding } from './codes.ts';
import { field, isRecord, readJson } from './records.ts';

/**
 * The terminology lists (README "Terminology format"). The real data is in packages/content/terminology/
 * (task 2.5); a missing file is an empty list.
 */

/** A real component name as it reads mid-sentence, and the plain-language glosses that may sit beside it. */
export interface ComponentTerm {
  readonly name: string;
  readonly glosses: readonly string[];
}

/** A word or phrase system text never uses, and why. */
export interface BannedPhrase {
  readonly phrase: string;
  readonly reason: string;
}

export interface Terminology {
  readonly components: readonly ComponentTerm[];
  /** Words that may stand beside a real name in a part's name, such as `large` or `2-cell`. */
  readonly qualifiers: readonly string[];
  readonly banned: readonly BannedPhrase[];
  /** Real terms that hold a banned word, such as `mount points`: the banned word is not refused inside them. */
  readonly allowed: readonly string[];
  /** Capitalised names that are not characters, such as a kit's name or the Run button: `Rolling Start`, `Run`. */
  readonly names?: readonly string[];
  /** Ordinary words that may open a sentence with a capital, such as `this` or `wired`. */
  readonly openers?: readonly string[];
}

/** The three files in a terminology folder. */
export const TERMINOLOGY_FILES = { components: 'components.json', banned: 'banned.json', words: 'words.json' } as const;

export interface LoadedTerminology {
  readonly terminology: Terminology;
  /** Format problems, as `terminology.bad_file` issues. A malformed entry is left out; the rest are used. */
  readonly issues: readonly ContentIssue[];
  /** Files that do not exist. Their lists are empty. */
  readonly missing: readonly string[];
}

// ---------------------------------------------------------------------------------------------
// Words

/** One word of a text: as written, the key it is compared by, and where it sits in the text. */
export interface Word {
  readonly raw: string;
  /** Lower case, compatibility-normalised and without accents. */
  readonly key: string;
  readonly start: number;
  readonly end: number;
}

const WORD = /[\p{L}\p{M}\p{N}]+/gu;

const keyOf = (raw: string): string => raw.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();

/**
 * The words of a text: runs of letters and digits. Spaces, hyphens, apostrophes and punctuation only
 * separate words, so `brain-y bit`, `Brain-y bit` and `brain y bit` are the same three words.
 */
export const wordsOf = (text: string): Word[] =>
  [...text.matchAll(WORD)]
    .map((match) => ({ raw: match[0], key: keyOf(match[0]), start: match.index, end: match.index + match[0].length }))
    .filter((word) => word.key !== '');

/** Where a run of keys starts among the words, as word indices. */
const findKeys = (words: readonly Word[], keys: readonly string[]): number[] => {
  const starts: number[] = [];
  if (keys.length === 0) return starts;
  for (let index = 0; index + keys.length <= words.length; index += 1) {
    if (keys.every((key, offset) => words[index + offset]?.key === key)) starts.push(index);
  }
  return starts;
};

/** The text from the first word of a span to the last, as written. */
const written = (text: string, words: readonly Word[], from: number, to: number): string =>
  text.slice(words[from]?.start ?? 0, words[to - 1]?.end ?? text.length);

const quoted = (text: string): string => `'${text.length > 60 ? `${text.slice(0, 60)}…` : text}'`;

interface Phrase {
  readonly text: string;
  readonly words: readonly Word[];
  readonly keys: readonly string[];
}

const phraseOf = (text: string): Phrase => {
  const words = wordsOf(text);
  return { text, words, keys: words.map((word) => word.key) };
};

const sameKeys = (a: Phrase, b: Phrase): boolean => a.keys.join(' ') === b.keys.join(' ');

// ---------------------------------------------------------------------------------------------
// Matching

/** The lists ready for matching. */
export interface TermMatcher {
  readonly components: readonly { readonly component: ComponentTerm; readonly name: Phrase; readonly glosses: readonly Phrase[] }[];
  readonly qualifiers: readonly Phrase[];
  readonly banned: readonly { readonly entry: BannedPhrase; readonly phrase: Phrase }[];
  /** The allow-list. */
  readonly allowed: readonly Phrase[];
  /** Each gloss once, with every component it is a gloss for. */
  readonly glosses: readonly { readonly gloss: Phrase; readonly owners: readonly { readonly component: ComponentTerm; readonly name: Phrase }[] }[];
  /** The listed capitalised names. */
  readonly names: readonly Phrase[];
  /** Words that may open a sentence with a capital: the openers, and every word of a listed term or name. */
  readonly openers: ReadonlySet<string>;
  /** Whether the words list names anything, which turns the capitalised-word check on for all system text. */
  readonly checksCapitals: boolean;
}

export const compileTerminology = (terminology: Terminology): TermMatcher => {
  const components = terminology.components.map((component) => ({
    component,
    name: phraseOf(component.name),
    glosses: component.glosses.map(phraseOf),
  }));
  const glosses: { gloss: Phrase; owners: { component: ComponentTerm; name: Phrase }[] }[] = [];
  for (const { component, name, glosses: own } of components) {
    for (const gloss of own) {
      const known = glosses.find((entry) => sameKeys(entry.gloss, gloss));
      if (known) known.owners.push({ component, name });
      else glosses.push({ gloss, owners: [{ component, name }] });
    }
  }
  const names = (terminology.names ?? []).map(phraseOf);
  const openers = terminology.openers ?? [];
  const listedWords = [
    ...components.flatMap(({ name, glosses: own }) => [name, ...own]),
    ...terminology.qualifiers.map(phraseOf),
    ...terminology.allowed.map(phraseOf),
    ...names,
  ].flatMap(({ keys }) => keys);
  return {
    components,
    qualifiers: terminology.qualifiers.map(phraseOf),
    banned: terminology.banned.map((entry) => ({ entry, phrase: phraseOf(entry.phrase) })),
    allowed: terminology.allowed.map(phraseOf),
    glosses,
    names,
    openers: new Set([...openers.map(keyOf), ...listedWords]),
    checksCapitals: names.length > 0 || openers.length > 0,
  };
};

type Span = readonly [from: number, to: number];

/** Where the phrases occur among the words, as word spans. */
const spansOf = (words: readonly Word[], phrases: readonly Phrase[]): Span[] =>
  phrases.flatMap(({ keys }) => findKeys(words, keys).map((start): Span => [start, start + keys.length]));

const within = (spans: readonly Span[], from: number, to: number): boolean => spans.some(([spanFrom, spanTo]) => spanFrom <= from && to <= spanTo);

/**
 * Banned words and phrases in one line of system text: whole words, ignoring case, accents and the
 * punctuation between words. A banned word that sits inside an allowed phrase, a real name or a gloss is
 * not refused, so `mount points` passes while `points` alone does not. One finding per banned entry, and a
 * banned word inside a longer banned phrase is left to that phrase: `Great job` is one finding, not two.
 */
export const bannedFindings = (text: string, matcher: TermMatcher): Finding[] => {
  if (matcher.banned.length === 0) return [];
  const words = wordsOf(text);
  const realTerms = [...matcher.allowed, ...matcher.components.flatMap(({ name, glosses }) => [name, ...glosses])];
  const allowedSpans = spansOf(words, realTerms);
  const bannedSpans = spansOf(words, matcher.banned.map(({ phrase }) => phrase));
  const inLongerBan = (from: number, to: number): boolean =>
    bannedSpans.some(([spanFrom, spanTo]) => spanFrom <= from && to <= spanTo && spanTo - spanFrom > to - from);
  const findings: Finding[] = [];
  for (const { entry, phrase } of matcher.banned) {
    const length = phrase.keys.length;
    const start = findKeys(words, phrase.keys).find((from) => !within(allowedSpans, from, from + length) && !inLongerBan(from, from + length));
    if (start === undefined) continue;
    findings.push({
      code: 'terminology.banned',
      message: `${quoted(written(text, words, start, start + length))} is on the banned list: ${entry.reason}`,
    });
  }
  return findings;
};

/**
 * Glosses standing alone in one line of system text. A plain-language gloss explains a real name and never
 * replaces it (brief Section 12), so a gloss passes only in a field that also holds its real name, as in
 * `chassis (frame)`; a gloss shared by several components passes beside any of them. Words inside a real
 * name, an allowed phrase or a banned phrase are not a gloss's use: the banned list reports those. One
 * finding per gloss.
 */
export const glossFindings = (text: string, matcher: TermMatcher): Finding[] => {
  if (matcher.glosses.length === 0) return [];
  const words = wordsOf(text);
  const realNames = matcher.components.map(({ name }) => name);
  const otherTerms = spansOf(words, [...realNames, ...matcher.allowed, ...matcher.banned.map(({ phrase }) => phrase)]);
  const findings: Finding[] = [];
  for (const { gloss, owners } of matcher.glosses) {
    if (owners.some(({ name }) => findKeys(words, name.keys).length > 0)) continue;
    const length = gloss.keys.length;
    const start = findKeys(words, gloss.keys).find((from) => !within(otherTerms, from, from + length));
    const [first] = owners;
    if (start === undefined || first === undefined) continue;
    const names = owners.map(({ component }) => quoted(component.name)).join(' or ');
    findings.push({
      code: 'terminology.gloss_alone',
      message: `${quoted(written(text, words, start, start + length))} is a gloss for ${names} and never stands alone: write the real name beside it, as in ${quoted(`${first.component.name} (${gloss.text})`)}.`,
    });
  }
  return findings;
};

const LETTER = /\p{L}/u;
const PROPER_NAME = /^\p{Lu}\p{Ll}/u;
/** Text before a word that opens a sentence ends in one of these, after spaces, quotes, brackets and Markdown marks are dropped. */
const SENTENCE_END = /[.:;?!·—–]$/u;
const BEFORE_WORD = /[\s"'“‘([#*•]+$/u;

/** Left to levelFindings. */
const LEVEL_WORDS = new Set(['level', 'levels']);

const opensSentence = (text: string, word: Word): boolean => {
  const before = text.slice(0, word.start).replace(BEFORE_WORD, '');
  return before === '' || SENTENCE_END.test(before);
};

/**
 * Capitalised words in one line of system text that read as a character's name (ground rule 7). A word that
 * starts with a capital and a lower-case letter passes inside a listed real name, gloss, qualifier, allowed
 * phrase or capitalised name, and at the start of a sentence when it is an ordinary word: an opener, or a word
 * of a listed term. Anything else is refused, as in `Buzzy says the wires are swapped` and `meet Buzzy`. Words
 * inside a banned phrase are left to the banned list. One finding per word as written. A part's name has its
 * own, stricter check (partNameFindings). With no words list, nothing is checked.
 */
export const capitalFindings = (text: string, matcher: TermMatcher): Finding[] => {
  if (!matcher.checksCapitals) return [];
  const words = wordsOf(text);
  const shields = spansOf(words, [
    ...matcher.components.flatMap(({ name, glosses }) => [name, ...glosses]),
    ...matcher.qualifiers,
    ...matcher.allowed,
    ...matcher.names,
    ...matcher.banned.map(({ phrase }) => phrase),
  ]);
  const seen = new Set<string>();
  const findings: Finding[] = [];
  words.forEach((word, index) => {
    if (!PROPER_NAME.test(word.raw) || LEVEL_WORDS.has(word.key) || within(shields, index, index + 1) || seen.has(word.raw)) return;
    if (opensSentence(text, word) && matcher.openers.has(word.key)) return;
    seen.add(word.raw);
    findings.push({
      code: 'terminology.proper_name',
      message: `${quoted(word.raw)} is capitalised and is not a listed term or name${opensSentence(text, word) ? ' or an opener' : ''}, so it reads as a character's name. If it is an ordinary word or a real name, add it to ${TERMINOLOGY_FILES.words}.`,
    });
  });
  return findings;
};

/**
 * `level` and `levels` in one line of system text. A level is a product word for adults and the app's shell,
 * not for a child's card or hint (brief Section 12, R-6.5 F4). Words inside a banned phrase such as `level up`
 * are left to the banned list. One finding per field.
 */
export const levelFindings = (text: string, matcher: TermMatcher): Finding[] => {
  const words = wordsOf(text);
  const banned = spansOf(words, matcher.banned.map(({ phrase }) => phrase));
  const index = words.findIndex((word, at) => LEVEL_WORDS.has(word.key) && !within(banned, at, at + 1));
  const word = words[index];
  if (word === undefined) return [];
  return [
    {
      code: 'text.level',
      message: `${quoted(word.raw)} is a product word: system text never names levels to the child (brief Section 12).`,
    },
  ];
};
/** What may sit between the listed terms of a part's name: spaces, and brackets as in `chassis (frame)`. */
const BETWEEN_TERMS = /[\s()]+/u;

/** A listed term found in a part's name, as a word span. */
interface Term {
  readonly what: 'real name' | 'qualifier' | 'gloss';
  readonly listed: Phrase;
  readonly from: number;
  readonly to: number;
}

const termsIn = (words: readonly Word[], what: Term['what'], phrases: readonly Phrase[]): Term[] =>
  phrases.flatMap((listed) => findKeys(words, listed.keys).map((from) => ({ what, listed, from, to: from + listed.keys.length })));

/** Leaves out each term that a longer one holds, as `switch` inside `bumper switch`. */
const outermost = (terms: readonly Term[]): Term[] =>
  terms.filter((a) => !terms.some((b) => b.from <= a.from && a.to <= b.to && b.to - b.from > a.to - a.from));

const overlaps = (a: Term, b: Term): boolean => a.from < b.to && b.from < a.to;

const NAME_TAIL = "A part's name is a real component name with nothing beside it but listed qualifiers, such as sizes.";

/**
 * Checks a part's name (`identity.name`, the real name as it reads mid-sentence) against the components
 * list. The name must hold a letter and a listed real name, and beside the real name only listed
 * qualifiers (`large`, `2-cell`) and glosses (`chassis (frame)`), with spaces and brackets between them.
 * Each of these is written exactly as listed. Anything else is refused: `sparky the DC motor`, `DC motor 🤖`.
 * A gloss beside the wrong real name is reported by glossFindings, as for any system text. With no
 * components listed, nothing is checked.
 */
export const partNameFindings = (name: string, matcher: TermMatcher): Finding[] => {
  if (matcher.components.length === 0 || name.trim() === '') return [];
  if (!LETTER.test(name)) {
    return [
      {
        code: 'terminology.not_real_name',
        message: `${quoted(name)} has no letters, so it contains no real component name. A part's name is built on a real name from the components list.`,
      },
    ];
  }
  const words = wordsOf(name);
  const realNames = outermost(termsIn(words, 'real name', matcher.components.map(({ name: real }) => real)));
  if (realNames.length === 0) {
    return [
      {
        code: 'terminology.not_real_name',
        message: `${quoted(name)} contains no real component name. A part's name is built on a real name from the components list.`,
      },
    ];
  }
  const beside = outermost(
    [...termsIn(words, 'qualifier', matcher.qualifiers), ...termsIn(words, 'gloss', matcher.glosses.map(({ gloss }) => gloss))].filter(
      (term) => !realNames.some((real) => overlaps(term, real)),
    ),
  );
  const terms = [...realNames, ...beside].toSorted((a, b) => a.from - b.from || a.to - b.to);
  const findings: Finding[] = [];
  for (const { what, listed, from, to } of terms) {
    // Word span against word span, so punctuation around a listed term never counts.
    const asWritten = written(name, words, from, to);
    const asListed = written(listed.text, listed.words, 0, listed.words.length);
    if (asWritten.normalize('NFC') !== asListed.normalize('NFC')) {
      findings.push({ code: 'terminology.name_form', message: `Write the ${what} as ${quoted(listed.text)}, not ${quoted(asWritten)}.` });
    }
  }
  const rest: string[] = [];
  let cursor = 0;
  for (const { from, to } of terms) {
    const start = words[from]?.start ?? cursor;
    rest.push(name.slice(cursor, Math.max(cursor, start)));
    cursor = Math.max(cursor, words[to - 1]?.end ?? start);
  }
  rest.push(name.slice(cursor));
  for (const piece of rest.flatMap((text) => text.split(BETWEEN_TERMS)).filter((text) => text !== '')) {
    findings.push(
      wordsOf(piece).some((word) => PROPER_NAME.test(word.raw))
        ? {
            code: 'terminology.proper_name',
            message: `${quoted(piece)} is capitalised and is not part of a real name, a listed qualifier or a gloss, so it reads as a character's name. ${NAME_TAIL}`,
          }
        : { code: 'terminology.not_qualifier', message: `${quoted(piece)} is not part of a real name, a listed qualifier or a gloss. ${NAME_TAIL}` },
    );
  }
  return findings.filter((finding, index) => findings.findIndex((other) => other.message === finding.message) === index);
};

// ---------------------------------------------------------------------------------------------
// Loading

type Report = (where: string, message: string) => void;

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** Extends a JSONPath in the schema's style: `$.banned[0].phrase`, `$['odd key']`. */
const at = (base: string, key: string | number): string => {
  if (typeof key === 'number') return `${base}[${key}]`;
  if (IDENTIFIER.test(key)) return `${base}.${key}`;
  return `${base}['${key.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}']`;
};

const LINE_BREAK = /[\n\r\u2028\u2029]/;

/** One trimmed line. An absent field reads as undefined without a report: readFields has reported it missing. */
const readLine = (value: unknown, where: string, report: Report, what: string): string | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    report(where, `Expected ${what} as a string.`);
    return undefined;
  }
  if (value === '' || value.trim() !== value || LINE_BREAK.test(value)) {
    report(where, `Expected ${what} on one line, without spaces at either end.`);
    return undefined;
  }
  return value;
};

const readPhrase = (value: unknown, where: string, report: Report, what: string): string | undefined => {
  const text = readLine(value, where, report, what);
  if (text !== undefined && wordsOf(text).length === 0) {
    report(where, `Expected ${what} with at least one word. Exclamation marks need no entry: the schema refuses them in all system text.`);
    return undefined;
  }
  return text;
};

/** Reports missing and unknown fields. The object is returned even with unknown fields, so its entries are still read. */
const readFields = (
  value: unknown,
  where: string,
  report: Report,
  required: readonly string[],
  optional: readonly string[] = [],
): Readonly<Record<string, unknown>> | undefined => {
  if (!isRecord(value)) {
    report(where, 'Expected an object.');
    return undefined;
  }
  for (const key of required) if (!Object.hasOwn(value, key)) report(at(where, key), `Missing '${key}'.`);
  for (const key of Object.keys(value)) {
    if (!required.includes(key) && !optional.includes(key)) report(at(where, key), `Unknown field '${key}'.`);
  }
  return value;
};

/** A list's items, each read on its own; an item the reader refuses is left out. An absent list is empty. */
const readList = <T>(value: unknown, where: string, report: Report, read: (item: unknown, where: string) => T | undefined): T[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    report(where, 'Expected a list.');
    return [];
  }
  return value.flatMap((item: unknown, index) => {
    const entry = read(item, at(where, index));
    return entry === undefined ? [] : [entry];
  });
};

interface Placed<T> {
  readonly value: T;
  /** The JSONPath it was read from. */
  readonly where: string;
}

/** Reports each phrase that repeats an earlier one, compared as words. */
const reportRepeats = (texts: readonly Placed<string>[], report: Report): void => {
  const seen = new Set<string>();
  for (const { value, where } of texts) {
    const key = phraseOf(value).keys.join(' ');
    if (seen.has(key)) report(where, `${quoted(value)} is already listed.`);
    seen.add(key);
  }
};

interface ComponentsFile {
  readonly components: readonly ComponentTerm[];
  readonly qualifiers: readonly string[];
}

const readComponents = (root: unknown, report: Report): ComponentsFile => {
  const record = readFields(root, '$', report, ['components'], ['qualifiers']);
  if (!record) return { components: [], qualifiers: [] };
  const listed = readList(field(record, 'components'), '$.components', report, (item, where): Placed<ComponentTerm> | undefined => {
    const entry = readFields(item, where, report, ['name'], ['glosses']);
    if (!entry) return undefined;
    const name = readPhrase(field(entry, 'name'), at(where, 'name'), report, 'a real component name');
    const glosses = readList(field(entry, 'glosses'), at(where, 'glosses'), report, (gloss, glossWhere): Placed<string> | undefined => {
      const text = readPhrase(gloss, glossWhere, report, 'a gloss');
      return text === undefined ? undefined : { value: text, where: glossWhere };
    });
    reportRepeats(glosses, report);
    return name === undefined ? undefined : { value: { name, glosses: glosses.map(({ value }) => value) }, where: at(where, 'name') };
  });
  reportRepeats(
    listed.map(({ value, where }) => ({ value: value.name, where })),
    report,
  );
  const qualifiers = readList(field(record, 'qualifiers'), '$.qualifiers', report, (item, where): Placed<string> | undefined => {
    const text = readPhrase(item, where, report, 'a qualifier');
    return text === undefined ? undefined : { value: text, where };
  });
  reportRepeats(qualifiers, report);
  return { components: listed.map(({ value }) => value), qualifiers: qualifiers.map(({ value }) => value) };
};

interface BannedFile {
  readonly banned: readonly Placed<BannedPhrase>[];
  readonly allowed: readonly Placed<string>[];
}

const readBanned = (root: unknown, report: Report): BannedFile => {
  const record = readFields(root, '$', report, ['banned'], ['allowed']);
  if (!record) return { banned: [], allowed: [] };
  const banned = readList(field(record, 'banned'), '$.banned', report, (item, where): Placed<BannedPhrase> | undefined => {
    const entry = readFields(item, where, report, ['phrase', 'reason']);
    if (!entry) return undefined;
    const phrase = readPhrase(field(entry, 'phrase'), at(where, 'phrase'), report, 'a banned word or phrase');
    const reason = readLine(field(entry, 'reason'), at(where, 'reason'), report, 'a reason');
    return phrase === undefined || reason === undefined ? undefined : { value: { phrase, reason }, where: at(where, 'phrase') };
  });
  const allowed = readList(field(record, 'allowed'), '$.allowed', report, (item, where): Placed<string> | undefined => {
    const text = readPhrase(item, where, report, 'an allowed phrase');
    return text === undefined ? undefined : { value: text, where };
  });
  reportRepeats(
    banned.map(({ value, where }) => ({ value: value.phrase, where })),
    report,
  );
  reportRepeats(allowed, report);
  return { banned, allowed };
};

interface WordsFile {
  readonly names: readonly Placed<string>[];
  readonly openers: readonly Placed<string>[];
}

const readWords = (root: unknown, report: Report): WordsFile => {
  const record = readFields(root, '$', report, [], ['names', 'openers']);
  if (!record) return { names: [], openers: [] };
  const names = readList(field(record, 'names'), '$.names', report, (item, where): Placed<string> | undefined => {
    const text = readPhrase(item, where, report, 'a capitalised name');
    return text === undefined ? undefined : { value: text, where };
  });
  const openers = readList(field(record, 'openers'), '$.openers', report, (item, where): Placed<string> | undefined => {
    const text = readPhrase(item, where, report, 'an opener');
    if (text === undefined) return undefined;
    if (wordsOf(text).length !== 1 || text !== text.toLowerCase()) {
      report(where, `Expected an opener as one word in lower case, found ${quoted(text)}.`);
      return undefined;
    }
    return { value: text, where };
  });
  reportRepeats(names, report);
  reportRepeats(openers, report);
  return { names, openers };
};

/** A name or opener that is banned could never be used. */
const reportBannedWords = (file: WordsFile, banned: readonly Placed<BannedPhrase>[], report: Report): void => {
  const bans = banned.map(({ value }) => phraseOf(value.phrase));
  for (const { value, where } of [...file.names, ...file.openers]) {
    const words = phraseOf(value).words;
    if (bans.some((ban) => findKeys(words, ban.keys).length > 0)) report(where, `${quoted(value)} holds a banned word, so it could never be used.`);
  }
};

/**
 * A banned phrase that is also an allowed phrase, a real name or a gloss could never be refused. A qualifier
 * that holds a banned phrase, outside any of those, could never be used: the name check takes it, but the
 * banned check refuses every name that has it.
 */
const reportContradictions = (
  file: BannedFile,
  components: readonly ComponentTerm[],
  qualifiers: readonly string[],
  report: Report,
): void => {
  const permitted = [
    ...file.allowed.map(({ value }) => ({ phrase: phraseOf(value), as: 'an allowed phrase' })),
    ...components.map(({ name }) => ({ phrase: phraseOf(name), as: `a real component name in ${TERMINOLOGY_FILES.components}` })),
    ...components.flatMap(({ name, glosses }) =>
      glosses.map((gloss) => ({ phrase: phraseOf(gloss), as: `a gloss for ${quoted(name)} in ${TERMINOLOGY_FILES.components}` })),
    ),
  ];
  const shields = permitted.map(({ phrase }) => phrase);
  const qualifierPhrases = qualifiers.map(phraseOf);
  for (const { value, where } of file.banned) {
    const banned = phraseOf(value.phrase);
    const clash = permitted.find(({ phrase }) => sameKeys(phrase, banned));
    if (clash) report(where, `${quoted(value.phrase)} is banned but is also ${clash.as}.`);
    for (const qualifier of qualifierPhrases) {
      const shielded = spansOf(qualifier.words, shields);
      const length = banned.keys.length;
      if (findKeys(qualifier.words, banned.keys).some((from) => !within(shielded, from, from + length))) {
        report(where, `${quoted(value.phrase)} is banned, so the qualifier ${quoted(qualifier.text)} in ${TERMINOLOGY_FILES.components} could never be used.`);
      }
    }
  }
};

/**
 * Reads the terminology folder: `components.json`, `banned.json` and `words.json`. A missing folder or file is an empty
 * list. Never throws: format problems come back as `terminology.bad_file` issues.
 */
export const loadTerminology = (folder: string): LoadedTerminology => {
  const issues: ContentIssue[] = [];
  const missing: string[] = [];
  const reporter =
    (file: string): Report =>
    (where, message) =>
      issues.push({ file, code: 'terminology.bad_file', path: where, message });
  /** The file's JSON, or undefined when it is missing or unreadable. */
  const load = (file: string): { readonly value: unknown } | undefined => {
    if (!fs.existsSync(file)) {
      missing.push(file);
      return undefined;
    }
    const read = readJson(file);
    if (read.ok) return { value: read.value };
    reporter(file)('$', read.message);
    return undefined;
  };
  const componentsFile = path.join(folder, TERMINOLOGY_FILES.components);
  const bannedFile = path.join(folder, TERMINOLOGY_FILES.banned);
  const componentsJson = load(componentsFile);
  const bannedJson = load(bannedFile);
  const wordsFile = path.join(folder, TERMINOLOGY_FILES.words);
  const wordsJson = load(wordsFile);
  const { components, qualifiers } = componentsJson
    ? readComponents(componentsJson.value, reporter(componentsFile))
    : { components: [], qualifiers: [] };
  const banned = bannedJson ? readBanned(bannedJson.value, reporter(bannedFile)) : { banned: [], allowed: [] };
  reportContradictions(banned, components, qualifiers, reporter(bannedFile));
  const words = wordsJson ? readWords(wordsJson.value, reporter(wordsFile)) : { names: [], openers: [] };
  reportBannedWords(words, banned.banned, reporter(wordsFile));
  return {
    terminology: {
      components,
      qualifiers,
      banned: banned.banned.map(({ value }) => value),
      allowed: banned.allowed.map(({ value }) => value),
      names: words.names.map(({ value }) => value),
      openers: words.openers.map(({ value }) => value),
    },
    issues,
    missing,
  };
};
