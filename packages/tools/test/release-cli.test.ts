// A whole release (task 6.3) in a copy of the repository's content, with a stand-in for `pnpm build` that bakes the
// variables it is given into a page as Vite does. `pnpm release:dry` runs the real build.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { contentFrom } from '@servo/content';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BUILD_VARIABLES,
  RELEASE_LAYOUT,
  ReleaseError,
  buildEnvironment,
  buildRelease,
  formatInviteCode,
  hashInviteCode,
  inviteCodes,
  makeContentBundle,
  readContentFiles,
  readContentSemver,
  runRelease,
} from '../src/release/index.ts';
import type { ContentBundle, ReleaseOptions, ReleaseSteps } from '../src/release/index.ts';
import { removeTempFolders, tempFolder, write } from './validate-content/support.ts';

const CONTENT = fileURLToPath(new URL('../../content/', import.meta.url));
const SEED = 'servo-test-seed-0123456789';

afterEach(removeTempFolders);

interface Repo {
  readonly root: string;
  readonly content: string;
  readonly dist: string;
  readonly out: string;
}

/** A repository with a copy of packages/content, an app build folder and the default release folder. */
const repo = (): Repo => {
  const root = tempFolder();
  const content = path.join(root, 'packages', 'content');
  fs.cpSync(CONTENT, content, { recursive: true, filter: (source) => !source.split(path.sep).includes('node_modules') });
  return { root, content, dist: path.join(root, 'packages', 'app', 'dist'), out: path.join(root, 'dist', 'release') };
};

type Variables = Readonly<Record<string, string>>;

interface FakeBuild {
  readonly calls: Variables[];
  readonly buildApp: ReleaseSteps['buildApp'];
}

/** Stands in for `pnpm build`: a page and a script holding the variables, as Vite bakes them in, or not. */
const fakeBuild = (dist: string, page: { readonly bake?: boolean; readonly extra?: string; readonly html?: string } = {}): FakeBuild => {
  const calls: Variables[] = [];
  return {
    calls,
    buildApp: (variables) => {
      calls.push({ ...variables });
      fs.rmSync(dist, { recursive: true, force: true });
      write(dist, 'index.html', page.html ?? '<!doctype html><script type="module" src="/assets/index.js"></script><div id="app"></div>');
      write(dist, 'assets/index.js', `const info = ${page.bake === false ? '{}' : JSON.stringify(variables)};${page.extra ?? ''}`);
    },
  };
};

const CLEAN: Readonly<Record<string, string>> = { 'rev-parse --short HEAD': 'abc1234', 'rev-parse HEAD': 'abc1234def5678', 'status --porcelain': '' };
const gitAnswers =
  (answers: Readonly<Record<string, string>>): ReleaseSteps['git'] =>
  (args) =>
    answers[args.join(' ')];

const steps = (build: FakeBuild, git: ReleaseSteps['git'] = gitAnswers(CLEAN)): ReleaseSteps => ({ buildApp: build.buildApp, git, log: () => undefined });

const options = (at: Repo, more: Partial<ReleaseOptions> = {}): ReleaseOptions => ({
  contentDir: at.content,
  repoRoot: at.root,
  appDist: at.dist,
  out: at.out,
  inviteCount: 10,
  ...more,
});

const read = (file: string): string => fs.readFileSync(file, 'utf8');
const readJson = <T>(file: string): T => JSON.parse(read(file)) as T;

/** Every file under a folder, as text. */
const textsUnder = (folder: string): string[] =>
  fs
    .readdirSync(folder, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => read(path.join(entry.parentPath, entry.name)));

const releaseError = (run: () => unknown): ReleaseError => {
  try {
    run();
  } catch (error) {
    if (error instanceof ReleaseError) return error;
    throw error;
  }
  throw new Error('Expected a ReleaseError.');
};

