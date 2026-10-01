# @servo/content

Servo's content as data: part records, kits, arena presets, challenges, terminology lists, fixture blueprints and art. One JSON record per file, named by its id. It depends only on `@servo/schema` (and on Vite at build time), so adding a part is adding a file here and its fixtures, never code (ground rule 1). Content workers own the records (Phases 2 and 4); task 0.4 owns the loaders in [src/index.ts](src/index.ts) and [src/fixtures.ts](src/fixtures.ts).

```ts
import { loadContent } from '@servo/content';
const { content, issues } = loadContent(); // content.catalogue: parts, arenas and kits by id
import { loadBlueprintFixtures } from '@servo/content/fixtures'; // tests only, never in the app bundle
```

## Layout

| Folder | Holds | Task |
| --- | --- | --- |
| `parts/level-1/`, `parts/level-2/` | Part records | 2.1, 2.2 |
| `arenas/` | Arena presets | 2.4 |
| `kits/` | Kits | 2.3 |
| `challenges/level-1/`, `challenges/level-2/` | Challenges | 4.7, 4.8 |
| `terminology/` | `components.json` and `banned.json`, in the content validator's format | 2.5 |
| `fixtures/blueprints/` | Bare blueprints for tests, each named in `FIXTURE_NOTES` (src/fixtures.ts) with what a Run of it shows | 2.6 |
| `art/final/` | Final renders, dropped in by hand (D6) | later |
| `art/generated/` | Placeholders and `registry.json` from `pnpm art`; gitignored | 0.6 |

## Loaders

`contentFrom(files)` is the pure core and `loadContent()` feeds it this package's files once, through Vite's eager `import.meta.glob`. It runs in the app build and under Vitest, not under plain Node.

- **The same verdicts as the content validator** (task 0.5). A file's kind comes from its nearest record folder (`parts/`, `arenas/`, `kits/`, `challenges/`, `blueprints/`, `run-records/`), at any depth, or else from the fields only one kind has. Parts and arenas are checked alone, kits against them, challenges against all three, with the schema's validators. When records of one kind share an id, the first in the validator's walk order is kept and the others are `content.duplicate_id`. A test in packages/tools runs both over the same trees and over this package, and fails on any difference.
- **Never throws, never locks out.** `loadContent()` returns `{ content, issues }`. A record with issues is left out and the rest load, so a defect breaks only builds that use that record. Each issue names its file. CI fails on any issue (test/loaders.test.ts).
- **Not checked here.** Terminology, banned words and glosses are checked only when content is authored, by `pnpm validate-content`. The loader passes the terminology files through as `{ id, data }`.
- **Left to others.** The loader skips `art/` (pictures go through the registry), `fixtures/`, `test/` and `terminology/`.
- `loadCatalogue()`, `loadParts()`, `loadArenas()`, `loadKits()`, `loadChallenges()`, `loadTerminology()` and `loadArtRegistry()` return pieces of the same load.

## The art registry

`pnpm art` (task 0.6) writes `art/generated/registry.json`: every art key to `{ src, isPlaceholder }`, with `src` relative to `art/generated/` (`part/led.svg`, or `../final/part/led.png` once a final render is dropped in). `loadArtRegistry()` turns each `src` into a bundled URL. Final renders may be avif, jpeg, jpg, png, svg or webp, in any case. A key the registry lacks gives `undefined`, and the canvas draws a neutral tile; before `pnpm art` has run, every key does. An entry whose picture is missing is an issue, and its key is left out. A test in packages/tools runs the real generator and reads its output.

## Fixtures

`@servo/content/fixtures` exports `loadBlueprintFixtures()`, `fixturesFrom()` and `FIXTURE_NOTES`. Each fixture is a bare blueprint, so the content validator checks it as one, and its note says what a Run of it shows: it works, it has one named fault, or it is the build before an impossible drop that is refused with a named code. A file without a note, or a note without a file, is an issue.

## Voice

Every system-text field follows the voice rules: real component names, no character names, no praise, no exclamation marks (ground rule 7, brief Section 12). The schema refuses exclamation marks; the content validator checks terminology and banned words.
