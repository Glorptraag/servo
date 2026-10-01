// `pnpm release:dry`, and the release workflow (.github/workflows/release.yml) with --tag; Node 24+ runs it without a
// build. pnpm runs root scripts from the repository root and sets INIT_CWD to the folder the command was typed in, so
// --out resolves from there.
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { appBuildStep, gitStep, runRelease } from './cli.ts';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));

process.exitCode = runRelease(process.argv.slice(2), {
  cwd: process.env.INIT_CWD ?? process.cwd(),
  repoRoot,
  env: process.env,
  steps: { buildApp: appBuildStep(repoRoot), git: gitStep(repoRoot) },
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
});
