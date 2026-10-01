// What a release bakes into the build (task 6.3, packages/tools/src/release): the app and content versions Settings
// shows, and the hashes of the tester invite codes. The release passes them to Vite as VITE_ variables, and Vite
// writes each value in where the code names it. A build made any other way (pnpm dev, pnpm build) has none of them.

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

const given = (value: string | undefined): string | undefined => (value === undefined || value === '' ? undefined : value);

export const BUILD_INFO: BuildInfo = {
  appVersion: given(import.meta.env.VITE_SERVO_APP_VERSION),
  contentVersion: given(import.meta.env.VITE_SERVO_CONTENT_VERSION),
  inviteHashes: (import.meta.env.VITE_SERVO_INVITE_HASHES ?? '').split(',').filter((hash) => /^[0-9a-f]{64}$/.test(hash)),
};
