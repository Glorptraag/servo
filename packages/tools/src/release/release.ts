// A release, start to finish: the content checked and bundled, the invite codes made, the app built with the versions
// and code hashes baked in, and everything written to one folder. Nothing is uploaded or deployed here: the workflow
// uploads the folder's parts as artifacts (.github/workflows/release.yml). See README.md.
import fs from 'node:fs';
import path from 'node:path';
import { checkContent, isSemver, makeContentBundle, readContentFiles } from './content-bundle.ts';
import { ReleaseError } from './errors.ts';
import { INVITE_SEED_VARIABLE, formatInviteCode, hashInviteCode, inviteCodes } from './invite-codes.ts';
import { buildVariables, packageWeb } from './web.ts';
import type { BuildInfo } from './web.ts';

/** What a release writes into its folder, and nothing else: an earlier release's copies are replaced. */
export const RELEASE_LAYOUT = {
  web: 'web',
  content: 'content/servo-content.json',
  manifest: 'release.json',
  codes: 'private/invite-codes.txt',
} as const;

const TOP_LEVEL = new Set(Object.values(RELEASE_LAYOUT).map((entry) => entry.split('/')[0] ?? entry));

export interface ReleaseOptions {
  /** packages/content: the records, and the content semver in its package.json. */
  readonly contentDir: string;
  /** The repository root, which the content validator reads record folders below. */
  readonly repoRoot: string;
  /** Where the app's build lands: packages/app/dist. */
  readonly appDist: string;
  /** The folder the release is written to. */
  readonly out: string;
  /** The tag being released, `v0.1.0`; undefined for a dry run. */
  readonly tag?: string | undefined;
  /** How many invite codes to make when there is a seed. */
  readonly inviteCount: number;
  /** The secret the codes come from (SERVO_INVITE_SEED). Without one there are no codes and no invite gate. */
  readonly inviteSeed?: string | undefined;
}

/** The steps that reach outside the process, so tests can stand in for them. */
export interface ReleaseSteps {
  /**
   * Builds the app into `appDist` with these variables added to the environment and the invite seed taken out of it
   * (`pnpm build`, which runs `pnpm art` first).
   */
  readonly buildApp: (variables: Readonly<Record<string, string>>) => void;
  /** Runs git in the repository with these arguments: its trimmed output, or undefined when git fails. */
  readonly git: (args: readonly string[]) => string | undefined;
  /** Says what is happening. */
  readonly log: (line: string) => void;
}

/** release.json: what was released, from which commit. It never holds a code. */
export interface ReleaseManifest {
  readonly appVersion: string;
  readonly contentVersion: string;
  /** The commit built, or null where git could not say. */
  readonly commit: string | null;
  /** True when the working tree had changes that are not committed. */
  readonly dirty: boolean;
  /** How many invite codes the build takes; 0 for a build with no invite gate. */
  readonly inviteCodes: number;
}

export interface ReleaseReport extends ReleaseManifest {
  readonly out: string;
  /** The codes file, when there are codes. */
  readonly codesFile: string | undefined;
}

/** A release tag: `v` and a semver, such as `v0.1.0` or `v0.2.0-tester.1`. The app version is the tag without its `v`. */
export const appVersionFromTag = (tag: string): string => {
  const version = tag.slice(1);
  if (!tag.startsWith('v') || !isSemver(version)) {
    throw new ReleaseError(`The tag '${tag}' does not name a version, so nothing was released.`, [
      'Tag a release as v<major>.<minor>.<patch>, for example v0.1.0, or v0.1.0-tester.1 for a pre-release.',
    ]);
  }
  return version;
};

/** A dry run's app version: `dry-` and the short commit, with `-dirty` when the working tree has changes; `dry` without git. */
export const dryRunAppVersion = (shortCommit: string | undefined, dirty: boolean): string =>
  shortCommit === undefined ? 'dry' : `dry-${shortCommit}${dirty ? '-dirty' : ''}`;

