// The entry point of `pnpm golden` (root package.json); Node 24+ runs it without a build. Content is read from disk,
// because content's own loaders need Vite.
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { goalJudgeFor } from '@servo/app/goal';
import { contentCase, readContentFixtures, schemaCases } from './cases.ts';
import { runGolden } from './cli.ts';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
// Content is read once, when the cases or the judge first need it.
let read: ReturnType<typeof readContentFixtures> | undefined;
const onDisk = (): ReturnType<typeof readContentFixtures> => (read ??= readContentFixtures(path.join(repoRoot, 'packages', 'content')));

process.exitCode = await runGolden(process.argv.slice(2), {
  // pnpm runs root scripts from the repository root and sets INIT_CWD to the folder the command was typed in.
  cwd: process.env.INIT_CWD ?? process.cwd(),
  goldenDir: path.join(repoRoot, 'packages', 'sim-core', 'golden'),
  cases: () => {
    const { content, fixtures, issues } = onDisk();
    return { cases: [...fixtures.map((fixture) => contentCase(fixture, content.catalogue)), ...schemaCases()], issues };
  },
  // The challenge runner's verdict (task 4.5), for fixtures that expect a goal.
  judge: (record, challenge) => goalJudgeFor(onDisk().content)(record, challenge),
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
});
