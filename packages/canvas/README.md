# @servo/canvas

The build surface: renderer, placement, wiring, selection, list view and Run animation. It depends on `@servo/schema` and reaches sim-core only through `@servo/sim-core/interface` (ground rule 6). It never imports content: the app passes the catalogue and the art resolver in. Task 0.4 owns this interface, typed in [src/interface.ts](src/interface.ts); `@servo/canvas` exports those types, `mountCanvas` (task 3.1, [docs/renderer.md](docs/renderer.md)), and `applyEdit` for every command (tasks 3.2 and 3.3, [docs/placement.md](docs/placement.md) and [docs/wiring.md](docs/wiring.md)), and Run mode's drawing through `applyRunFrame` (task 3.5, [docs/run-animation.md](docs/run-animation.md)); tidy wires, the safe area and the zoom limits are task 3.7's ([docs/routing.md](docs/routing.md)). Selection, focus states and hint rungs: task 3.4, [docs/selection.md](docs/selection.md). `canvas.listView` is task 3.6's list view ([below](#the-list-view-task-36-srclist-view)).

```ts
import { applyEdit, mountCanvas } from '@servo/canvas';
const canvas = mountCanvas(host, { catalogue, resolveArt, level, prefs });
canvas.load(blueprint);
canvas.on('edit', ({ command, blueprint }) => history.push(blueprint));
```

