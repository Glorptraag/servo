// Shared helpers for the content validator's tests (test/validate-content*.test.ts).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { exampleArenas, exampleChallenges, exampleParts, exampleRunRecords, validBlueprints, validKits } from '@servo/schema/fixtures';
import { runValidateContent } from '../../src/validate-content/cli.ts';

export const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
/** Test lists in the terminology format, modelled on CLAUDE.md's terminology. They stay fixed while the real ones grow. */
export const TERMINOLOGY = fileURLToPath(new URL('./terminology/', import.meta.url));
/** The real lists (task 2.5), which content and later the app read. */
export const CONTENT_TERMINOLOGY = path.join(REPO_ROOT, 'packages', 'content', 'terminology');
export const MAIN = fileURLToPath(new URL('../../src/validate-content/main.ts', import.meta.url));

const made: string[] = [];

/**
 * A fresh folder under the system temp folder; removeTempFolders deletes it. Its real path, because a child
 * process reports its working folder that way (macOS links /var to /private/var).
 */
export const tempFolder = (): string => {
  const folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'servo-validate-content-')));
  made.push(folder);
  return folder;
};

export const removeTempFolders = (): void => {
  for (const folder of made.splice(0)) fs.rmSync(folder, { recursive: true, force: true });
};

/** Writes JSON (or raw text) to a path under a folder, making the folders on the way. */
export const write = (folder: string, relative: string, data: unknown): string => {
  const file = path.join(folder, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof data === 'string' ? data : `${JSON.stringify(data, null, 2)}\n`);
  return file;
};

/** A deep copy with one change made, for "one thing wrong" records. */
export const changed = <T>(data: T, change: (copy: T) => void): T => {
  const copy = structuredClone(data);
  change(copy);
  return copy;
};

export const idOf = (data: unknown): string => {
  const id = (data as { readonly id?: unknown }).id;
  if (typeof id !== 'string') throw new Error('Expected a record with an id.');
  return id;
};

export const partFixture = (id: string): Record<string, unknown> => {
  const found = exampleParts.find((part) => idOf(part) === id);
  if (!found) throw new Error(`No example part '${id}'.`);
  return structuredClone(found) as Record<string, unknown>;
};

/** Writes every valid schema fixture into content-style folders: parts/, arenas/, kits/, challenges/, fixtures/blueprints/, run-records/. */
export const writeSchemaFixtures = (folder: string): string[] => [
  ...exampleParts.map((part) => write(folder, `parts/${idOf(part)}.json`, part)),
  ...exampleArenas.map((arena) => write(folder, `arenas/${idOf(arena)}.json`, arena)),
  ...validKits.map((kit) => write(folder, `kits/${kit.name}.json`, kit.data)),
  ...exampleChallenges.map((challenge) => write(folder, `challenges/${challenge.name}.json`, challenge.data)),
  ...validBlueprints.map((blueprint) => write(folder, `fixtures/blueprints/${blueprint.name}.json`, blueprint.data)),
  ...exampleRunRecords.map((run) => write(folder, `run-records/${run.name}.json`, run.data)),
];

/** How the command shows a path when run from `cwd`: relative inside it, in full outside it. */
export const shown = (file: string, cwd: string = REPO_ROOT): string => {
  const relative = path.relative(cwd, file);
  return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) ? file : relative || '.';
};

export interface CliRun {
  readonly status: number;
  readonly out: readonly string[];
  readonly err: readonly string[];
}

/** Runs the command in-process. `contentDir` stands in for packages/content, so tests never read the real content. */
export const cli = (argv: readonly string[], options: { readonly cwd?: string; readonly contentDir?: string } = {}): CliRun => {
  const out: string[] = [];
  const err: string[] = [];
  const status = runValidateContent(argv, {
    cwd: options.cwd ?? REPO_ROOT,
    repoRoot: REPO_ROOT,
    contentDir: options.contentDir ?? tempFolder(),
    out: (line) => out.push(line),
    err: (line) => err.push(line),
  });
  return { status, out, err };
};

/** Runs `node main.ts` as `pnpm validate-content` does, in a child process. */
export const spawnCli = (args: readonly string[], cwd: string): { readonly status: number | null; readonly stdout: string; readonly stderr: string } => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'INIT_CWD'));
  const result = spawnSync(process.execPath, [MAIN, ...args], { cwd, env, encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
};
