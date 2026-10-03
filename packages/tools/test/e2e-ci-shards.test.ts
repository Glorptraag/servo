// CI's e2e shards (.github/workflows/ci.yml) name their files by hand: every browser test file must be in exactly one
// shard, or in the perf job, or a file added later would never run in CI (review R-3.8, finding R3). The perf job runs
// `pnpm perf`, which runs the harness's `performance` project: its one file is PERFORMANCE_FILE.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PERFORMANCE_FILE } from '../src/e2e/profile.ts';

const CI = fileURLToPath(new URL('../../../.github/workflows/ci.yml', import.meta.url));
const E2E = fileURLToPath(new URL('./e2e/', import.meta.url));
const ROOT_PACKAGE = fileURLToPath(new URL('../../../package.json', import.meta.url));
const TOOLS_PACKAGE = fileURLToPath(new URL('../package.json', import.meta.url));

const scripts = (file: string): Record<string, string> => (JSON.parse(fs.readFileSync(file, 'utf8')) as { scripts: Record<string, string> }).scripts;

describe('the e2e shards in CI', () => {
  it('run every browser test file once, in a shard or the perf job', () => {
    const ci = fs.readFileSync(CI, 'utf8');
    const named = [...ci.matchAll(/^\s+files: (.+)$/gm)].flatMap((match) => (match[1] as string).trim().split(/\s+/));
    const onDisk = fs
      .readdirSync(E2E)
      .filter((name) => name.endsWith('.e2e.ts'))
      .map((name) => `test/e2e/${name}`);
    const run = [...named, PERFORMANCE_FILE];
    expect(run.length, 'a file named in two shards, or in a shard and the perf job').toBe(new Set(run).size);
    expect([...run].sort()).toEqual(onDisk.sort());
  });

  it('runs the timing file in the perf job only', () => {
    expect(fs.readFileSync(CI, 'utf8'), 'the perf job').toMatch(/^\s+- run: pnpm perf$/m);
    expect(scripts(ROOT_PACKAGE).perf).toContain('run perf');
    expect(scripts(TOOLS_PACKAGE).perf).toContain('--config src/e2e/vitest.config.ts --project performance');
    expect(scripts(TOOLS_PACKAGE).e2e).toContain('--project e2e');
  });
});
