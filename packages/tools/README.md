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
| Canvas e2e harness | `src/e2e/` ([README](src/e2e/README.md)) | 3.8 | `pnpm e2e` at the root (Vitest browser mode) | Runs `pnpm art` first, then touch and pointer emulation, screenshot diffs, an iPad-class performance profile, and the parity check that touch, pointer and list view give byte-identical blueprints for every edit a child makes: placing, mounting and wiring, then moving, turning and removing a part, removing a wire, placing, moving and removing a prop, Reset arena, Undo, tidying the wires, clearing the selection and flipping a switch in Run mode (task 7.6). Each parity shard under 10 minutes in CI |
| App performance | `src/perf/` | 6.1 | `pnpm perf:app` at the root | Builds the web app and the perf page (`vite build --mode perf`), serves each gzipped, and in Chromium on the machine's GPU measures, per stand-in profile (2020 iPad at 2× CPU slowdown, low-end Chromebook at 4×), cold start (first paint and the app's `servo:interactive` mark, first visit over shaped Wi-Fi and from the service worker's cache), Build and Run frame time on busy-workbench, and the bundle; the median of three runs, held to the budgets. Not part of `pnpm perf` yet ([docs/perf.md](../../docs/perf.md)) |
| Gate G3 page | `src/gate/` | G3 prep | `pnpm gate:g3` at the root; `pnpm gate:g3:test` | Dev only. Runs `pnpm art`, then a Vite page on every interface (it prints the address for an iPad on the same Wi-Fi): a Level 1 fixture robot picker (kit-rolling-start and level-1-roller first), a tray of its kit's parts from the content records, the real canvas with Fit, Tidy wires and the list view, Run and Stop through `createSimulation` at 30 ticks a second, and one status line with the robot and any fault. Its test serves the page with its own config and builds the Rolling Start kit robot by mouse, runs and stops it ([howto](../../docs/gates/G3-howto.md)) |
| Release | `src/release/` | 6.3 | a `v*` tag; `pnpm release:dry`, `pnpm release:preview` | Checks the content, runs `pnpm build` (and so `pnpm art`) with the app and content versions and the invite code hashes baked in, and writes the web build, the versioned content bundle and the tester invite codes. The codes are hashed with the app's own `@servo/app/invite-code`. Deploying waits for a host (D10) ([README](src/release/README.md)) |

## Tests here

- Behaviour tests against the real content records and `@servo/content/fixtures` live here, as ruled; sim-core's own tests use `@servo/schema/fixtures`, so they do not move when content does.
- `test/content-loader.test.ts` holds content's loader to these tools: it reads real `pnpm art` output, and it must give the same verdicts as the content validator on the same trees and on `packages/content` itself.
- `test/canvas-fixture-copies.test.ts` checks the canvas's test copies of content fixtures (the busy workbench, the Circuit Crew kit robot) still match content, blueprint, part records and arenas. The canvas may not import content, so it carries copies; refresh one when this fails.
- `test/lint-rules.test.ts` lints sample files through the real ESLint config and proves each rule fires (task 0.1). Extend it whenever a rule changes.
- `test/golden-runs.test.ts` and `test/golden-cli.test.ts` test the golden-run harness, the second against one real golden file. The full check is `pnpm golden`, a CI step of its own after the tests.

## Running

- Node 24 runs the TypeScript here directly (type stripping), so a CLI must not depend on Vite. Content's loaders use Vite's `import.meta.glob`, so CLIs read content files from disk with `node:fs`, and tests (under Vitest) may call the loaders.
- tools' tsconfig has Node types and no DOM. The e2e harness adds the DOM library when it imports the canvas.
- Generated files (placeholder art, the registry, golden runs) are deterministic, so the same inputs give the same bytes and diffs stay reviewable.
