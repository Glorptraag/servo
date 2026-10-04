// What keeps cold start fast (task 6.1, docs/perf.md), in Node: no file of the app imports sim-core's code at load, so
// the bundle keeps sim-core and the physics engine's WebAssembly in a chunk of their own that the first Run loads (D11);
// that loader gives sim-core's createSimulation; and the interactive mark the measurement reads is set once per page.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createSimulation } from '@servo/sim-core';
import { INTERACTIVE_MARK, markInteractive } from '../../src/perf/marks.ts';
import { loadCreateSimulation } from '../../src/run-bar/run-loop.ts';

const source = fileURLToPath(new URL('../../src', import.meta.url));

const codeFiles = (folder: string): string[] =>
  fs
    .readdirSync(folder, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
    .map((entry) => path.join(entry.parentPath, entry.name));

describe('cold start', () => {
  afterEach(() => performance.clearMarks(INTERACTIVE_MARK));

  it('imports sim-core only as types at load, and its code only through the first Run', () => {
    const loading = codeFiles(source).flatMap((file) => {
      const text = fs.readFileSync(file, 'utf8');
      // Every static import or re-export from sim-core, but those of types only.
      const statics = [...text.matchAll(/^(?:import|export)\s+(?!type\b)[^;]*?from\s+'@servo\/sim-core[^']*';/gms)];
      return statics.map((match) => `${path.relative(source, file)}: ${match[0]}`);
    });
    expect(loading).toEqual([]);
    const dynamic = codeFiles(source).filter((file) => fs.readFileSync(file, 'utf8').includes("import('@servo/sim-core')"));
    expect(dynamic.map((file) => path.relative(source, file))).toEqual([path.join('run-bar', 'run-loop.ts')]);
  });

  it('loads sim-core’s createSimulation at the first Run', async () => {
    await expect(loadCreateSimulation()).resolves.toBe(createSimulation);
  });

  it('marks the app interactive once per page', () => {
    markInteractive();
    const first = performance.getEntriesByName(INTERACTIVE_MARK);
    markInteractive();
    expect(first).toHaveLength(1);
    expect(performance.getEntriesByName(INTERACTIVE_MARK)).toEqual(first);
  });
});
