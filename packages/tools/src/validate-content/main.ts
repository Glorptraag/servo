// The entry point of `pnpm validate-content` (root package.json); Node 24+ runs it without a build.
// pnpm runs root scripts from the repository root and sets INIT_CWD to the folder the command was typed in,
// so paths on the command line resolve from there.
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { runValidateContent } from './cli.ts';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));

process.exitCode = runValidateContent(process.argv.slice(2), {
  cwd: process.env.INIT_CWD ?? process.cwd(),
  repoRoot,
  contentDir: path.join(repoRoot, 'packages', 'content'),
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
});
