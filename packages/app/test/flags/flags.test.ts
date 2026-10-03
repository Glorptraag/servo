// The feature flags (task 6.6): per device, off by default, on only when the device's storage names them.
import { describe, expect, it } from 'vitest';
import { FLAGS_KEY, FLAG_NAMES, NO_FLAGS, deviceFlags, readFlags, settingsLevel } from '../../src/flags/index.ts';

const holding = (value: string | null) => ({ getItem: (key: string) => (key === FLAGS_KEY ? value : null) });

describe('feature flags', () => {
  it('are all off by default', () => {
    expect(FLAG_NAMES.every((name) => !NO_FLAGS[name])).toBe(true);
    expect(readFlags(null)).toEqual(NO_FLAGS);
    expect(readFlags(undefined)).toEqual(NO_FLAGS);
    expect(readFlags(holding(null))).toEqual(NO_FLAGS);
    // Node has no localStorage: the device's flags are off.
    expect(deviceFlags()).toEqual(NO_FLAGS);
  });

  it('are off for anything unreadable or unknown', () => {
    for (const value of ['', 'level-3-slot', '{"level-3-slot":true}', 'true', '["level-3"]', '[1]', 'null', '"level-3-slot"']) {
      expect(readFlags(holding(value))).toEqual(NO_FLAGS);
    }
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readFlags(throwing)).toEqual(NO_FLAGS);
  });

  it('turn on when the device lists them', () => {
    expect(readFlags(holding('["level-3-slot"]'))).toEqual({ 'level-3-slot': true });
    expect(readFlags(holding('["something-else","level-3-slot"]'))).toEqual({ 'level-3-slot': true });
  });

  it('raise only the level settings unlock at, to Level 3 with the slot on', () => {
    expect(settingsLevel(1, NO_FLAGS)).toBe(1);
    expect(settingsLevel(2, NO_FLAGS)).toBe(2);
    expect(settingsLevel(1, { 'level-3-slot': true })).toBe(3);
    expect(settingsLevel(2, { 'level-3-slot': true })).toBe(3);
    expect(settingsLevel(4, { 'level-3-slot': true })).toBe(4);
  });
});
