# @servo/app

The child's app: shell, tray, library, spec card, Run bar, arena strip, challenges, hints, store, offline and sync, sound and accessibility. It puts the other packages together: content gives the records, the canvas draws and edits the build, sim-core runs it. It depends on schema, content, sim-core and canvas. Only tools imports it whole; parent imports only `@servo/app/store`. Phases 4 to 6 own it; task 0.4 owns this interface and the store's types. UI framework: React 19 (D12 default), installed by the first task that needs it (4.1).

| Export | Owner | What |
| --- | --- | --- |
| `@servo/app` | 4.1 | The app's entry, `mountApp(host)`, started by the web build and the e2e harness |
| `@servo/app/store` | 0.4 types, 4.9, 5.5 | `openStore(options)` and the store's types ([src/store/index.ts](src/store/index.ts)) |

## The shell (brief Section 9)

| Region | Where | Build mode | Run mode |
| --- | --- | --- | --- |
| Canvas | Centre, 70–100% of the screen | Parts and wires editable | Locked; values animate; the robot moves |
| Part tray | Left edge; bottom in portrait | The kit's tiles by family; Library button | Hidden |
| Spec card | Right edge, slides in on `select` | Layered text by level; settings | Live readouts |
| Run bar | Bottom centre, always visible | Run, clock speed, Undo, Reset arena | Stop, slow motion |
| Arena strip | Top of the canvas, expands on Run | Preset picker | The arena around the robot |
| Header | Top edge, thin | Kit and level, the goal line, Home, Save, the blueprint's name | The goal ticks when met |

Every edge tucks away and the canvas never drops below 70% of the screen. Tuck states persist, and the left-handed preference mirrors the tray and spec card.

## How the packages meet

- **Content.** `openStore()` loads and validates it once; the app passes `content.catalogue` and a `resolveArt` built from `content.art` to `mountCanvas`.
- **Canvas.** The app listens to `edit` (Undo history and saving), `select` (spec card), `placement` (tray) and `control` (switch flips). Its own changes (settings, name, arena, the hint ladder's do-it) go through `canvas.apply`, so every change to a build is an `EditCommand`.
- **sim-core.** Run awaits `createSimulation`, snapshots tick 0 and switches the canvas to Run mode. After a one-second spin-up on tick 0, a wall-clock driver steps the simulation at 30 ticks a second or in slow motion down to 1, and passes each frame to the canvas, spec card, sound layer and challenge runner. Stop records the Run, restores tick 0 and returns the canvas to Build mode, where the build is exactly as it was (ground rule 4). sim-core never sees the wall clock.

Details: [docs/run-loop.md](docs/run-loop.md).

## The store

Local-first on Dexie, profile-scoped, with blueprint CRUD keyed by `meta.id` and run records. Loading migrates (the schema's `migrateBlueprint`, task 0.3) then validates; a document that fails stays stored. Sync goes through a pluggable `SyncRemote`, off until one is configured (D10, D13), and when two devices changed one blueprint the later keeps the id and the other is kept beside it, never merged or dropped. Details: [docs/store.md](docs/store.md).

## Areas and owners

| Folder | Task | Does |
| --- | --- | --- |
| `shell/` | 4.1 | Layout, tucking, the header |
| `tray/`, `library/` | 4.2 | Kit tiles by family; the catalogue overlay, browse-only before Level 3 |
| `spec-card/` | 4.3 | Layers by level, settings with child-sized steps and real units, live readouts, speak-it |
| `run-bar/` | 4.4 | Run and Stop, the clock, Undo, Reset arena, the spin-up |
| `challenges/` | 4.5 | Goal line, arena preset, goal detection over the Run, the tick |
| `hints/` | 4.6 | The hint ladder: rungs drawn by the canvas, do-it as one `batch` |
| `store/` | 4.9, 5.5 | Persistence and sync |
| `sound/` | 4.10 | Machine sounds and UI clicks, each with a visual twin; mute persists |
| `sharing/` | 5.6 | Read-only links with the blueprint in the URL fragment and no profile data (D10) |
| `a11y/`, `theme/` | 5.7 | WCAG 2.2 AA chrome, high contrast, dyslexia-friendly type, left-handed mirror |
| `telemetry/` | 6.2 | Only the events the success measures need |
| `flags/`, `program-view/` | 6.6 | The Level 3 slot, off by default |
