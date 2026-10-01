import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import type { ContentIssue } from './codes.ts';
import { findRecordFiles } from './records.ts';
import { validateContent } from './validate.ts';
import type { ContentReport } from './validate.ts';

/** What the command reads from the world, so tests can run it without a process. */
export interface ValidateContentEnvironment {
  /** The folder the command was typed in. Paths on the command line are relative to it, and so are paths in the output. */
  readonly cwd: string;
  readonly repoRoot: string;
  /** The content package: the default catalogue, with the default terminology folder inside it. */
  readonly contentDir: string;
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

export const USAGE = [
  'Usage: pnpm validate-content <path>... [--catalogue <folder>] [--terminology <folder>]',
  '',
  'Checks content records (part records, arena presets, kits, challenges, blueprints) against the',
  'schema and the terminology lists. A path is a record file, or a folder searched for .json records.',
  '',
  '  --catalogue <folder>    The parts, arenas and kits that kits, challenges and blueprints are checked',
  '                          against. Default: packages/content, or the schema fixtures while it has no parts.',
  '  --terminology <folder>  The folder holding components.json and banned.json.',
  '                          Default: packages/content/terminology. A missing file is an empty list.',
  '  -h, --help              Show this help.',
  '',
  'Exit status: 0 when every record passes, 1 when there are issues, 2 when the command is misused.',
].join('\n');

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? '' : 's'}`;

/** What the walk leaves out (records.ts), said when a folder holds no records. */
const NOT_RECORDS =
  'Terminology and art folders, node_modules, hidden folders, package.json, tsconfig files and symbolic links are not records.';

/** One line per issue: file, code, JSON path and message. */
export const formatIssue = (issue: ContentIssue, show: (file: string) => string): string =>
  `${show(issue.file)}: ${issue.code} at ${issue.path}: ${issue.message}`;

export const formatSummary = (report: ContentReport): string => {
  const records = plural(report.files.length, 'record');
  if (report.issues.length === 0) return `validate-content: ${records} checked, no issues.`;
  const files = new Set(report.issues.map((issue) => issue.file)).size;
  return `validate-content: ${records} checked, ${plural(report.issues.length, 'issue')} in ${plural(files, 'file')}.`;
};

const parse = (argv: readonly string[]) =>
  parseArgs({
    args: [...argv],
    allowPositionals: true,
    strict: true,
    options: {
      catalogue: { type: 'string' },
      terminology: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });

const isFolder = (target: string): boolean => fs.existsSync(target) && fs.statSync(target).isDirectory();

/**
 * `pnpm validate-content <path>...`: prints one line per issue, then any notes, then a summary line.
 * Returns the exit status: 0 when every record passes, 1 when there are issues, 2 on misuse.
 */
export const runValidateContent = (argv: readonly string[], env: ValidateContentEnvironment): number => {
  const misuse = (message: string, withUsage = false): number => {
    env.err(`validate-content: ${message}`);
    if (withUsage) env.err(`\n${USAGE}`);
    return 2;
  };
  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(argv);
  } catch (error) {
    return misuse(error instanceof Error ? error.message : String(error), true);
  }
  if (parsed.values.help) {
    env.out(USAGE);
    return 0;
  }
  if (parsed.positionals.length === 0) return misuse('Name a record file, or a folder of records, to check.', true);

  const show = (file: string): string => {
    const relative = path.relative(env.cwd, file);
    const outside = relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
    return outside ? file : relative || '.';
  };
  const resolve = (target: string): string => path.resolve(env.cwd, target);
  const paths = parsed.positionals.map(resolve);
  for (const target of paths) {
    if (!fs.existsSync(target)) return misuse(`No such file or folder: ${show(target)}`);
    // A folder that cannot be listed is no misuse: the run reports it as file.unreadable, with its cause.
    const unlisted: string[] = [];
    if (findRecordFiles(target, (folder) => unlisted.push(folder)).length === 0 && unlisted.length === 0) {
      return misuse(`No .json records in ${show(target)}. ${NOT_RECORDS}`);
    }
  }
  const { catalogue, terminology } = parsed.values;
  if (catalogue !== undefined && !isFolder(resolve(catalogue))) return misuse(`--catalogue is not a folder: ${catalogue}`);
  if (terminology !== undefined && !isFolder(resolve(terminology))) return misuse(`--terminology is not a folder: ${terminology}`);

  const report = validateContent({
    paths,
    repoRoot: env.repoRoot,
    terminology: terminology === undefined ? path.join(env.contentDir, 'terminology') : resolve(terminology),
    catalogue:
      catalogue === undefined
        ? { folder: env.contentDir, fallBackToFixtures: true }
        : { folder: resolve(catalogue), fallBackToFixtures: false },
    show,
  });
  for (const issue of report.issues) env.out(formatIssue(issue, show));
  for (const note of report.notes) env.out(`note: ${note}`);
  env.out(formatSummary(report));
  return report.issues.length === 0 ? 0 : 1;
};
