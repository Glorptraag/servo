# The renderer (task 3.1)

Back to the [README](../README.md). The contract is [src/interface.ts](../src/interface.ts) and [surface.md](surface.md); this page says how task 3.1 meets its part of it: `mountCanvas`, `load`, `blueprint`, `setMode`, `fit`, `setZoom`, `zoom`, `setLevel`, `setPrefs`, `on` (`zoom`) and `destroy`, the layers, pan, zoom, the grid and the art. Members later tasks build throw an error that names the task.

## Files

| Path | What it does |
| --- | --- |
| `src/scene/units.ts` | Sizes: the brief's pixels at default zoom, in canvas millimetres |
| `src/scene/layout.ts` | A part's tile and where its sockets sit, from the part record alone |
| `src/scene/scene.ts` | The scene model: every part's pose, tile, sockets, wires and linkages, in canvas mm. No Pixi |
| `src/scene/arena.ts` | Where the arena floor lies on the canvas |
| `src/scene/hit.ts` | What lies under a point: a socket, a wire, a part, or empty canvas |
| `src/scene/geometry.ts` | Plane maths with the schema's deterministic `cosSin` |
| `src/renderer/mount.ts` | `mountCanvas` |
| `src/renderer/surface.ts` | `CanvasSurface`, the handle: state, events, lifecycle, the frame loop, and the hooks for later tasks |
| `src/renderer/camera.ts` | The view (centre and zoom), `fit` and the limits. No Pixi |
| `src/renderer/input.ts` | Pointer and wheel input: pan, pinch, wheel, and the pointer hand-off to later tasks |
| `src/renderer/views.ts` | The display objects for a part and a wire |
| `src/renderer/sockets.ts` | Socket shapes |
| `src/renderer/arena-view.ts`, `grid.ts`, `art.ts`, `style.ts`, `frame-loop.ts`, `emitter.ts` | The arena, the grid, pictures, the palettes and typefaces, drawing on demand, events |

## Scale

- The canvas plane is in millimetres, x to the right and y down (packages/schema/docs/geometry.md).
- **2.5 screen pixels per millimetre at zoom 1** (`PX_PER_MM`). At that scale the example parts' true sizes fall in the brief's 96–160 px tile band: a DC motor is 115 px, a 2-cell battery pack 145 px, a large wheel 162 px. The Rolling Start robot, about 170 × 185 mm, is about 425 × 460 px, so a Level 1 build fits a 10-inch tablet's canvas without scrolling (brief Section 9). A test checks that `fit` keeps it at zoom 1 in the iPad profile.
- Every other size is the brief's pixels at default zoom converted to millimetres, so it zooms with the build: ports 44 px, wires 6 px with a 24 px hit area, linkages 10 px.

## Tiles

- A part is drawn as a tile: a rounded card in its footprint's proportions (`body.size` x by y), with its picture or its name on it.
- The tile is the footprint, scaled up evenly until its longer side is at least 96 px. A part whose sockets would overlap grows a little more, 5% at a time, until they do not. Proportions always stay true. A part bigger than 64 mm is drawn at its true size, so it passes the brief's 160 px: the large wheel is 162.5 px.
- A tile grown past its part's size can cover a neighbour's on a chassis: on the bumper robot some names show cut short ("ca" for caster). Left for now; pictures, the normal case, cover less of the tile than a name.
- Frames (parts with a mount point, so far only the chassis) are as big as they really are. They draw in the chassis layer.
- The tile turns with the part. A part on a mirrored mount point, directly or through its host, is drawn as its mirror image, flipped across its own x axis (`node.scale.y = -1`). Its picture flips with it.
- Parts draw from low to high on the robot (the height `placeParts` gives), then by depth and id. So a battery pack on the deck covers the caster hanging under the chassis.

## Sockets

- Mechanical ports sit where the record puts them (`at`), so a shaft and the hub on it, or a mount and its mount point, meet exactly.
- Power and signal ports have no place in the record. They sit side by side along the back edge (−x), centred, in the record's port order from the part's left (+y) to its right, a socket and an 8 px gap apart: like the terminals at the back of a real motor or the leads out of a battery holder. More than the back edge holds carry on round the corners, the same on both sides, keeping their spacing in a straight line. A two-port part on a short back edge (a 1-cell battery pack) has its two at the corners.
  - The first layout tried spread sockets evenly round the whole outline, so a two-port part had one at each end. Then a wire from the back socket heading forward ran straight through the front socket of its own part and looked connected to it.
