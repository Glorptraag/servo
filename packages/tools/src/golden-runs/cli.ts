// `pnpm golden [--accept] [<case>...]`: re-runs every case, checks each content fixture's expect, and diffs each Run
// against its golden file. `--accept` writes the golden files anew, on purpose, and prints what changed.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { describeDiff, diffGolden } from './diff.ts';
import { checkExpect } from './expect.ts';
import type { ExpectReport, GoalJudge } from './expect.ts';
import { GOLDEN_EXTENSION, formatGolden, parseGolden } from './file.ts';
import { runCase } from './run.ts';
import type { GoldenCase } from './run.ts';

/** The cases a run checks, or the issues that stop it. */
export interface CaseLoad {
  readonly cases: readonly GoldenCase[];
  /** Issues in the content or fixtures the cases come from, one line each. Any issue stops the command. */
  readonly issues: readonly string[];
}

/** What the command reads from the world, so tests can run it without a process. */
export interface GoldenEnvironment {
  /** The folder the command was typed in: the golden folder is shown relative to it. */
  readonly cwd: string;
  /** packages/sim-core/golden/: each case's file is `<id>.golden` inside it. */
  readonly goldenDir: string;
  readonly cases: () => CaseLoad;
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
  /** The challenge runner's verdict, for fixtures that expect a goal. None until task 4.5. */
  readonly judge?: GoalJudge;
}

export const USAGE = [
  'Usage: pnpm golden [--accept] [<case>...]',
  '',
  'Runs every content fixture and every valid schema blueprint through sim-core, checks each fixture against its',
  'expect, and diffs each Run against its golden file in packages/sim-core/golden/.',
  '',
  '  <case>        content/<fixture>, schema/<blueprint>, a name either may end with, or content or schema for',
  '                all of one kind. Default: every case, and golden files no case has are reported.',
  '  --accept      Write each golden file from the Run as it is now, and remove those no case has. For intended',
  '                changes only: say why in the task\'s notes for the orchestrator. It never makes an expect hold.',
  '  -h, --help    Show this help.',
  '',
  'Exit status: 0 when every Run matches its golden file (or is accepted) and every expect holds, 1 otherwise,',
  '2 when the command is misused.',
].join('\n');

type Status = 'same' | 'differs' | 'missing' | 'unreadable' | 'failed' | 'stale' | 'accepted' | 'written' | 'removed';

/** What happened to one case, or one golden file no case has. */
interface Outcome {
  readonly id: string;
  readonly status: Status;
  /** Lines under the status line: the diff, what could not be read or run. */
  readonly details: readonly string[];
  readonly expect?: ExpectReport;
}

const plural = (count: number, noun: string, many = `${noun}s`): string => `${count} ${count === 1 ? noun : many}`;

const parse = (argv: readonly string[]) =>
  parseArgs({ args: [...argv], allowPositionals: true, strict: true, options: { accept: { type: 'boolean' }, help: { type: 'boolean', short: 'h' } } });

/** Every golden file under the folder, by case id. */
const goldenFiles = (folder: string): string[] => {
  if (!fs.existsSync(folder)) return [];
  const found: string[] = [];
  const visit = (relative: string): void => {
    const entries = fs.readdirSync(path.join(folder, relative), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const inside = relative === '' ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory()) visit(inside);
      else if (entry.isFile() && entry.name.endsWith(GOLDEN_EXTENSION)) found.push(inside.slice(0, -GOLDEN_EXTENSION.length));
    }
  };
  visit('');
  return found;
};

/** The cases a pattern names: an id, a name an id ends with, or a whole kind. */
const select = (cases: readonly GoldenCase[], pattern: string): GoldenCase[] => {
  const name = pattern.replace(/\/+$/, '');
  return cases.filter((each) => each.id === name || each.id.endsWith(`/${name}`) || each.id.startsWith(`${name}/`));
};

const STATUS_WIDTH = 11;

