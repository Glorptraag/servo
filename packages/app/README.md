# @servo/app

The child's app: shell, tray, library, spec card, Run bar, arena strip, challenges, hints, store, offline and sync, sound and accessibility. It puts the other packages together: content gives the records, the canvas draws and edits the build, sim-core runs it. It depends on schema, content, sim-core and canvas. Only tools imports it whole; parent imports only `@servo/app/store`. Phases 4 to 6 own it; task 0.4 owns this interface and the store's types. UI framework: React 19 with Vite (D12 default), from task 4.1.

| Export | Owner | What |
| --- | --- | --- |
| `@servo/app` | 4.1 | `mountApp(host, options?)`, started by the web build ([src/main.tsx](src/main.tsx)) and the e2e harness: the shell round the canvas. It opens the store from task 4.9 |
| `@servo/app/store` | 0.4 types, 4.9, 5.5, 5.6 | `openStore(options)`, the store's types and content's types ([src/store/index.ts](src/store/index.ts)); `shareLinkOf` and `SHARED_BUILD_NAME` for the parent view's shared links (task 5.6) |
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

- **Content.** `openStore()` loads it once, and `mountApp` takes it from the store (or from `loadContent()` itself when the device's storage cannot be opened); the app passes `content.catalogue` and a `resolveArt` built from `content.art` to `mountCanvas`.
- **Canvas.** The app listens to `edit` (Undo history and saving), `select` (spec card), `placement` (tray and arena strip) and `control` (switch flips). Its own changes (settings, name, arena and Reset arena, the hint ladder's do-it) go through `canvas.apply`, so every change to a build is an `EditCommand`.
- **sim-core.** Run snapshots tick 0 and switches the canvas to Run mode. After a one-second spin-up, a wall-clock driver steps the simulation at 30 ticks a second or in slow motion, and passes each frame to the canvas, spec card, sound layer and challenge runner. Stop records the Run, restores tick 0 and returns the canvas to Build mode, where the build is exactly as it was (ground rule 4). An unchanged build keeps its Simulation and seed (D37).
- **Shared links** open a read-only canvas and replay the build (D43), with no store opened ([below](#shared-links)).

Details: [docs/run-loop.md](docs/run-loop.md).

## Running it

From the repository root, `pnpm dev` serves the app and `pnpm build` writes it to `packages/app/dist`; both run `pnpm art` first. `pnpm --filter @servo/app preview` serves the build, and `pnpm --filter @servo/app test` runs the unit and browser tests ([docs/shell.md](docs/shell.md), "Tests").

A release (`pnpm release:dry`, or a `v*` tag; [packages/tools/src/release/README.md](../tools/src/release/README.md)) bakes in the app version, the content version and, in a tester build, the hashes of the invite codes. A tester build opens on the invite form, a plain page with one field, before anything else, and remembers an accepted code on the device. `/settings` shows both versions; a build made any other way has no gate and shows "Not a release build" there.

## The store

Local-first on Dexie and profile-scoped: blueprints keyed by `meta.id`, run records and card-game results. Loading migrates and validates, and a document that fails stays stored. A content defect never stops the store opening. Sync goes through a pluggable `SyncRemote`, off until one is configured (D10, D13); two devices' copies of one blueprint are both kept. On first run the app makes a profile, "Builder 1", and an empty "Build 1"; after that it opens the one profile's newest build. The build saves itself a second after each edit, and at once on Run and when the page is hidden or left; Save in the header stores it at once, and a tap on the build's name renames it. Two tabs on one build keep both versions, and a device that cannot keep builds still builds, with a line saying so. Details: [docs/store.md](docs/store.md).

## Offline and sync

Task 5.5. The full sandbox and every level work with no network, and builds sync on reconnect with the project's conflict rule: the latest blueprint wins its id, and both versions are kept (brief Section 6).

### Offline ([src/offline/](src/offline/))

- **What is kept.** Content is baked into the build (`loadContent()` reads it with `import.meta.glob`), so every level ships with the app; "downloaded" means the app was opened online once. The store is local-first (task 4.9), so builds, Runs and card games are kept on the device whatever the network does.
- **The service worker.** `vite build` writes `/sw.js` ([plugin.ts](src/offline/plugin.ts), added in [vite.config.ts](vite.config.ts)) from [service-worker.ts](src/offline/service-worker.ts), with the build's every file written in front of it: `index.html`, every script and stylesheet, the art, and every lazily loaded chunk (Pixi's today, Rapier's WebAssembly once the Run loop loads it, D11), but not source maps or the worker itself. No dependency: the list comes from the bundle Vite writes.
- **Install.** The worker downloads every file into the cache `servo-offline-<version>`, all or nothing (`cache.addAll`, bypassing the HTTP cache). The version is a hash of the file list and of `index.html`, so any change to any file changes the worker's bytes, which is how the browser sees a new build.
- **Serving.** Same-origin GETs come from the cache, then the network; every page of the app (`/`, `/settings/`) opens on the cached `index.html`, and `startPage` reads the path as before. Nothing else is cached at run time.
- **Updates.** A new build installs beside the old one and takes over only once no page of the old one is open, so a child mid-build never has the code swapped under them; then the old cache is deleted. The first install takes the page at once (`clients.claim`), so the app is ready offline after its first online start.
- **Registering.** [main.tsx](src/main.tsx) calls `registerOffline()` ([src/offline/index.ts](src/offline/index.ts)) after `load`, so the downloads never slow the first start (D11). Only a production build registers; `pnpm dev` and the tests have no worker. A page that is not a secure context (a laptop's plain http address on the home network) cannot have one: there the app works online only. A failed registration is a console warning, never a dialog.

### Sync ([src/sync/](src/sync/))

- **The seam.** `openStore({ remote })` syncs through any `SyncRemote` ([src/store/index.ts](src/store/index.ts)). With none, which is the app today (D10, D13), the store is local-only and `sync.now()` resolves at once. `memoryRemote()` is the in-memory one for tests and the sync page. `httpRemote({ url, headers })` speaks `GET <url>/changes?cursor=` and `POST <url>/changes`; nothing in the app makes one until D13 names a host and the adult account can sign its requests.
- **When.** As the store opens (when online), on `sync.now()`, and on reconnect (the browser's `online` event). While offline (`navigator.onLine` false, or the remote unreachable: `RemoteUnreachable`) it waits in state `offline` and `now()` resolves without syncing. A remote that refuses puts it in `failed`, `now()` rejects, and it tries again 2 s later, then 4 s and so on up to 30 s. One sync runs at a time; `now()` during one runs another after it. Tabs on one device take turns through Web Locks where the browser has them; without them a change may be pushed twice, which every device takes as one. The state is for the app to show as a line if it wants one, never a dialog.
- **A sync** pulls the changes after the stored cursor, applies them and the cursor in one transaction, then pushes every waiting change (the store records one per record as it writes, task 4.9). Pushed changes stop waiting; a change recorded again meanwhile stays for the next push.
- **The version a change was made from.** Each device notes, per blueprint, the version it last sent or took (its `meta.updatedAt` and a hash of its content, in the store's `sync` table). A pushed blueprint carries it as `base`, and a kept copy carries `keptFrom` (both optional `SyncChange` fields added by this task).
- **The conflict rule**, for a blueprint arriving at a device:
  - new here: kept, with `keptFrom` when it is a copy. A removal here not yet pushed gives way to it;
  - the version this device last synced, or the same content as the one here: nothing new;
  - made from the version here, which has not changed since: it replaces it;
  - otherwise both changed since they last agreed: the later `meta.updatedAt` keeps the id, and the other is kept as its own blueprint under a fresh UUID v4, `keptFrom` naming the id, exactly as the store keeps two tabs' versions (docs/store.md, decision 15), and is pushed so every device has both. A tie keeps the version here. A version from a newer Servo is kept as it came.
  - A run of versions of one blueprint in one pull, each made from the one before, counts as its last, so a device that missed a dozen autosaves keeps at most one copy.
- **Removals.** A blueprint removed elsewhere goes only when it is the version the remover last synced and has not changed here since; otherwise it stays and is sent back to the remote. Runs and card-game results are only ever added. A profile removed elsewhere goes only when nothing of it is left here. A record for a profile this device does not hold (removed here) is left on the remote.
- **Remotes keep a log.** A pull gives every change after the cursor in the order pushed. A remote that kept only each record's latest change would lose nothing, but devices would keep copies of versions they simply had not seen.

### Tests

- **Unit, Node on fake-indexeddb** ([test/sync/](test/sync/)). The conflict fixture ([fixtures/conflict.ts](test/sync/fixtures/conflict.ts): one build changed on a tablet and a laptop, both offline) in both reconnect orders: every device, a newcomer and the remote end with the laptop's later version at the id and the tablet's as one copy, and syncing again changes nothing; a tie. Then: local-only; pull then push; sync on open; offline, then sync on reconnect by itself; an unreachable remote; a refusing one, retried; one sync at a time; a plain update; no copy of a device's own version coming back; two devices that both pushed from the same version; removals both ways; profiles, renames, runs and card games; a profile removed elsewhere; a newer Servo's version; changes it cannot read; a pull taken twice; one copy for many missed autosaves. The remotes, the HTTP one against a stand-in fetch.
- **Browser, Chromium** ([test/browser/offline.test.ts](test/browser/offline.test.ts), [sync.test.ts](test/browser/sync.test.ts)). Commands in [side-page.ts](test/browser/side-page.ts), registered in [vitest.config.ts](vitest.config.ts), drive a page in a browser context of its own, so going offline never touches the test runner. **Airplane mode:** the real production build (with its worker) is built and served with `vite preview`; opened online, it makes "Builder 1" and "Build 1" and the worker caches every file; then the context goes offline and the server is stopped, and after a reload the shell, the canvas and Save work, every file of the build loads, a save is kept across another reload, and no request of the app fails. **Sync on reconnect:** the conflict fixture on two stores in one page ([sync-page.ts](test/browser/sync-page.ts)); the context goes offline, the tablet saves and waits, the laptop's edit reaches the remote, and when the context comes back online the tablet syncs by itself and both end with both versions.

### Decisions and open questions

Taken here, conservatively:

1. A service worker written by a small Vite plugin, no new dependency (not `vite-plugin-pwa`/Workbox). No web app manifest: installing to the home screen is a product decision for Drew (it also matters for Safari's storage eviction, docs/stack.md).
2. A new build waits until every page of the old one is closed. Asking the child to reload, or reloading for them between builds, is for Drew.
3. `SyncChange` gains two optional fields, `base` and `keptFrom` (interface change, noted in src/store/index.ts). The store's database gains version 2 with one table, `sync`.
4. Sync runs on open, on `now()` and on reconnect. Whether to sync on a timer or after each save while online is for Drew (and the host's limits).
5. A profile removed on one device while a child built in it offline on another is kept on the second device, with that build. A record arriving for a profile removed here is not taken. Both for Drew (D38).
6. A blueprint removed on one device but changed offline on another is kept and sent back to the remote.
7. Concurrent pushes from two devices made from the same version can leave one copy per device that meets them. A host that rejects a push whose `base` is not its current version would prevent that: for D13.
8. Sync conflicts are not yet said in Save's line ("A copy of the other version was kept"): `syncFor`'s `onKept` is there for the app when a host exists.
9. When sync puts the other device's version at the id of the build open on the canvas, the canvas's next save keeps that version as a copy too, by the store's two-tab rule, so nothing is lost but one version may be kept twice.
10. `httpRemote`'s wire format, its authentication and where `VITE_` configuration would name its address are for D13 and task 5.1.

## Shared links

Task 5.6, in [src/sharing/](src/sharing/). Read-only links from one adult to another. There is no backend (D10), so a link carries the build itself in its URL fragment, which a browser never sends to a server, and opening one needs no network once the app is cached.

- **Making one** ([link.ts](src/sharing/link.ts)). `shareLinkOf(blueprint, catalogue, { includeName, base })` gives `<app address>#share=1.<payload>`: the canonical JSON (`serializeBlueprint`), deflated with the browser's `CompressionStream('deflate')` (zlib, whose checksum makes a changed or cut-off link fail to inflate), in base64url. No new dependency. Only an adult makes one, from the parent view behind the parental gate (D28): it is exported through `@servo/app/store`, the parent's one way into the app.
- **What it carries** (D21). A new blueprint made field by field: the build's parts, wires and arena, and a `meta` of its level and id marks, a fresh UUID v4 as its id, and the moment of sharing as both dates. Never `meta.author`, the build's own id or dates, a Run, or anything of the profile. The build's name travels only when `includeName` is true (the "include the build's name" option, unticked by default); otherwise it is "Shared build". The content fixtures' links are 0.7 to 1.1 KB.
- **Opening one** ([view.tsx](src/sharing/view.tsx)). [main.tsx](src/main.tsx) opens `mountSharedPage` in place of the child's app when the fragment starts `#share=` (after the tester invite gate, as any page), and reloads when the fragment moves into, out of or between links. The page opens no store, no profile and no gate, and writes nothing: not to IndexedDB, page storage, the address or the history. Its title is never the build's name.
- **Caps** ([limits.ts](src/sharing/limits.ts), `SHARE_LIMITS`, review R-5.6). A valid build can still be too big to open: 8,000 parts validate in under a second, then making the Simulation freezes the page, Stop included. So a link is refused, and none is made, past any of these: a fragment over **32 KB**; a payload that inflates past **256 KB**; more than **100 parts** or **200 wires**. The busiest content fixture, busy-workbench, has 25 parts and 43 wires. The fragment is measured before it is decoded; inflating feeds 256 bytes at a time (`pipeWithin`) and stops as soon as the output passes the cap, never inflating in full first; parts and wires are counted straight after parsing, before migration, validation, drawing or the replay, and again after migration.
- **Reading it** (`readShareFragment`). Never throws. Past the caps above, it refuses a payload that is not base64url, does not inflate, is not UTF-8 JSON, carries `meta.author` or any field a blueprint does not have, fails `migrateBlueprint`, or fails `validateBlueprint` against this build's content. A newer link format or blueprint version is said to be newer. The page then shows one plain line, never a dialog (ground rule 9).
- **The replay** ([replay.ts](src/sharing/replay.ts)). The Run flow of [docs/run-loop.md](docs/run-loop.md) on a read-only canvas: one Simulation from the shared blueprint, tick 0 snapshotted, Run mode, the one-second spin-up, then 30 ticks a second from `requestAnimationFrame` (a gap such as a hidden tab is skipped, not caught up). It starts on opening, except with `prefers-reduced-motion`, where it waits at tick 0 for Run (the canvas then shows each frame at once, as task 3.5 draws it); Stop restores tick 0 and Build mode, and Run again plays the same run. The seed is a hash of the build's parts, wires and arena (`seedOf`), so everyone who opens a link to a build sees the same run, tick for tick. A read-only canvas emits no control, so a replay has no switch flips. Stop and Run again is a native button (pointer, touch, keyboard, screen reader); the canvas's list view reads the build out and offers inspection only. A canvas that cannot draw frames ends the replay with a plain line, "The run cannot be shown on this device."
- **Offline.** The service worker (task 5.5) answers every page of the app with the cached `index.html` and never sees the fragment, so links open offline as online.

### Tests

- **Unit, Node** ([test/sharing/](test/sharing/)). The negative test: a real child's build in a real store (fake-indexeddb), with a profile name, a name the child gave it and a Run on record, is shared; the payload, inflated by hand, has exactly the blueprint's top-level fields and the allowed `meta` keys, and holds no profile id or name, author, build id or dates, Run id or times, and no string that is not the build's own or the shared copy's meta. The name only with the option ticked; extras on the object left behind. Every content fixture round-trips; the seed is the same for the same build and differs for another; a version 0 link migrates, and one with an author is refused. Refused: cut-off and changed links, non-links, non-JSON and non-UTF-8, an author, every extra field, unknown parts and arenas, newer formats and versions, and 50 random fragments, none of which throws. Each cap: every fixture is within them; 100 parts open and 101 are refused, making and opening; 201 wires; 500 parts in a small link and the review's 8,000, fast; a fragment over 32 KB; a small link inflating past 256 KB; and a 64 MB zero bomb, of which less than a tenth of the input is ever fed before inflating stops. The replay on the real sim-core and a stand-in canvas: spin-up, 30 ticks a second, the same frames as the build's own Run with the link's seed, Stop and Run again, a long gap, a canvas that cannot draw, Stop and dispose while loading. The service worker serves a link's page from the cache.
- **Browser, Chromium** ([test/browser/sharing.test.tsx](test/browser/sharing.test.tsx)). A link from a child's build in real IndexedDB opens on the real read-only canvas and replays, every frame drawn; Stop by pointer, Run again by touch, Stop by keyboard; no `indexedDB.open`, `localStorage` write, history entry, address change or dialog, and the store's rows are unchanged. Refused links are one line with no canvas; the build's name shows only when the link carries it, never in the title. Under emulated reduced motion the replay waits for Run. The real entry, `src/main.tsx` in [share-page.html](test/browser/share-page.html) (index.html plus a script that notes store opens and storage writes), with the link's fragment, opens the shared page (not the child's app), says "Running." and its canvas's pixels change from screenshot to screenshot; it opened no IndexedDB database and wrote nothing to page storage.

### Decisions and open questions (task 5.6)

Taken conservatively, for Drew and the orchestrator:

1. "Keep a copy" (D43's recommendation) is not built: the task says opening a link must never write into a child's store, and choosing which child would need the parental gate. `blueprints.copy` already takes a shared blueprint when Drew decides where the action lives (for example in the parent view, pasting a link).
2. The parent view's "Copy link" per build and its "include the build's name" checkbox (unticked) are in packages/parent (README there), in the row beside 5.3's Parts list through `PartsListExport`'s `actions` slot.
3. The caps (32 KB, 256 KB, 100 parts, 200 wires) are fixed numbers, not the largest Level 1–2 kit; revisit with Level 3+.
4. The shared copy gets a fresh id and the moment of sharing as its dates, so a link never names the child's build or when the child made it.
5. A link without the name says "Shared build" (schema requires a name).
6. The replay's seed comes from the build, not from a child's Run, and a replay has no switch flips: a link carries no Run (D21). Whether a link should carry one Run's seed and inputs is for Drew.
7. The replay starts on opening and runs until Stop, as a Run does; with reduced motion it waits for Run. Whether it should stop by itself is for Drew (and task 5.7).
8. A link opened in a tester build still meets the invite gate first.

## Areas and owners

| Folder | Task | Does |
| --- | --- | --- |
| `shell/` | 4.1 | Layout, tucking, the header, the zoom control (`canvas.setZoom`) |
| `tray/`, `library/` | 4.2 | Kit tiles by family; the catalogue overlay, browse-only before Level 3 |
| `spec-card/` | 4.3 | Layers by level, settings with child-sized steps and real units, live readouts, speak-it |
| `run-bar/` | 4.4 | Run and Stop, the clock, Undo, Reset arena, the spin-up |
| `challenges/` | 4.5 | Goal line, arena preset, goal detection over the Run, the tick |
| `hints/` | 4.6 | Which ladder and rung; the canvas draws them, and do-it is one `batch` |
| `store/` | 4.9, 5.5 | Persistence, and the changes sync pushes |
| `offline/`, `sync/` | 5.5 | The service worker and its build step; sync through a `SyncRemote` with the conflict rule |
| `sound/` | 4.10 | Machine sounds and UI clicks, each with a visual twin; mute persists |
| `sharing/` | 5.6 | Read-only links with the blueprint in the URL fragment and no profile data (D10, D43) |
| `a11y/`, `theme/` | 5.7 | WCAG 2.2 AA chrome, high contrast, dyslexia-friendly type, left-handed mirror |
| `telemetry/` | 6.2 | Only the events the success measures need |
| `release/` | 6.3 | What a release bakes in (`build-info.ts`), the page's start (`start.ts`: the invite gate first in a tester build, then Settings at `/settings` or the app), the invite gate, Settings, and the invite code's hash (`@servo/app/invite-code`) |
| `flags/`, `program-view/` | 6.6 | The Level 3 slot, off by default |
