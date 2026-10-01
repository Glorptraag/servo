# @servo/tools

Developer tools and the tests that need the whole system. Dev-only: nothing at runtime imports tools, and the app bundle never contains it. It may import every package (the package map), but only through their `package.json` exports, like everyone else. Each area below is owned by its task; task 0.4 owns this page.

## Areas

| Area | Folder | Task | Entry | What |
| --- | --- | --- | --- | --- |
| Content validator | `src/validate-content/` | 0.5 | `pnpm validate-content <path>` | Checks part records, kits, arenas and challenges, one file or a folder, against the schema's validators and the terminology and banned-words lists in `packages/content/terminology/` (a missing list counts as empty). Readable messages; a non-zero exit on any issue |
| Placeholder art | `src/placeholder-art/` | 0.6 | a generator over part records | One SVG tile per part from `identity.colours` and `body.size`: true proportions, a consistent three-quarter view, no faces. Written to `packages/content/art/generated/` |
| Swap registry | `src/swap-registry/` | 0.6 | `registry.json` | Maps every asset key to `{ src, isPlaceholder }`. A final render in `packages/content/art/final/` wins over the placeholder, which stays as the fallback. Content's `loadArtRegistry()` reads the result |
| Golden runs | `src/golden-runs/` | 1.7 | a CI check, and `--accept` | Records a reference run per fixture blueprint in `packages/sim-core/golden/` and fails CI with a readable per-tick diff when a run changes. `--accept` regenerates, for intended solver changes, with an orchestrator note |
| Canvas e2e harness | `src/e2e/` | 3.8 | Vitest browser mode | Touch and pointer emulation, screenshot diffs, an iPad-class performance profile, and the parity check that touch, pointer and list view give byte-identical blueprints. Under 10 minutes in CI |
| Release | `src/release/` | 6.3 | a tagged commit | The web build, a versioned content bundle shown in Settings, and tester invite codes. Deploying waits for a host (D10) |

## Tests here

- Behaviour tests against the real content records live here, because only tools may import both content and sim-core. sim-core's own tests use `@servo/schema/fixtures`.
- `test/lint-rules.test.ts` lints sample files through the real ESLint config and proves each rule fires (task 0.1). Extend it whenever a rule changes.

## Running

- Node 24 runs the TypeScript here directly (type stripping), so a CLI must not depend on Vite. Content's loaders use Vite's `import.meta.glob`, so CLIs read content files from disk with `node:fs`, and tests (under Vitest) may call the loaders.
- tools' tsconfig has Node types and no DOM. The e2e harness adds the DOM library when it imports the canvas.
- Generated files (placeholder art, the registry, golden runs) are deterministic, so the same inputs give the same bytes and diffs stay reviewable.