- Sockets are 44 px at default zoom, as drawn and as a target. Power is a round socket, signal a square and mechanical a hexagon whose flat sides are 44 px apart (D20). Each is in its wire colour, hollow (a pale centre in a coloured ring) when empty and filled when a wire ends on it.
- Power, signal, shaft and hub sockets draw in the ports layer, above the wires. A frame's mount points draw on the frame, in the chassis layer, so a part fixed on one covers it as on a real chassis, and the free ones show where parts can go. A part's own mount is not drawn: it is under the part, and the mount point it is fixed to stands for it.
- **Known gap, for task 3.3 (review R-3.1, finding 2).** A part's sockets keep clear of each other, but not of a neighbouring part's. Where parts sit close on a chassis they overlap, at every zoom, because sockets scale with the build. On the Level 2 bumper robot: the motor driver's minus is 10 px from the left DC motor's minus, its `in-a` (signal) 10 px from the right DC motor's minus, its plus and `in-b` 26 px from the servo motor's minus, and the bumper switch's two sockets 34 px from the servo motor's arm. The socket underneath is left a sliver, neither a 44 px target nor readable as empty or connected, and `hitTest` returns only the topmost socket. Task 3.3 owns port sockets and must make every legal fixture wireable on both paths, the bumper robot included, so it solves this (options in the review's question 1). Rolling Start and the LED circuit have no overlap.

## Wires

- A wire is a straight line between the centres of its two sockets, under them, or its route once tidied (task 3.7, [routing.md](routing.md)). Power lines are solid, signal lines dashed and mechanical linkages thick, each in its colour over a darker edge (brief Section 13).
- Power and signal lines draw above parts. Drive linkages and mounts draw below parts, in the linkages layer; on a built robot they are almost always zero length.

## Layers

Bottom to top, as brief Section 9 orders them:

| Layer | Pixi object | Holds |
| --- | --- | --- |
| Arena floor and props | `arena` render group: floor, features, props | The floor, its zones, ramps, lines and walls, then the preset's and the child's props |
| Grid | `grid`, last in the `arena` group | Faint lines, while the view moves |
| Chassis | `world` render group, `RenderLayer` 1 | Frames' tiles, then their mount points |
| Mechanical linkages | `RenderLayer` 2 | Drive linkages and mounts |
| Parts | `RenderLayer` 3 | Every other part's tile and picture or name |
| Wires | `RenderLayer` 4 | Power and signal lines |
| Ports and handles | `RenderLayer` 5 | Sockets (and later the rotate and bin handles) |
| Hints | `RenderLayer` 6 | Task 3.4's hint rungs and callouts |

- One node per part carries its pose. Its tile, its sockets and a frame's mount points are children of that node, attached to different `RenderLayer`s. Moving or dimming the node moves or dims all of them together, and the layer order still holds.
- Panning and zooming change only the two render groups' transforms, on the GPU. Nothing is redrawn for a pan.
- Run mode: `setMode('run')` lays the arena floor down and brings its features and props up over 200 ms, and `setMode('build')` takes them back. In Build mode the workbench shows through, with the arena's features at 30%. The build is untouched either way.

## The arena on the canvas

A Run starts the robot's root at the preset's start pose, and every other part keeps its place relative to the root (geometry.md, D19). So the floor is laid in the same plane, with its start pose on the root's canvas pose (the inverse of the schema's `arenaPoseOf`, with its deterministic trigonometry). With no root, the canvas origin stands in.

## Pictures

