import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

// Which @servo packages each package's shipped code may import: the package map in CLAUDE.md.
// Tests are exempt so they can use fixtures from other packages. tools is dev-only and unrestricted.
const allowedImports = {
  schema: [],
  content: ['schema'],
  'sim-core': ['schema'],
  canvas: ['schema', 'sim-core/interface'],
  app: ['schema', 'content', 'sim-core', 'canvas'],
  parent: ['schema', 'app'],
};

const packageBoundaries = Object.entries(allowedImports).map(([pkg, allowed]) => ({
  files: [`packages/${pkg}/src/**/*.ts`],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            regex: allowed.length === 0 ? '^@servo/' : `^@servo/(?!(?:${allowed.join('|')})(?:/|$))`,
            message: `packages/${pkg} may import ${
              allowed.length === 0 ? 'no other Servo package' : allowed.map((name) => `@servo/${name}`).join(', ')
            } (CLAUDE.md package map).`,
          },
        ],
      },
    ],
  },
}));

const restrictGlobals = (names, message) => ['error', ...names.map((name) => ({ name, message }))];

const uiAndIo = [
  'window',
  'document',
  'navigator',
  'location',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'fetch',
  'XMLHttpRequest',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'setTimeout',
  'setInterval',
  'clearTimeout',
  'clearInterval',
  'process',
  'Buffer',
];

export default defineConfig(
  globalIgnores(['**/node_modules/', '**/dist/', '**/coverage/', '.claude/']),
  js.configs.recommended,
  tseslint.configs.recommended,
  packageBoundaries,
  {
    files: ['packages/{schema,content}/src/**/*.ts'],
    rules: {
      'no-restricted-globals': restrictGlobals(uiAndIo, 'schema and content know nothing about the UI, timers or I/O.'),
    },
  },
  {
    files: ['packages/sim-core/src/**/*.ts'],
    rules: {
      'no-restricted-globals': restrictGlobals(
        [...uiAndIo, 'Date', 'performance'],
        'sim-core is pure and deterministic (ground rule 2): no UI, timers, I/O or wall clock.',
      ),
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'sim-core takes randomness only from the run seed (ground rule 2).' },
      ],
    },
  },
);
