import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

const repoRoot = path.dirname(fileURLToPath(import.meta.url));
const typeScriptFiles = '*.{ts,tsx,mts,cts}';
const codeFiles = '*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}';

// The package map in CLAUDE.md: which Servo packages each package's src/ may import.
// A bare name allows every entry in that package's exports; a subpath allows that one entry.
const packageMap = {
  schema: [],
  content: ['schema'],
  'sim-core': ['schema'],
  canvas: ['schema', 'sim-core/interface'],
  app: ['schema', 'content', 'sim-core', 'canvas'],
  parent: ['schema', 'app/store'],
  tools: ['schema', 'content', 'sim-core', 'canvas', 'app', 'parent'],
};

const exportedEntries = (name) => {
  const { exports = '.' } = JSON.parse(fs.readFileSync(path.join(repoRoot, 'packages', name, 'package.json'), 'utf8'));
  const subpaths =
    exports && typeof exports === 'object' && Object.keys(exports).every((key) => key.startsWith('.'))
      ? Object.keys(exports)
      : ['.'];
  return subpaths.map((subpath) => `@servo/${name}${subpath.slice(1)}`);
};

const escapeRegExp = (text) => text.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
const toMatcher = (entry) => new RegExp(`^${escapeRegExp(entry).replaceAll('*', '.*')}$`);
const entriesOf = (names) =>
  names.flatMap((name) => (name.includes('/') ? [`@servo/${name}`] : exportedEntries(name))).map(toMatcher);
const allowedInSource = Object.fromEntries(Object.entries(packageMap).map(([pkg, names]) => [pkg, entriesOf(names)]));
const allowedElsewhere = entriesOf(Object.keys(packageMap));

// packages/<pkg>/<area>/...; only src/ is shipped, and its relative imports of code stay in src/.
// Tests and config files may use any package's exports.
const locate = (filename) => {
  const [top, pkg, area] = path.relative(repoRoot, filename).split(path.sep);
  if (top !== 'packages' || !pkg || !area) return undefined;
  const root = path.join(repoRoot, 'packages', pkg);
  return { pkg, root, source: path.join(root, 'src'), shipped: area === 'src' };
};

const isRelative = (value) => value.startsWith('./') || value.startsWith('../');
const isPathLike = (value) => value === '.' || value === '..' || isRelative(value);
const isInside = (target, directory) => target === directory || target.startsWith(directory + path.sep);

// A module specifier as { head, tail, exact }. A template literal keeps its static start and end.
const specifierOf = (node) => {
  if (node?.type === 'Literal' && typeof node.value === 'string') return { head: node.value, tail: node.value, exact: true };
  if (node?.type === 'TemplateLiteral') {
    return {
      head: node.quasis[0].value.cooked ?? '',
      tail: node.quasis.at(-1).value.cooked ?? '',
      exact: node.expressions.length === 0,
    };
  }
  return undefined;
};

