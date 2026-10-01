// Settings (task 6.3): an adult-facing page at /settings with the build's app version and content version, and
// nothing else for now. Read-only, with no links out (brief Section 13). The parental gate in front of it is task
// 5.1's (D28); Home, when it comes, may lead here.
import { createRoot } from 'react-dom/client';
import type { BuildInfo } from './build-info.ts';
import './release.css';

/** The page's address under the app's base. The release also writes settings/index.html, so any static host serves it. */
export const SETTINGS_ROUTE = 'settings';

/** What Settings shows for a version that only a release build has. */
export const NOT_A_RELEASE = 'Not a release build';

/** True for the Settings page's path, with or without a trailing slash. */
export const isSettingsPath = (pathname: string, base: string = import.meta.env.BASE_URL): boolean =>
  pathname.replace(/\/+$/, '') === `${base.replace(/\/+$/, '')}/${SETTINGS_ROUTE}`;

export const SettingsView = ({ info }: { readonly info: BuildInfo }) => (
  <main className="release-page">
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
    </section>
  </main>
);

export const mountSettings = (host: HTMLElement, info: BuildInfo): void => {
  host.ownerDocument.title = 'Servo settings';
  createRoot(host).render(<SettingsView info={info} />);
};
