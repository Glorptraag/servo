# Tidy wires and zoom limits (task 3.7)

Back to the [README](../README.md). The contract is [src/interface.ts](../src/interface.ts) and [commands.md](commands.md); this page says how task 3.7 meets its part: `tidyWires` and the `tidy-wires` command, the router, `setSafeArea`, and zoom limits that keep the build on screen (brief Sections 9 and 10, D66, D70).

## Files

| Path | What it does |
| --- | --- |
| `src/routing/commands.ts` | `tidy-wires`, one more reducer in `applyEdit`'s table, and `TIDY_WIRES_ACTION`, the list view's twin of the button |
| `src/routing/router.ts` | `routeWires(scene)`: a route for every power and signal line that crosses a part body. Pure and deterministic |
| `src/routing/shapes.ts` | Tiles, grown tiles and socket squares as convex shapes; entering one's inside, and rays through them. Pure |
| `src/routing/controller.ts` | The routes the canvas draws: set by `tidy-wires`, kept while they fit the build |
| `src/routing/view.ts` | The safe area, the uncovered canvas, and where the view may go so the build stays on screen. Pure |

Outside `src/routing/`, kept small: `TidyWires`, `CanvasSafeArea` and `setSafeArea` in the interface (additive); `applyEdit` registers the reducer; the camera works in the uncovered canvas; `WireView` draws a route and `hitTest` follows one; the surface wires them together.

## One path for every hand (ground rule 8)

- Tidying is the command `{ kind: 'tidy-wires' }`, through the same `applyEdit` as every edit. Routes are view state and the blueprint is frozen at v1, so its reducer gives the build back as it was: the handle fires no `edit` and adds no undo step, then routes the wires.
- Touch and pointer: the app's tidy wires button (beside Fit in its zoom control) calls `tidyWires()`, which is `apply({ kind: 'tidy-wires' })`. The canvas draws no button of its own.
- The list view (task 3.6) offers `TIDY_WIRES_ACTION`, whose `does` is the same command.
- Like every command it is refused with `edit.locked` in Run mode and on a read-only canvas, and with `edit.no_build` before a load.

## The router

- **What is routed.** Power and signal lines whose straight line crosses a part body. A line that crosses nothing keeps its straight line, so tidying changes as little as it can. Mechanical linkages and mounts are never routed: they lie under the parts and are almost always zero long.
- **What a body is.** A part's tile as drawn, the rectangle its picture or name fills, turned with the part. Frames (the chassis) are not bodies: they are the deck the parts stand on, and wires run over them as over a real chassis.
- **What crossing means.** The wire as the child sees it. A socket is drawn over its wire's end (44 px, above the wires), so the stretch under a wire's own two sockets does not count. That matters where parts overlap on a robot: the battery pack's sockets sit over the caster under it, and the route climbs out of the caster within that hidden stretch. Running along an edge or touching a corner is not crossing.
- **The way round.** A route leaves its socket straight out from its part's edge (a stub just past the socket and the clearance), then takes the shortest way round: a visibility graph over the corners of the bodies, searched with Dijkstra. Three passes from the roomiest: bodies grown by 10 px with the other sockets kept clear too; bodies grown by 10 px; bodies only. The first that joins the sockets cleanly wins. A socket whose stub is blocked by a neighbour goes straight to the corners.
- **Boxed-in sockets.** Tiles are drawn at least 96 px, bigger than small parts, so on a crowded chassis they can overlap and close a pocket round a socket. A wire from inside such a pocket cannot avoid crossing a part. Its route crosses the least it can, by one straight run out of the pocket (straight out, along the edge, or between), and is clean from there. On the busy workbench three wires (`w14`, `w20`, `w21`: from the motor driver's plus and the LED's plus and minus, boxed in by the buzzer, the LED, the switch and the motor driver) are like this; a flood fill of the open workbench in the tests proves no clean way exists.
- **Deterministic.** Only arithmetic, `Math.sqrt` and `hypot`, the scene's own order, a stable sort and first-wins ties. The same scene gives the same routes byte for byte, whatever order the blueprint lists things in.
- **Cost.** On the busy workbench (25 parts, 43 wires, about 25 of them routed) a tidy took 0.06–0.3 s of CPU on an M1 Max, measured while the machine was heavily shared; the work is one visibility graph per pass, shared by every wire. A 2020 iPad will be slower: not yet measured there, and a candidate for a worker if it shows.

## Routes as the build changes

