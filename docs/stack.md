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
- Costs: the compat build inlines the WebAssembly (about 1.3 MB gzipped), and `await RAPIER.init()` must run once before the first world is created. D11 (default: accept) takes that size, and the app lazy-loads the WebAssembly at the first Run so cold start does not pay for it. So the sim-core interface needs an async setup step, or takes an engine that is already initialised. `@dimforge/rapier2d-deterministic` (a separate `.wasm` file, same results) stays available if bundle size matters.
- For the sim-core tasks: keep `world.profilerEnabled` off, and never feed `timing*()` values (`timingStep()` and the rest) into simulation state. Rapier's glue reads `performance.now()` for that profiler only; it does not change results.
- Rejected: Matter.js. It is pure JavaScript and the best known, but it has no determinism guarantee: it relies on `Math.sin`/`Math.cos`, which ECMAScript lets each engine approximate differently. The V8/JavaScriptCore spot check happened to agree. It also has no snapshot API and no release since June 2024. Planck.js has the same `Math` problem.

### Local-first store: Dexie.js 4 (`dexie`, packages/app). Sync host: none yet (D13).

- Dexie is the most widely used wrapper for IndexedDB, the standard durable browser store. It gives transactions, indexes, live queries and versioned table layouts, and ties the app to no UI framework.
- The store holds blueprints and run records in the shapes packages/schema defines. Blueprint migrations stay in packages/schema (ground rule 5); Dexie's own versioning covers only table and index layout.
- Safari may evict IndexedDB for sites not added to the home screen. The store task should call `navigator.storage.persist()`, and sync is the real backup.
- Sync: Dexie's own sync layer is Dexie Cloud (`dexie-cloud-addon`). It adds users and shared access realms, which map to one adult account with child profiles and, later, a class. It is a commercial service, hosted or self-hosted under a licence, so it is not installed. Where children's builds are stored is D13. Its default is no host yet: the store syncs through a pluggable `SyncRemote`, so a host can be added later without changing the store. Until then the store is local-only, which is also the offline path.
- Proposed for the sync task: when two devices change the same blueprint offline, keep both copies. A child's build is never merged or dropped silently.
- Rejected: Automerge (CRDT). It merges concurrent edits automatically, which can combine two versions of a blueprint into one whose wires point at deleted parts. Blueprints need versions and "keep both", not merging. RxDB was also considered. It has sync built in, but it is heavier (RxJS), several of its storages and plugins are paid, and its schema migrations would duplicate packages/schema's job.

## Tooling

| Tool | Choice | Why | Rejected |
| --- | --- | --- | --- |
| Language | TypeScript 6.0 | typescript-eslint supports TypeScript below 6.1 only. Move to 7.x (native compiler) when it does | TypeScript 7.0 for now |
| Packages | pnpm 12 workspaces, version pinned in `packageManager` | Strict `node_modules`: a package cannot import what it has not declared. Shared tool versions live in the `catalog` in `pnpm-workspace.yaml` | npm workspaces (hoisting hides undeclared imports) |
| Tests | Vitest 5 | Runs TypeScript and ESM with no build. The same runner can serve unit tests, golden runs and, through its browser mode, the canvas e2e harness later | Jest (needs a transform for TypeScript and ESM) |
| Lint | ESLint 10 with typescript-eslint | The standard. Two local rules in `eslint.config.js` carry the package map and the `.ts` import rule; `no-restricted-globals` carries the purity rules | Biome (faster, but ESLint is the one every worker already knows) |
| CI | GitHub Actions (D3 default) on Node 24 LTS, the `engines` minimum | Actions pinned by commit SHA. `.github/workflows/ci.yml` runs install, lint, typecheck and tests on every push | n/a |

Module conventions: ESM everywhere, `nodenext` resolution, relative imports that name the `.ts` file (enforced by lint), and no enums, namespaces or parameter properties (`erasableSyntaxOnly`). Packages import each other's source through `exports`, so nothing is built between packages, and Node 24+ can run a tools script directly. Vite, already installed for Vitest, is the obvious bundler when the app needs one.

## What lint and the compiler enforce

`packages/tools/test/lint-rules.test.ts` lints sample files through the real config and proves each rule below fires. Extend it whenever a rule changes.

- The package map in CLAUDE.md (ground rule 6). Lint checks every way a file in `packages/` loads a module: `import`, `export … from`, `import()`, `import()` types, `require()`, `new URL()` of a code file, and `import.meta.glob` patterns.
  - In `src/`, a package may import only the packages the map allows, and only through their `package.json` exports. Canvas reaches sim-core only as `@servo/sim-core/interface`, and parent reaches app only as `@servo/app/store`.
  - From `src/`, relative imports of code (TypeScript, JavaScript, WebAssembly or an extensionless path) must stay inside `src/`. Data files such as JSON may sit elsewhere in the package.
  - Tests may import any package, but also only through its exports.
  - Everywhere, these are errors: relative paths that leave the package or pass through `node_modules`, absolute paths, package.json `imports` aliases (`#…`), and specifiers computed at run time.
  - A template or glob that starts with `./` or `../` is checked by its fixed part, up to the first `${}` or wildcard.
- Relative imports name the TypeScript file. `.js`, `.mjs`, `.cjs`, `.jsx` and extensionless relative specifiers are errors, so code that passes Vitest also runs under Node.
- schema, content and sim-core compile without DOM or Node types. Lint bans UI, timer and I/O globals there, including `globalThis`, `self` and `global`.
- sim-core also bans `Date`, `performance`, `Temporal`, `crypto`, `Math.random`, `WeakRef` and `FinalizationRegistry` (ground rule 2). These bans cover sim-core's own `src/`. Schema code that sim-core calls follows schema's rules, which allow `Date` and `Math.random`.
- The import rule covers `.ts`, `.tsx`, `.mts` and `.cts` files. The package-map and purity rules also cover `.js`, `.jsx`, `.mjs` and `.cjs` files, so a stray JavaScript file is no way around them. `eslint-disable` comments have no effect in `packages/`, and `pnpm lint` fails on any warning. A rule that is wrong gets fixed in `eslint.config.js`, in review.
- Lint catches every ordinary form. Deliberate workarounds it cannot see are left to review. None of them happens by accident in ordinary code:
  - a template path that climbs with `..` after its first `${}`
  - a committed symlink
  - an alias in tsconfig or a bundler config
  - a package export that points outside `src/`
  - a global reached indirectly (`Function('return this')()`, `Reflect.get(Math, …)`, `Intl` date formatting)
- Left to the sim-core tasks and not linted, but needed for determinism across devices: sim-core's own maths. `Math.sin`, `cos`, `tan`, `atan2`, `exp`, `log`, `pow` and `hypot` may differ between browsers; `+ - * /` and `Math.sqrt` are exact. Keep such maths inside Rapier or one deterministic module, and iterate parts and wires in a stable order (for example sorted by id).

## Decisions queued for Drew

These are in the decision queue (`python3 .claude/plans/pharao.py decision list`). The build proceeds on each default until Drew answers.

- D11, Rapier's size. Default: accept it, and lazy-load the WebAssembly at the first Run.
- D12, UI framework. Default: React 19 in app and parent; canvas stays framework-free. React is not installed until a task needs it.
- D13, sync host. Default: none yet; the store syncs through a pluggable `SyncRemote`.
- D14, browser baseline. Default: iPadOS/Safari 17+, Chrome/Edge 120+ and Firefox 120+. ES2023 (the TypeScript `lib`), WebGL2 and WebAssembly are required; WebGPU is optional.
