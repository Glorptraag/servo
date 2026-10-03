import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

// Lints virtual files with the repository's real ESLint config, exactly as `pnpm lint` does.
const root = fileURLToPath(new URL('../../../', import.meta.url));
const eslint = new ESLint({ cwd: root, overrideConfigFile: `${root}eslint.config.js` });

const ruleIds = async (filePath: string, code: string): Promise<(string | null)[]> => {
  const [result] = await eslint.lintText(code, { filePath });
  return result?.messages.map((message) => message.ruleId) ?? [];
};

const packages = ['schema', 'content', 'sim-core', 'canvas', 'app', 'parent', 'tools'];

type Case = [name: string, filePath: string, code: string];

beforeAll(async () => {
  await ruleIds('packages/schema/src/warm-up.ts', 'export {};');
}, 60_000);

describe('package map (ground rule 6)', () => {
  it.each(packages)('packages/%s: a relative import of another package is reported', async (pkg) => {
    const other = pkg === 'schema' ? 'content' : 'schema';
    const code = `import * as other from '../../${other}/src/index.ts';\nexport { other };`;
    expect(await ruleIds(`packages/${pkg}/src/probe.ts`, code)).toContain('servo/package-boundaries');
  });

  const bypasses: Case[] = [
    ['an import outside the map', 'packages/canvas/src/probe.ts', "import { store } from '@servo/app';\nexport { store };"],
    ['a type-only import', 'packages/canvas/src/probe.ts', "import type { Engine } from '@servo/sim-core';\nexport type { Engine };"],
    ['the sim-core root from canvas', 'packages/canvas/src/probe.ts', "export * from '@servo/sim-core';"],
    ['a deep path', 'packages/canvas/src/probe.ts', "export * from '@servo/sim-core/src/engine.ts';"],
    ['a deep path into a mapped package', 'packages/app/src/probe.ts', "export * from '@servo/sim-core/src/engine.ts';"],
    ['a relative path from a nested folder', 'packages/canvas/src/a/b/probe.ts', "export * from '../../../../sim-core/src/index.ts';"],
    ['a relative path from a test', 'packages/canvas/test/probe.test.ts', "export * from '../../sim-core/src/index.ts';"],
    ['an absolute path', 'packages/canvas/src/probe.ts', "export * from '/repo/packages/sim-core/src/index.ts';"],
    ['dynamic import()', 'packages/canvas/src/probe.ts', "export const engine = await import('@servo/sim-core');"],
    ['dynamic import() of a deep path', 'packages/canvas/src/probe.ts', "export const solver = await import('@servo/sim-core/src/solver.ts');"],
    ['dynamic import() of a computed name', 'packages/canvas/src/probe.ts', 'export const load = (name: string) => import(`@servo/${name}`);'],
    ['dynamic import() of a variable', 'packages/canvas/src/probe.ts', 'export const load = (name: string) => import(name);'],
    ['dynamic import() of a relative template', 'packages/canvas/src/probe.ts', 'export const load = (name: string) => import(`../../sim-core/src/${name}.ts`);'],
    ['an import() type', 'packages/canvas/src/probe.ts', "export type Engine = import('@servo/sim-core').Engine;"],
    ['require()', 'packages/canvas/src/probe.ts', "export const engine = require('@servo/sim-core');"],
    ['new URL() of another package', 'packages/canvas/src/probe.ts', "export const worker = new URL('../../sim-core/src/worker.ts', import.meta.url);"],
    ['a .tsx file', 'packages/canvas/src/probe.tsx', "export * from '@servo/sim-core';"],
    ['a .mts file', 'packages/canvas/src/probe.mts', "export * from '@servo/sim-core';"],
    ['a .cts file', 'packages/canvas/src/probe.cts', "export * from '@servo/sim-core';"],
    ['a .js file', 'packages/canvas/src/probe.js', "export * from '@servo/sim-core';"],
    ['parent importing app beyond its store', 'packages/parent/src/probe.ts', "export * from '@servo/app';"],
    ['schema importing any Servo package', 'packages/schema/src/probe.ts', "export * from '@servo/content';"],
    ['an eslint-disable comment', 'packages/canvas/src/probe.ts', "// eslint-disable-next-line servo/package-boundaries\nexport * from '@servo/sim-core';"],
    // Re-review findings N1-N3 in docs/reviews/tasks/0.1.md.
    ['a relative path through node_modules', 'packages/canvas/src/probe.ts', "export * from '../node_modules/@servo/sim-core/src/solver.ts';"],
    ['a relative path through node_modules from a test', 'packages/canvas/test/probe.test.ts', "export * from '../node_modules/@servo/sim-core/src/solver.ts';"],
    ['src importing test code', 'packages/canvas/src/probe.ts', "export * from '../test/helpers.ts';"],
    ['sim-core src importing code outside src', 'packages/sim-core/src/probe.ts', "export * from '../lib/clock.ts';"],
    ['src importing code outside src by template', 'packages/sim-core/src/probe.ts', 'export const load = (name: string) => import(`../lib/${name}.ts`);'],
    ['src starting a worker outside src', 'packages/canvas/src/probe.ts', "export const worker = new URL('../workers/solver.ts', import.meta.url);"],
    ['a package.json imports alias', 'packages/canvas/src/probe.ts', "export * from '#engine';"],
    ['import.meta.glob of another package', 'packages/canvas/src/probe.ts', "export const modules = import.meta.glob('../../sim-core/src/*.ts');"],
    ['import.meta.glob of code outside src', 'packages/canvas/src/probe.ts', "export const modules = import.meta.glob('../test/*.ts');"],
    // Review R-1.3 finding 2: the behaviour runtime is for packages/tools only, though app's map allows every sim-core entry.
    ['the behaviour runtime from app', 'packages/app/src/probe.ts', "export * from '@servo/sim-core/behaviour';"],
    ['a behaviour type from app', 'packages/app/src/probe.ts', "import type { BehaviourModel } from '@servo/sim-core/behaviour';\nexport type { BehaviourModel };"],
    ['a behaviour import() type from app', 'packages/app/src/probe.ts', "export type Model = import('@servo/sim-core/behaviour').BehaviourModel;"],
    ['dynamic import() of the behaviour runtime from app', 'packages/app/src/probe.ts', "export const runtime = await import('@servo/sim-core/behaviour');"],
    ['the behaviour runtime from canvas', 'packages/canvas/src/probe.ts', "export * from '@servo/sim-core/behaviour';"],
    ['the behaviour runtime from parent', 'packages/parent/src/probe.ts', "export * from '@servo/sim-core/behaviour';"],
    // Task 3.4: the canvas's testing entry is for the e2e harness, though app's map allows every canvas entry.
    ['the canvas testing entry from app', 'packages/app/src/probe.ts', "export * from '@servo/canvas/testing';"],
  ];

  it.each(bypasses)('reports %s', async (_name, filePath, code) => {
    expect(await ruleIds(filePath, code)).toContain('servo/package-boundaries');
  });

  it('names the behaviour runtime as tools-only, not as an export app lacks', async () => {
    const [result] = await eslint.lintText("export * from '@servo/sim-core/behaviour';", { filePath: 'packages/app/src/probe.ts' });
    expect(result?.messages.map((message) => message.message)).toEqual([
      "'@servo/sim-core/behaviour' is for packages/tools only. Run a simulation through createSimulation from @servo/sim-core.",
    ]);
  });

  const allowed: Case[] = [
    ['canvas importing the sim-core interface', 'packages/canvas/src/probe.ts', "export * from '@servo/sim-core/interface';"],
    ['canvas importing schema', 'packages/canvas/src/probe.ts', "export * from '@servo/schema';"],
    ['a relative import inside the package', 'packages/canvas/src/a/probe.ts', "export * from '../index.ts';"],
    ['a relative template inside the package', 'packages/canvas/src/probe.ts', 'export const load = (name: string) => import(`./art/${name}.ts`);'],
    ['app importing the sim-core entry and interface', 'packages/app/src/probe.ts', "export * from '@servo/sim-core';\nexport * from '@servo/sim-core/interface';"],
    ['tools importing the behaviour runtime', 'packages/tools/src/probe.ts', "export * from '@servo/sim-core/behaviour';"],
    ['tools importing the canvas testing entry', 'packages/tools/src/probe.ts', "export * from '@servo/canvas/testing';"],
    ['a test importing the behaviour runtime', 'packages/app/test/probe.test.ts', "export * from '@servo/sim-core/behaviour';"],
    ['parent importing the app store', 'packages/parent/src/probe.ts', "export * from '@servo/app/store';"],
    ['tools importing parent', 'packages/tools/src/probe.ts', "export * from '@servo/parent';"],
    ['a test using another package', 'packages/sim-core/test/probe.test.ts', "export * from '@servo/content';"],
    ['a URL to files that are not code', 'packages/tools/src/probe.ts', "export const fixtures = new URL('../../content/fixtures/', import.meta.url);"],
    ['src importing data outside src', 'packages/content/src/probe.ts', "import parts from '../records/parts.json' with { type: 'json' };\nexport { parts };"],
    ['a test importing code outside src', 'packages/canvas/test/probe.test.ts', "export * from '../lib/helpers.ts';"],
    ['import.meta.glob inside src', 'packages/canvas/src/probe.ts', "export const art = import.meta.glob(['./art/*.ts', '!./art/draft.ts']);"],
  ];

  it.each(allowed)('allows %s', async (_name, filePath, code) => {
    expect(await ruleIds(filePath, code)).toEqual([]);
  });
});

