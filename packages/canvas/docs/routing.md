# Tidy wires and zoom limits (task 3.7)

Back to the [README](../README.md). The contract is [src/interface.ts](../src/interface.ts) and [commands.md](commands.md). This page covers task 3.7's part:

- `tidyWires` and the `tidy-wires` command;
- the router;
- `setSafeArea`;
- zoom limits that keep the build on screen (brief Sections 9 and 10, D66, D70, D85).

## Files

| Path | What it does |
| --- | --- |
| `src/routing/commands.ts` | `tidy-wires`, one more reducer in `applyEdit`'s table, and `TIDY_WIRES_ACTION`, the list view's twin of the button |
| `src/routing/router.ts` | `routeWires(scene)`: a route for every power and signal line that crosses a part body. Pure and deterministic |
| `src/routing/shapes.ts` | Drawn bodies, grown bodies, tiles and socket squares as convex shapes; entering one's inside, and rays through them. Pure |
| `src/routing/controller.ts` | The routes the canvas draws: set by `tidy-wires`, kept while they fit the build |
| `src/routing/exposure.ts` | `exposeWires(scene, routes)`: a bend for every line no press reaches (task 7.9). Pure and deterministic |
| `src/routing/view.ts` | The safe area, the uncovered canvas, and where the view may go so the build stays on screen. Pure |
| `src/renderer/picture.ts` | The renderer's own picture sizing, free of Pixi: `views.ts` draws with it, and the router and its tests measure with it |

Outside `src/routing/`, kept small:

- the interface: `TidyWires`, `CanvasSafeArea` and `setSafeArea`;
- `applyEdit` registers the reducer;
- the camera works in the uncovered canvas;
- `WireView` draws a route, `PartView.drawnPicture` says how big the picture is drawn, and `hitTest` follows a route;
- the surface wires them together;
- the list view (task 3.6) offers the action;
- the app (packages/app) has the button, passes the safe area on, and fits the first load.

`setSafeArea` is a new required member of `CanvasHandle`. It is additive for callers. Implementers, such as the app's test stand-in, add it.

## One path for every hand (ground rule 8)

- **The command.** Tidying is the command `{ kind: 'tidy-wires' }`, through the same `applyEdit` as every edit.
  - Routes are view state and the blueprint is frozen at v1, so its reducer gives the build back as it was.
  - The handle fires no `edit` and adds no undo step, then routes the wires.
