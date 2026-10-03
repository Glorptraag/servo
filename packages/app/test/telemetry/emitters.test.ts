// Task 6.2's done-when: every event Servo emits is listed in the data note, and nothing else is emitted. This test
// enumerates every emitter in the source of every package (each call of the one emitter, `emitTelemetry`, with its
// kind), holds them to the registry, holds the registry to docs/data-note.md kind by kind and field by field, holds the
// copy the parent view draws to that file word for word, and checks nothing else writes the telemetry table or sends
// anything off the device.
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TELEMETRY_EVENTS, TELEMETRY_KINDS } from '../../src/telemetry/events.ts';
import { DATA_NOTE, noteBlocks } from '../../src/telemetry/note.ts';

const root = fileURLToPath(new URL('../../../../', import.meta.url));

/** Every source file of every package, as a path from the repository's root. */
const sources = (): readonly string[] => {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry.name)) found.push(relative(root, path));
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

/** Each call of the emitter in the source: its file, and the kind it names (undefined when it is not a string literal). */
const emitters = (): readonly { readonly file: string; readonly kind: string | undefined }[] =>
  sources().flatMap((file) => {
    const text = read(file);
    return [...text.matchAll(/\bemitTelemetry\(/g)].map((match) => {
      const after = text.slice((match.index ?? 0) + match[0].length);
      return { file, kind: /^[^,()]*(?:\([^()]*\)[^,()]*)*,\s*'([a-z-]+)'\s*,/.exec(after)?.[1] };
    });
  });

/** Every emitter there is, by file and kind. A new one fails here until it is listed here and in the data note. */
const EXPECTED = [
  { file: 'packages/app/src/App.tsx', kind: 'hint' },
  { file: 'packages/app/src/challenges/home.tsx', kind: 'session-start' },
  { file: 'packages/app/src/run-bar/record.ts', kind: 'run' },
  { file: 'packages/app/src/run-bar/record.ts', kind: 'session-start' },
  { file: 'packages/parent/src/accounts/model.ts', kind: 'export' },
  { file: 'packages/parent/src/export/view.tsx', kind: 'export' },
];

/** The data note's events list: each item's kind (its first code span) and the fields it names (the others). */
const noteEvents = (): ReadonlyMap<string, readonly string[]> => {
  const blocks = noteBlocks(DATA_NOTE);
  const heading = blocks.findIndex((block) => block.kind === 'heading' && block.spans.map((span) => span.text).join('') === 'The events');
  const list = blocks[heading + 1];
  if (list?.kind !== 'list') throw new Error('The data note has no list under "The events".');
  return new Map(
    list.items.map((item) => {
      const codes = item.filter((span) => span.code).map((span) => span.text);
      return [codes[0] ?? '', codes.slice(1)] as const;
    }),
  );
};

describe('every emitted event is in the data note, and nothing else is emitted (task 6.2)', () => {
  it('finds every emitter in the source, each naming a registered kind, and no others', () => {
    const found = emitters();
    expect(found.filter((emitter) => emitter.kind === undefined)).toEqual([]);
    expect([...found].sort((a, b) => `${a.file} ${a.kind}`.localeCompare(`${b.file} ${b.kind}`))).toEqual(EXPECTED);
    expect(new Set(found.map((emitter) => emitter.kind))).toEqual(new Set(TELEMETRY_KINDS));
  });

  it('lists in the data note exactly the registry’s kinds, each with exactly its fields', () => {
    const listed = noteEvents();
    expect([...listed.keys()].sort()).toEqual([...TELEMETRY_KINDS].sort());
    for (const kind of TELEMETRY_KINDS) {
      expect([...(listed.get(kind) ?? [])].sort(), kind).toEqual(Object.keys(TELEMETRY_EVENTS[kind].fields).sort());
    }
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

  it('writes the telemetry table only from the emitter, and the store only deletes from it', () => {
    const writers = sources().filter((file) => /\btelemetry\s*\.\s*(add|put|bulkAdd|bulkPut|update|modify)\(/.test(read(file)));
    expect(writers).toEqual(['packages/app/src/telemetry/emit.ts']);
    const touching = sources().filter((file) => /\bdb\.telemetry\b/.test(read(file)));
    expect(touching).toEqual([
      'packages/app/src/store/profiles.ts',
      'packages/app/src/sync/changes.ts',
      'packages/app/src/telemetry/emit.ts',
    ]);
  });

  it('sends nothing off the device: the telemetry module has no network path', () => {
    for (const file of sources().filter((path) => path.startsWith('packages/app/src/telemetry/'))) {
      expect(read(file), file).not.toMatch(/\b(fetch|sendBeacon|XMLHttpRequest|WebSocket|EventSource|navigator|postMessage)\b/);
    }
  });
});