const isInside = (inner: string, outer: string): boolean => {
  const relative = path.relative(outer, inner);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

/**
 * Makes `out` ready: refuses a folder that holds anything a release does not write (hidden files aside) or that
 * overlaps the app's build, then removes an earlier release's files so none of them, invite codes above all, outlive it.
 */
const prepareOut = (out: string, appDist: string): void => {
  if (isInside(out, appDist) || isInside(appDist, out)) {
    throw new ReleaseError(`The release folder ${out} overlaps the app's build folder ${appDist}, so nothing was released.`, [
      'The build empties its own folder, so the release goes elsewhere, by default dist/release.',
    ]);
  }
  if (fs.existsSync(out)) {
    if (!fs.statSync(out).isDirectory()) throw new ReleaseError(`${out} is a file, not a folder, so nothing was released.`);
    const strangers = fs.readdirSync(out).filter((name) => !name.startsWith('.') && !TOP_LEVEL.has(name));
    if (strangers.length > 0) {
      throw new ReleaseError(`${out} holds files a release does not write, so nothing was written there.`, [
        ...strangers.slice(0, 5),
        ...(strangers.length > 5 ? [`and ${strangers.length - 5} more`] : []),
        'Point --out at an empty folder, or at one an earlier release wrote.',
      ]);
    }
    for (const name of TOP_LEVEL) fs.rmSync(path.join(out, name), { recursive: true, force: true });
  }
  fs.mkdirSync(out, { recursive: true });
};

const writeFile = (file: string, text: string): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};

const codesText = (codes: readonly string[], info: BuildInfo): string =>
  [
    'Servo tester invite codes',
    `Made for app version ${info.appVersion}, content version ${info.contentVersion}.`,
    '',
    'Give one code to each tester family. A tester build asks for a code on its first launch on a device and',
    `remembers it there. The same ${INVITE_SEED_VARIABLE} gives the same codes in every release, so testers keep theirs.`,
    'The codes are a soft gate, not security: keep this file private, and rely on it to protect nothing.',
    '',
    ...codes.map((code, index) => `${String(index + 1).padStart(3)}  ${formatInviteCode(code)}`),
    '',
  ].join('\n');

/** packages/content's `version`, the content semver. */
export const readContentSemver = (contentDir: string): string => {
  const file = path.join(contentDir, 'package.json');
  let version: unknown;
  try {
    version = (JSON.parse(fs.readFileSync(file, 'utf8')) as { readonly version?: unknown }).version;
  } catch (error) {
    throw new ReleaseError(`Could not read the content's version from ${file}.`, [error instanceof Error ? error.message : String(error)]);
  }
  if (typeof version !== 'string') throw new ReleaseError(`${file} has no version, so the content has none.`);
  return version;
};

/**
 * Builds a release into `options.out`: the web build with the app version, the content version and the invite code
 * hashes baked in (web/, with web/settings/index.html), the content bundle, release.json and, with a seed, the codes
 * (private/invite-codes.txt). Rejects with a ReleaseError, before building, on content with issues, a bad tag, a short
 * seed or a folder it may not write; and after building when the build lacks the versions or holds a code.
 */
export const buildRelease = async (options: ReleaseOptions, steps: ReleaseSteps): Promise<ReleaseReport> => {
  const commit = steps.git(['rev-parse', 'HEAD']);
  const dirty = commit !== undefined && Boolean(steps.git(['status', '--porcelain']));
  const appVersion =
    options.tag === undefined ? dryRunAppVersion(steps.git(['rev-parse', '--short', 'HEAD']), dirty) : appVersionFromTag(options.tag);

  steps.log('Checking the content.');
  const files = readContentFiles(options.contentDir);
  checkContent(options.contentDir, options.repoRoot, files);
  const bundle = makeContentBundle(readContentSemver(options.contentDir), files);

  const codes = options.inviteSeed === undefined ? [] : inviteCodes(options.inviteSeed, options.inviteCount);
  const inviteHashes = await Promise.all(codes.map((code) => hashInviteCode(code)));
  const info: BuildInfo = { appVersion, contentVersion: bundle.version, inviteHashes };
  const secrets = [...codes, ...codes.map(formatInviteCode), ...(options.inviteSeed === undefined ? [] : [options.inviteSeed])];

  prepareOut(options.out, options.appDist);
  steps.log(`Building the app ${appVersion} with content ${bundle.version}.`);
  steps.buildApp(buildVariables(info));
  packageWeb(options.appDist, path.join(options.out, RELEASE_LAYOUT.web), info, secrets);

  writeFile(path.join(options.out, RELEASE_LAYOUT.content), `${JSON.stringify(bundle, null, 2)}\n`);
  const codesFile = codes.length > 0 ? path.join(options.out, RELEASE_LAYOUT.codes) : undefined;
  if (codesFile !== undefined) writeFile(codesFile, codesText(codes, info));
  const manifest: ReleaseManifest = { appVersion, contentVersion: bundle.version, commit: commit ?? null, dirty, inviteCodes: codes.length };
  writeFile(path.join(options.out, RELEASE_LAYOUT.manifest), `${JSON.stringify(manifest, null, 2)}\n`);
  return { ...manifest, out: options.out, codesFile };
};