- **Touch and pointer.** The app's Tidy wires button, beside Fit in its zoom control, calls `tidyWires()`, which is `apply({ kind: 'tidy-wires' })`. The canvas draws no button of its own.
- **The list view.** It offers the same command with every power and signal line, as `tidy-wires:<wire>` (`TIDY_WIRES_ACTION` with an id of the wire's own, so buttons stay unique).
  - `perform` counts it as a change when the routes changed. The routes map is replaced only then, and the list view's host compares it.
  - The list says "Tidied the wires round the parts".
- **Parity.** The browser tests show that the app's path, and the list view's button by finger, by mouse and by Enter, give identical routes. The app's test taps and clicks the real button.
- **Refusals.** Like every command it is refused with `edit.locked` in Run mode and on a read-only canvas, and with `edit.no_build` before a load.

## The router

- **What is routed.** Power and signal lines whose straight line crosses a part body.
  - A line that crosses nothing keeps its straight line, so tidying changes as little as it can.
  - Mechanical linkages and mounts are never routed: they lie under the parts and are almost always zero long.
- **What a body is (D85).** The picture as the renderer draws it, centred on the tile and turned with the part.
  - The canvas passes the router each part's loaded picture (its texture, the same one `views.ts` draws), and both size it with one function, `drawnPictureSize` (renderer/picture.ts): the picture's own proportions fitted in the tile less its 2 mm padding.
  - The placeholder pictures are three-quarter views, so their proportions are not the footprint's: a large wheel's picture is 18 × 22 mm, not the 55 × 22 mm its footprint box would give (review R-3.7, finding 11).
  - While a part's picture is not loaded (no entry, loading or failed), its body is the whole room a picture takes, which holds any picture that comes.
  - The rest of the tile is a hit affordance a wire may pass over.
  - Frames (the chassis) are not bodies: they are the deck the parts stand on, and wires run over them as over a real chassis.
- **What crossing means.** The wire as the child sees it. A socket is drawn over its wire's end (44 px, above the wires), so the stretch under a wire's own two sockets does not count.
  - That matters where a socket sits over another part's picture: on the bumper robot the motor driver's sockets sit over the battery pack beside it.
  - There the route climbs off the battery pack within that hidden stretch, and may start back under its own socket.
  - Running along an edge or touching a corner is not crossing.
- **The way round.** Where it can, a route leaves its socket straight out from its part's edge, on a stub just past the socket and the clearance. It then takes the shortest way round: a visibility graph over the corners of the bodies, searched with Dijkstra.
  - It tries three passes, from the roomiest:
    1. bodies grown by a 10 px clearance, with the other sockets kept clear too;
    2. bodies grown by 10 px;
    3. bodies only, where a gap is too narrow for the clearance.
  - The first pass that joins the sockets cleanly wins.
  - A socket whose stub is blocked by a neighbour goes straight to the corners. A socket over another part's picture leaves along its edge, inside the hidden stretch.
- **Boxed-in sockets.** A socket closed in on every side by other drawn bodies cannot be left without crossing one.
  - Its route crosses the least it can, on one straight run out, and is clean from there.
  - A synthetic build in the tests keeps this tested: an LED ringed by four battery packs.
  - No fixture has a boxed-in socket.
- **Deterministic.** Only arithmetic, `Math.sqrt` and `hypot`, the scene's own order, a stable sort and first-wins ties. The same scene gives the same routes byte for byte, whatever order the blueprint lists things in.
- **Cost.** `routeWires`, three runs each, on an M1 Max shared with other agents (load average about 310):

  | Build | Wall time | CPU time |
  | --- | --- | --- |
  | Busy workbench (25 parts, 32 power and signal lines) | 0.93–1.27 s | 0.16–0.29 s |
  | 25-part performance fixture | 0.49–0.67 s | 0.065–0.083 s |

  It runs synchronously in `apply`, and the work is one visibility graph per pass, shared by every wire. It has not been timed on a 2020 iPad. It should be measured there before G3, and moved to a worker if it shows.

## The fixtures

Zero crossings after tidying are asserted on five builds: the busy workbench, the 25-part performance fixture, the bumper robot, the Circuit Crew kit robot and Rolling Start.

- **Overlapping pictures.** Drawn pictures overlap only between parts mounted on a chassis, never between loose parts:
  - busy workbench: caster and battery pack, battery pack and motor driver, bumper switch and LED, buzzer with the motor driver, the LED and a DC motor;
  - 25-part fixture: casters and battery packs, battery pack and motor driver, bumper switch and servo motor.
- **Why they are kept.** Mounting places a part where its mount point puts it, so a child reaches these layouts. Placement's free-spot rule (free-spot.ts) keeps only loose parts clear of other tiles.
- **Nothing spread.** No fixture copy was changed: every wire on every fixture has a clean way round, which a flood fill in the tests confirms on the busy workbench.
- **The copy.** The canvas carries a copy of the busy workbench (`test/fixtures/busy-workbench.json`), because it may not import content. `packages/tools/test/canvas-fixture-copies.test.ts` fails if the copy drifts from content.

## Routes as the build changes

Routes are kept in the canvas, never in the blueprint.

- After any change to the build, including `load` (Undo), a route stays while both its sockets are exactly where they were and it crosses no more parts than when it was tidied.
- Otherwise its wire goes back to a straight line, like any new wire, until the child tidies again (D85, Q4: kept as built), or to a bend where a straight line would be out of reach (below).
- A drag draws the wires on a moving part straight, as before; dropping it ends their routes.
- Tidying routes every wire afresh.

## Every line can be pressed (task 7.9)

Sockets are drawn above the lines and take a press first, and a line drawn later takes a press before one under it (`hitTest`). Where parts sit close, as the list view's free spots put them, a line can lie wholly under sockets and the lines drawn over it: no press reaches it and the child cannot see it (review R-7.6 finding 2: the 1-cell battery pack's minus line runs past the pack's plus socket to a DC motor beside it).

- **When a line counts as pressable.** Some point on its path, as drawn, is clear of every socket's 44 px target and of every line drawn over it by 1 mm to spare (`PRESS_SPARE_MM`), as a press there would reach it.
- **The bend.** Otherwise the line is drawn with a bend in one stretch: out sideways to a flat stretch a hit area long, whose middle keeps half a socket and half a hit area from every socket and a whole hit area from every line over it, so the whole 24 px round it reaches the line. The nearest offset wins (1 mm steps, up to 60 mm), then the place along the stretch nearest its middle, then the left of the stretch before the right. A tidied route gets its bend in its longest stretch that can take one; a straight line in its only stretch. With nothing clear within 60 mm, the line stays as it was.
- **Top down.** Lines are taken from the top of the draw order down, since only the lines over a line can cover it, and each bent line counts as bent for those under it.
- **View state, recomputed.** The bends are part of `routes` (and so of `routeOf`, `pathOf`, `WireView.path`, `hitTest` and the testing entry's wire paths), worked out again after every change to the build. `routing.tidied` gives the tidied routes alone. They are not undo steps and never reach the blueprint. A tidy that changes nothing still changes nothing.
- **Visual change.** Most builds draw as before. Those with a buried line now draw it bent: of the content fixtures `kit-circuit-crew`, `busy-workbench`, `light-until-the-wall-led-on-plus` and `stop-the-motor-driver-hung-off-plus`; of the schema fixtures `short-circuit` and `bumper-robot`.
- **Why not fan the lines out on demand, as crowded sockets do (D86).** A fan opens on a press among overlapping targets, but a line covered only by sockets has nothing a press reaches to open it, and a press on a socket must stay a wire's start. A bend gives every line a place a finger reaches at rest, and the child sees the line.

`surface.routing` exposes `routes`, `routeOf(id)` and `pathOf(wire)`. `WireView.path` is the path a line is drawn along now, its route once tidied: the selected wire's label sits on it (task 3.4), and in Run mode the animator carries it with the line's body (`run.pathOf(id)`), so the flowing dots (task 3.5) and the label follow the route too (review R-3.7, finding 13).

## Zoom limits and the safe area

- **`setSafeArea({ top, right, bottom, left })`**, in CSS pixels from each edge of the canvas: the app's panels where they overlap the canvas (D66: at most 30% of it) and the device's insets (D70).
  - It has the shape of the app shell's `SafeArea`; App.tsx passes `onSafeArea` straight on.
  - An inset that is not a finite number from 0 throws a RangeError.
  - However much is said to be covered, at least half the canvas's width and height stays uncovered.
- **`fit`** centres the build (and in Run mode the arena) in the uncovered canvas, at the zoom that shows it all there with 48 px to spare, never above the default zoom. The app calls it after the first load.
- **`setZoom`** zooms about the centre of the uncovered canvas.
- **Zoom** stays between half the fitting zoom of the uncovered canvas (half the default for a small build) and 400%.
- **Pan and zoom never lose the build (D85).** After every pan, pinch, wheel turn or `setZoom`, a 96 px square piece of one part's drawn tile is wholly on screen in the uncovered canvas.
  - The piece is turned with the part. Across a side shorter than 96 px, it covers all of that side.
  - In Run mode the arena counts as well.
  - The limits measure the turned tile itself, not its bounding box, so a lone chassis at 400% panned into a corner, or a part at 45 degrees, stays in view.
  - Each part is its own target, so zooming in on empty workbench between two parts slides the view onto one of them.
  - The limits slide the view along their edge rather than stopping it dead.
- **Resize and safe area.** A resize of the canvas or a new safe area re-holds the view: a build left covered or off screen comes back to the nearest place within the limits, and the zoom comes back within them.
- **Load.** A view already outside the limits after a `load` may move back, or keep its distance, but never further out, so a limit never makes the view jump.

## Tests

- **`test/routing/router.test.ts`** (unit):
  - Five builds (the busy workbench, the 25-part fixture, the bumper robot, the Circuit Crew kit robot and Rolling Start) cross no drawn body after tidying. On the busy workbench that is all 43 wires: power and signal lines as routed, linkages and mounts as drawn.
  - A wire is routed exactly when its straight line crosses: the router's exact check in one direction, the sampler in the other.
  - The same routes come out every time, in any order.
  - On the boxed-in synthetic build, the route crosses the least it can and is clean from there.
  - The crossing check samples every path every 0.08 mm against the renderer's own `drawnPictureSize` for the real placeholder pictures (`test/fixtures/placeholder-art.json`, `pnpm art`'s output, which packages/tools checks against the generator), not the router's shapes. The same builds are checked before their pictures load.
  - A flood fill of the open workbench shows which sockets have a clean way.
  - The earlier "leaves each socket away from its own part" test is gone. With bodies now pictures, a route may start back under its own socket where the socket hides it, so the property no longer holds or matters.
- **`test/routing/commands.test.ts`** (unit):
  - the command gives the build back unchanged, alone and in a batch;
  - the list view's action;
  - routes kept through a rename and dropped when a socket moves or a part lands on the route;
  - hit testing along a route.
- **`test/routing/exposure.test.ts`** (unit, task 7.9): a line under sockets end to end is bent and then reached with its whole hit area; only lines no press reaches are bent; every line of every schema fixture, the Circuit Crew kit robot and the busy workbench (tidied or not) has a point a press reaches; the bend's middle keeps its distance; deterministic; the controller bends before any tidy and keeps the same map through a change that moves nothing.
- **`test/browser/tap-paths.test.ts`** (browser, task 7.9): the buried line selected and binned by touch and mouse and dragged to the tray, each giving the list view's bytes.
- **`test/camera.test.ts`** (unit):
  - fit and zoom about the uncovered centre, and the safe area's guard;
  - the reviewer's repro: a lone chassis, fit, zoom 4, `panBy(-1e6, 1e6)`;
  - turned parts in every corner;
  - re-holding after a new safe area;
  - 2000 pseudo-random gestures on the busy workbench with panels covering the canvas.
  - "Findable" is measured independently (test/helpers/findable.ts): it counts the turned tile's square pixels in the uncovered view, on a 2 px grid.
- **`test/browser/routing.test.ts`** (browser):
  - identical routes by every hand, and the list view counting route changes;
  - a routed wire drawn (by pixels) and hit along its route;
  - the pictures Pixi draws: every part type of the five fixtures, with its real placeholder picture, measured from the sprite's own bounds (`getBounds`) and compared with the body the router keeps clear of; then, against those measured pictures, a wire is routed exactly when its straight line crosses one, and no route crosses one;
  - refused in Run mode;
  - routes kept and dropped as the build changes;
  - fit and `setZoom` in the uncovered canvas;
  - re-holding on a new safe area and on a resize;
  - flings that keep the build beside the panels.

## Decisions

Settled by the coordinator for task 3.7 (D80 as superseded by D85), as defaults until Drew says otherwise:

1. A part body is the picture as the renderer draws it (`drawnPictureSize` with the loaded picture), not its tile's padding; wires keep a clearance where one fits. Frames (the chassis) are not bodies: wires run over the deck.
2. The stretch of wire under its own two sockets is exempt: it is hidden, so it does not count as crossing.
3. Only crossing wires are routed; a wire that crosses nothing stays straight.
4. Tidying makes no undo step. Routes are view state: kept while their sockets stay put, and dropped back to straight when a socket moves. Saving routes with the build would need a blueprint field, a schema question for after v1.
5. The app owns the Tidy wires button, beside Fit in its zoom control; the canvas draws none. Tidying is refused in Run mode and on a read-only canvas, like every command.
6. The app calls `fit` after the first load: `load` keeps the view (interface).
7. "Lost" means no 96 px square piece of any part's drawn tile, turned with it, is wholly in the uncovered view, or all of it across a side shorter than that.
8. A line no press reaches is drawn with a bend out to the nearest clear spot (task 7.9), rather than covered lines fanning out on a press: a line under sockets alone has nothing a press reaches to open a fan.
