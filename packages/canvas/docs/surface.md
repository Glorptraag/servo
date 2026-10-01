# Drawing, input, Run mode and the list view

Back to the [README](../README.md). The types are in [src/interface.ts](../src/interface.ts).

## Drawing (task 3.1)

- Canvas units are millimetres, as in the schema's geometry: x to the right, y down, rotations clockwise. Mounted and carried parts sit where `canvasPoseOf` and `placeParts` put them.
- Layers, bottom to top (brief Section 9): arena floor and props, grid, chassis, mechanical linkages, parts, wires, ports and handles, hints. Wires stay above parts so a connection is always readable; hints never cover a port.
- The canvas fills its host and follows the host's size, so tucking an edge gives it the room. `fit()` and `setZoom()` (up to 400%, brief Section 13) serve the app's zoom control; pinch and wheel zoom too, and each fires `zoom`.
- Art comes from `resolveArt(identity.art)`, the swap registry the app injects. A key with no entry gets a neutral tile in the part's proportions. A part on a mirrored mount point, directly or through its host, is drawn as its mirror image (`canvasPoseOf(...).mirrored`).
- Ports and wires use the schema's `PORT_TYPE_STYLE`: colour, line style and socket shape together, so colour is never the only cue. Ports are hollow when empty and filled when connected.
- Sizes at default zoom: ports are 44 px targets, parts 96–160 px tiles, wires 6 px with a 24 px hit area.
- Prefs: `dragSensitivity` scales the drag threshold and drop forgiveness, `leftHanded` puts the canvas's own handles (rotate, bin) on the other side (both D44), `highContrast` swaps the palette and keeps the line styles and socket shapes, and `typeface` sets the type of labels, callouts and the list view.

## Input (tasks 3.2–3.4)

- Touch and pointer are equals: tap or click to inspect, drag to place or wire, pinch or scroll to zoom, drag on empty canvas to pan. No long-press, no double-tap, no two-handed gestures.
- Tap-then-tap is a full alternative to every drag. A tray tile or an arena-strip prop comes in through `beginPlacement` or `beginPropPlacement`, with the dragging pointer or without one; dropping a part, wire or prop on an element given to `setRemoveTargets` (the tray, the arena strip) removes it, as the bin does.
- Moving a part off its mount or shaft takes it off, and near another free mount point it re-snaps there (D34). Removing a part says which parts it leaves loose (D35).
- Selecting a part dims everything not connected to it by one step; selecting a wire highlights both ports and says what flows on it. Hint rungs (pulse part, pulse port, ghost wire) draw on the same layer as these focus states (task 3.4).
- Keys: Delete removes the selection in Build mode; Enter flips a selected manual switch in Run mode (D42). Space belongs to the app's Run and Stop.

## Run mode (task 3.5)

`setMode('run')` locks the build and expands the arena. The app then passes one `RunFrame` per tick, at its own pace (the spin-up, slow motion). The canvas draws:

- dots along wires from `frame.flows`, red for power and yellow for signal, moving with the current;
- wheels turning at the simulated rpm, servo arms at their angle, LEDs at their light;
- the buzzer's visual twin, and every other sound's twin from `sound` events;
- a stalled motor's shudder, and tipping from a body's pitch and roll;
- the robot moving in the arena: each body from its `motion`, and each part riding on it placed by `placeParts`.

Tapping, clicking or pressing Enter on a manual switch flips it: the canvas fires `control`, and the app passes it to `Simulation.input`. `setMode('build')` returns to the build exactly as it was; the canvas never writes to the blueprint in Run mode.

A read-only canvas (D43: a shared link, a phone replay) draws the same frames, refuses every edit and fires no `control`. The app shows the replay with "keep a copy" beside it.

## The list view (task 3.6)

- DOM beside the surface, for screen readers and keyboards. It lists every part with its ports, their wires and, in Run mode, live readouts; every wire as a line of plain words with real names (`DC motor, plus (+) connected to battery pack, plus (+)`); and every prop in the arena.
- `actionsFor(part, port, wire or prop)` gives the same actions the canvas has: place (`placementsFor`, `propPlacementsFor`), move (to the free spot, or onto any free mount point or shaft), turn a quarter turn either way, wire, mount, configure and remove. In Run mode it gives switch flips and inspection; read-only, inspection only.
- It offers only legal actions, so it never meets an impossible drop. `perform` goes through the same command layer as touch and pointer.
- The rung the hint ladder shows is read out from `hint.line`.
- `listView` exposes the same model to the app and to the e2e harness's parity checks (task 3.8).