`unlockSettings` (optional, added for the app's task 6.6) is a pure `(record, setting) => boolean` naming settings the list view offers before their `unlockLevel`. It is fixed at mount. The app's Level 3 slot passes one that names only the servo motor's angle, so the list view offers it beside the spec card's slider. It changes nothing else: the level still sets the reading load, and `applyEdit` never checked unlock levels.

## Who builds what

Every canvas responsibility belongs to a Phase 3 task, so no app task writes canvas code.

| Task | Builds |
| --- | --- |
| 3.1 | `mountCanvas` (fills and follows its host), `load`, `blueprint`, `setMode`, read-only, `fit`, `zoom`, `setZoom` and `zoom`, `setLevel`, `setPrefs` (theme, typeface), `on`, `destroy`; the layers, pan, zoom and art |
| 3.2 | `applyEdit` for every command but wiring: place, move, rotate, remove, mount, unmount, settings, arena and props, rename, `batch`; `apply` and `edit`; `beginPlacement`, `beginPropPlacement`, `cancelPlacement`, `setRemoveTargets` and `placement`; drag sensitivity |
| 3.3 | `applyEdit` for `connect` and `disconnect`; wiring by drag and tap-then-tap, the glow on approach, the push-away on a wrong type, the spring back, crowded sockets fanning out, removing wires |
| 3.4 | `select`, `selection` and the `select` event; focus states; prop selection, its bin and Delete; `showHint` and `clearHints`; the testing entry |
| 3.5 | `applyRunFrame`; Run-mode drawing; switch flips and `control` |
| 3.6 | `listView` and its DOM |
| 3.7 | `tidyWires` and the `tidy-wires` command, `setSafeArea`, zoom limits |
| 3.8 (tools) | The e2e harness and its parity checks over touch, pointer and the list view |

## The handle in brief

`load(blueprint)` validates, canonicalises and redraws, firing no `edit`. `apply(command)` takes the same path as touch, pointer and the list view. `setMode('build' | 'run')`: Run locks the build, and Build returns to it exactly as it was. `applyRunFrame(frame)` takes a `RunFrame` from `Simulation.step`. A read-only canvas (D43) refuses every edit and fires no `control`, for shared links and phone replay.

Events out: `edit` (the command and the resulting canonical blueprint), `select` (a part selection opens the spec card), `placement` (a tray part or prop landed or not), `control` (Run mode: a manual switch flipped by tap, click, Enter or the list view, D42), `zoom` and `wire` (a wire on its way by any path, task 7.8, [below](#the-wire-event-task-78)).

## One command layer (ground rule 8)

Touch, pointer and the list view only ever emit an `EditCommand`: `place-part`, `move-part`, `rotate-part`, `remove-part`, `connect`, `disconnect`, `mount`, `unmount`, `set-setting`, `set-arena`, `place-prop`, `move-prop`, `remove-prop`, `rename`, `tidy-wires`, or a `batch` of them. `tidy-wires` leaves the build as it is: routes are view state, so it fires no `edit`. One pure `applyEdit` applies them with the schema's `planWire`, id claims and canonical form, so the same steps give byte-identical blueprints on every path. A part on a mount or a shaft is stored where it holds the part. Moving a mounted part takes it off, and it re-snaps near another mount point (D34); removing a part leaves what was on it loose, says so, and Undo restores it (D35); props come only from the arena strip, in Build mode (D36). Impossible drops come back with the schema's `wire.*` codes and show as a colour cue at the socket, never as text; legal-but-wrong wiring is always accepted. Details and refusals: [docs/commands.md](docs/commands.md). Wiring by touch and pointer, the 32 px glow, the push-away and crowded sockets fanning out: [docs/wiring.md](docs/wiring.md).

## Drawing, Run mode and the list view

Canvas units are millimetres (the schema's geometry), drawn in the layer order of brief Section 9. Art comes from the injected `resolveArt`; a key with no picture gets a neutral tile, and a part on a mirrored mount point is drawn mirrored. In Run mode the canvas draws each frame it is given (dots along wires from `frame.flows`, wheels, servo arms, light, sounds' visual twins, stalls, tipping, the robot in the arena) and never writes to the blueprint. How, and the spin-up: [docs/run-animation.md](docs/run-animation.md). The list view is DOM beside the surface, offers the same legal actions as touch and pointer (including move and turn), lists the arena's props, and in Run mode flips switches. Details: [docs/surface.md](docs/surface.md). How task 3.1 draws, its scale, socket layout, layers, view and tests: [docs/renderer.md](docs/renderer.md).

## The list view (task 3.6, src/list-view/)

`canvas.listView` is the screen-reader and keyboard path (ground rule 8). Its model (`model.ts`) reads the build from the canvas and acts only through it: an edit goes to the canvas's own `apply`, the path touch and pointer take, so the same steps give byte-identical blueprints; a switch flip fires `control` (Run mode, never read-only); an inspection calls `select` (task 3.4). Its actions (`actions.ts`) are judged by the rules the canvas uses: `planWire` for every wire, `placeTargets` and `moveTargets` for mount points and shafts, the free spot for a part placed or moved without one (`defaultSpot`, `movedPartSpot`) and for a prop (`propSpot`). So it offers only legal actions, legal-but-wrong wires included, and never meets an impossible drop.

- Build mode, per part: select; move to a free spot, onto a free mount point, or (a hub) onto a free shaft; turn a quarter turn either way, a free part only, as only a free part has a rotate handle on the canvas (task 7.3, R-6.4 CAN-1); each setting unlocked at the child's level, or named by the `unlockSettings` mount option, a step up or down or another option; remove, saying what it leaves loose (D35). Per port: wire to every port `planWire` allows, remove its wires; a mount: mount on a free mount point or take it off; a mount point: mount a part on it or take one off. Per wire: select, remove; with a power or signal line, tidy wires (task 3.7: the same `tidy-wires` command as the app's button; `perform` counts it as a change when the routes changed). Per prop: select; the child's own props move to a free spot or go (D36). Twin props are numbered by shape in id order, as twin parts are (`box 1`, `box 2`), so two boxes read apart (CAN-4).
- Every mode: on what is selected, `Clear selection` (`clear-selection`, a `select` action with `selection: null`) takes the place of its Select, and its line ends `, selected` (CAN-6).
- Run mode: select, and flip a manual switch (its state from the frame's `closed` readout when frames have come, else what the list sent, else the record's starting state). Read-only: select only.
- `placementsFor(type)` and `propPlacementsFor(prop)` are the tray's and the arena strip's keyboard path: the app's tray offers them, since the canvas does not know the kit.
- Words (`words.ts`): real names from the part records, twins numbered in id order (`DC motor 1`, `DC motor 2`), ports by their labels: `DC motor 1, mounted on chassis left motor mount, plus (+) connected to switch side B`; `power line from 2-cell battery pack plus (+) to switch side A`; `box, 80 by 80 millimetres, ahead and to the left of the robot, part of the arena`. Parts and wires come in id order as a child counts (`p2` before `p10`).

The DOM (`dom.ts`) sits in the canvas's host after the canvas element: a labelled section of native lists and buttons, hidden until it takes focus and then shown over the canvas's top corner (the other corner for left-handed use), in the canvas's typeface and contrast. Shown, it takes taps and clicks as well: a press inside it moves focus to the pressed button itself, since Safari (iPadOS and macOS) does not, and would otherwise hide the panel before the press ends. It hides again when focus leaves it, on Escape, or on a press outside it (the canvas keeps focus where it was when pressed), and takes focus out with it. In Build mode each part, port, wire and prop has an Actions button that opens its actions (they are worked out only when asked for); in Run mode and read-only they show at once. Enter does an action, so Enter flips a switch; Space never does, since it is the app's Run and Stop (D42). Focus stays where it was across redraws, or falls back to the subject's Actions button. A polite live region says what each change did: what was placed, added, moved, turned, set or removed, and which parts are loose now. It says it for the list's own actions and for every edit made on the canvas by touch or pointer (bin, Delete, drags, handles), in the same words; a part's removal reads the canvas's own line after it (`Removed DC motor 1. Removed with it: 2 wires. Loose now: large wheel`), and a tap on a held part reads its held line (CAN-2). An action that changed nothing, or had gone stale, says `Nothing changed` (CAN-7).

Task 7.3 gave the model three optional `ListHost` hooks, which the surface fills: `selection()` (for Clear selection), `notice()` (the canvas's line, `placement.notice`), and `watch(listener)` (every `edit` with its command, and every change of selection). A host without them, such as the Node bench, gets the list as before. The canvas interface changed in one place, a widening: `ListAction.does` of kind `select` may carry `selection: null`. An app that reads `does.selection` should allow null; none does today.

Tests: `test/list-view/model.test.ts` builds Rolling Start, Reversed Motor and Short Circuit from the list view alone, byte-identical to the commands touch and pointer give (with and without settings), and checks every offered action is legal and every legal wire is offered on every fixture. `test/browser/list-view.test.ts` builds Rolling Start by touch, tap-then-tap, and again from the list view with every wire by keyboard, and compares the bytes. `test/browser/list-view-hands.test.ts` taps and clicks the shown panel's buttons in Chromium and WebKit (the `hands` project) and checks the panel stays open and the action happens, and that a press on the canvas or Escape hides it.

## Keyboard view and props by tap-then-tap (task 7.3)

- The handle's `select` (the list view's Select) brings what it selects into the uncovered canvas when it is not wholly there, at the same zoom, within the view's limits, with 48 px to spare; already in view it moves nothing (R-6.4 CAN-5). The arrow keys pan the view by a quarter of the uncovered canvas's shorter side while the canvas has focus, in every mode.
- A selected prop of the child's shows a Move handle beside its bin. Tap it, then tap where the prop goes: its middle goes to the free spot nearest the tap, the rule a drag grabbed at its middle follows, so the bytes match (CAN-3). Tapped again, or a tap on the prop itself, it stays. `selecting.movingProp` and `selecting.propHandlePlaces` give the state and the places; the testing entry's `handles()` still reports only the prop's bin (it is outside this task's files).
- Starting Move on a part hides the held line, so a tap where it sat is where the part goes (CAN-8). `beginPlacement`, `beginPropPlacement` and the Move handle let a waiting wire go, with its glows, an open fan, a refusal's cue and a wire's bin (`wiring.yieldToPlacement`, CAN-10).

Tests: `test/browser/list-view-parity.test.ts` (one or more per finding, CAN-1 to CAN-10 but CAN-9, which is task 7.6's) and the `R-6.4 list-view parity` block of `test/list-view/model.test.ts`.

## The wire event (task 7.8)

Interface change, additive: `CanvasEventMap` gains `wire`, a `WireEvent` carrying `{ wire: WireInProgress | null }`, where a `WireInProgress` is `{ path: 'drag' | 'tap' | 'list', from: PortRef, towards: PortRef[] }`: where the wire starts and every port `planWire` lets it join, legal-but-wrong ones included, sorted by `part.port`. The app's spec card steps aside on it, so it never covers a port being wired on any path (R-6.4 APP-7, D66). Nothing else in the interface changed.

- On the canvas (`wiring/controller.ts`): it fires as a drag draws a wire from a socket, or as a tapped socket's wire waits for its second tap, and again when a waiting wire is picked up and dragged (path `tap` to `drag`). It fires null when the wire lands, springs back, is let go by a tap elsewhere or by a placement (`yieldToPlacement`), when the build changes under it, and when Run begins. Drag behaviour is unchanged.
- In the list view (`list-view/dom.ts`): opening a port's Actions in Build mode, when they offer wires to make (`connect` from that port), begins a wire towards the ports they name. It ends when those Actions close, when any list action is done (the wire landed, or the child chose something else), when the panel hides (Escape, focus leaving, a press outside) and when Run begins. The Actions stay open after a wire lands, as before; they begin a new wire only when opened again.
- One wire at a time (`wiring/progress.ts`): the latest still on its way is reported. Repeated reports of the same path and source fire nothing. Never fires on a read-only canvas.

Tests: `test/browser/wire-event.test.ts` (drag and tap-then-tap by touch and mouse, landed and let go; the list view by keyboard, landed, closed and hidden; Run). The app's `test/browser/spec-card-aside.test.tsx` makes a wire to a socket under the open card on all three paths.

## Tap-path gaps: a wheel off its shaft, a buried line (task 7.9)

No interface change. Review R-7.6 found two gaps on touch tap-then-tap and pointer click-click:

- **A tap on the moving part's own tile** (placement.md, decision 7 as revised). While the Move handle moves a part, a tap on the part itself places it when the tap is a spot it can go: within reach of a mount point it can re-snap onto, or, for a part a mount or shaft holds, a free spot exactly where tapped. A loose part tapped on its own tile stays put, never nudged by the tap's offset. Only a tap that is no such spot leaves the part where it is. So a wheel off its shaft reaches a free spot on its own tile, as a drag and the list view do. Props are unchanged: a tap inside a prop's own outline still lets it be (task 7.3).
- **A line no press reaches is drawn with a bend** (routing.md, "Every line can be pressed"). Where sockets and the lines drawn over a line cover all of it, the canvas draws it with a bend out to the nearest clear spot outside every part body, leaning away from the build's middle, so it shows and its whole 24 px hit area reaches it there. Touch, pointer and the list view all select and remove it. This is a visual change, intended, on builds with such a line: of the content fixtures, `kit-circuit-crew`, `busy-workbench`, `light-until-the-wall-led-on-plus` and `stop-the-motor-driver-hung-off-plus`; of the schema fixtures, `short-circuit` and `bumper-robot`.

Tests: `test/routing/exposure.test.ts` (the bend, pressability on every fixture with and without tidying, determinism), `test/browser/tap-paths.test.ts` (both gaps by touch and mouse, a drag and the command as references, decision 7 for a mounted part), and the e2e parity tours, which now move a carried wheel and remove the fixture's longest line without stepping round either (packages/tools/src/e2e/README.md).

## Testing entry (task 3.4)

`@servo/canvas/testing` exports `probeCanvas(handle)`, for packages/tools' e2e harness (task 3.8) and this package's tests only. Lint keeps it out of every other package's `src/` (`toolsOnly` in eslint.config.js): the app reaches the canvas through `@servo/canvas` alone, and the entry is not part of `interface.ts`. A probe gives, at the current view, both on the canvas plane (mm) and on the page (CSS pixels, as `clientX`): where each part, its tile's corners, each socket (and where it takes a press now, fanned out or not), each wire and its middle, and the shown handles and bins sit. It also gives `ready`, `settled`, `gridOpacity`, the canvas element, the view and `setView(centre, zoom)` (without the limits), `requestFrame`, `pageOf`/`worldOf`, how a part or wire is emphasised, and the selected wire's label and where its pill sits (`wireLabelBox`). The harness can read these instead of the renderer's members.

## Frame time (task 3.1)

`test/browser/frame-time.test.ts` holds the 16 ms frame budget on the 25-part fixture in the iPad profile, with the CPU slowed 4× through CDP. It runs in the `performance` project, through `pnpm --filter @servo/canvas perf` or `pnpm perf` at the root and in CI's `perf` job, never in `pnpm test`, so a busy machine's timings never fail the correctness run.

- **What is timed.** A frame's main-thread work: every `requestAnimationFrame` callback the page runs, the canvas's own included, timed and summed per frame (its input and its drawing). Not the interval between frames, which a software GPU decides.
- **Samples.** One run of the pan, wheel and pinch is one sample. On CI's shared runners with SwiftShader one sample's p95 has read from 8.1 to 37.8 ms for the same code, and the first sample after mounting is nearly always the slowest. So each test re-fits the view and takes five samples, printing every one (`[frame time] pictures, sample 3 of 5: median …, p95 …`).
- **The gate.** The best sample, the one with the lowest p95, must have its median and p95 frame within 16 ms, and on a hardware GPU arrive at 50 fps or better; it is printed as `best of 5 samples`. This is how sim-core's tick cost is measured (the fastest of 15 batches): a busy runner only ever adds time, so the best run is the nearest to what the code costs. The budget is the one task 3.1 set, over a whole run with every frame counted. A change that slows frames slows every sample, the best one too, so it still fails.
- **Why not the median of the samples.** Tried first: on one noisy runner Run mode's samples read 10.0 to 24.5 ms and their median 19.7 ms, with no change to the code. That gate would still fail on the runner, not on the code.
