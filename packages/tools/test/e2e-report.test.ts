// The parity report (src/e2e/report.ts): one line per fixture, sorted, with a summary, as one run prints it and as the
// CI step merges the shards' reports (src/e2e/merge-report.ts, run here with plain Node as CI runs it).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { PARITY_HEADING, readLine, reportText } from '../src/e2e/report.ts';

const MERGE = fileURLToPath(new URL('../src/e2e/merge-report.ts', import.meta.url));

const lines = {
  rolling: 'kit-rolling-start: partial: identical on commands and touch drag (8 placements); pending: needs task 3.3 (5 wires)',
  crew: 'kit-circuit-crew: identical on commands and touch drag (12 placements and 12 wires)',
  short: 'broken-short-circuit: MISMATCH: touch drag: p3 position (1, 0) here, (0, 0) in commands',
  geared: 'geared-robot: pending: needs task 3.2 (10 placements)',
};

const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0)) fs.rmSync(folder, { recursive: true, force: true });
});

describe('the parity report', () => {
  it('reads each line’s fixture and verdict', () => {
    expect(readLine(lines.rolling)).toEqual({ fixture: 'kit-rolling-start', verdict: 'partial' });
    expect(readLine(lines.crew)).toEqual({ fixture: 'kit-circuit-crew', verdict: 'identical' });
    expect(readLine(lines.short)).toEqual({ fixture: 'broken-short-circuit', verdict: 'mismatch' });
    expect(readLine(lines.geared)).toEqual({ fixture: 'geared-robot', verdict: 'pending' });
    expect(readLine('not a report line')).toBeUndefined();
  });

  it('sorts the lines by fixture, keeps one line a fixture, and sums them up', () => {
    expect(reportText([lines.rolling, lines.crew, lines.short, lines.geared, lines.crew])).toEqual([
      PARITY_HEADING,
      `  ${lines.short}`,
      `  ${lines.geared}`,
      `  ${lines.crew}`,
      `  ${lines.rolling}`,
      '  4 fixtures: 1 identical, 1 partial, 1 mismatched, 1 pending',
    ]);
  });

  it('merges the shards’ reports into one, with plain Node', () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'servo-e2e-report-'));
    folders.push(folder);
    for (const [shard, shardLines] of [
      ['e2e-report-parity-1', [lines.rolling, lines.short]],
      ['e2e-report-parity-2', [lines.crew]],
      ['e2e-report-parity-3', [lines.geared]],
    ] as const) {
      fs.mkdirSync(path.join(folder, shard));
      fs.writeFileSync(path.join(folder, shard, 'parity.json'), JSON.stringify({ lines: shardLines }));
    }
    const run = spawnSync(process.execPath, [MERGE, folder], { encoding: 'utf8' });
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout.trimEnd().split('\n')).toEqual(reportText([lines.rolling, lines.short, lines.crew, lines.geared]));
  });

  it('fails when the shards left no report', () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'servo-e2e-report-'));
    folders.push(folder);
    const run = spawnSync(process.execPath, [MERGE, folder], { encoding: 'utf8' });
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/No parity report lines/);
  });
});
