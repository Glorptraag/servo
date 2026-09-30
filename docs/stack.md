# Stack

Proposed by task 0.1 under decision D2 (default: accept). Versions are the ones `pnpm-lock.yaml` pinned on 2026-09-30. Changing a choice here is a decision for Drew, not a worker.

## The three D2 choices

### 2D canvas renderer: PixiJS 8 (`pixi.js`, packages/canvas)

- A WebGL/WebGPU scene graph, which is the hardware acceleration the brief asks for: dots animate along every wire at 30 ticks per second and the canvas zooms to 400%.
- One pointer-event model for touch, mouse and pen, with custom hit areas. That fits 44 px port targets, 24 px wire hit areas, and the touch and pointer paths of ground rule 8.
- `Graphics` draws vector shapes, which is how placeholder art from schema colours gets drawn (ground rule 12).
- Pixi draws pixels, so the list view (ground rule 8) has to be DOM beside the canvas for screen readers to read it.
- pixi.js imports under Node, so unit tests can load it. Anything that renders needs a real browser (Vitest browser mode).
- Rejected: Konva. Its drag and drop is simpler, but it draws through Canvas 2D without a GPU scene graph, so redrawing many animated wires at high zoom costs more.

### 2D physics: Rapier 2D, deterministic build (`@dimforge/rapier2d-deterministic-compat`, packages/sim-core)

- Rust compiled to WebAssembly. The `-deterministic` build comes with a documented guarantee of cross-platform deterministic execution. The default build is deterministic only on one machine; the guarantee costs some speed.
- `world.takeSnapshot()` and `World.restoreSnapshot()` serialise the whole physics state. Ground rule 4 (Stop restores the snapshot) and golden runs both depend on that.
- Checked with a scratch script before choosing (not committed). A 900-tick arena scene hashed identically in Node (V8) and Safari's JavaScriptCore. A world restored from a mid-run snapshot replayed to a bit-identical end state.
- It is pinned to an exact version (0.21.0), because any physics upgrade can move golden runs. An upgrade is a deliberate change that comes with an orchestrator note.
- Costs: the compat build inlines the WebAssembly (about 1.3 MB gzipped), and `await RAPIER.init()` must run once before the first world is created. So the sim-core interface needs an async setup step or an engine passed in already initialised. The app can switch to `@dimforge/rapier2d-deterministic` (a separate `.wasm` file, same results) if bundle size matters.
- Rejected: Matter.js. It is pure JavaScript and the best known, but it has no determinism guarantee: it relies on `Math.sin`/`Math.cos`, which ECMAScript lets each engine approximate differently. The V8/JavaScriptCore spot check happened to agree. It also has no snapshot API and no release since June 2024. Planck.js has the same `Math` problem.

### Local-first store: Dexie.js 4 (`dexie`, packages/app). Sync host not decided.

- Dexie is the most widely used wrapper for IndexedDB, the standard durable browser store. It gives transactions, indexes, live queries and versioned table layouts, and ties the app to no UI framework.
- The store holds blueprints and run records in the shapes packages/schema defines. Blueprint migrations stay in packages/schema (ground rule 5); Dexie's own versioning covers only table and index layout.
- Safari may evict IndexedDB for sites not added to the home screen. The store task should call `navigator.storage.persist()`, and sync is the real backup.
- Sync: Dexie's own sync layer is Dexie Cloud (`dexie-cloud-addon`). It adds users and shared access realms, which map to one adult account with child profiles and, later, a class. It is a commercial service, hosted or self-hosted under a licence, so it is not installed yet. Where children's builds are stored is Drew's call (see below). Until then the store is local-only, which is also the offline path.
- Proposed for the sync task: when two devices change the same blueprint offline, keep both copies. A child's build is never merged or dropped silently.
- Rejected: Automerge (CRDT). It merges concurrent edits automatically, which can combine two versions of a blueprint into one whose wires point at deleted parts. Blueprints need versions and "keep both", not merging. RxDB was also considered. It has sync built in, but it is heavier (RxJS), several of its storages and plugins are paid, and its schema migrations would duplicate packages/schema's job.

## Tooling

| Tool | Choice | Why | Rejected |
| --- | --- | --- | --- |
| Language | TypeScript 6.0 | typescript-eslint supports TypeScript below 6.1 only. Move to 7.x (native compiler) when it does | TypeScript 7.0 for now |
| Packages | pnpm 12 workspaces, version pinned in `packageManager` | Strict `node_modules`: a package cannot import what it has not declared. Shared tool versions live in the `catalog` in `pnpm-workspace.yaml` | npm workspaces (hoisting hides undeclared imports) |
| Tests | Vitest 5 | Runs TypeScript and ESM with no build. The same runner can serve unit tests, golden runs and, through its browser mode, the canvas e2e harness later | Jest (needs a transform for TypeScript and ESM) |
| Lint | ESLint 10 with typescript-eslint | The standard. Its per-folder `no-restricted-imports` and `no-restricted-globals` carry the package map and the purity rules | Biome (faster, but ESLint is the one every worker already knows) |
| CI | GitHub Actions (D3 default) on Node 24 LTS, the `engines` minimum | Actions pinned by commit SHA. `.github/workflows/ci.yml` runs install, lint, typecheck and tests on every push | n/a |

Module conventions: ESM everywhere, `nodenext` resolution, a `.ts` extension on every relative import, and no enums, namespaces or parameter properties (`erasableSyntaxOnly`). Packages import each other's source through `exports`, so nothing is built between packages, and Node 24+ can run a tools script directly. Vite, already installed for Vitest, is the obvious bundler when the app needs one.

## What lint and the compiler enforce

- The package map in CLAUDE.md: shipped code (`src/`) may import only the Servo packages it depends on, and canvas reaches sim-core only as `@servo/sim-core/interface`. Tests are exempt so they can use fixtures.
- schema, content and sim-core compile without DOM or Node types. Lint bans UI, timer and I/O globals there.
- sim-core additionally bans `Date`, `performance` and `Math.random` (ground rule 2).
- Left to the sim-core tasks and not linted yet, but needed for determinism across devices: sim-core's own maths. `Math.sin`, `cos`, `tan`, `atan2`, `exp`, `log`, `pow` and `hypot` may differ between browsers; `+ - * /` and `Math.sqrt` are exact. Keep such maths inside Rapier or one deterministic module, and iterate parts and wires in a stable order (for example sorted by id).

## Left open (questions for Drew)

- The UI framework for the app chrome (tray, spec card, Run bar) is not among D2's decisions, so none is installed.
- The sync host for children's data: Dexie Cloud hosted, Dexie Cloud self-hosted, or a small sync service of our own.
- The oldest iPadOS and browser versions supported. This sets the app build target; the TypeScript `lib` is ES2023 until then.
