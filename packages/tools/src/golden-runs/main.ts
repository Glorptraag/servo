// The entry point of `pnpm golden` (root package.json); Node 24+ runs it without a build. Content is read from disk,
// because content's own loaders need Vite.
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { contentCase, readContentFixtures, schemaCases } from './cases.ts';
import { runGolden } from './cli.ts';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));

process.exitCode = await runGolden(process.argv.slice(2), {
  // pnpm runs root scripts from the repository root and sets INIT_CWD to the folder the command was typed in.
  cwd: process.env.INIT_CWD ?? process.cwd(),
  goldenDir: path.join(repoRoot, 'packages', 'sim-core', 'golden'),
  cases: () => {
    const { content, fixtures, issues } = readContentFixtures(path.join(repoRoot, 'packages', 'content'));
    return { cases: [...fixtures.map((fixture) => contentCase(fixture, content.catalogue)), ...schemaCases()], issues };
  },
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
});
