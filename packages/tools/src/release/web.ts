// The web build in a release: what the build is given, the app's dist folder copied with an entry for /settings, and
// the checks that it carries the build's versions and code hashes and none of the codes. See README.md.
import fs from 'node:fs';
import path from 'node:path';
import { ReleaseError } from './errors.ts';

/** What a release bakes into the app (packages/app/src/release/build-info.ts). */
export interface BuildInfo {
  /** The app version: the release tag without its `v`, or a dry run's label. */
  readonly appVersion: string;
  /** The content version, `<semver>+<short hash>`. */
  readonly contentVersion: string;
  /** The lower-case hex SHA-256 of each invite code. Empty for a build with no invite gate. */
  readonly inviteHashes: readonly string[];
}

/**
 * The environment variables the app's build reads them from. Vite bakes every `VITE_` variable the code names into the
 * bundle, so the invite seed is never given one of these names, and is not passed to the build at all.
 */
export const BUILD_VARIABLES = {
  appVersion: 'VITE_SERVO_APP_VERSION',
  contentVersion: 'VITE_SERVO_CONTENT_VERSION',
  inviteHashes: 'VITE_SERVO_INVITE_HASHES',
} as const;

/** The variables for a build: the hashes are joined with commas, and an empty value means no invite gate. */
export const buildVariables = (info: BuildInfo): Record<string, string> => ({
  [BUILD_VARIABLES.appVersion]: info.appVersion,
  [BUILD_VARIABLES.contentVersion]: info.contentVersion,
  [BUILD_VARIABLES.inviteHashes]: info.inviteHashes.join(','),
});

/** The Settings page's address under the site (packages/app/src/release/settings.tsx). */
export const SETTINGS_ROUTE = 'settings';

const posix = (file: string): string => file.split(path.sep).join('/');

/** Every file under a folder, hidden ones included. */
const filesUnder = (folder: string): string[] =>
  fs
    .readdirSync(folder, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort();

/** The URLs index.html loads that are relative to the page, so would break in a copy one folder down. */
const relativeUrls = (html: string): string[] =>
  [...html.matchAll(/\b(?:src|href)\s*=\s*["']([^"']*)["']/gi)]
    .map((match) => match[1] ?? '')
    .filter((url) => !/^(?:\/|#|[a-z][a-z0-9+.-]*:)/i.test(url));

/**
 * Refuses a web build that does not carry the content version or every code's hash (so the build was not given the
 * variables), or that holds any of `secrets` (the codes and the seed) in any file. Messages name files, never secrets.
 */
export const checkWeb = (web: string, info: BuildInfo, secrets: readonly string[]): void => {
  const files = filesUnder(web).map((file) => ({ name: posix(path.relative(web, file)), bytes: fs.readFileSync(file) }));
  const holding = (text: string): string[] => files.filter(({ bytes }) => bytes.includes(text)).map(({ name }) => name);
  const missing = [info.contentVersion, ...info.inviteHashes].filter((text) => holding(text).length === 0);
  if (missing.length > 0) {
    throw new ReleaseError(
      `The web build does not carry what the release gave it, so nothing was released. The app reads it from ${Object.values(BUILD_VARIABLES).join(', ')}.`,
      missing.map((text) => `No file holds '${text}'.`),
    );
  }
  const leaks = [...new Set(secrets.filter((secret) => secret !== '').flatMap(holding))];
  if (leaks.length > 0) {
    throw new ReleaseError(
      'The web build holds an invite code or the invite seed, so nothing was released.',
      leaks.map((name) => `${name} holds one.`),
    );
  }
};

/**
 * Copies the app's build from `dist` to `web`, adds `settings/index.html` (a copy of index.html, so /settings opens
 * on any static host, not only one that serves index.html for every path), and checks the result (checkWeb).
 */
export const packageWeb = (dist: string, web: string, info: BuildInfo, secrets: readonly string[]): void => {
  const index = path.join(dist, 'index.html');
  if (!fs.existsSync(index)) throw new ReleaseError(`The app's build has no index.html in ${dist}, so nothing was released.`);
  const html = fs.readFileSync(index, 'utf8');
  const relative = relativeUrls(html);
  if (relative.length > 0) {
    throw new ReleaseError('index.html loads files by relative URL, which a copy at settings/index.html would not find.', [
      ...relative,
      "Build the app with Vite's default base, '/'.",
    ]);
  }
  if (fs.existsSync(path.join(dist, SETTINGS_ROUTE))) {
    throw new ReleaseError(`The app's build already has ${SETTINGS_ROUTE}/, which the release writes the Settings page's entry to.`);
  }
  fs.cpSync(dist, web, { recursive: true });
  fs.mkdirSync(path.join(web, SETTINGS_ROUTE));
  fs.writeFileSync(path.join(web, SETTINGS_ROUTE, 'index.html'), html);
  checkWeb(web, info, secrets);
};
