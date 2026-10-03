// The tester invite gate's checks (task 6.3). A soft gate, not security: the release stores only each code's hash,
// the gate hashes what a tester types the same way (invite-code.ts, which the release imports too), and a code once
// taken is remembered on this device.
import { hashInviteCode } from './invite-code.ts';

/** Where the code a tester entered is remembered on this device. */
export const INVITE_KEY = 'servo.invite.code';

/** True when the code is one of the build's. Rejects with NoWebCrypto where the page cannot hash. */
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

/** Remembers a code, already reduced. A storage that refuses (full, blocked) leaves the gate to ask on the next launch. */
export const rememberCode = (storage: Storage | null, code: string): void => {
  try {
    storage?.setItem(INVITE_KEY, code);
  } catch {
    // Nothing to do: the app opens for this visit.
  }
};
