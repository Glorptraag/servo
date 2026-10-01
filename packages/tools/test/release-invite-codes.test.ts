// Tester invite codes (task 6.3): made from a secret seed, the same every release, stored in the build only as hashes.
// The known answers below were worked out independently (Python's hmac and shasum), so a change to how codes or hashes
// are made, which would lock testers out of a new release, fails here.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_INVITE_COUNT,
  INVITE_ALPHABET,
  INVITE_CODE_LENGTH,
  MAX_INVITE_COUNT,
  MIN_INVITE_SEED_LENGTH,
  ReleaseError,
  checkInviteCount,
  formatInviteCode,
  hashInviteCode,
  inviteCodes,
  normalizeInviteCode,
} from '../src/release/index.ts';

const SEED = 'servo-test-seed-0123456789';
const CODE = /^[2-9A-HJ-NP-Z]{8}$/;

describe('invite codes', () => {
  it('are made from the seed as documented: the first 40 bits of HMAC-SHA256(seed, "servo-invite:<n>"), 5 bits a character', () => {
    expect(inviteCodes(SEED, 3)).toEqual(['23RYK629', '9FYY7UW3', 'NPSSBK7S']);
  });

  it('use 8 characters from 32 that cannot be mistaken for one another', () => {
    expect(INVITE_ALPHABET).toHaveLength(32);
    expect(new Set(INVITE_ALPHABET).size).toBe(32);
    for (const lookalike of ['0', '1', 'I', 'O']) expect(INVITE_ALPHABET).not.toContain(lookalike);
    expect(INVITE_CODE_LENGTH).toBe(8);
    for (const code of inviteCodes(SEED, MAX_INVITE_COUNT)) expect(code).toMatch(CODE);
  });

  it('are the same for the same seed, and a larger count keeps the smaller one\'s codes first', () => {
    const ten = inviteCodes(SEED, DEFAULT_INVITE_COUNT);
    expect(inviteCodes(SEED, DEFAULT_INVITE_COUNT)).toEqual(ten);
    expect(inviteCodes(SEED, 40).slice(0, DEFAULT_INVITE_COUNT)).toEqual(ten);
  });

  it('are all different, and differ from seed to seed', () => {
    const codes = inviteCodes(SEED, MAX_INVITE_COUNT);
    expect(new Set(codes).size).toBe(MAX_INVITE_COUNT);
    const other = inviteCodes(`${SEED}-other`, DEFAULT_INVITE_COUNT);
    expect(other.filter((code) => codes.includes(code))).toEqual([]);
  });

  it(`refuse a seed shorter than ${MIN_INVITE_SEED_LENGTH} characters, without repeating it`, () => {
    const short = 'abc123';
    expect(() => inviteCodes(short, 1)).toThrow(ReleaseError);
    expect(() => inviteCodes(short, 1)).toThrow(/SERVO_INVITE_SEED is 6 characters long; it needs at least 16/);
    try {
      inviteCodes(short, 1);
    } catch (error) {
      expect(String(error)).not.toContain(short);
    }
    expect(inviteCodes('x'.repeat(MIN_INVITE_SEED_LENGTH), 1)).toHaveLength(1);
  });

  it(`refuse a count that is not a whole number from 1 to ${MAX_INVITE_COUNT}`, () => {
    for (const bad of [0, -1, 1.5, MAX_INVITE_COUNT + 1, Number.NaN]) {
      expect(() => checkInviteCount(bad)).toThrow(ReleaseError);
      expect(() => inviteCodes(SEED, bad)).toThrow(ReleaseError);
    }
    expect(() => checkInviteCount(1)).not.toThrow();
    expect(() => checkInviteCount(MAX_INVITE_COUNT)).not.toThrow();
  });
});

describe('what the build stores for a code', () => {
  it("is the lower-case hex SHA-256 of the code's 8 characters", () => {
    // printf '%s' 'ABCD2345' | shasum -a 256
    expect(hashInviteCode('ABCD2345')).toBe('a00d76646eba91b057841554d5c8334f498dc592ed744bce404f21fe271cd36e');
    const [first = ''] = inviteCodes(SEED, 1);
    expect(hashInviteCode(first)).toBe(createHash('sha256').update(first).digest('hex'));
    expect(hashInviteCode(first)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is the same however the code is typed: any case, with dashes or spaces', () => {
    const hash = hashInviteCode('ABCD2345');
    for (const typed of ['abcd2345', 'ABCD-2345', ' abcd 2345 ', 'Abcd–2345', 'ab.cd/23_45']) {
      expect(normalizeInviteCode(typed), typed).toBe('ABCD2345');
      expect(hashInviteCode(typed), typed).toBe(hash);
    }
  });

  it('never equals the code, and a code prints as two groups of four', () => {
    const [code = ''] = inviteCodes(SEED, 1);
    expect(hashInviteCode(code)).not.toContain(code);
    expect(formatInviteCode(code)).toBe('23RY-K629');
    expect(formatInviteCode('23ry k629')).toBe('23RY-K629');
  });
});