describe('relative imports name the TypeScript file', () => {
  it.each(packages)('packages/%s: a .js specifier is reported', async (pkg) => {
    expect(await ruleIds(`packages/${pkg}/src/probe.ts`, "export * from './part.js';")).toContain('servo/import-extensions');
  });

  it.each(['./part.mjs', './part.cjs', './part.jsx', './part', '../src/', './part.js?url'])('reports %s', async (specifier) => {
    expect(await ruleIds('packages/schema/src/probe.ts', `export * from '${specifier}';`)).toContain('servo/import-extensions');
  });

  it('reports .js in tests and in import()', async () => {
    expect(await ruleIds('packages/schema/test/probe.test.ts', "export * from '../src/index.js';")).toContain('servo/import-extensions');
    expect(await ruleIds('packages/schema/src/probe.ts', "export const part = await import('./part.js');")).toContain(
      'servo/import-extensions',
    );
  });

  it.each(['./part.ts', './part.tsx', './parts.json'])('allows %s', async (specifier) => {
    expect(await ruleIds('packages/schema/src/probe.ts', `export * from '${specifier}';`)).toEqual([]);
  });
});

describe('sim-core purity (ground rule 2)', () => {
  const restricted = expect.arrayContaining([expect.stringMatching(/^no-restricted-(globals|properties)$/)]);

  it.each([
    'Date.now()',
    'new Date()',
    'performance.now()',
    'Math.random()',
    'crypto.randomUUID()',
    'crypto.getRandomValues(new Uint8Array(4))',
    'Temporal.Now.instant()',
    'globalThis.Date.now()',
    'globalThis.Math.random()',
    'self.performance.now()',
    'global.Date',
    'setTimeout(() => undefined, 1)',
    'queueMicrotask(() => undefined)',
    'new WeakRef({})',
    'document.title',
  ])('reports %s', async (expression) => {
    expect(await ruleIds('packages/sim-core/src/probe.ts', `export const value = ${expression};`)).toEqual(restricted);
  });

  it('reports Math.random taken by destructuring', async () => {
    expect(await ruleIds('packages/sim-core/src/probe.ts', 'const { random } = Math;\nexport const value = random();')).toEqual(restricted);
  });

  it.each(['probe.tsx', 'probe.mts', 'probe.cts', 'probe.js', 'solvers/probe.ts'])('covers src/%s', async (file) => {
    expect(await ruleIds(`packages/sim-core/src/${file}`, 'export const value = crypto.randomUUID();')).toEqual(restricted);
  });

  it('allows exact arithmetic and a local named self', async () => {
    const code = 'export const value = (self: number) => Math.floor(Math.sqrt(self) * 10);';
    expect(await ruleIds('packages/sim-core/src/probe.ts', code)).toEqual([]);
  });

  it.each(['schema', 'content'])('keeps UI globals out of packages/%s', async (pkg) => {
    expect(await ruleIds(`packages/${pkg}/src/probe.ts`, 'export const value = window.innerWidth;')).toEqual(restricted);
  });
});
