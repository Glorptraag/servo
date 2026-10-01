// What every part of the store shares: the database, the content builds are checked against, and the clock. Also
// the few plain checks they share. See docs/store.md.
import type { Content } from '@servo/content';
import type { Issue, Level, ProfileId, Timestamp } from '@servo/schema';
import type { ServoDatabase } from './database.ts';

export interface StoreContext {
  readonly db: ServoDatabase;
  readonly content: Content;
  readonly now: () => Timestamp;
}

/**
 * Why the store refused a write or a read: the promise rejects with it, never a dialog (ground rule 9). The message
 * is for developers; `cause` holds the validators' issues when there are any.
 */
export const refusal = (message: string, issues?: readonly Issue[]): Error =>
  issues === undefined ? new Error(message) : new Error(message, { cause: issues });

/** Writes need the profile to be there, so nothing is ever kept for a profile that has been removed. Inside a transaction. */
export const requireProfile = async ({ db }: StoreContext, profile: ProfileId): Promise<void> => {
  const found = typeof profile === 'string' ? await db.profiles.get({ id: profile }) : undefined;
  if (!found) throw refusal(`There is no profile '${String(profile)}' on this device.`);
};

export const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Code-unit order: the order canonical form and ISO timestamps sort in. */
export const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const isControl = (char: string): boolean => {
  const code = char.codePointAt(0) ?? 0;
  return code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029;
};

/** A name as the schema reads `meta.name`: 1 to 60 characters on one line, without spaces at either end. */
export const isName = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  const chars = [...value];
  return chars.length >= 1 && chars.length <= 60 && value.trim() === value && !chars.some(isControl);
};

export const isLevel = (value: unknown): value is Level => value === 1 || value === 2 || value === 3 || value === 4 || value === 5;

/** The shape `toISOString` writes. */
export const isTimestamp = (value: unknown): value is Timestamp =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value);
