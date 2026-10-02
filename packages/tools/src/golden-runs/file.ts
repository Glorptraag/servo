// A golden file: the reference for one Run, as text that diffs well. `formatGolden` writes it and `parseGolden` reads it
// back to the same GoldenFile. The layout is in README.md.
import type { FaultSeen, RunInput } from '@servo/schema';
import { FIELD_ORDER, NONE, applyChanges, changedFields } from './summary.ts';
import type { SubjectState, TickState } from './summary.ts';

/** Bumped whenever the layout changes. A file in another format cannot be read, and `--accept` rewrites it. */
export const GOLDEN_FORMAT = 1;

export const GOLDEN_EXTENSION = '.golden';

/** One tick of a golden file. */
export interface GoldenTick {
  readonly tick: number;
  /** The first 8 hex digits of the SHA-256 of this tick's events, exactly as the run record keeps them. */
  readonly hash: string;
  /** Every subject's summarized state at this tick. */
  readonly state: TickState;
}

/** A hash of one of the Run's inputs, so a diff can say whether the build, a part record or the arena changed. */
export interface InputHash {
  readonly id: string;
  readonly hash: string;
}

/** Everything a golden file holds. */
export interface GoldenFile {
  /** `content/<fixture>` or `schema/<blueprint>`: the file's path inside packages/sim-core/golden/, without the extension. */
  readonly id: string;
  readonly seed: number;
  /** The Run's last tick; `frames` holds ticks 0 to `ticks`. */
  readonly ticks: number;
  readonly inputs: readonly RunInput[];
  /** The first 16 hex digits of the SHA-256 of the canonical blueprint the Run read. */
  readonly blueprint: string;
  readonly arena: InputHash;
  /** Each part record the blueprint uses, in id order. */
  readonly parts: readonly InputHash[];
  /** The SHA-256 of the whole run record, as the schema's canonicalJson writes it. */
  readonly record: string;
  /** The run record's faults: each failure mode shown, once, from its first tick. */
  readonly faults: readonly FaultSeen[];
  /** Every subject, in `frame.live`'s order: placed parts by id, then props. */
  readonly subjects: readonly string[];
  readonly frames: readonly GoldenTick[];
}

const HEADER = [
  '# Servo golden run (task 1.7): the reference this Run is checked against. Written by `pnpm golden --accept`; never edit it by hand.',
  '# Layout: packages/tools/src/golden-runs/README.md',
];

/** The change lines of one tick: each subject with a field that differs from the tick before. */
const changeLines = (state: TickState, before: TickState | undefined): string[] =>
  [...state].flatMap(([subject, fields]) => {
    const changes = changedFields(fields, before?.get(subject));
    return changes.size === 0 ? [] : [`  ${[subject, ...[...changes].map(([field, value]) => `${field}=${value}`)].join(' ')}`];
  });

/** The golden file's text. Each tick lists only what changed since the tick before, so tick 0 lists every field. */
export const formatGolden = (file: GoldenFile): string => {
  const lines = [
    ...HEADER,
    `golden ${GOLDEN_FORMAT}`,
    `case ${file.id}`,
    `seed ${file.seed}`,
    `ticks ${file.ticks}`,
    ...(file.inputs.length === 0 ? [`inputs ${NONE}`] : file.inputs.map((input) => `input ${input.tick} ${input.partId} closed=${input.closed}`)),
    `blueprint ${file.blueprint}`,
    `arena ${file.arena.id} ${file.arena.hash}`,
    ...file.parts.map((part) => `part ${part.id} ${part.hash}`),
    `record ${file.record}`,
    ...(file.faults.length === 0 ? [`faults ${NONE}`] : file.faults.map((fault) => `fault ${fault.partId} ${fault.failure} first-tick=${fault.firstTick}`)),
    ['subjects', ...file.subjects].join(' '),
  ];
  let before: TickState | undefined;
  for (const frame of file.frames) {
    lines.push(`tick ${frame.tick} ${frame.hash}`, ...changeLines(frame.state, before));
    before = frame.state;
  }
  return `${lines.join('\n')}\n`;
};

export type GoldenParse = { readonly ok: true; readonly file: GoldenFile } | { readonly ok: false; readonly line: number; readonly message: string };

