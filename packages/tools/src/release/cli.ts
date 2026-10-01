// The release command: `pnpm release:dry` locally, and the release workflow with --tag. See README.md.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';
import { ReleaseError } from './errors.ts';
import { DEFAULT_INVITE_COUNT, INVITE_SEED_VARIABLE, MAX_INVITE_COUNT, MIN_INVITE_SEED_LENGTH } from './invite-codes.ts';
import { RELEASE_LAYOUT, buildRelease } from './release.ts';
import type { ReleaseReport, ReleaseSteps } from './release.ts';
import { SETTINGS_ROUTE } from './web.ts';

export const RELEASE_USAGE = [
  'Usage: pnpm release:dry [--out <folder>] [--invite-count <n>]',
  '       node packages/tools/src/release/main.ts --tag v<version> [--out <folder>] [--invite-count <n>]',
  '',
  'Builds a release into one folder: the web build with the app and content versions baked in (web/), the content',
  `bundle (${RELEASE_LAYOUT.content}), ${RELEASE_LAYOUT.manifest} and, when ${INVITE_SEED_VARIABLE} is set, the tester invite`,
  `codes (${RELEASE_LAYOUT.codes}). It runs pnpm build, which runs pnpm art. Nothing is uploaded or deployed.`,
  '',
  '  --tag <tag>         The tag being released, v<major>.<minor>.<patch>. The app version is the tag without its v.',
  '                      Without it the release is a dry run, and the app version is dry- and the commit.',
  '  --out <folder>      Where the release goes. Default: dist/release in the repository.',
  `  --invite-count <n>  How many invite codes to make, 1 to ${MAX_INVITE_COUNT}. Default: ${DEFAULT_INVITE_COUNT}.`,
  '  -h, --help          Show this help.',
  '',
  `Environment: ${INVITE_SEED_VARIABLE}, the secret the invite codes come from, at least ${MIN_INVITE_SEED_LENGTH} characters.`,
  'Without it there are no codes, and the build has no invite gate.',
  '',
  'Exit status: 0 when the release is written, 1 when something stops it, 2 when the command is misused.',
].join('\n');

