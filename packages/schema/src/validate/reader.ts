import type { Level, Pose, Vec2, Vec3 } from '../types/common.ts';
import type { Issue, IssueCode, ValidationResult } from '../types/issue.ts';

/**
 * The validation kit: hand-written, dependency-free readers that collect issues instead of throwing.
 *
 * Conventions:
 * - A reader returns the value when it is valid and `undefined` after reporting at least one issue.
 * - A field reader given `undefined` returns `undefined` without reporting: `readObject` has already
 *   reported a missing required field, and an absent optional field is fine.
 */

export interface Ctx {
  readonly issues: Issue[];
}

export const report = (ctx: Ctx, code: IssueCode, path: string, message: string): void => {
  ctx.issues.push({ code, path, message });
};

export type Reader<T> = (ctx: Ctx, value: unknown, path: string) => T | undefined;

/** Runs a reader over a document root and never throws: anything thrown becomes a `value.unreadable` issue. */
export const runValidator = <T>(root: unknown, read: (ctx: Ctx, root: unknown) => T | undefined): ValidationResult<T> => {
  const ctx: Ctx = { issues: [] };
  if (root === undefined) {
    report(ctx, 'value.wrong_type', '$', 'Expected an object, found nothing.');
    return { ok: false, issues: ctx.issues };
  }
  let value: T | undefined;
  try {
    value = read(ctx, root);
  } catch {
    report(ctx, 'value.unreadable', '$', 'The data could not be read: a property threw or the structure loops.');
    return { ok: false, issues: ctx.issues };
  }
  if (ctx.issues.length > 0) return { ok: false, issues: ctx.issues };
  if (value === undefined) {
    report(ctx, 'value.unreadable', '$', 'The data could not be read.');
    return { ok: false, issues: ctx.issues };
  }
  return { ok: true, value };
};

export const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** An own property, or undefined; inherited names such as `constructor` never count. */
export const field = (record: Readonly<Record<string, unknown>>, key: string): unknown =>
  Object.hasOwn(record, key) ? record[key] : undefined;

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** Extends a JSONPath: `$.parts[0].settings['gear-ratio']`. */
export const at = (path: string, key: string | number): string => {
  if (typeof key === 'number') return `${path}[${key}]`;
  if (IDENTIFIER.test(key)) return `${path}.${key}`;
  return `${path}['${key.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}']`;
};

const quote = (key: string): string => `'${key}'`;

export const readObject = (
  ctx: Ctx,
  value: unknown,
  path: string,
  required: readonly string[],
  optional: readonly string[] = [],
): Readonly<Record<string, unknown>> | undefined => {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    report(ctx, 'value.wrong_type', path, 'Expected an object.');
    return undefined;
  }
  for (const key of required) {
    if (field(value, key) === undefined) report(ctx, 'value.missing', at(path, key), `Missing ${quote(key)}.`);
  }
  for (const key of Object.keys(value)) {
    if (!required.includes(key) && !optional.includes(key)) {
      report(ctx, 'value.unknown_key', at(path, key), `Unknown field ${quote(key)}.`);
    }
  }
  return value;
};

export const readArray = (ctx: Ctx, value: unknown, path: string, minItems = 0): readonly unknown[] | undefined => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    report(ctx, 'value.wrong_type', path, 'Expected a list.');
    return undefined;
  }
  if (value.length < minItems) {
    report(ctx, 'value.empty', path, minItems === 1 ? 'Needs at least one item.' : `Needs at least ${minItems} items.`);
  }
  return value;
};

