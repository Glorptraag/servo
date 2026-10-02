// The invite code's reduction and hash (src/release/invite-code.ts, task 6.3), held to known answers on the app's own
// copy. The release imports this same module to hash the codes it bakes in (packages/tools/src/release), so a change
// here that would lock every tester out fails here, and in the release's tests. Known answers: shasum -a 256.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BUILD_INFO, buildInfoFrom } from '../../src/release/build-info.ts';
import { INVITE_HASH, NoWebCrypto, hashInviteCode, normalizeInviteCode } from '../../src/release/invite-code.ts';
import { rememberCode, rememberedCode } from '../../src/release/invite.ts';
import { NOT_A_RELEASE, isSettingsPath } from '../../src/release/settings.tsx';

/** printf '%s' ABCD2345 | shasum -a 256 */
const ABCD2345 = 'a00d76646eba91b057841554d5c8334f498dc592ed744bce404f21fe271cd36e';
/** printf '%s' 23RYK629 | shasum -a 256: the first code the release's tests make from their seed. */
const FIRST_TEST_CODE = 'b6753643b54721594b9f84348dfcdec21090d790296625acb37bcf6f725246d9';

afterEach(() => vi.unstubAllGlobals());

describe('the invite code hash', () => {
  it('is the lower-case hex SHA-256 of the reduced code', async () => {
    expect(await hashInviteCode('ABCD2345')).toBe(ABCD2345);
    expect(await hashInviteCode('23RYK629')).toBe(FIRST_TEST_CODE);
    expect(ABCD2345).toMatch(INVITE_HASH);
  });

  it('is the same however the code is typed: any case, with dashes, spaces or other marks', async () => {
    for (const typed of ['abcd2345', 'ABCD-2345', ' abcd 2345 ', 'Abcd–2345', 'ab.cd/23_45']) {
      expect(normalizeInviteCode(typed), typed).toBe('ABCD2345');
      expect(await hashInviteCode(typed), typed).toBe(ABCD2345);
    }
    expect(await hashInviteCode('23ry-k629')).toBe(FIRST_TEST_CODE);
  });

  it('rejects with NoWebCrypto where there is no Web Crypto, as on a page that is not secure', async () => {
    vi.stubGlobal('crypto', { subtle: undefined });
    await expect(hashInviteCode('ABCD2345')).rejects.toBeInstanceOf(NoWebCrypto);
    vi.stubGlobal('crypto', undefined);
    await expect(hashInviteCode('ABCD2345')).rejects.toBeInstanceOf(NoWebCrypto);
  });
});

describe('what a release bakes into the build', () => {
  it('is nothing in a build the release did not make: no versions and no invite hashes, so no gate', () => {
    expect(BUILD_INFO).toEqual({ appVersion: undefined, contentVersion: undefined, inviteHashes: [] });
    expect(buildInfoFrom({})).toEqual(BUILD_INFO);
    expect(buildInfoFrom({ appVersion: '', contentVersion: '', inviteHashes: '' })).toEqual(BUILD_INFO);
  });

  it('takes the versions and the comma-joined hashes the release passes, and leaves out anything that is not a hash', () => {
    const info = buildInfoFrom({
      appVersion: '0.1.0',
      contentVersion: '0.1.0+9c5fd87f',
      inviteHashes: [ABCD2345, 'ABCD2345', ABCD2345.toUpperCase(), FIRST_TEST_CODE, ''].join(','),
    });
    expect(info).toEqual({ appVersion: '0.1.0', contentVersion: '0.1.0+9c5fd87f', inviteHashes: [ABCD2345, FIRST_TEST_CODE] });
  });
});

describe('the release pages', () => {
  it('put Settings at /settings, with or without a trailing slash, under the base', () => {
    for (const path of ['/settings', '/settings/', '/settings//']) expect(isSettingsPath(path, '/'), path).toBe(true);
    for (const path of ['/', '/index.html', '/settings/more', '/Settings', '/settingsx']) expect(isSettingsPath(path, '/'), path).toBe(false);
    expect(isSettingsPath('/servo/settings', '/servo/')).toBe(true);
    expect(isSettingsPath('/settings', '/servo/')).toBe(false);
    expect(NOT_A_RELEASE).toBe('Not a release build');
  });

  it('remember a code where the device lets them, and carry on where it refuses', () => {
    const items = new Map<string, string>();
    const storage = {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => void items.set(key, value),
    } as Storage;
    expect(rememberedCode(storage)).toBeUndefined();
    rememberCode(storage, 'ABCD2345');
    expect(rememberedCode(storage)).toBe('ABCD2345');
    const refusing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    } as unknown as Storage;
    expect(() => rememberCode(refusing, 'ABCD2345')).not.toThrow();
    expect(rememberedCode(refusing)).toBeUndefined();
    expect(rememberedCode(null)).toBeUndefined();
  });
});
