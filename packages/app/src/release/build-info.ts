// What a release bakes into the build (task 6.3, packages/tools/src/release): the app and content versions Settings
// shows, and the hashes of the tester invite codes. The release passes them to Vite as VITE_ variables, and Vite
// writes each value in where the code names it. A build made any other way (pnpm dev, pnpm build) has none of them.
import { INVITE_HASH } from './invite-code.ts';

declare global {
  interface ImportMetaEnv {
    readonly VITE_SERVO_APP_VERSION?: string;
    readonly VITE_SERVO_CONTENT_VERSION?: string;
    readonly VITE_SERVO_INVITE_HASHES?: string;
  }
}

export interface BuildInfo {
  /** The release's app version, from its tag. Undefined in a build the release did not make. */
  readonly appVersion: string | undefined;
  /** The content version, `<semver>+<short hash>`. Undefined in a build the release did not make. */
  readonly contentVersion: string | undefined;
  /** The lower-case hex SHA-256 of each tester invite code. A build with none has no invite gate. */
  readonly inviteHashes: readonly string[];
}

/** The variables as the release passes them: the hashes joined with commas. Empty or missing means none. */
export interface BuildVariables {
  readonly appVersion?: string | undefined;
  readonly contentVersion?: string | undefined;
  readonly inviteHashes?: string | undefined;
}

const given = (value: string | undefined): string | undefined => (value === undefined || value === '' ? undefined : value);

/** The build's info from the release's variables. Anything that is not a hash is left out of the hashes. */
export const buildInfoFrom = (variables: BuildVariables): BuildInfo => ({
  appVersion: given(variables.appVersion),
  contentVersion: given(variables.contentVersion),
  inviteHashes: (variables.inviteHashes ?? '').split(',').filter((hash) => INVITE_HASH.test(hash)),
});

// Each variable is named in full, so Vite writes in only these three, never the rest of the build's environment.
export const BUILD_INFO: BuildInfo = buildInfoFrom({
  appVersion: import.meta.env.VITE_SERVO_APP_VERSION,
  contentVersion: import.meta.env.VITE_SERVO_CONTENT_VERSION,
  inviteHashes: import.meta.env.VITE_SERVO_INVITE_HASHES,
});
