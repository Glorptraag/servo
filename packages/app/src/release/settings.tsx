// Settings (task 6.3): an adult-facing page at /settings with the build's app version and content version, and the
// access options (task 5.7), the same switches as on Home, kept on this device. No links out (brief Section 13). The
// parental gate in front of it is task 5.1's (D28). The page itself follows the options: its theme, its typeface and
// read-aloud.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { AccessSettings, AccessStore, ReadAloudScope } from '../a11y/index.ts';
import { pageStorage } from '../shell/edges.ts';
import { accessTheme } from '../theme/index.ts';
import type { BuildInfo } from './build-info.ts';
import './release.css';

/** The page's address under the app's base. The release also writes settings/index.html, so any static host serves it. */
export const SETTINGS_ROUTE = 'settings';

/** What Settings shows for a version that only a release build has. */
export const NOT_A_RELEASE = 'Not a release build';

/** True for the Settings page's path, with or without a trailing slash. */
export const isSettingsPath = (pathname: string, base: string = import.meta.env.BASE_URL): boolean =>
  pathname.replace(/\/+$/, '') === `${base.replace(/\/+$/, '')}/${SETTINGS_ROUTE}`;

export interface SettingsViewProps {
  readonly info: BuildInfo;
  /** The access options. Default this device's, kept in its localStorage and followed across its pages. */
  readonly access?: AccessStore;
}

export const SettingsView = ({ info, access: givenAccess }: SettingsViewProps) => {
  const [ownAccess] = useState(() => new AccessStore(givenAccess ? null : pageStorage()));
  const access = givenAccess ?? ownAccess;
  const followsDevice = !givenAccess;
  useEffect(() => (followsDevice ? ownAccess.follow(window) : undefined), [followsDevice, ownAccess]);
  const prefs = useSyncExternalStore(access.subscribe, () => access.prefs);
  return (
    <ReadAloudScope store={access}>
      <main className="release-page" {...accessTheme(prefs)}>
        <section className="release-panel" aria-labelledby="settings-title">
          <h1 id="settings-title">Settings</h1>
          <dl className="release-facts">
            <div>
              <dt>App version</dt>
              <dd>{info.appVersion ?? NOT_A_RELEASE}</dd>
            </div>
            <div>
              <dt>Content version</dt>
              <dd>{info.contentVersion ?? NOT_A_RELEASE}</dd>
            </div>
          </dl>
          <div className="release-access">
            <AccessSettings store={access} />
          </div>
        </section>
      </main>
    </ReadAloudScope>
  );
};

export const mountSettings = (host: HTMLElement, info: BuildInfo): void => {
  host.ownerDocument.title = 'Servo settings';
  createRoot(host).render(<SettingsView info={info} />);
};
