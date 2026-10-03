// The tester invite code's reduction and hash (task 6.3), written once. The app's invite gate hashes what a tester
// types with it, and the release (packages/tools/src/release) imports it, as `@servo/app/invite-code`, to hash the
// codes it bakes into a tester build, so the two can never disagree. It lives here because tools may import the app
// but the app may import nothing from tools, and content and schema cannot reach Web Crypto. It is pure: no DOM,
// React or Node, only the Web Crypto that browsers and Node both put on `globalThis.crypto`.

/** A hash as the build stores it: lower-case hex SHA-256. */
export const INVITE_HASH = /^[0-9a-f]{64}$/;

/** What a tester typed, reduced to the code's characters: upper case, with spaces, dashes and the like taken out. */
export const normalizeInviteCode = (typed: string): string => typed.toUpperCase().replace(/[^0-9A-Z]/g, '');

/** Thrown where there is no Web Crypto to hash with: a browser has it only on a secure page (https, or localhost). */
export class NoWebCrypto extends Error {
  constructor() {
    super('There is no Web Crypto here: a browser has it only on a secure page (https, or localhost).');
    this.name = 'NoWebCrypto';
  }
}

/**
 * What a release stores for a code: the lower-case hex SHA-256 of the reduced code. Its characters are all ASCII, so
 * its bytes are its character codes. Rejects with NoWebCrypto where `globalThis.crypto.subtle` is missing.
 */
export const hashInviteCode = async (typed: string): Promise<string> => {
  // Typed as always there, but a browser leaves `subtle` out on a page that is not secure.
  const subtle = globalThis.crypto?.subtle as typeof globalThis.crypto.subtle | undefined;
  if (!subtle) throw new NoWebCrypto();
  const bytes = Uint8Array.from(normalizeInviteCode(typed), (character) => character.charCodeAt(0));
  const digest = await subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};