/** Where a golden file cannot be read, and why. */
class Unreadable extends Error {
  readonly line: number;
  constructor(line: number, message: string) {
    super(message);
    this.line = line;
  }
}

const WORD = /^[^\s=]+$/;
const WHOLE = /^(0|[1-9][0-9]*)$/;
const FIELDS = new Set(FIELD_ORDER);
const HEADER_KEYS = ['golden', 'case', 'seed', 'ticks', 'blueprint', 'arena', 'record', 'subjects'] as const;

const wholeNumber = (text: string | undefined, line: number, what: string): number => {
  if (text === undefined || !WHOLE.test(text)) throw new Unreadable(line, `Expected ${what} as a whole number, not '${text ?? ''}'.`);
  return Number(text);
};

const word = (text: string | undefined, line: number, what: string): string => {
  if (text === undefined || !WORD.test(text)) throw new Unreadable(line, `Expected ${what}, not '${text ?? ''}'.`);
  return text;
};

const hex = (text: string | undefined, digits: number, line: number, what: string): string => {
  if (text === undefined || !new RegExp(`^[0-9a-f]{${digits}}$`).test(text)) {
    throw new Unreadable(line, `Expected ${what} as ${digits} lower-case hex digits, not '${text ?? ''}'.`);
  }
  return text;
};

const pair = (text: string | undefined, key: string, line: number, shape: string): string => {
  if (text === undefined || !text.startsWith(`${key}=`) || text.length === key.length + 1) throw new Unreadable(line, `Expected ${shape}.`);
  return text.slice(key.length + 1);
};

/** Reads a golden file. Never throws: a file it cannot read gives the line and what is wrong there. */
export const parseGolden = (text: string): GoldenParse => {
  try {
    return { ok: true, file: parse(text) };
  } catch (error) {
    if (error instanceof Unreadable) return { ok: false, line: error.line, message: error.message };
    throw error;
  }
};

