# @servo/content

Servo's content as data: part records, kits, arena presets, challenges, terminology lists, fixture blueprints and art. One JSON record per file, named by its id. It depends only on `@servo/schema`, so adding a part is adding a file here and its fixtures, never code (ground rule 1). Content workers own the records (Phases 2 and 4); task 0.4 owns the loaders in [src/index.ts](src/index.ts).

```ts
import { loadContent, loadCatalogue } from '@servo/content';
const catalogue = loadCatalogue(); // parts, arenas and kits by id, for validateBlueprint, sim-core and the canvas
```

## Layout

| Folder | Holds | Checked by | Task |
| --- | --- | --- | --- |
| `parts/level-1/`, `parts/level-2/` | `PartRecord` | `validatePartRecord` | 2.1, 2.2 |
| `arenas/` | `ArenaPreset` | `validateArenaPreset` | 2.4 |
| `kits/` | `Kit` | `validateKit` | 2.3 |
| `challenges/level-1/`, `challenges/level-2/` | `Challenge` | `validateChallenge` | 4.7, 4.8 |
| `terminology/` | The terminology and banned-words lists | the tools CLI; the format is task 0.5's and 2.5's | 2.5 |
| `fixtures/blueprints/` | Working and broken blueprints, each in a wrapper naming its fault | `validateBlueprint` | 2.6 |
| `art/generated/` | Placeholder SVGs and `registry.json`, written by tools | tools | 0.6 |
| `art/final/` | Final renders as they are dropped in (D6) | tools | later |

Later levels add `parts/level-3/` and so on; the loaders already read every level folder. Task 2.6 adds a `./fixtures` export for the fixture blueprints, so the app bundle never carries them.

## Loaders

| Function | Returns |
| --- | --- |
| `loadContent()` | `ContentResult`: every record validated, or every issue with its `file`. Never throws |
| `loadCatalogue()` | The schema's `Catalogue` of parts, arenas and kits (`makeCatalogue`) |
| `loadParts()`, `loadArenas()`, `loadKits()`, `loadChallenges()` | The records, each list in id order |
| `loadTerminology()` | `{ id, data }` per file in `terminology/`, as authored |
| `loadArtRegistry()` | Asset key → `{ src, isPlaceholder }`, with `src` a URL the browser can load |

- Records are validated with the schema's validators in dependency order: parts and arenas, then kits against them, then challenges against all three. A file whose name differs from its record's id, or a second file with the same id, is an issue too.
- Content loads once and is cached. The single loaders throw a `ContentError` (with `issues`) when anything fails, because content ships as one validated bundle.
- The loaders read the folders with Vite's eager `import.meta.glob` (typed by `vite/client`), so they run in the app build and in every Vitest test, but not under plain Node. The tools CLI reads files from disk instead.

## Validation

Content has no validator of its own. Records are checked with the schema's validators in three places: `loadContent()` over the whole tree; `pnpm validate-content <path>` (tools, task 0.5) over any file or folder, which also checks terminology, banned words and the folder layout; and CI on every push.

## The art registry

`art/generated/registry.json` maps each asset key (`part/dc-motor`) to `{ src, isPlaceholder }`, with `src` relative to `art/`. Tools writes it (task 0.6): a final render in `art/final/` wins over the generated placeholder for the same key. The loader turns each `src` into a bundled URL. The app builds the canvas's `resolveArt` from it, so the canvas never imports content. Agents never generate final art (ground rule 12).

## Voice

Every system-text field follows the voice rules: real component names, no character names, no praise, no exclamation marks (ground rule 7, brief Section 12). The schema refuses exclamation marks; the content validator checks terminology and banned words.