- Only through the injected `resolveArt(identity.art)`. A key with no entry, or a picture that fails to load, gets the neutral tile with the part's real name, in bold, upright whatever the part's turn. While a picture loads the tile stays plain.
- A picture is fitted inside the tile less its 2 mm padding, keeping its proportions (`drawnPictureSize`, src/renderer/picture.ts: the one sizing tidy wires also routes round, D85). SVG placeholders are rasterised at 4× their 160 px (sharp on a 2× screen to about 200% zoom for a part tile). A frame's tile is bigger, so the chassis picture is already soft at 200%, and every picture and name blurs towards 400%. Rasterising by tile size and zoom is left for later (review R-3.1, finding 8).
- A frame's name sits in its top-left corner, clear of the parts on it.

## The view

- The canvas element fills its host and follows its size. Resizing the drawing buffer clears it, and the browser does that in the same frame it paints, so the canvas draws straight away after a resize: a tray or spec card sliding in never shows a blank canvas.

- `zoom` 1 is the default. The view starts with the canvas origin in the middle. `load` keeps the view, so Undo moves nothing; the app calls `fit` when it wants the build framed.
- `fit` centres the build, and in Run mode the arena too, in the canvas the safe area leaves uncovered (`setSafeArea`, task 3.7), with 48 px to spare, at the zoom that shows it all, never above 1.
- **Limits** (task 3.7 extended them, [routing.md](routing.md)): zoom from half the fitting zoom (half the default for a small build) up to 4 (400%, brief Section 13), and at least 96 px of one part always on screen in the canvas the safe area leaves uncovered. A view that is already outside the limits (after a `load`, say) may move back but never further out, so a limit never makes the view jump.
- `zoom` fires whenever the zoom changes: pinch, wheel, `fit` or `setZoom`.

## Input

