// The entry point of `pnpm golden` (root package.json); Node 24+ runs it without a build. Content is read from disk,
// because content's own loaders need Vite.
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { goalJudgeFor } from '@servo/app/goal';
import { contentCase, readContentFixtures, schemaCases } from './cases.ts';
import { runGolden } from './cli.ts';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const onDisk = readContentFixtures(path.join(repoRoot, 'packages', 'content'));

process.exitCode = await runGolden(process.argv.slice(2), {
  // pnpm runs root scripts from the repository root and sets INIT_CWD to the folder the command was typed in.
  cwd: process.env.INIT_CWD ?? process.cwd(),
  goldenDir: path.join(repoRoot, 'packages', 'sim-core', 'golden'),
  cases: () => ({ cases: [...onDisk.fixtures.map((fixture) => contentCase(fixture, onDisk.content.catalogue)), ...schemaCases()], issues: onDisk.issues }),
  // The challenge runner's verdict (task 4.5), for fixtures that expect a goal.
  judge: goalJudgeFor(onDisk.content),
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
});
