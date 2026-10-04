// Task 6.2's done-when: every event Servo emits is listed in the data note, and nothing else is emitted. This test
// enumerates every emitter in the source of every package: every mention of the one emitter, `emitTelemetry`, outside
// comments must be a plain import or export of it or a direct call naming its kind (generic and optional calls
// included), so an alias, a namespace import or passing it around fails here (R-6.2 F1). It holds the calls to the
// registry, the registry to docs/data-note.md kind by kind and field by field (through note-words.ts, which pairs each
// code name with the plain words the note uses for it), and the parent view's copy to that file word for word. It fails on any reach of the telemetry table but the emitter's own and the profile removals' deletes,
// and proves no code the emitter runs can reach the network, nor can its sink be swapped (R-6.2 F2).
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as emitModule from '../../src/telemetry/emit.ts';
import { TELEMETRY_EVENTS, TELEMETRY_KINDS } from '../../src/telemetry/events.ts';
import type { TelemetryKind } from '../../src/telemetry/events.ts';
import { DATA_NOTE, noteBlocks } from '../../src/telemetry/note.ts';
import { NOTE_WORDS } from './note-words.ts';

const root = fileURLToPath(new URL('../../../../', import.meta.url));

/** Every source file of every package, as a path from the repository's root. */
const sources = (): readonly string[] => {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) found.push(relative(root, path));
    }
  };
  for (const pkg of readdirSync(join(root, 'packages'))) {
    try {
      walk(join(root, 'packages', pkg, 'src'));
    } catch {
      // A package with no src/.
    }
  }
  return found.sort();
};

const read = (path: string): string => readFileSync(join(root, path), 'utf8');

/** The source without its comments, so a comment naming the emitter or the table counts for nothing. */
const code = (path: string): string =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

interface Mention {
  readonly file: string;
  readonly kind: string | undefined;
  readonly how: 'call' | 'import' | 'definition' | 'other';
  readonly text: string;
}

/** Every mention of the emitter outside comments, and what it is. */
const mentions = (): readonly Mention[] =>
  sources().flatMap((file) => {
    const text = code(file);
    return [...text.matchAll(/\bemitTelemetry\b/g)].map((match): Mention => {
      const start = match.index ?? 0;
      const after = text.slice(start + match[0].length);
      const lineStart = text.lastIndexOf('\n', start) + 1;
      const line = text.slice(lineStart, text.indexOf('\n', start) === -1 ? undefined : text.indexOf('\n', start));
      const shown = line.trim();
      const call = /^\s*(?:<[^<>()]*>)?\s*(?:\?\.)?\s*\(/.exec(after);
      if (call) {
        const args = after.slice(call[0].length);
        return { file, how: 'call', kind: /^[^,()]*(?:\([^()]*\)[^,()]*)*,\s*'([a-z-]+)'\s*,/.exec(args)?.[1], text: shown };
      }
      if (/^\s*(?:import|export)\s+(?:type\s+)?\{[^}]*\}\s*from\s*'[^']+';?\s*$/.test(line) && /^\s*[,}]/.test(after)) {
        return { file, how: 'import', kind: undefined, text: shown };
      }
      if (file === 'packages/app/src/telemetry/emit.ts' && /^export const emitTelemetry = /.test(shown)) {
        return { file, how: 'definition', kind: undefined, text: shown };
      }
      return { file, how: 'other', kind: undefined, text: shown };
    });
  });

/** Every emitter there is, by file and kind. A new one fails here until it is listed here and in the data note. */
const EXPECTED = [
  { file: 'packages/app/src/App.tsx', kind: 'hint' },
  { file: 'packages/app/src/challenges/home.tsx', kind: 'session-start' },
  { file: 'packages/app/src/index.ts', kind: 'session-start' },
  { file: 'packages/app/src/run-bar/record.ts', kind: 'run' },
  { file: 'packages/app/src/run-bar/record.ts', kind: 'session-start' },
  { file: 'packages/parent/src/accounts/model.ts', kind: 'export' },
  { file: 'packages/parent/src/export/view.tsx', kind: 'export' },
];

/** The data note's events list (the first list under "The events", before the next heading), each item as plain text. */
const noteItems = (): readonly string[] => {
  const blocks = noteBlocks(DATA_NOTE);
  const heading = blocks.findIndex((block) => block.kind === 'heading' && block.spans.map((span) => span.text).join('') === 'The events');
  const section = blocks.slice(heading + 1);
  const next = section.findIndex((block) => block.kind === 'heading');
  const list = (next === -1 ? section : section.slice(0, next)).find((block) => block.kind === 'list');
  if (heading === -1 || list?.kind !== 'list') throw new Error('The data note has no list under "The events".');
  return list.items.map((item) => item.map((span) => span.text).join(''));
};

