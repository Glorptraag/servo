// What the web build's entry (main.tsx) does with the page (task 6.3): a tester build shows the invite gate before
// anything else; then /settings shows Settings, and any other path opens the child's app.
import type { BuildInfo } from './build-info.ts';
import { openThroughInviteGate } from './invite-gate.tsx';
import { isSettingsPath, mountSettings } from './settings.tsx';

export interface PageStart {
  /** What the release baked into the build: a build with invite hashes is a tester build. */
  readonly info: BuildInfo;
  /** The page's path. */
  readonly pathname: string;
  /** Opens the child's app in the host: mountApp in the web build. */
  readonly openApp: (host: HTMLElement) => void;
}

/** Fills the host: the invite gate first in a tester build, then Settings at /settings or the app anywhere else. */
export const startPage = async (host: HTMLElement, { info, pathname, openApp }: PageStart): Promise<void> => {
  const open = (): void => {
    if (isSettingsPath(pathname)) mountSettings(host, info);
    else openApp(host);
  };
  if (info.inviteHashes.length > 0) await openThroughInviteGate(host, info.inviteHashes, open);
  else open();
};
