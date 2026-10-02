# @servo/tools

Developer tools and the tests that need the whole system. Dev-only: nothing at runtime imports tools, and the app bundle never contains it. It may import every package (the package map), but only through their `package.json` exports, like everyone else. Each area below is owned by its task; task 0.4 owns this page.

## Areas

| Area | Folder | Task | Entry | What |
| --- | --- | --- | --- | --- |
| Content validator | `src/validate-content/` | 0.5 | `pnpm validate-content <path>` | Checks part records, kits, arenas, challenges, blueprints and run records, one file or a folder, against the schema's validators and the terminology and banned-words lists. Readable messages; a non-zero exit on any issue ([README](src/validate-content/README.md)) |
| Placeholder art | `src/placeholder-art/` | 0.6 | `pnpm art` | One SVG tile per part from `identity.colours` and `body.size`: true proportions, one three-quarter view, no faces. Written to `packages/content/art/generated/` ([README](src/placeholder-art/README.md)) |
| Swap registry | `src/swap-registry/` | 0.6 | `registry.json` | Every art key to `{ src, isPlaceholder }`, `src` relative to the registry's folder. A final render in `packages/content/art/final/` wins over the placeholder. Content's `loadArtRegistry()` reads it; a key it lacks gives `undefined` there, and the canvas draws a neutral tile |
| Golden runs | `src/golden-runs/` | 1.7 | `pnpm golden`, run by CI | Runs every content fixture (its blueprint, seed, inputs and ticks) and every valid schema blueprint through `createSimulation`, asserts each fixture's `expect` (its faults, named fault, refused drop and goal), and diffs each Run against its golden file in `packages/sim-core/golden/`: which input changed, the first differing tick with each field old → new, how many ticks differ ([README](src/golden-runs/README.md)) |
| Accepting golden runs | `src/golden-runs/` | 1.7 | `pnpm golden --accept [<case>...]` | Rewrites the golden files from the Runs as they are now, removes those no case has, and prints what changed. For intended changes only, with an orchestrator note; it never makes an `expect` hold |
| Determinism sweep | `test/sim-determinism.test.ts` | 1.5 | `pnpm --filter @servo/tools test:determinism` | Every content fixture and every valid schema blueprint run 100 times, the run records compared byte for byte. Not part of `pnpm check`, whose run of the same file does three fixtures 100 times and the rest 10 (plan Section 8: nightly) |
| Canvas e2e harness | `src/e2e/` | 3.8 | Vitest browser mode | Runs `pnpm art` first, then touch and pointer emulation, screenshot diffs, an iPad-class performance profile, and the parity check that touch, pointer and list view give byte-identical blueprints. Under 10 minutes in CI |
| Release | `src/release/` | 6.3 | a tagged commit | Runs `pnpm art`, then the web build, a versioned content bundle shown in Settings, and tester invite codes. Deploying waits for a host (D10) |

## Tests here

- Behaviour tests against the real content records and `@servo/content/fixtures` live here, as ruled; sim-core's own tests use `@servo/schema/fixtures`, so they do not move when content does.
- `test/content-loader.test.ts` holds content's loader to these tools: it reads real `pnpm art` output, and it must give the same verdicts as the content validator on the same trees and on `packages/content` itself.
- `test/lint-rules.test.ts` lints sample files through the real ESLint config and proves each rule fires (task 0.1). Extend it whenever a rule changes.
- `test/golden-runs.test.ts` and `test/golden-cli.test.ts` test the golden-run harness, the second against one real golden file. The full check is `pnpm golden`, a CI step of its own after the tests.

## Running

- Node 24 runs the TypeScript here directly (type stripping), so a CLI must not depend on Vite. Content's loaders use Vite's `import.meta.glob`, so CLIs read content files from disk with `node:fs`, and tests (under Vitest) may call the loaders.
- tools' tsconfig has Node types and no DOM. The e2e harness adds the DOM library when it imports the canvas.
- Generated files (placeholder art, the registry, golden runs) are deterministic, so the same inputs give the same bytes and diffs stay reviewable.
