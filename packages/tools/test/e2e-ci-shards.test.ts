// CI's e2e shards (.github/workflows/ci.yml) name their files by hand: every browser test file must be in exactly one
// shard, or a file added later would never run in CI (review R-3.8, finding R3).
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const CI = fileURLToPath(new URL('../../../.github/workflows/ci.yml', import.meta.url));
const E2E = fileURLToPath(new URL('./e2e/', import.meta.url));

describe('the e2e shards in CI', () => {
  it('run every browser test file once', () => {
    const named = [...fs.readFileSync(CI, 'utf8').matchAll(/^\s+files: (.+)$/gm)].flatMap((match) => (match[1] as string).trim().split(/\s+/));
    const onDisk = fs
      .readdirSync(E2E)
      .filter((name) => name.endsWith('.e2e.ts'))
      .map((name) => `test/e2e/${name}`);
    expect(named.length, 'a file named in two shards').toBe(new Set(named).size);
    expect([...named].sort()).toEqual(onDisk.sort());
  });
});
