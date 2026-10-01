// Tester invite codes: a soft gate in front of a tester build, not security. Codes come from a secret seed; the build
// stores only their hashes. See README.md, "Invite codes".
import { createHash, createHmac } from 'node:crypto';
import { ReleaseError } from './errors.ts';

/** The environment variable, a repository secret in the workflow, that the codes come from. */
export const INVITE_SEED_VARIABLE = 'SERVO_INVITE_SEED';

/** Digits 2-9 and capital letters except I and O, so no two characters look alike: 32 symbols of 5 bits each. */
export const INVITE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/** Characters in a code: 40 bits, printed in two groups of four. */
export const INVITE_CODE_LENGTH = 8;

/** The shortest seed taken, so that the codes do not come from a guessable one. */
export const MIN_INVITE_SEED_LENGTH = 16;

export const DEFAULT_INVITE_COUNT = 10;
export const MAX_INVITE_COUNT = 500;

/**
 * A code as typed, reduced to its characters: upper case, with spaces, dashes and anything else that is not a letter
 * or a digit taken out. The app reduces what a tester types the same way (packages/app/src/release/invite.ts).
 */
export const normalizeInviteCode = (typed: string): string => typed.toUpperCase().replace(/[^0-9A-Z]/g, '');

/** What the build stores for a code: the lower-case hex SHA-256 of its reduced form's UTF-8 bytes. */
export const hashInviteCode = (code: string): string => createHash('sha256').update(normalizeInviteCode(code), 'utf8').digest('hex');

/** A code as printed for a person: two groups of four, such as `7KQ2-M9XD`. */
export const formatInviteCode = (code: string): string => {
  const plain = normalizeInviteCode(code);
  return `${plain.slice(0, 4)}-${plain.slice(4)}`;
};

/** Refuses a seed too short to keep the codes from being guessed. The message never repeats the seed. */
export const checkInviteSeed = (seed: string): void => {
  if (seed.length < MIN_INVITE_SEED_LENGTH) {
    throw new ReleaseError(`${INVITE_SEED_VARIABLE} is ${seed.length} characters long; it needs at least ${MIN_INVITE_SEED_LENGTH}.`, [
      'Use a long random value, for example the output of openssl rand -hex 32, and keep it secret.',
    ]);
  }
};

export const checkInviteCount = (count: number): void => {
  if (!Number.isInteger(count) || count < 1 || count > MAX_INVITE_COUNT) {
    throw new ReleaseError(`The number of invite codes must be a whole number from 1 to ${MAX_INVITE_COUNT}, not ${count}.`);
  }
};

/** Code number `index` of a seed: the first 40 bits of HMAC-SHA256(seed, `servo-invite:<index>`), 5 bits a character. */
const codeAt = (seed: string, index: number): string => {
  let bits = createHmac('sha256', seed).update(`servo-invite:${index}`, 'utf8').digest().readUIntBE(0, 5);
  let code = '';
  for (let place = 0; place < INVITE_CODE_LENGTH; place += 1) {
    code = INVITE_ALPHABET.charAt(bits % INVITE_ALPHABET.length) + code;
    bits = Math.floor(bits / INVITE_ALPHABET.length);
  }
  return code;
};

/**
 * The first `count` codes of a seed, in their reduced form and all different. The same seed always gives the same
 * codes, and a larger count keeps a smaller one's codes first, so testers keep their codes from release to release.
 */
export const inviteCodes = (seed: string, count: number): string[] => {
  checkInviteSeed(seed);
  checkInviteCount(count);
  const codes: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; codes.length < count; index += 1) {
    const code = codeAt(seed, index);
    if (!seen.has(code)) {
      seen.add(code);
      codes.push(code);
    }
  }
  return codes;
};
