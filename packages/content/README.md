# @servo/content

Servo's content as data: part records, kits, arena presets, challenges, terminology lists, fixtures and art. One JSON record per file; by convention the file is named by the record's id, which neither the loader nor the content validator checks. It depends only on `@servo/schema` (and on Vite at build time), so adding a part is adding a file here and its fixtures, never code (ground rule 1). Content workers own the records (Phases 2 and 4); task 0.4 owns the loaders in [src/index.ts](src/index.ts) and [src/fixtures.ts](src/fixtures.ts).

```ts
import { loadContent } from '@servo/content';
const { content, issues } = loadContent(); // content.catalogue: parts, arenas and kits by id
import { loadFixtures } from '@servo/content/fixtures'; // for tests and tools
```

## Layout

| Folder | Holds | Task |
| --- | --- | --- |
| `parts/level-1/`, `parts/level-2/` | Part records | 2.1, 2.2 |
| `arenas/` | Arena presets | 2.4 |
| `kits/` | Kits | 2.3 |
| `challenges/level-1/`, `challenges/level-2/` | Challenges | 4.7, 4.8 |
| `terminology/` | `components.json` and `banned.json`, in the content validator's format | 2.5 |
| `fixtures/blueprints/` | Bare blueprints the fixtures in `FIXTURES` (src/fixtures.ts) start from | 2.6, 4.7, 4.8 |
| `art/final/` | Final renders, dropped in by hand (D6) | later |
| `art/generated/` | Placeholders and `registry.json` from `pnpm art`; gitignored | 0.6 |

## Loaders

`contentFrom(files)` is the pure core and `loadContent()` feeds it this package's files once, through Vite's eager `import.meta.glob`, so it runs in the app build and under Vitest, not under plain Node. `loadCatalogue()`, `loadParts()` and their siblings return pieces of the same load.

- **The same verdicts as the content validator** (task 0.5). A file's kind comes from its nearest record folder (`parts/`, `arenas/`, `kits/`, `challenges/`, `blueprints/`, `run-records/`), at any depth, or else from the fields only one kind has. Parts and arenas are checked alone, kits against them, challenges against all three, with the schema's validators. When records of one kind share an id, the first in the validator's walk order is kept and the others are `content.duplicate_id`. A test in packages/tools runs both over the same trees and over this package, and fails on any difference.
- **Never throws, never locks out.** `loadContent()` returns `{ content, issues }`. A record with issues is left out and the rest load, so a defect breaks only builds that use that record. CI fails on any issue (test/loaders.test.ts).
- **Not checked here.** Terminology, banned words and glosses are checked only when content is authored, by `pnpm validate-content`.
- **Left to others.** The loader skips `art/` (pictures go through the registry), `fixtures/`, `test/` and `terminology/` (passed through as `{ id, data }`).

## The art registry

`pnpm art` (task 0.6) writes `art/generated/registry.json`: every art key to `{ src, isPlaceholder }`, with `src` relative to `art/generated/`. `loadArtRegistry()` turns each `src` into a bundled URL; finals may be avif, jpeg, jpg, png, svg or webp, in any case. A key the registry lacks gives `undefined`, and the canvas draws a neutral tile. The folder is gitignored, so every build or test that draws parts runs `pnpm art` first: the canvas's screenshot tests (3.1), the e2e harness (3.8) and the release build (6.3). Once the registry exists, a test fails if any part's key is missing from it.

## Fixtures (`@servo/content/fixtures`)

A fixture is a Run that tests replay: task 2.6's working and broken builds, the passing and failing Runs of each challenge (4.7, 4.8), which 4.5 checks the challenge runner against and 1.7's golden runs record. `FIXTURES` (src/fixtures.ts) holds one `FixtureSpec` per fixture, and `loadFixtures()` gives each as a `ContentFixture`:

- `blueprint`: a bare blueprint in `fixtures/blueprints/` (several fixtures may share one), or, with none named, the challenge's own `start`;
- `challenge`: the challenge the Run is judged against, whose arena the blueprint must use;
- `inputs`: the switch presses the Run needs, as a run record keeps them (`RunInput`), and `ticks`: how long it runs; `seed`, default 1;
- `expect`: the goal met or not (with a challenge), exactly the faults the Run shows by part and failure mode, and a broken fixture's `namedFault` or `refused` impossible drop.

Every reference is checked against the content, and a blueprint file no fixture uses is an issue. The blueprints stay bare, so `pnpm validate-content` checks them as blueprints. The package map does not stop app code importing this entry, so review does.

## Level 1 challenges (task 4.7)

Fifteen challenges in `challenges/level-1/`, all on the Rolling Start kit with no settings: part introductions for the battery pack, DC motor, large wheel, caster and switch (the chassis is the base of every build, so it has none); guided `drive-forward`, `stop-with-the-switch`, `turn-in-a-circle`, `over-the-hill` (ramp) and `push-the-box` (bump props); breakdowns `no-way-out` (a DC motor with no return wire) and `switch-to-one-side` (a switch outside the loop), each naming its fault in a `fault` trigger (D48); what-ifs `what-if-one-wheel` and `what-if-one-motor-on-the-switch`; and the unscripted build `cross-the-arena`, to the wall stop's far-side zone (D26). Each has a passing and a failing fixture in `FIXTURES`. A what-if's goal is the behaviour its change shows, since a goal must be a predicate. Home lists challenges in id order, so the order a child meets them in is not authored here.

## Voice

Every system-text field follows the voice rules: real component names, no character names, no praise, no exclamation marks (ground rule 7, brief Section 12). The schema refuses exclamation marks; the content validator checks terminology and banned words.