/** What the command reads from the world, so tests can run it without a process. */
export interface ReleaseEnvironment {
  /** The folder the command was typed in: --out is relative to it. */
  readonly cwd: string;
  readonly repoRoot: string;
  /** The process's environment: the invite seed, and GITHUB_OUTPUT and GITHUB_STEP_SUMMARY in a workflow. */
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly steps: Omit<ReleaseSteps, 'log'>;
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

const parse = (argv: readonly string[]) =>
  parseArgs({
    args: [...argv],
    strict: true,
    allowPositionals: false,
    options: {
      tag: { type: 'string' },
      out: { type: 'string' },
      'invite-count': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });

/** The build's environment: this one with the invite seed taken out, and the release's variables put in. */
export const buildEnvironment = (
  env: Readonly<Record<string, string | undefined>>,
  variables: Readonly<Record<string, string>>,
): Record<string, string | undefined> => ({
  ...Object.fromEntries(Object.entries(env).filter(([name]) => name !== INVITE_SEED_VARIABLE)),
  ...variables,
});

/** `pnpm build` from the repository root, with the release's variables added and the invite seed left out. */
export const appBuildStep =
  (repoRoot: string): ReleaseSteps['buildApp'] =>
  (variables) => {
    const env = buildEnvironment(process.env, variables);
    const result = spawnSync('pnpm', ['build'], { cwd: repoRoot, env, stdio: 'inherit', shell: process.platform === 'win32' });
    if (result.error) throw new ReleaseError(`Could not run pnpm build: ${result.error.message}`);
    if (result.status !== 0) throw new ReleaseError(`pnpm build stopped (${result.signal ?? `exit status ${String(result.status)}`}), so nothing was released.`);
  };

export const gitStep =
  (repoRoot: string): ReleaseSteps['git'] =>
  (args) => {
    const result = spawnSync('git', [...args], { cwd: repoRoot, encoding: 'utf8' });
    return result.status === 0 ? result.stdout.trim() : undefined;
  };

/** A path as a person reads it: relative to `cwd` when inside it. */
const shown = (file: string, cwd: string): string => {
  const relative = path.relative(cwd, file);
  return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) ? file : relative || '.';
};

/** The step summary a workflow shows (GITHUB_STEP_SUMMARY). It never holds a code. */
export const releaseSummary = (report: ReleaseReport): string =>
  [
    `## Servo ${report.appVersion}`,
    '',
    '| | |',
    '| --- | --- |',
    `| App version | ${report.appVersion} |`,
    `| Content version | ${report.contentVersion} |`,
    `| Commit | ${report.commit ?? 'unknown'}${report.dirty ? ' (with changes not committed)' : ''} |`,
    '',
    `Settings, at /${SETTINGS_ROUTE} on the site, shows both versions.`,
    '',
    report.inviteCodes > 0
      ? `Invite codes: ${report.inviteCodes}, in the private artifact only. The build asks for one on its first launch on a device.`
      : `Invite codes: skipped, because ${INVITE_SEED_VARIABLE} is not set. This build has no invite gate.`,
    '',
  ].join('\n');

/**
 * The release command: returns the exit status. Prints the versions and where the release went, and in a workflow
 * writes the step outputs (app-version, content-version, invite-codes) and the step summary.
 */
export const runRelease = (argv: readonly string[], environment: ReleaseEnvironment): number => {
  const { cwd, repoRoot, env, out, err } = environment;
  const misuse = (message: string): number => {
    err(`release: ${message}`);
    err(`\n${RELEASE_USAGE}`);
    return 2;
  };
  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(argv);
  } catch (error) {
    return misuse(error instanceof Error ? error.message : String(error));
  }
  const { values } = parsed;
  if (values.help) {
    out(RELEASE_USAGE);
    return 0;
  }
  const count = values['invite-count'] ?? String(DEFAULT_INVITE_COUNT);
  if (!/^\d+$/.test(count) || Number(count) < 1 || Number(count) > MAX_INVITE_COUNT) {
    return misuse(`--invite-count must be a whole number from 1 to ${MAX_INVITE_COUNT}, not '${count}'.`);
  }
  if (values.tag === '') return misuse('--tag needs the tag being released, for example v0.1.0.');
  const seed = env[INVITE_SEED_VARIABLE];
  const releaseOut = values.out === undefined ? path.join(repoRoot, 'dist', 'release') : path.resolve(cwd, values.out);

  try {
    const report = buildRelease(
      {
        contentDir: path.join(repoRoot, 'packages', 'content'),
        repoRoot,
        appDist: path.join(repoRoot, 'packages', 'app', 'dist'),
        out: releaseOut,
        tag: values.tag,
        inviteCount: Number(count),
        inviteSeed: seed === undefined || seed === '' ? undefined : seed,
      },
      { ...environment.steps, log: (line) => out(`release: ${line}`) },
    );
    out(`App version: ${report.appVersion}`);
    out(`Content version: ${report.contentVersion}`);
    out(
      report.codesFile === undefined
        ? `Invite codes: none, because ${INVITE_SEED_VARIABLE} is not set, so the build has no invite gate.`
        : `Invite codes: ${report.inviteCodes}, in ${shown(report.codesFile, cwd)}. Keep that file private.`,
    );
    out(`Release written to ${shown(report.out, cwd)}. Settings is at /${SETTINGS_ROUTE}.`);
    if (env.GITHUB_OUTPUT) {
      const outputs = [`app-version=${report.appVersion}`, `content-version=${report.contentVersion}`, `invite-codes=${report.inviteCodes}`];
      fs.appendFileSync(env.GITHUB_OUTPUT, `${outputs.join('\n')}\n`);
    }
    if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, releaseSummary(report));
    return 0;
  } catch (error) {
    if (!(error instanceof ReleaseError)) throw error;
    err(`release: ${error.message}`);
    return 1;
  }
};
