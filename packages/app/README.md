# @servo/app

The child's app: shell, tray, library, spec card, Run bar, arena strip, challenges, hints, store, offline and sync, sound and accessibility. It puts the other packages together: content gives the records, the canvas draws and edits the build, sim-core runs it. It depends on schema, content, sim-core and canvas. Only tools imports it whole; parent imports only `@servo/app/store`. Phases 4 to 6 own it; task 0.4 owns this interface and the store's types. UI framework: React 19 with Vite (D12 default), from task 4.1.

| Export | Owner | What |
| --- | --- | --- |
| `@servo/app` | 4.1 | `mountApp(host, options?)`, started by the web build ([src/main.tsx](src/main.tsx)) and the e2e harness: the shell round the canvas. It opens the store from task 4.9 |
| `@servo/app/store` | 0.4 types, 4.9, 5.5 | `openStore(options)`, the store's types and content's types ([src/store/index.ts](src/store/index.ts)) |
| `@servo/app/invite-code` | 6.3 | The tester invite code's reduction and hash, `normalizeInviteCode` and `hashInviteCode` ([src/release/invite-code.ts](src/release/invite-code.ts)). Pure: no DOM, React or Node. The release in packages/tools imports it, so the hashes it bakes in are the ones the invite gate makes |

## The shell (brief Section 9)

| Region | Where | Build mode | Run mode |
| --- | --- | --- | --- |
| Canvas | The whole screen, behind the edges; at least 70% of it uncovered | Parts and wires editable | Locked; values animate; the robot moves |
| Part tray | Left edge; bottom in portrait | The kit's tiles by family; Library button | Hidden |
| Spec card | Right edge, 320 px wide; slides in on `select` of a part, out when none; steps aside while the child drags | Layered text by level; settings | Live readouts |
| Run bar | Bottom centre, always visible, never moving | Run, clock speed, Undo, Reset arena | Stop, slow motion |
| Arena strip | Top of the canvas, expands on Run | Preset picker; props to drag in (D36) | The arena around the robot |
| Header | Top edge, thin | Kit and level, the goal line, Home, Save, the blueprint's name | The goal ticks when met |

The canvas fills the screen, and the chrome over it (header, tray, spec card, Run bar, zoom control and tabs) never covers more than 30% of it; the arena strip is part of the canvas. The header, tray, spec card and arena strip tuck away; the Run bar never tucks or moves. Tuck states persist, and the left-handed preference mirrors the tray and spec card. Keys: Space is Run and Stop; Enter flips a selected switch during a Run (D42). How the shell does it, its slots and `useShell()`: [docs/shell.md](docs/shell.md).

## How the packages meet

- **Content.** `openStore()` loads it once (until task 4.9, `mountApp` calls `loadContent()` itself); the app passes `content.catalogue` and a `resolveArt` built from `content.art` to `mountCanvas`.
- **Canvas.** The app listens to `edit` (Undo history and saving), `select` (spec card), `placement` (tray and arena strip) and `control` (switch flips). Its own changes (settings, name, arena and Reset arena, the hint ladder's do-it) go through `canvas.apply`, so every change to a build is an `EditCommand`.
- **sim-core.** Run snapshots tick 0 and switches the canvas to Run mode. After a one-second spin-up, a wall-clock driver steps the simulation at 30 ticks a second or in slow motion, and passes each frame to the canvas, spec card, sound layer and challenge runner. Stop records the Run, restores tick 0 and returns the canvas to Build mode, where the build is exactly as it was (ground rule 4). An unchanged build keeps its Simulation and seed (D37).
- **Shared links** open a read-only canvas: a replay with "keep a copy" (D43).

Details: [docs/run-loop.md](docs/run-loop.md).

## Running it

From the repository root, `pnpm dev` serves the app and `pnpm build` writes it to `packages/app/dist`; both run `pnpm art` first. `pnpm --filter @servo/app preview` serves the build, and `pnpm --filter @servo/app test` runs the unit and browser tests ([docs/shell.md](docs/shell.md), "Tests").

A release (`pnpm release:dry`, or a `v*` tag; [packages/tools/src/release/README.md](../tools/src/release/README.md)) bakes in the app version, the content version and, in a tester build, the hashes of the invite codes. A tester build opens on the invite form, a plain page with one field, before anything else, and remembers an accepted code on the device. `/settings` shows both versions; a build made any other way has no gate and shows "Not a release build" there.

## The store

Local-first on Dexie and profile-scoped: blueprints keyed by `meta.id`, run records and card-game results. Loading migrates and validates, and a document that fails stays stored. A content defect never stops the store opening. Sync goes through a pluggable `SyncRemote`, off until one is configured (D10, D13); two devices' copies of one blueprint are both kept. Details: [docs/store.md](docs/store.md).

## Areas and owners

| Folder | Task | Does |
| --- | --- | --- |
| `shell/` | 4.1 | Layout, tucking, the header, the zoom control (`canvas.setZoom`) |
| `tray/`, `library/` | 4.2 | Kit tiles by family; the catalogue overlay, browse-only before Level 3 |
| `spec-card/` | 4.3 | Layers by level, settings with child-sized steps and real units, live readouts, speak-it |
| `run-bar/` | 4.4 | Run and Stop, the clock, Undo, Reset arena, the spin-up |
| `challenges/` | 4.5 | Goal line, arena preset, goal detection over the Run, the tick |
| `hints/` | 4.6 | Which ladder and rung; the canvas draws them, and do-it is one `batch` |
| `store/` | 4.9, 5.5 | Persistence and sync |
| `sound/` | 4.10 | Machine sounds and UI clicks, each with a visual twin; mute persists |
| `sharing/` | 5.6 | Read-only links with the blueprint in the URL fragment and no profile data (D10, D43) |
| `a11y/`, `theme/` | 5.7 | WCAG 2.2 AA chrome, high contrast, dyslexia-friendly type, left-handed mirror |
| `telemetry/` | 6.2 | Only the events the success measures need |
| `release/` | 6.3 | What a release bakes in (`build-info.ts`), the page's start (`start.ts`: the invite gate first in a tester build, then Settings at `/settings` or the app), the invite gate, Settings, and the invite code's hash (`@servo/app/invite-code`) |
| `flags/`, `program-view/` | 6.6 | The Level 3 slot, off by default |