Routes are kept in the canvas, never in the blueprint. After any change to the build, including `load` (Undo), a route stays while both its sockets are exactly where they were and it crosses no more parts than when it was tidied. Otherwise its wire goes back to a straight line, like any new wire, until the child tidies again. A drag draws the wires on a moving part straight, as before; dropping it ends their routes. Tidying routes every wire afresh.

`surface.routing` exposes `routes`, `routeOf(id)` and `pathOf(wire)`, the path a wire is drawn along. Run mode (task 3.5) should run its flow dots along `pathOf`.

## Zoom limits and the safe area

- **`setSafeArea({ top, right, bottom, left })`**, in CSS pixels from each edge of the canvas: the app's panels where they overlap the canvas (D66: at most 30% of it) and the device's insets (D70). It is the shape of the app shell's `SafeArea`, so `onSafeArea` can pass it straight on. It moves nothing on screen; `fit`, `setZoom` and the limits use it from then on. An inset that is not a finite number from 0 throws a RangeError, and however much is said to be covered, at least half the canvas's width and height stays uncovered.
- **`fit`** centres the build (and in Run mode the arena) in the uncovered canvas, at the zoom that shows it all there with 48 px to spare, never above the default zoom.
- **`setZoom`** zooms about the centre of the uncovered canvas.
- **Zoom** stays from half the fitting zoom of the uncovered canvas (half the default for a small build) up to 400%.
- **Pan and zoom never lose the build.** After every pan, pinch, wheel turn or `setZoom`, at least 96 px of one part (all of a smaller one) is on screen across and down, in the uncovered canvas; in Run mode the arena counts as well. Each part is its own target, so zooming in on empty workbench between two parts slides the view onto one of them. The limits slide the view along their edge rather than stopping it dead. A view already outside them (after a `load`, a resize or a new safe area) may move back, or keep its distance, but never further out, so a limit never makes the view jump.

## Tests

- `test/routing/router.test.ts` (unit): on the busy workbench (a copy of packages/content's fixture, `test/fixtures/busy-workbench.json`), the 25-part performance fixture, the bumper robot, the Circuit Crew kit robot and Rolling Start: no routed wire crosses a part body except where a flood fill of the open workbench shows its socket is boxed in, and then only on one straight run out; only crossing wires are routed, socket to socket; routes leave away from their parts; the same routes every time and in any order. The crossing check samples each route every 0.08 mm against every tile, apart from the router's own maths.
- `test/routing/commands.test.ts` (unit): the command gives the build back unchanged, alone and in a batch; the list view's action; routes kept through a rename and dropped when a socket moves or a part lands on the route; hit testing along a route.
- `test/camera.test.ts` (unit): fit, zoom about the uncovered centre, the safe area's guard, 96 px kept however far the child pans, sliding onto a part when zooming into empty workbench, and 2000 pseudo-random pans, flings, pinches and wheel turns on the busy workbench with panels covering the canvas, the build findable after every one.
- `test/browser/routing.test.ts` (browser): tidying by `tidyWires`, `apply` and the list view's action gives the same routes and no `edit`; a routed wire drawn (by pixels) and hit along its route; refused in Run mode; routes kept and dropped as the build changes; fit and `setZoom` in the uncovered canvas; flings that keep the build beside the panels.

## Decisions and open questions

Taken here, conservatively, for Drew:

1. A part body is its drawn tile, and frames (the chassis) are not bodies: wires run over the deck.
2. The stretch of wire under its own two sockets is hidden, so it does not count as crossing.
3. A socket boxed in by other tiles gets the least crossing route, not none. Three wires on the busy workbench cross a part this way, because tiles grown to 96 px close a pocket round the motor driver's plus and the LED's plus and minus. The real fix is the tile layout (renderer.md's tile note, task 3.1/3.3), or a smaller minimum tile on a chassis.
4. Only crossing wires are routed; a wire that crosses nothing stays straight.
5. Routes are view state: no undo step, kept while their sockets stay put, dropped back to straight otherwise. Whether routes should be saved with the build needs a blueprint field, a schema question for after v1.
6. The tidy wires button belongs to the app's zoom control (beside Fit); the canvas draws none. Tidying is refused in Run mode and on a read-only canvas, like every command; tidying a shared build's view could be allowed later.
7. "Lost" means less than 96 px of every part on screen. Each part is a target, not the build's bounding box.
8. `setSafeArea` moves nothing itself, and `load` still keeps the view (interface): D70 says load and Fit centre the build, so the app should call `fit` after the first load.