/** Statuses that need nothing done, written in lower case; the rest are upper case, so they stand out in a CI log. */
const QUIET: ReadonlySet<Status> = new Set(['same', 'written', 'accepted', 'removed']);

const KIND_NOUNS: Readonly<Record<string, string>> = { content: 'content fixture', schema: 'schema blueprint' };

/** The most cases the closing hint names; past it, the hint says to accept every change or name the ones meant. */
const NAMED_IN_HINT = 3;

/**
 * `pnpm golden`: one line per case, with the diff or the problem under it, each fixture's expect, then a summary.
 * Returns the exit status: 0 when everything matches and every expect holds, 1 when not, 2 on misuse.
 */
export const runGolden = async (argv: readonly string[], env: GoldenEnvironment): Promise<number> => {
  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(argv);
  } catch (error) {
    env.err(`golden: ${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`);
    return 2;
  }
  if (parsed.values.help) {
    env.out(USAGE);
    return 0;
  }
  const accept = parsed.values.accept === true;
  const load = env.cases();
  if (load.issues.length > 0) {
    for (const issue of load.issues) env.err(issue);
    env.err(`golden: the content has ${plural(load.issues.length, 'issue')}, so its fixtures cannot run. \`pnpm validate-content packages/content\` says more.`);
    return 1;
  }
  const all = [...load.cases].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  let cases = all;
  if (parsed.positionals.length > 0) {
    const chosen = new Set<GoldenCase>();
    for (const pattern of parsed.positionals) {
      const found = select(all, pattern);
      if (found.length === 0) {
        env.err(`golden: no case '${pattern}'. Cases are content/<fixture> and schema/<blueprint>.\n\n${USAGE}`);
        return 2;
      }
      for (const each of found) chosen.add(each);
    }
    cases = all.filter((each) => chosen.has(each));
  }

  const kinds = new Map<string, number>();
  for (const each of cases) {
    const kind = each.id.slice(0, Math.max(0, each.id.indexOf('/')));
    kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
  }
  const what = [...kinds].map(([kind, count]) => plural(count, KIND_NOUNS[kind] ?? (kind || 'case')));
  const folder = path.relative(env.cwd, env.goldenDir) || '.';
  const where = folder.startsWith('..') || path.isAbsolute(folder) ? env.goldenDir : folder;
  env.out(`golden${accept ? ' --accept' : ''}: ${plural(cases.length, 'Run')}${what.length > 0 ? ` (${what.join(', ')})` : ''} against ${where}${path.sep}`);

  const outcomes: Outcome[] = [];
  const width = Math.max(0, ...cases.map((each) => each.id.length));
  const report = (outcome: Outcome): void => {
    outcomes.push(outcome);
    const expect = outcome.expect;
    const verdict = !expect || expect.shows === '' ? '' : `  expect ${expect.holds ? 'holds' : 'DOES NOT HOLD'}: ${expect.shows}`;
    const status = QUIET.has(outcome.status) ? outcome.status : outcome.status.toUpperCase();
    env.out(`  ${status.padEnd(STATUS_WIDTH)}${verdict ? outcome.id.padEnd(width) : outcome.id}${verdict}`.trimEnd());
    const indent = ' '.repeat(2 + STATUS_WIDTH);
    for (const line of outcome.details) env.out(`${indent}${line}`);
    for (const line of expect?.mismatches ?? []) env.out(`${indent}expect: ${line}`);
  };

  for (const golden of cases) {
    const file = path.join(env.goldenDir, `${golden.id}${GOLDEN_EXTENSION}`);
    let run: Awaited<ReturnType<typeof runCase>>;
    try {
      run = await runCase(golden);
    } catch (error) {
      const message = error instanceof Error ? `${error.name === 'Error' ? '' : `${error.name}: `}${error.message}` : String(error);
      report({ id: golden.id, status: 'failed', details: [`could not run: ${message}`] });
      continue;
    }
    const text = formatGolden(run.file);
    const expect = checkExpect(golden, run, env.judge);
    // A checkout that turns line endings into CRLF changes no Run.
    const stored = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n') : undefined;
    let status: Status;
    let details: string[] = [];
    if (stored === text) status = 'same';
    else if (stored === undefined) {
      status = accept ? 'written' : 'missing';
      details = accept ? ['a new golden file'] : ['no golden file yet: `pnpm golden --accept` writes it'];
    } else {
      const reference = parseGolden(stored);
      if (!reference.ok) {
        status = accept ? 'accepted' : 'unreadable';
        details = [`its golden file cannot be read, line ${reference.line}: ${reference.message}`];
      } else {
        const diff = diffGolden(reference.file, run.file);
        status = accept ? 'accepted' : 'differs';
        details = diff ? describeDiff(diff) : ["the Run is the same; only the file's layout differs"];
      }
    }
    if (accept && status !== 'same') {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text);
    }
    report({ id: golden.id, status, details, expect });
  }

  if (parsed.positionals.length === 0) {
    const ids = new Set(all.map((each) => each.id));
    for (const id of goldenFiles(env.goldenDir).filter((each) => !ids.has(each))) {
      if (accept) fs.rmSync(path.join(env.goldenDir, `${id}${GOLDEN_EXTENSION}`));
      report({ id, status: accept ? 'removed' : 'stale', details: accept ? ['no case has it any more'] : ['no case has this golden file: `pnpm golden --accept` removes it'] });
    }
  }

  const count = (...statuses: Status[]): number => outcomes.filter((outcome) => statuses.includes(outcome.status)).length;
  const fixtures = outcomes.filter((outcome) => outcome.expect && outcome.expect.shows !== '');
  const broken = fixtures.filter((outcome) => outcome.expect?.holds === false);
  const failed = count('failed');
  const lines: string[] = [];
  if (accept) {
    const written = count('accepted', 'written');
    lines.push(
      `golden --accept: wrote ${plural(written, 'golden file')} (${count('accepted')} changed, ${count('written')} new), removed ${count('removed')}, left ${count('same')} unchanged.`,
    );
  } else {
    const off = outcomes.length - count('same');
    lines.push(
      off === 0
        ? `golden: ${plural(cases.length, 'Run')} ${cases.length === 1 ? 'matches its' : 'match their'} golden ${cases.length === 1 ? 'file' : 'files'}.`
        : `golden: ${plural(off, 'case does', 'cases do')} not match ${off === 1 ? 'its golden file' : 'their golden files'}.`,
    );
    const changed = outcomes.filter((outcome) => ['differs', 'missing', 'unreadable'].includes(outcome.status)).map((outcome) => outcome.id);
    if (changed.length > 0 && changed.length <= NAMED_IN_HINT) {
      lines.push(`  If the change is intended, run \`pnpm golden --accept ${changed.join(' ')}\` and note why for the orchestrator (docs/plan.md Section 8).`);
    } else if (changed.length > 0) {
      lines.push('  If every change is intended, run `pnpm golden --accept`, or name the cases you meant, and note why for the orchestrator (docs/plan.md Section 8).');
    }
    if (count('stale') > 0) lines.push('  `pnpm golden --accept`, with no case named, removes golden files no case has.');
  }
  if (failed > 0) lines.push(`golden: ${plural(failed, 'case')} could not run.`);
  if (fixtures.length > 0) {
    lines.push(
      broken.length === 0
        ? `golden: every content fixture's expect holds (${fixtures.length}).`
        : `golden: the expect of ${plural(broken.length, 'content fixture')} does not hold: ${broken.map((outcome) => outcome.id).join(', ')}. That is a finding for the fixture or the simulation, and --accept never makes it hold.`,
    );
  }
  for (const line of lines) env.out(line);
  const clean = accept ? failed === 0 : outcomes.every((outcome) => outcome.status === 'same');
  return clean && broken.length === 0 ? 0 : 1;
};