/** Reads every item; returns the list only when every item is valid. */
export const readList = <T>(ctx: Ctx, value: unknown, path: string, item: Reader<T>, minItems = 0): T[] | undefined => {
  const mark = ctx.issues.length;
  const list = readArray(ctx, value, path, minItems);
  if (!list) return undefined;
  const out: T[] = [];
  let visited = 0;
  // forEach skips the holes of a sparse list, so holes are counted rather than walked.
  list.forEach((entry, index) => {
    visited += 1;
    if (entry === undefined) {
      report(ctx, 'value.wrong_type', at(path, index), 'Expected a value, found undefined.');
      return;
    }
    const read = item(ctx, entry, at(path, index));
    if (read !== undefined) out.push(read);
  });
  if (visited !== list.length) report(ctx, 'value.wrong_type', path, 'The list has empty slots.');
  return ctx.issues.length === mark ? out : undefined;
};

export const readString = (ctx: Ctx, value: unknown, path: string): string | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    report(ctx, 'value.wrong_type', path, 'Expected a string.');
    return undefined;
  }
  return value;
};

/** A value quoted for a message, cut short so a huge string never lands in an issue. */
export const shown = (text: string): string => `'${text.length > 60 ? `${text.slice(0, 60)}…` : text}'`;

const matching = (ctx: Ctx, value: unknown, path: string, pattern: RegExp, format: string): string | undefined => {
  const text = readString(ctx, value, path);
  if (text === undefined) return undefined;
  if (!pattern.test(text)) {
    report(ctx, 'value.bad_format', path, `Expected ${format}, found ${shown(text)}.`);
    return undefined;
  }
  return text;
};

export const SLUG = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** Lower-case words joined by hyphens, starting with a letter, at most 64 characters. */
export const readSlug = (ctx: Ctx, value: unknown, path: string): string | undefined => {
  const text = matching(ctx, value, path, SLUG, 'an id of lower-case words joined by hyphens');
  if (text !== undefined && text.length > 64) {
    report(ctx, 'value.bad_format', path, 'Expected an id of at most 64 characters.');
    return undefined;
  }
  return text;
};

export const OPAQUE_ID = /^[A-Za-z0-9_-]{16,128}$/;

/** An opaque id (profile or run): 16–128 letters, digits, '_' or '-'. It can hold no spaces, so no full name. */
export const readOpaqueId = (ctx: Ctx, value: unknown, path: string): string | undefined =>
  matching(ctx, value, path, OPAQUE_ID, "an opaque id of 16 to 128 letters, digits, '_' or '-', never a name");

export const readAssetKey = (ctx: Ctx, value: unknown, path: string): string | undefined =>
  matching(ctx, value, path, /^[a-z][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)*$/, "a swap-registry key such as 'part/dc-motor'");

