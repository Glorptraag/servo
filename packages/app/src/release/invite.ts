// The tester invite gate's checks (task 6.3). A soft gate, not security: the release stores only each code's hash
// (packages/tools/src/release/invite-codes.ts), this side reduces what a tester types the same way and hashes it with
// the browser's Web Crypto, and a code once taken is remembered on this device.

/** Where the code a tester entered is remembered on this device. */
export const INVITE_KEY = 'servo.invite.code';

/** What a tester typed, reduced to the code's characters: upper case, with spaces, dashes and the like taken out. */
export const normalizeInviteCode = (typed: string): string => typed.toUpperCase().replace(/[^0-9A-Z]/g, '');

/** Thrown where the browser cannot hash: Web Crypto works only on a secure page (https, or localhost). */
export class NoWebCrypto extends Error {}

/** The lower-case hex SHA-256 of a code's reduced form, as the release stores it. */
export const hashInviteCode = async (code: string): Promise<string> => {
  const subtle = globalThis.isSecureContext ? (globalThis.crypto.subtle as SubtleCrypto | undefined) : undefined;
  if (!subtle) throw new NoWebCrypto('Web Crypto needs a secure page.');
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(normalizeInviteCode(code)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

/** True when the code is one of the build's. */
export const isInviteCode = async (code: string, hashes: readonly string[]): Promise<boolean> => hashes.includes(await hashInviteCode(code));

/**
 * The page's localStorage, or null where it has none. Reading `localStorage` itself throws in some browsers when site
 * data is blocked, so even the lookup is guarded.
 */
export const pageStorage = (): Storage | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

export const rememberedCode = (storage: Storage | null): string | undefined => {
  try {
    return storage?.getItem(INVITE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
};

/** Remembers a code. A storage that refuses (full, blocked) leaves the gate to ask again on the next launch. */
export const rememberCode = (storage: Storage | null, code: string): void => {
  try {
    storage?.setItem(INVITE_KEY, normalizeInviteCode(code));
  } catch {
    // Nothing to do: the app opens for this visit.
  }
};
