# Drawing, Run mode and the list view

Back to the [README](../README.md). The types are in [src/interface.ts](../src/interface.ts).

## Drawing

- Canvas units are millimetres, as in the schema's geometry: x to the right, y down, rotations clockwise. Mounted parts sit where `canvasPoseOf` puts them.
- Layers, bottom to top (brief Section 9): arena floor and props, grid, chassis, mechanical linkages, parts, wires, ports and handles, hints. Wires stay above parts so a connection is always readable; hints never cover a port.
- Art comes from `resolveArt(identity.art)`, the swap registry the app injects. With no entry, a part is drawn as flat vector shapes from `identity.colours` and `body.size` (ground rule 12). A part on a mirrored mount point, directly or through its host, is drawn as its mirror image (`canvasPoseOf(...).mirrored`).
- Ports and wires use the schema's `PORT_TYPE_STYLE`: colour, line style and socket shape together, so colour is never the only cue. Ports are hollow when empty and filled when connected.
- Sizes at default zoom: ports are 44 px targets, parts 96–160 px tiles, wires 6 px with a 24 px hit area. Zoom runs to 400%, with limits that keep the build on screen.
- Prefs: `dragSensitivity` scales the drag threshold and drop forgiveness; `leftHanded` puts the canvas's own handles (rotate, bin) on the other side; `highContrast` swaps the palette and keeps the line styles and socket shapes.

## Input

- Touch and pointer are equals: tap or click to inspect, drag to wire, pinch or scroll to zoom, drag on empty canvas to pan. No long-press, no double-tap, no two-handed gestures for the actions a child needs.
- Tap-then-tap is a full alternative to every drag. A tray tile comes in through `beginPlacement`, with the dragging pointer or without one; dropping a part or wire on the element given to `setRemoveTarget` (the tray) removes it, as the bin does.
- Selecting a part dims everything not connected to it by one step; selecting a wire highlights both ports and says what flows on it.

## Run mode

`setMode('run')` locks the build and expands the arena. The app then passes one `RunFrame` per tick, at its own pace (the spin-up, slow motion). The canvas draws:

- dots along wires from `frame.flows`, red for power and yellow for signal, moving with the current;
- wheels turning at the simulated rpm, servo arms at their angle, LEDs at their light;
- the buzzer's visual twin, and every other sound's twin from `sound` events;
- a stalled motor's shudder, and tipping from a body's pitch and roll;
- the robot moving in the arena: each body from its `motion`, and each part riding on it placed by `placeParts`.

`setMode('build')` returns to the build exactly as it was. The canvas never writes to the blueprint in Run mode.

## The list view (task 3.6)

- DOM beside the surface, for screen readers and keyboards. It lists every part with its ports, their wires and, in Run mode, live readouts, and every wire as a line of plain words with real names: `DC motor, plus (+) connected to battery pack, plus (+)`.
- `actionsFor(part, port or wire)` gives the same actions the canvas has: place (through `placementsFor`), wire, mount, configure, remove. In Run mode it gives switch flips and inspection.
- It offers only legal actions, so it never meets an impossible drop. `perform` goes through the same command layer as touch and pointer.
- The rung the hint ladder shows is read out from `hint.line`.
- `listView` exposes the same model to the app and to the e2e harness's parity checks.