export const readHexColour = (ctx: Ctx, value: unknown, path: string): string | undefined =>
  matching(ctx, value, path, /^#[0-9a-f]{6}$/, "a colour written '#rrggbb' in lower case");

const TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.\d{3}Z$/;

const daysIn = (year: number, month: number): number =>
  month === 2 ? (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28) : [4, 6, 9, 11].includes(month) ? 30 : 31;

/** UTC in the exact form `Date.prototype.toISOString` writes, so timestamps sort as strings. */
export const readTimestamp = (ctx: Ctx, value: unknown, path: string): string | undefined => {
  const text = matching(ctx, value, path, TIMESTAMP, "a UTC timestamp such as '2026-10-01T09:30:00.000Z'");
  if (text === undefined) return undefined;
  const [, year, month, day, hour, minute, second] = (TIMESTAMP.exec(text) ?? []).map(Number);
  const valid =
    year !== undefined &&
    month !== undefined &&
    day !== undefined &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysIn(year, month) &&
    (hour ?? 99) <= 23 &&
    (minute ?? 99) <= 59 &&
    (second ?? 99) <= 59;
  if (!valid) {
    report(ctx, 'value.bad_format', path, `Expected a real date and time, found ${shown(text)}.`);
    return undefined;
  }
  return text;
};

const EXCLAMATIONS = [0x21, 0xa1, 0xff01, 0x203c, 0x2049, 0x2757, 0x2755].map((code) => String.fromCodePoint(code));
const LINE_BREAKS = [0x0a, 0x0d, 0x2028, 0x2029].map((code) => String.fromCodePoint(code));

/** System text: one trimmed, non-empty line with no exclamation mark (ground rule 7). */
export const readText = (ctx: Ctx, value: unknown, path: string): string | undefined => {
  const text = readString(ctx, value, path);
  if (text === undefined) return undefined;
  if (text.trim().length === 0) {
    report(ctx, 'text.format', path, 'Text is empty.');
    return undefined;
  }
  let ok = true;
  if (text.trim() !== text) {
    report(ctx, 'text.format', path, 'Text starts or ends with a space.');
    ok = false;
  }
  if (LINE_BREAKS.some((mark) => text.includes(mark))) {
    report(ctx, 'text.format', path, 'Text is one line.');
    ok = false;
  }
  if (EXCLAMATIONS.some((mark) => text.includes(mark))) {
    report(ctx, 'text.exclamation', path, 'System text has no exclamation marks (ground rule 7).');
    ok = false;
  }
  return ok ? text : undefined;
};

const hasControl = (text: string): boolean =>
  [...text].some((char) => {
    const code = char.codePointAt(0) ?? 0;
    return code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029;
  });

/** A name given by a child or the app: one trimmed line of 1–60 characters. Voice rules do not apply. */
export const readName = (ctx: Ctx, value: unknown, path: string): string | undefined => {
  const text = readString(ctx, value, path);
  if (text === undefined) return undefined;
  const length = [...text].length;
  if (length < 1 || length > 60 || text.trim() !== text || hasControl(text)) {
    report(ctx, 'value.bad_format', path, 'Expected a name of 1 to 60 characters on one line, without spaces at either end.');
    return undefined;
  }
  return text;
};

export interface Range {
  readonly min?: number;
  readonly max?: number;
  /** When true, `min` itself is not allowed. */
  readonly above?: boolean;
  /** When true, `max` itself is not allowed. */
  readonly below?: boolean;
  readonly integer?: boolean;
}

export const describeRange = (range: Range): string => {
  const low = range.min === undefined ? '' : range.above ? `above ${range.min}` : `at least ${range.min}`;
  const high = range.max === undefined ? '' : range.below ? `below ${range.max}` : `at most ${range.max}`;
  return [low, high].filter((part) => part !== '').join(' and ');
};

export const inRange = (value: number, range: Range): boolean =>
  (range.min === undefined || (range.above ? value > range.min : value >= range.min)) &&
  (range.max === undefined || (range.below ? value < range.max : value <= range.max));

export const readNumber = (ctx: Ctx, value: unknown, path: string, range: Range = {}): number | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    report(ctx, 'value.wrong_type', path, 'Expected a finite number.');
    return undefined;
  }
  if (range.integer && !Number.isInteger(value)) {
    report(ctx, 'value.not_integer', path, `Expected a whole number, found ${value}.`);
    return undefined;
  }
  if (!inRange(value, range)) {
    report(ctx, 'value.out_of_range', path, `Expected a number ${describeRange(range)}, found ${value}.`);
    return undefined;
  }
  return value;
};

const EPSILON = 1e-9;

/** Whether `value` is a whole number of `step`s from `min`, allowing for floating-point error. */
export const onStep = (value: number, min: number, step: number): boolean => {
  const steps = (value - min) / step;
  return Math.abs(steps - Math.round(steps)) < EPSILON * Math.max(1, Math.abs(steps));
};

/** Equal, allowing floating-point error between numbers. */
export const sameValue = (a: unknown, b: unknown): boolean =>
  typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) <= EPSILON * Math.max(1, Math.abs(a), Math.abs(b)) : a === b;

export const POSITIVE: Range = { min: 0, above: true };
export const NON_NEGATIVE: Range = { min: 0 };
export const FRACTION: Range = { min: 0, max: 1 };
export const DEGREES: Range = { min: 0, max: 360, below: true };
export const TICK: Range = { min: 0, integer: true };