describe('a release', () => {
  it('writes the web build, the content bundle and release.json, with no codes and no invite gate without a seed', () => {
    const at = repo();
    const build = fakeBuild(at.dist);
    const report = buildRelease(options(at), steps(build));

    const expected = makeContentBundle(readContentSemver(at.content), readContentFiles(at.content));
    expect(report.contentVersion).toBe(expected.version);
    expect(report.contentVersion).toMatch(/^0\.1\.0\+[0-9a-f]{8}$/);
    expect(build.calls).toEqual([
      { [BUILD_VARIABLES.appVersion]: 'dry-abc1234', [BUILD_VARIABLES.contentVersion]: expected.version, [BUILD_VARIABLES.inviteHashes]: '' },
    ]);

    const web = path.join(at.out, RELEASE_LAYOUT.web);
    expect(read(path.join(web, 'settings', 'index.html'))).toBe(read(path.join(web, 'index.html')));
    expect(read(path.join(web, 'assets', 'index.js'))).toContain(expected.version);

    const bundle = readJson<ContentBundle>(path.join(at.out, RELEASE_LAYOUT.content));
    expect(bundle).toEqual(JSON.parse(JSON.stringify(expected)));
    expect(contentFrom(bundle).issues).toEqual([]);

    expect(readJson(path.join(at.out, RELEASE_LAYOUT.manifest))).toEqual({
      appVersion: 'dry-abc1234',
      contentVersion: expected.version,
      commit: 'abc1234def5678',
      dirty: false,
      inviteCodes: 0,
    });
    expect(fs.existsSync(path.join(at.out, 'private'))).toBe(false);
    expect(report.codesFile).toBeUndefined();
  });

  it('with a seed, writes the codes to the private file only and gives the build only their hashes', () => {
    const at = repo();
    const build = fakeBuild(at.dist);
    const codes = inviteCodes(SEED, 4);
    const report = buildRelease(options(at, { inviteSeed: SEED, inviteCount: 4 }), steps(build));

    expect(build.calls[0]?.[BUILD_VARIABLES.inviteHashes]).toBe(codes.map(hashInviteCode).join(','));
    expect(report.inviteCodes).toBe(4);
    const codesFile = path.join(at.out, RELEASE_LAYOUT.codes);
    expect(report.codesFile).toBe(codesFile);
    for (const code of codes) expect(read(codesFile)).toContain(formatInviteCode(code));

    const secrets = [SEED, ...codes, ...codes.map(formatInviteCode)];
    const outsideCodesFile = [
      ...Object.values(build.calls[0] ?? {}),
      ...textsUnder(path.join(at.out, RELEASE_LAYOUT.web)),
      read(path.join(at.out, RELEASE_LAYOUT.content)),
      read(path.join(at.out, RELEASE_LAYOUT.manifest)),
    ];
    for (const text of outsideCodesFile) for (const secret of secrets) expect(text).not.toContain(secret);
  });

  it('takes the app version from the tag, and refuses a tag that names no version before building', () => {
    const at = repo();
    const build = fakeBuild(at.dist);
    expect(buildRelease(options(at, { tag: 'v0.1.0' }), steps(build)).appVersion).toBe('0.1.0');
    expect(buildRelease(options(at, { tag: 'v0.2.0-tester.1' }), steps(build)).appVersion).toBe('0.2.0-tester.1');
    expect(build.calls.map((call) => call[BUILD_VARIABLES.appVersion])).toEqual(['0.1.0', '0.2.0-tester.1']);
    for (const tag of ['0.1.0', 'v1', 'v1.0', 'vfoo', 'v1.0.0+build', 'release-1']) {
      expect(releaseError(() => buildRelease(options(at, { tag }), steps(build))).message).toMatch(/does not name a version/);
    }
    expect(build.calls).toHaveLength(2);
  });

  it("names a dry run by its commit, says when the working tree had changes, and copes without git", () => {
    const at = repo();
    const dirty = { ...CLEAN, 'status --porcelain': ' M packages/content/parts/level-1/dc-motor.json' };
    expect(buildRelease(options(at), steps(fakeBuild(at.dist), gitAnswers(dirty)))).toMatchObject({ appVersion: 'dry-abc1234-dirty', dirty: true });
    expect(buildRelease(options(at), steps(fakeBuild(at.dist), () => undefined))).toMatchObject({ appVersion: 'dry', commit: null, dirty: false });
  });

  it('refuses content with issues before building anything', () => {
    const at = repo();
    write(at.content, 'parts/level-1/dc-motor.json', '{ "id": "dc-motor" }');
    const build = fakeBuild(at.dist);
    const error = releaseError(() => buildRelease(options(at), steps(build)));
    expect(error.message).toMatch(/The content has issues/);
    expect(error.problems.some((problem) => problem.startsWith('parts/level-1/dc-motor.json: '))).toBe(true);
    expect(build.calls).toEqual([]);
    expect(fs.existsSync(at.out)).toBe(false);
  });

  it('refuses a build that does not carry the content version and the code hashes', () => {
    const at = repo();
    const error = releaseError(() => buildRelease(options(at, { inviteSeed: SEED, inviteCount: 2 }), steps(fakeBuild(at.dist, { bake: false }))));
    expect(error.message).toMatch(/does not carry what the release gave it/);
    expect(error.problems).toHaveLength(3);
  });

  it('refuses a build that holds a code or the seed, and never prints either', () => {
    const at = repo();
    const [code = ''] = inviteCodes(SEED, 1);
    for (const leaked of [formatInviteCode(code), code, SEED]) {
      const build = fakeBuild(at.dist, { extra: `const leaked = ${JSON.stringify(leaked)};` });
      const error = releaseError(() => buildRelease(options(at, { inviteSeed: SEED, inviteCount: 1 }), steps(build)));
      expect(error.message).toMatch(/holds an invite code or the invite seed/);
      expect(error.problems).toEqual(['assets/index.js holds one.']);
      for (const secret of [code, formatInviteCode(code), SEED]) expect(error.message).not.toContain(secret);
    }
  });

  it('refuses an index.html that loads files by relative URL, which /settings would not find', () => {
    const at = repo();
    const build = fakeBuild(at.dist, { html: '<!doctype html><script type="module" src="./assets/index.js"></script>' });
    expect(releaseError(() => buildRelease(options(at), steps(build))).problems).toContain('./assets/index.js');
  });

  it("replaces an earlier release's files, its codes included", () => {
    const at = repo();
    buildRelease(options(at, { inviteSeed: SEED }), steps(fakeBuild(at.dist)));
    expect(fs.existsSync(path.join(at.out, RELEASE_LAYOUT.codes))).toBe(true);
    write(at.out, '.DS_Store', '');
    write(at.out, 'web/stale.txt', 'from before');
    buildRelease(options(at), steps(fakeBuild(at.dist)));
    expect(fs.existsSync(path.join(at.out, 'private'))).toBe(false);
    expect(fs.existsSync(path.join(at.out, 'web', 'stale.txt'))).toBe(false);
    expect(readJson<{ readonly inviteCodes: number }>(path.join(at.out, RELEASE_LAYOUT.manifest)).inviteCodes).toBe(0);
  });

  it('refuses a release folder holding files a release does not write, and removes nothing there', () => {
    const at = repo();
    buildRelease(options(at), steps(fakeBuild(at.dist)));
    write(at.out, 'notes.txt', 'mine');
    const build = fakeBuild(at.dist);
    expect(releaseError(() => buildRelease(options(at), steps(build))).message).toMatch(/holds files a release does not write/);
    expect(build.calls).toEqual([]);
    expect(fs.existsSync(path.join(at.out, RELEASE_LAYOUT.manifest))).toBe(true);
    expect(fs.existsSync(path.join(at.out, 'notes.txt'))).toBe(true);
  });

  it("refuses a release folder that overlaps the app's build folder", () => {
    const at = repo();
    for (const out of [path.join(at.dist, 'release'), at.root]) {
      expect(releaseError(() => buildRelease(options(at, { out }), steps(fakeBuild(at.dist)))).message).toMatch(/overlaps the app's build folder/);
    }
  });
});

describe('the build environment', () => {
  it('leaves the invite seed out, and sets every release variable over any already there', () => {
    const env = buildEnvironment(
      { PATH: '/bin', SERVO_INVITE_SEED: SEED, [BUILD_VARIABLES.appVersion]: 'stale' },
      { [BUILD_VARIABLES.appVersion]: '0.1.0', [BUILD_VARIABLES.contentVersion]: '0.1.0+00000000', [BUILD_VARIABLES.inviteHashes]: '' },
    );
    expect(env).toEqual({
      PATH: '/bin',
      [BUILD_VARIABLES.appVersion]: '0.1.0',
      [BUILD_VARIABLES.contentVersion]: '0.1.0+00000000',
      [BUILD_VARIABLES.inviteHashes]: '',
    });
    for (const name of Object.values(BUILD_VARIABLES)) expect(name).toMatch(/^VITE_/);
  });
});

describe('the release command', () => {
  const run = (argv: readonly string[], at: Repo, env: Readonly<Record<string, string>> = {}, cwd: string = at.root) => {
    const out: string[] = [];
    const err: string[] = [];
    const build = fakeBuild(at.dist);
    const status = runRelease(argv, {
      cwd,
      repoRoot: at.root,
      env,
      steps: { buildApp: build.buildApp, git: gitAnswers(CLEAN) },
      out: (line) => out.push(line),
      err: (line) => err.push(line),
    });
    return { status, out, err, build };
  };

  it('prints the versions and where the release went, and in a workflow writes the step outputs and summary', () => {
    const at = repo();
    const outputs = path.join(at.root, 'github-output');
    const summary = path.join(at.root, 'github-summary');
    const { status, out, err } = run(['--tag', 'v0.1.0', '--invite-count', '3'], at, {
      SERVO_INVITE_SEED: SEED,
      GITHUB_OUTPUT: outputs,
      GITHUB_STEP_SUMMARY: summary,
    });
    expect(err).toEqual([]);
    expect(status).toBe(0);
    const { contentVersion } = readJson<{ readonly contentVersion: string }>(path.join(at.out, RELEASE_LAYOUT.manifest));
    expect(out).toContain('App version: 0.1.0');
    expect(out).toContain(`Content version: ${contentVersion}`);
    expect(out).toContain('Invite codes: 3, in dist/release/private/invite-codes.txt. Keep that file private.');
    expect(read(outputs)).toBe(`app-version=0.1.0\ncontent-version=${contentVersion}\ninvite-codes=3\n`);
    expect(read(summary)).toContain(`| Content version | ${contentVersion} |`);
    expect(read(summary)).toContain('Invite codes: 3, in the private artifact only.');
    const codes = inviteCodes(SEED, 3);
    for (const text of [...out, read(summary), read(outputs)]) {
      for (const secret of [SEED, ...codes, ...codes.map(formatInviteCode)]) expect(text).not.toContain(secret);
    }
  });

  it('says when there is no seed, so no codes and no gate', () => {
    const at = repo();
    const summary = path.join(at.root, 'github-summary');
    const { status, out } = run([], at, { SERVO_INVITE_SEED: '', GITHUB_STEP_SUMMARY: summary });
    expect(status).toBe(0);
    expect(out).toContain('Invite codes: none, because SERVO_INVITE_SEED is not set, so the build has no invite gate.');
    expect(read(summary)).toContain('Invite codes: skipped, because SERVO_INVITE_SEED is not set. This build has no invite gate.');
  });

  it('writes to --out, relative to the folder the command was typed in', () => {
    const at = repo();
    const cwd = path.join(at.root, 'packages');
    const { status } = run(['--out', '../somewhere/else'], at, {}, cwd);
    expect(status).toBe(0);
    expect(fs.existsSync(path.join(at.root, 'somewhere', 'else', RELEASE_LAYOUT.manifest))).toBe(true);
  });

  it('stops with status 1 and says why, when the release cannot be made', () => {
    const at = repo();
    const { status, err, build } = run(['--tag', 'latest'], at);
    expect(status).toBe(1);
    expect(err.join('\n')).toMatch(/The tag 'latest' does not name a version/);
    expect(build.calls).toEqual([]);
    expect(run([], at, { SERVO_INVITE_SEED: 'short' }).status).toBe(1);
  });

  it('shows its help, and stops with status 2 when misused', () => {
    const at = repo();
    const help = run(['--help'], at);
    expect(help.status).toBe(0);
    expect(help.out.join('\n')).toMatch(/^Usage: pnpm release:dry/);
    for (const argv of [['--invite-count', '0'], ['--invite-count', 'ten'], ['--invite-count', '501'], ['--tag='], ['--bogus'], ['extra']]) {
      const misused = run(argv, at);
      expect(misused.status, argv.join(' ')).toBe(2);
      expect(misused.build.calls).toEqual([]);
    }
  });
});