/** The relative modules `file` imports for their values (an `import type` runs nothing), and any bare ones. */
const valueImports = (file: string): { readonly local: readonly string[]; readonly bare: readonly string[] } => {
  const text = code(file);
  const specifiers = [
    ...[...text.matchAll(/^\s*(?:import|export)\s+(?!type\b)[^;]*?\bfrom\s*'([^']+)'/gm)].map((match) => match[1] ?? ''),
    ...[...text.matchAll(/^\s*import\s*'([^']+)'/gm)].map((match) => match[1] ?? ''),
    ...[...text.matchAll(/\bimport\s*\(\s*'([^']+)'/g)].map((match) => match[1] ?? ''),
  ];
  return {
    local: specifiers.filter((specifier) => specifier.startsWith('.')).map((specifier) => normalize(join(dirname(file), specifier))),
    bare: specifiers.filter((specifier) => !specifier.startsWith('.')),
  };
};

describe('every emitted event is in the data note, and nothing else is emitted (task 6.2)', () => {
  it('finds every emitter in the source, each a direct call naming a registered kind, and no other use of it', () => {
    const found = mentions();
    expect(found.filter((mention) => mention.how === 'other')).toEqual([]);
    expect(found.filter((mention) => mention.how === 'definition')).toHaveLength(1);
    const calls = found.filter((mention) => mention.how === 'call');
    expect(calls.filter((call) => call.kind === undefined)).toEqual([]);
    expect(calls.map(({ file, kind }) => ({ file, kind })).sort((a, b) => `${a.file} ${a.kind}`.localeCompare(`${b.file} ${b.kind}`))).toEqual(EXPECTED);
    expect(new Set(calls.map((call) => call.kind))).toEqual(new Set(TELEMETRY_KINDS));
  });

  it('allows no alias and no namespace import of the emitter, wherever it can be imported from', () => {
    for (const file of sources()) {
      const text = code(file);
      expect(text, file).not.toMatch(/\bemitTelemetry\s+as\b/);
      expect(text, file).not.toMatch(/import\s+\*\s+as\s+\w+\s+from\s*'(@servo\/app\/store|[./]*(?:telemetry|store)\/(?:index|emit)\.ts|[./]*telemetry\/?)'/);
      expect(text, file).not.toMatch(/\bimport\s*\(\s*'[^']*(?:telemetry|app\/store|store\/index\.ts)[^']*'/);
    }
  });

  it('catches the spellings the review found (R-6.2 F1)', () => {
    const kindOf = (snippet: string) => /^\s*(?:<[^<>()]*>)?\s*(?:\?\.)?\s*\(/.test(snippet.slice('emitTelemetry'.length));
    expect(kindOf("emitTelemetry<'export'>(child, 'export', {})")).toBe(true);
    expect(kindOf("emitTelemetry?.(child, 'export', {})")).toBe(true);
    expect(kindOf('emitTelemetry;')).toBe(false);
  });

  it('describes in the words table exactly the registry’s kinds, each with exactly its fields', () => {
    expect(Object.keys(NOTE_WORDS).sort()).toEqual([...TELEMETRY_KINDS].sort());
    for (const kind of TELEMETRY_KINDS) {
      expect(Object.keys(NOTE_WORDS[kind].fields).sort(), kind).toEqual(Object.keys(TELEMETRY_EVENTS[kind].fields).sort());
    }
  });

  it('gives each kind one item in the data note, opening with its words and saying each of its fields, and no other item', () => {
    const items = noteItems();
    const opens = (item: string, kind: TelemetryKind): boolean => item.startsWith(`${NOTE_WORDS[kind].event}:`);
    for (const item of items) expect(TELEMETRY_KINDS.filter((kind) => opens(item, kind)), item).toHaveLength(1);
    for (const kind of TELEMETRY_KINDS) {
      const own = items.filter((item) => opens(item, kind));
      expect(own, kind).toHaveLength(1);
      const said = (own[0] ?? '').slice(NOTE_WORDS[kind].event.length + 1);
      const fields: Readonly<Record<string, string>> = NOTE_WORDS[kind].fields;
      for (const [field, words] of Object.entries(fields)) expect(said, `${kind} ${field}`).toContain(words);
    }
  });

  it('shows the adult no code names: no code spans, and no kind or field name of the registry', () => {
    expect(DATA_NOTE).not.toContain('`');
    const spans = noteBlocks().flatMap((block) => (block.kind === 'list' ? block.items.flat() : block.spans));
    expect(spans.filter((span) => span.code)).toEqual([]);
    // The names a reader could not mistake for plain words: those with a capital or a hyphen.
    const names = TELEMETRY_KINDS.flatMap((kind) => [kind, ...Object.keys(TELEMETRY_EVENTS[kind].fields)]).filter((name) => /[A-Z-]/.test(name));
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(DATA_NOTE, name).not.toContain(name);
  });

  it('draws docs/data-note.md word for word in the parent view', () => {
    expect(DATA_NOTE).toBe(read('docs/data-note.md'));
    const text = noteBlocks()
      .flatMap((block) => (block.kind === 'list' ? block.items.flat() : block.spans))
      .map((span) => span.text)
      .join(' ');
    // Brief Section 12: plain words, no exclamation marks, no praise.
    expect(text).not.toMatch(/!/);
    // Brief Section 13: one screen.
    expect(text.split(/\s+/).length).toBeLessThan(320);
  });
});

describe('only the emitter reaches the telemetry table (R-6.2 F1)', () => {
  it('reaches the table by name nowhere but the emitter, the profile removals’ deletes and the table’s own declaration', () => {
    const reaches = sources().flatMap((file) => {
      const text = code(file);
      return [...text.matchAll(/\.\s*telemetry\b/g)].map((match) => ({ file, after: text.slice((match.index ?? 0) + match[0].length, (match.index ?? 0) + 80) }));
    });
    const deleteOrScope = /^(\s*[,\]]|\.where\('profile'\)\.equals\([\w.]+\)\.delete\(\))/;
    const outside = reaches.filter(({ file, after }) => {
      if (file === 'packages/app/src/telemetry/emit.ts') return false;
      if (file === 'packages/app/src/store/profiles.ts' || file === 'packages/app/src/sync/changes.ts') return !deleteOrScope.test(after);
      return true;
    });
    expect(outside).toEqual([]);
    expect(new Set(reaches.map((reach) => reach.file))).toEqual(
      new Set(['packages/app/src/store/profiles.ts', 'packages/app/src/sync/changes.ts', 'packages/app/src/telemetry/emit.ts']),
    );
  });

  it('allows no way round the name: no table by string, no `table()` or `tables`, no destructured table', () => {
    for (const file of sources()) {
      const text = code(file);
      expect(text, file).not.toMatch(/['"`]telemetry['"`]/);
      expect(text, file).not.toMatch(/\.\s*tables?\b\s*[([]?/);
      if (file !== 'packages/app/src/store/database.ts') expect(text, file).not.toMatch(/(^|[^.\w/])telemetry\s*[,}:]/m);
    }
  });

  it('keeps the table out of everything else: the store declares it, and nothing else names its rows', () => {
    const declared = sources().filter((file) => /\bTelemetryRow\b/.test(code(file)));
    expect(declared).toEqual(['packages/app/src/store/database.ts']);
  });
});

describe('nothing the emitter runs can leave the device (R-6.2 F2)', () => {
  /** Every module the telemetry code runs, following value imports from its own files. */
  const reached = (): { readonly files: readonly string[]; readonly bare: readonly string[] } => {
    const seen = new Set<string>();
    const bare = new Set<string>();
    const queue = sources().filter((file) => file.startsWith('packages/app/src/telemetry/'));
    while (queue.length > 0) {
      const file = queue.pop() as string;
      if (seen.has(file)) continue;
      seen.add(file);
      const imports = valueImports(file);
      for (const name of imports.bare) bare.add(name);
      queue.push(...imports.local);
    }
    return { files: [...seen].sort(), bare: [...bare].sort() };
  };

  it('reaches only its own files and the store’s plain checks, and no package', () => {
    const { files, bare } = reached();
    expect(bare).toEqual([]);
    expect(files).toEqual([
      'packages/app/src/store/context.ts',
      'packages/app/src/telemetry/emit.ts',
      'packages/app/src/telemetry/events.ts',
      'packages/app/src/telemetry/index.ts',
      'packages/app/src/telemetry/note.ts',
    ]);
  });

  it('touches no network API on any path it runs', () => {
    for (const file of reached().files) {
      expect(code(file), file).not.toMatch(/\b(fetch|sendBeacon|XMLHttpRequest|WebSocket|EventSource|RTCPeerConnection|navigator|postMessage|BroadcastChannel|importScripts|Worker)\b/);
    }
  });

  it('takes no sink: the scope gets the store’s own table, and nothing can swap it at runtime', () => {
    expect(Object.keys(emitModule).sort()).toEqual(['emitTelemetry', 'telemetryOf', 'withTelemetry']);
    expect(emitModule.withTelemetry.length).toBe(2);
    const calls = sources().flatMap((file) => [...code(file).matchAll(/\bwithTelemetry\s*\(/g)].map(() => file));
    expect(calls).toEqual(['packages/app/src/store/open.ts']);
    expect(code('packages/app/src/store/open.ts')).toMatch(/withTelemetry\(ctx, \{\s*profile,\s*blueprints: blueprintsOf\(ctx, profile\),\s*runs: runsOf\(ctx, profile\),\s*cardGames: cardGamesOf\(ctx, profile\),\s*\}\)/);
    expect(code('packages/app/src/telemetry/emit.ts')).not.toMatch(/\bSink\b|\bsink\b/);
  });
});