export const readBoolean = (ctx: Ctx, value: unknown, path: string): boolean | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') {
    report(ctx, 'value.wrong_type', path, 'Expected true or false.');
    return undefined;
  }
  return value;
};

export const readEnum = <T extends string>(ctx: Ctx, value: unknown, path: string, allowed: readonly T[]): T | undefined => {
  const text = readString(ctx, value, path);
  if (text === undefined) return undefined;
  if (!(allowed as readonly string[]).includes(text)) {
    report(ctx, 'value.not_allowed', path, `Expected one of ${allowed.map((word) => `'${word}'`).join(', ')}; found ${shown(text)}.`);
    return undefined;
  }
  return text as T;
};

export const LEVEL_VALUES: readonly Level[] = [1, 2, 3, 4, 5];

export const readLevel = (ctx: Ctx, value: unknown, path: string): Level | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !(LEVEL_VALUES as readonly number[]).includes(value)) {
    report(ctx, 'value.not_allowed', path, 'Expected a level from 1 to 5.');
    return undefined;
  }
  return value as Level;
};

export const readVec2 = (ctx: Ctx, value: unknown, path: string, range: Range = {}): Vec2 | undefined => {
  const mark = ctx.issues.length;
  const record = readObject(ctx, value, path, ['x', 'y']);
  if (!record) return undefined;
  readNumber(ctx, field(record, 'x'), at(path, 'x'), range);
  readNumber(ctx, field(record, 'y'), at(path, 'y'), range);
  return ctx.issues.length === mark ? (record as unknown as Vec2) : undefined;
};

export const readVec3 = (ctx: Ctx, value: unknown, path: string, range: Range = {}): Vec3 | undefined => {
  const mark = ctx.issues.length;
  const record = readObject(ctx, value, path, ['x', 'y', 'z']);
  if (!record) return undefined;
  readNumber(ctx, field(record, 'x'), at(path, 'x'), range);
  readNumber(ctx, field(record, 'y'), at(path, 'y'), range);
  readNumber(ctx, field(record, 'z'), at(path, 'z'), range);
  return ctx.issues.length === mark ? (record as unknown as Vec3) : undefined;
};

export const readPose = (ctx: Ctx, value: unknown, path: string): Pose | undefined => {
  const mark = ctx.issues.length;
  const record = readObject(ctx, value, path, ['x', 'y', 'heading']);
  if (!record) return undefined;
  readNumber(ctx, field(record, 'x'), at(path, 'x'));
  readNumber(ctx, field(record, 'y'), at(path, 'y'));
  readNumber(ctx, field(record, 'heading'), at(path, 'heading'), DEGREES);
  return ctx.issues.length === mark ? (record as unknown as Pose) : undefined;
};

/** Reports `id.duplicate` on every item whose id an earlier item already used. */
export const reportDuplicateIds = (
  ctx: Ctx,
  items: readonly unknown[] | undefined,
  path: string,
  key = 'id',
): void => {
  if (!items) return;
  const seen = new Set<string>();
  items.forEach((item, index) => {
    if (!isRecord(item)) return;
    const id = field(item, key);
    if (typeof id !== 'string') return;
    if (seen.has(id)) report(ctx, 'id.duplicate', at(at(path, index), key), `The id '${id}' is already used in this list.`);
    seen.add(id);
  });
};

/** Reports `value.duplicate` on every string that repeats an earlier one. */
export const reportRepeats = (ctx: Ctx, items: readonly unknown[] | undefined, path: string): void => {
  if (!items) return;
  const seen = new Set<unknown>();
  items.forEach((item, index) => {
    if (typeof item !== 'string') return;
    if (seen.has(item)) report(ctx, 'value.duplicate', at(path, index), `'${item}' is listed twice.`);
    seen.add(item);
  });
};

/** Code-unit order, the same on every engine and locale. */
export const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