const parse = (text: string): GoldenFile => {
  const seen = new Map<string, number>();
  const header: Record<(typeof HEADER_KEYS)[number], string[] | undefined> = {
    golden: undefined,
    case: undefined,
    seed: undefined,
    ticks: undefined,
    blueprint: undefined,
    arena: undefined,
    record: undefined,
    subjects: undefined,
  };
  const inputs: RunInput[] = [];
  const parts: InputHash[] = [];
  const faults: FaultSeen[] = [];
  const frames: GoldenTick[] = [];
  let subjects: string[] | undefined;
  let state = new Map<string, SubjectState>();
  let open: { readonly tick: number; readonly hash: string } | undefined;
  const close = (): void => {
    if (open) frames.push({ ...open, state: new Map(state) });
  };
  const once = (key: string, line: number): void => {
    const first = seen.get(key);
    if (first !== undefined) throw new Unreadable(line, `'${key}' is given twice, first on line ${first}.`);
    seen.set(key, line);
  };
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  lines.forEach((raw, index) => {
    const line = index + 1;
    if (raw.trim() === '' || raw.startsWith('#')) return;
    if (raw.startsWith('  ')) {
      if (!open || !subjects) throw new Unreadable(line, 'A subject line comes before the first tick.');
      const [name, ...fields] = raw.slice(2).split(' ');
      const subject = word(name, line, 'a subject');
      if (!subjects.includes(subject)) throw new Unreadable(line, `'${subject}' is not in the subjects line.`);
      if (fields.length === 0) throw new Unreadable(line, `'${subject}' has no fields.`);
      const changes = new Map<string, string>();
      for (const field of fields) {
        const at = field.indexOf('=');
        const key = field.slice(0, at);
        if (at <= 0 || at === field.length - 1) throw new Unreadable(line, `Expected field=value, not '${field}'.`);
        if (!FIELDS.has(key)) throw new Unreadable(line, `'${key}' is not a field a golden file keeps.`);
        if (changes.has(key)) throw new Unreadable(line, `'${key}' is given twice.`);
        changes.set(key, field.slice(at + 1));
      }
      state.set(subject, applyChanges(state.get(subject), changes));
      return;
    }
    const [key = '', ...rest] = raw.split(' ');
    if (key === 'tick') {
      const missing = HEADER_KEYS.filter((name) => header[name] === undefined);
      if (missing.length > 0 || !subjects) throw new Unreadable(line, `The header lacks ${missing.join(', ')}.`);
      if (rest.length !== 2) throw new Unreadable(line, 'A tick line is `tick <n> <hash>`.');
      const tick = wholeNumber(rest[0], line, 'the tick');
      close();
      if (tick !== frames.length) throw new Unreadable(line, `Expected tick ${frames.length}, not tick ${tick}.`);
      if (!open) state = new Map(subjects.map((subject) => [subject, new Map<string, string>()]));
      open = { tick, hash: hex(rest[1], 8, line, "the tick's hash") };
      return;
    }
    if (open) throw new Unreadable(line, `'${key}' belongs in the header, before the first tick.`);
    if (key === 'input') {
      if (seen.has('inputs')) throw new Unreadable(line, `\`inputs ${NONE}\` is given too.`);
      const closed = pair(rest[2], 'closed', line, 'an input as `input <tick> <part> closed=true|false`');
      if (closed !== 'true' && closed !== 'false') throw new Unreadable(line, 'An input is `input <tick> <part> closed=true|false`.');
      inputs.push({ tick: wholeNumber(rest[0], line, "the input's tick"), partId: word(rest[1], line, 'a part'), kind: 'switch', closed: closed === 'true' });
      return;
    }
    if (key === 'part') {
      parts.push({ id: word(rest[0], line, 'a part record'), hash: hex(rest[1], 16, line, "the part record's hash") });
      return;
    }
    if (key === 'fault') {
      if (seen.has('faults')) throw new Unreadable(line, `\`faults ${NONE}\` is given too.`);
      const firstTick = wholeNumber(pair(rest[2], 'first-tick', line, 'a fault as `fault <part> <failure> first-tick=<n>`'), line, 'the first tick');
      faults.push({ partId: word(rest[0], line, 'a part'), failure: word(rest[1], line, 'a failure mode'), firstTick });
      return;
    }
    if (key === 'inputs' || key === 'faults') {
      once(key, line);
      const listed = key === 'inputs' ? inputs.length : faults.length;
      if (rest.length !== 1 || rest[0] !== NONE || listed > 0) throw new Unreadable(line, `\`${key} ${NONE}\` stands alone, for a Run with no ${key === 'inputs' ? 'input' : 'fault'}.`);
      return;
    }
    if (!(HEADER_KEYS as readonly string[]).includes(key)) throw new Unreadable(line, `Unknown line '${raw}'.`);
    once(key, line);
    header[key as (typeof HEADER_KEYS)[number]] = rest;
    if (key === 'golden' && wholeNumber(rest[0], line, 'the format') !== GOLDEN_FORMAT) {
      throw new Unreadable(line, `This file is format ${rest[0] ?? ''}; this harness reads format ${GOLDEN_FORMAT}.`);
    }
    if (key === 'subjects') {
      subjects = rest.map((subject) => word(subject, line, 'a subject'));
      if (new Set(subjects).size !== subjects.length) throw new Unreadable(line, 'A subject is listed twice.');
    }
  });
  close();
  const at = (key: (typeof HEADER_KEYS)[number]): number => seen.get(key) ?? lines.length;
  const missing = HEADER_KEYS.filter((name) => header[name] === undefined);
  if (missing.length > 0 || !subjects) throw new Unreadable(lines.length, `The header lacks ${missing.join(', ')}.`);
  const ticks = wholeNumber(header.ticks?.[0], at('ticks'), 'the number of ticks');
  if (frames.length !== ticks + 1) {
    throw new Unreadable(lines.length, `The Run has ${ticks} ticks, so the file needs ticks 0 to ${ticks}; it has ${frames.length === 0 ? 'none' : `0 to ${frames.length - 1}`}.`);
  }
  return {
    id: word(header.case?.[0], at('case'), 'the case'),
    seed: wholeNumber(header.seed?.[0], at('seed'), 'the seed'),
    ticks,
    inputs,
    blueprint: hex(header.blueprint?.[0], 16, at('blueprint'), "the blueprint's hash"),
    arena: { id: word(header.arena?.[0], at('arena'), 'the arena preset'), hash: hex(header.arena?.[1], 16, at('arena'), "the arena's hash") },
    parts,
    record: hex(header.record?.[0], 64, at('record'), "the run record's hash"),
    faults,
    subjects,
    frames,
  };
};