- Pointer events, so mouse, touch and pen share one path. The canvas element has `touch-action: none`, no text selection and no long-press callout.
- Drag on empty canvas to pan. A drag starts after 8 px divided by `prefs.dragSensitivity` (D44), then moves the whole way from the press, so the canvas stays under the finger.
- Two pointers pinch: the spread zooms about the point between them and that point pans the view. Two fingers always move the view, wherever they land.
- The wheel zooms about the pointer; a trackpad pinch (ctrl-wheel) zooms faster. Safari on macOS sends a trackpad pinch as WebKit gesture events instead, which the canvas does not handle yet, so there it may zoom the page (unverified: the tests run in Chromium; task 3.8's harness should add WebKit).
- No long-press, no double-tap. A drag that starts on a part, wire or socket does nothing yet: it belongs to placement, wiring or selection (tasks 3.2–3.4).

## The grid

Faint lines every 10 mm, with a stronger line every 50 mm, stepping to 50, 250 mm and on as the view zooms out so lines stay at least 18 px apart. It fades in over 120 ms when the view moves and out over 200 ms once nothing has moved for 600 ms and no finger is down. It is drawn once over an area three views across, with hairlines one device pixel wide, and redrawn only when the view leaves that area or the spacing steps.

## Drawing on demand

The canvas draws a frame only when something changed: the view, the build, a picture arriving, a fade. At rest it asks for no frames at all (brief Section 11: no idle animation). Pixi's own scheduler, which would otherwise ask for a frame at every refresh, is advanced from the canvas's frames instead. `prefers-reduced-motion` makes every fade instant.

## Prefs and level

- `highContrast` swaps the palette (white workbench, black edges, stronger wire and socket colours) and keeps every line style and socket shape.
- `typeface` sets the name's font stack: a rounded sans-serif, or a dyslexia-friendly face. The canvas loads no fonts.
- `dragSensitivity` scales the pan threshold. `leftHanded` places handles, which come with tasks 3.2 and 3.4.
- `setLevel` stores the level. The only text the renderer writes, a neutral tile's name, shows at every level; the list view and callouts will read it.

## Hooks for the later canvas tasks

- `surface.input.handlers` (3.2–3.4): offered every new pointer, with what it landed on, before the view takes it.
- `surface.scene` and `surface.hitAt(screen)`: the geometry for snapping, wiring and selecting.
- `surface.partView(id).setPose(pose)` and `surface.wireView(id).draw(wire, palette, from, to)` (3.2, 3.3, 3.5): move a part's node or redraw a wire between given ends.
- `surface.setEmphasis({ parts, wires, ports })` (3.4): dims parts and wires by one step and rings parts, wires and sockets.
- `surface.layers.hints` with `surface.overlays` as the logical parent (3.4): where hint rungs draw, above everything.
- `surface.wakeGrid()` (3.2, 3.3): keeps the grid up during a drag. `surface.requestFrame()` after changing a display object directly.

## Tests

`vitest.config.ts` has four Vitest projects. `pnpm --filter @servo/canvas test` runs unit, browser and hands; `test:unit` and `test:browser` run them apart. `pnpm --filter @servo/canvas perf` runs performance alone, as `pnpm perf` at the root and CI's perf job do, so frame times never fail the correctness run. The browser projects need Playwright's Chromium and WebKit once per machine: `pnpm --filter @servo/canvas exec playwright install chromium webkit` (CI adds `--with-deps`).

- **unit** (Node): layout, scene, hit testing, the camera, the arena's place and the 25-part fixture's validity.
- **browser** (headless Chromium, the iPad profile: 1180 × 820 CSS pixels at device scale factor 2, rendered on SwiftShader so pixels match on every machine): mounting, following the host's size with no blank frame, `load`, modes and their fades (instant with reduced motion), prefs, pan, pinch, wheel, `fit`, limits, the grid fade, no frames at rest, and the layer order. Layer order is checked with pixel probes on real screenshots where two layers overlap (a wire over a part, an empty socket on a wire, a linkage under a part, a part over the chassis, a hint over a socket, the grid over the floor and under the chassis), and with three whole-image snapshots in `test/browser/__screenshots__/`, one for every platform.
- **performance**: the 25-part fixture (`test/fixtures/twenty-five-parts.json`: Rolling Start, the bumper robot, the LED circuit and a microcontroller, 39 wires) panned, wheeled and pinched one input per frame with the CPU slowed 4× through CDP, on the machine's GPU. Each test takes five samples of the gestures and prints each; the best sample's (lowest p95) median and p95 frame main-thread work must both be within 16 ms (README, "Frame time"), and on a hardware GPU frames must arrive at 50 fps or better; median, p95, worst and the frame rate are printed. On an M1 Max: median 1.6 ms, p95 4.4 ms with pictures, at 60 fps. A software GPU (CI) draws this frame size far below 60 fps whatever the page does, so there the test runs fewer frames, measures the main thread and only prints the frame rate. It runs after the other projects, alone.
- **hands** (headless Chromium and WebKit, Safari's engine, in a touchscreen context of the same size): the list view by tap and click, through Playwright's own input rather than CDP, so it runs in both engines. The other browser files drive input through CDP, which only Chromium has.
- The browser tests have not yet run on CI's ubuntu runner. The reference screenshots come from SwiftShader on macOS arm64, and the comparison allows 0.5% of pixels to differ. Failed comparisons write their diffs under `node_modules/.vitest-screenshots`.

## Decisions and open questions

Taken here, conservatively, and listed for Drew (decision D55 should carry all ten):

1. Scale: 2.5 px per mm at zoom 1.
2. Where power and signal sockets go (the record has no place for them): side by side on the back edge, in port order.
3. A tile grows past its true size for small parts (to 96 px) and for crowded sockets.
4. Mount points draw on their frame, under the parts fixed to them; a part's own mount is not drawn.
5. A mirrored part's picture is flipped with it, as the contract says. With the placeholder art's one view, that puts its light at the bottom left. The art README suggests a view per side (its question 3).
6. Labels: only a neutral tile's name, at every level. Port labels and polarity marks are not drawn.
7. The trackpad's two-finger scroll zooms, as the brief says the scroll wheel does, rather than panning.
8. Fonts: rounded and dyslexia-friendly stacks that fall back to the device's fonts; which faces ship is the app's call.
9. Build mode shows the arena's features faintly (walls, zones, lines, props and the floor's 6 mm edge at 30%); Run mode lays the floor down. The view does not move on Run: the app calls `fit` to show the whole arena.
10. A one-finger drag on empty canvas pans on touch too, not only with a mouse. The brief's touch path pans with two fingers, and the orchestrator asked for drag-on-empty panning without naming a path. A near miss when dragging a part then moves the view (review R-3.1, question 2).