const withoutQuery = (value) => value.replace(/[?#].*$/, '');
const codeExtensions = new Set(['ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs', 'wasm']);
const extensionOf = (reference) => /\.([a-z0-9]+)$/i.exec(withoutQuery(reference.tail))?.[1]?.toLowerCase();
const namesCode = (reference) => codeExtensions.has(extensionOf(reference));
const namesData = (reference) => extensionOf(reference) !== undefined && !namesCode(reference);

const isImportMetaMember = (node, name) =>
  node?.type === 'MemberExpression' &&
  node.object.type === 'MetaProperty' &&
  node.object.meta.name === 'import' &&
  node.property.name === name;

// Visits every way a file can load another module: import, export-from, import(), import types,
// import = require, require(), and (for package boundaries) the bundler forms: new URL() of a code
// file, as workers use, and import.meta.glob patterns, checked by their part before the first wildcard.
const moduleReferences = (visit, { bundler }) => ({
  ImportDeclaration: (node) => visit(node.source, specifierOf(node.source)),
  ExportAllDeclaration: (node) => visit(node.source, specifierOf(node.source)),
  ExportNamedDeclaration: (node) => node.source && visit(node.source, specifierOf(node.source)),
  ImportExpression: (node) => visit(node.source, specifierOf(node.source)),
  TSImportType: (node) => {
    const source = node.source ?? node.argument?.literal;
    visit(source ?? node, specifierOf(source));
  },
  TSExternalModuleReference: (node) => visit(node.expression, specifierOf(node.expression)),
  CallExpression: (node) => {
    if (node.callee.type === 'Identifier' && node.callee.name === 'require') {
      visit(node.arguments[0] ?? node, specifierOf(node.arguments[0]));
    }
    if (bundler && isImportMetaMember(node.callee, 'glob')) {
      const [patterns] = node.arguments;
      for (const pattern of patterns?.type === 'ArrayExpression' ? patterns.elements : [patterns]) {
        const reference = specifierOf(pattern);
        if (reference?.head.startsWith('!')) continue;
        visit(pattern ?? node, reference && { ...reference, head: reference.head.split(/[*?{[]/)[0], exact: false });
      }
    }
  },
  NewExpression: (node) => {
    const reference = specifierOf(node.arguments[0]);
    const isUrl = node.callee.type === 'Identifier' && node.callee.name === 'URL' && isImportMetaMember(node.arguments[1], 'url');
    if (bundler && isUrl && reference && namesCode(reference)) {
      visit(node.arguments[0], reference);
    }
  },
});

const packageBoundaries = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      dynamic: 'Module specifiers must be string literals, or templates starting with ./ or ../, so the package map can be checked.',
      absolute: "'{{specifier}}' is an absolute path. Import other packages by name.",
      alias: "'{{specifier}}' is a package.json imports alias. Import inside the package by relative path, and other packages by name.",
      leavesPackage: "'{{specifier}}' reaches outside packages/{{pkg}}. Import other packages by name.",
      leavesSource: "'{{specifier}}' reaches code outside packages/{{pkg}}/src. From src/, relative imports of code stay inside src/.",
      outsideMap: "'{{specifier}}' is outside the package map: packages/{{pkg}}/src may import {{allowed}} (CLAUDE.md).",
      notExported: "'{{specifier}}' is not an entry its package exports.",
      unknownPackage: "'{{specifier}}' is not a Servo package.",
    },
  },
  create(context) {
    const where = locate(context.filename);
    if (!where) return {};
    const allowed = where.shipped ? (allowedInSource[where.pkg] ?? []) : allowedElsewhere;
    const listed = where.shipped ? (packageMap[where.pkg] ?? []) : Object.keys(packageMap);
    return moduleReferences(
      (node, reference) => {
        const report = (messageId) =>
          context.report({
            node,
            messageId,
            data: {
              specifier: reference?.head,
              pkg: where.pkg,
              allowed: listed.map((name) => `@servo/${name}`).join(', ') || 'no other Servo package',
            },
          });
        if (!reference) return report('dynamic');
        const { head, exact } = reference;
        if (head.startsWith('#')) return report('alias');
        if (path.isAbsolute(head) || head.startsWith('file:')) return report('absolute');
        if (!exact && !isRelative(head)) return report('dynamic');
        if (isPathLike(head)) {
          const target = path.resolve(path.dirname(context.filename), exact ? head : head.slice(0, head.lastIndexOf('/') + 1));
          if (head.split('/').includes('node_modules') || !isInside(target, where.root)) return report('leavesPackage');
          if (where.shipped && !namesData(reference) && !isInside(target, where.source)) report('leavesSource');
          return;
        }
        if (!head.startsWith('@servo/') || allowed.some((entry) => entry.test(head))) return;
        const name = head.split('/')[1];
        if (!Object.hasOwn(packageMap, name)) return report('unknownPackage');
        report(listed.includes(name) ? 'notExported' : 'outsideMap');
      },
      { bundler: true },
    );
  },
};

const importExtensions = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      missing: "'{{specifier}}' needs the file extension, for example './part.ts'.",
      javascript: "'{{specifier}}' names a JavaScript file. Name the TypeScript source ('.ts'), which Node runs directly.",
    },
  },
  create(context) {
    if (!locate(context.filename)) return {};
    return moduleReferences(
      (node, reference) => {
        if (!reference || !isPathLike(reference.head)) return;
        const extension = extensionOf(reference);
        const data = { specifier: reference.head };
        if (!extension) context.report({ node, messageId: 'missing', data });
        else if (['js', 'jsx', 'mjs', 'cjs'].includes(extension)) context.report({ node, messageId: 'javascript', data });
      },
      { bundler: false },
    );
  },
};

const servo = {
  meta: { name: 'servo' },
  rules: { 'package-boundaries': packageBoundaries, 'import-extensions': importExtensions },
};

const restrictGlobals = (names, message) => ['error', ...names.map((name) => ({ name, message }))];

const uiTimersAndIo = [
  'window',
  'self',
  'globalThis',
  'global',
  'document',
  'navigator',
  'location',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'caches',
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'Worker',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'requestIdleCallback',
  'cancelIdleCallback',
  'setTimeout',
  'setInterval',
  'setImmediate',
  'clearTimeout',
  'clearInterval',
  'clearImmediate',
  'queueMicrotask',
  'process',
  'Buffer',
];

const clocksChanceAndGc = ['Date', 'performance', 'Temporal', 'crypto', 'WeakRef', 'FinalizationRegistry'];

export default defineConfig(
  globalIgnores(['**/node_modules/', '**/dist/', '**/coverage/', '.claude/']),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: [`packages/**/${codeFiles}`],
    plugins: { servo },
    linterOptions: { noInlineConfig: true },
    rules: { 'servo/package-boundaries': 'error' },
  },
  {
    files: [`packages/**/${typeScriptFiles}`],
    plugins: { servo },
    rules: { 'servo/import-extensions': 'error' },
  },
  {
    files: [`packages/{schema,content}/src/**/${codeFiles}`],
    rules: {
      'no-restricted-globals': restrictGlobals(uiTimersAndIo, 'schema and content know nothing about the UI, timers or I/O.'),
    },
  },
  {
    files: [`packages/sim-core/src/**/${codeFiles}`],
    rules: {
      'no-restricted-globals': restrictGlobals(
        [...uiTimersAndIo, ...clocksChanceAndGc],
        'sim-core is pure and deterministic (ground rule 2): no UI, timers, I/O, clocks, randomness or GC timing.',
      ),
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'sim-core takes randomness only from the run seed (ground rule 2).' },
      ],
    },
  },
);
