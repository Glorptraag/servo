import fs from 'node:fs';
import path from 'node:path';
import type { ContentIssue, Finding } from './codes.ts';
import { field, isRecord, readJson } from './records.ts';

/**
 * The terminology lists (README "Terminology format"). Task 2.5 authors the real data in
 * packages/content/terminology/; a missing file is an empty list.
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
  readonly banned: readonly BannedPhrase[];
  /** Real terms that hold a banned word, such as `mount points`: the banned word is not refused inside them. */
  readonly allowed: readonly string[];
}

/** The two files in a terminology folder. */
export const TERMINOLOGY_FILES = { components: 'components.json', banned: 'banned.json' } as const;

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
  readonly banned: readonly { readonly entry: BannedPhrase; readonly phrase: Phrase }[];
  /** Allowed phrases, real names and glosses: a banned word inside one of them is not refused. */
  readonly allowed: readonly Phrase[];
}

export const compileTerminology = (terminology: Terminology): TermMatcher => {
  const components = terminology.components.map((component) => ({
    component,
    name: phraseOf(component.name),
    glosses: component.glosses.map(phraseOf),
  }));
  return {
    components,
    banned: terminology.banned.map((entry) => ({ entry, phrase: phraseOf(entry.phrase) })),
    allowed: [...terminology.allowed.map(phraseOf), ...components.flatMap(({ name, glosses }) => [name, ...glosses])],
  };
};

/**
 * Banned words and phrases in one line of system text: whole words, ignoring case, accents and the
 * punctuation between words. A banned word that sits inside an allowed phrase, a real name or a gloss is
 * not refused, so `mount points` passes while `points` alone does not. One finding per banned entry.
 */
export const bannedFindings = (text: string, matcher: TermMatcher): Finding[] => {
  if (matcher.banned.length === 0) return [];
  const words = wordsOf(text);
  const allowedSpans = matcher.allowed.flatMap(({ keys }) => findKeys(words, keys).map((start) => [start, start + keys.length] as const));
  const findings: Finding[] = [];
  for (const { entry, phrase } of matcher.banned) {
    const length = phrase.keys.length;
    const start = findKeys(words, phrase.keys).find(
      (from) => !allowedSpans.some(([allowedFrom, allowedTo]) => allowedFrom <= from && from + length <= allowedTo),
    );
    if (start === undefined) continue;
    findings.push({
      code: 'terminology.banned',
      message: `${quoted(written(text, words, start, start + length))} is on the banned list: ${entry.reason}`,
    });
  }
  return findings;
};

const PROPER_NAME = /^\p{Lu}\p{Ll}/u;

/**
 * Checks a part's name (`identity.name`, the real name as it reads mid-sentence) against the components
 * list: it must contain a listed real name, written exactly as listed, and no capitalised word outside it.
 * Qualifiers such as `large` or `2-cell` may stand beside the real name. With no components listed, nothing
 * is checked.
 */
export const partNameFindings = (name: string, matcher: TermMatcher): Finding[] => {
  const words = wordsOf(name);
  if (matcher.components.length === 0 || words.length === 0) return [];
  const found = matcher.components.flatMap(({ component, name: real }) =>
    findKeys(words, real.keys).map((from) => ({ component, real, from, to: from + real.keys.length })),
  );
  if (found.length === 0) {
    for (const { component, glosses } of matcher.components) {
      for (const gloss of glosses) {
        const [from] = findKeys(words, gloss.keys);
        if (from === undefined) continue;
        const glossAsWritten = written(name, words, from, from + gloss.keys.length);
        return [
          {
            code: 'terminology.not_real_name',
            message: `${quoted(glossAsWritten)} is a plain-language gloss for ${quoted(component.name)}. Name the part by its real name; the gloss only sits beside it.`,
          },
        ];
      }
    }
    return [
      {
        code: 'terminology.not_real_name',
        message: `${quoted(name)} contains no real component name. A part's name is built on a real name from the components list.`,
      },
    ];
  }
  const findings: Finding[] = [];
  const outermost = found.filter((a) => !found.some((b) => b.from <= a.from && a.to <= b.to && b.to - b.from > a.to - a.from));
  for (const { component, real, from, to } of outermost) {
    // Word span against word span, so punctuation around a listed name never counts.
    const asWritten = written(name, words, from, to);
    const asListed = written(real.text, real.words, 0, real.words.length);
    if (asWritten.normalize('NFC') !== asListed.normalize('NFC')) {
      findings.push({
        code: 'terminology.name_form',
        message: `Write the real name as ${quoted(component.name)}, not ${quoted(asWritten)}.`,
      });
    }
  }
  words.forEach((word, index) => {
    const insideRealName = found.some(({ from, to }) => from <= index && index < to);
    if (!insideRealName && PROPER_NAME.test(word.raw)) {
      findings.push({
        code: 'terminology.proper_name',
        message: `${quoted(word.raw)} is capitalised outside the real name, so it reads as a character's name. A part's name reads mid-sentence: lower case apart from the real name's own capitals.`,
      });
    }
  });
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

const readComponents = (root: unknown, report: Report): ComponentTerm[] => {
  const record = readFields(root, '$', report, ['components']);
  if (!record) return [];
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
  return listed.map(({ value }) => value);
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

/** A banned phrase that is also an allowed phrase, a real name or a gloss could never be refused. */
const reportContradictions = (file: BannedFile, components: readonly ComponentTerm[], report: Report): void => {
  const permitted = [
    ...file.allowed.map(({ value }) => ({ phrase: phraseOf(value), as: 'an allowed phrase' })),
    ...components.map(({ name }) => ({ phrase: phraseOf(name), as: `a real component name in ${TERMINOLOGY_FILES.components}` })),
    ...components.flatMap(({ name, glosses }) =>
      glosses.map((gloss) => ({ phrase: phraseOf(gloss), as: `a gloss for ${quoted(name)} in ${TERMINOLOGY_FILES.components}` })),
    ),
  ];
  for (const { value, where } of file.banned) {
    const banned = phraseOf(value.phrase);
    const clash = permitted.find(({ phrase }) => sameKeys(phrase, banned));
    if (clash) report(where, `${quoted(value.phrase)} is banned but is also ${clash.as}.`);
  }
};

/**
 * Reads the terminology folder: `components.json` and `banned.json`. A missing folder or file is an empty
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
  const components = componentsJson ? readComponents(componentsJson.value, reporter(componentsFile)) : [];
  const banned = bannedJson ? readBanned(bannedJson.value, reporter(bannedFile)) : { banned: [], allowed: [] };
  reportContradictions(banned, components, reporter(bannedFile));
  return {
    terminology: {
      components,
      banned: banned.banned.map(({ value }) => value),
      allowed: banned.allowed.map(({ value }) => value),
    },
    issues,
    missing,
  };
};
