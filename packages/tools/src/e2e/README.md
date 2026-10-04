# The canvas e2e harness (task 3.8)

Back to the [tools README](../../README.md). The harness drives the real canvas (`@servo/canvas`) over the real content (`@servo/content` and its `FIXTURES`) in Playwright's Chromium, with Vitest browser mode. It generalises task 3.1's and 3.2's browser helpers (packages/canvas/test/browser/) so later tasks test through one set of hands, one screenshot setup and one device profile. Its first job is ground rule 8: touch, pointer and the list view give the same blueprint, byte for byte.

```sh
pnpm e2e                                   # at the repo root: pnpm art, then every harness file but the timing (packages/tools: vitest run --config src/e2e/vitest.config.ts --project e2e)
pnpm e2e test/e2e/parity-1.e2e.ts          # some files only, as a CI shard runs them
pnpm e2e -u                                # rewrite the screenshot references
SERVO_PARITY_STRICT=0 pnpm e2e             # only a real difference fails a parity fixture, not a step left out or a path waiting
SERVO_PARITY_TOURS=all pnpm e2e test/e2e/parity-1.e2e.ts   # every tour of edits on every fixture in the group, not one each
pnpm perf                                  # at the repo root: every package's timing tests, this harness's performance project among them
```

Chromium must be installed once per machine: `pnpm --filter @servo/tools exec playwright install chromium`. The art registry is gitignored, so `pnpm e2e` runs `pnpm art` first; the bench refuses to start while any part has no picture.

## Files

| Path | What it does |
| --- | --- |
| `vitest.config.ts` | Two browser projects in the iPad profile, one after the other: `e2e` on SwiftShader (parity, screenshots and their mutation test, gestures), then `performance` on the machine's own GPU, alone. `pnpm e2e` runs `e2e`; `pnpm perf` runs `performance`. The reporters, and `provide` for the strict switch |
| `profile.ts` | The iPad profile (1180 × 820 CSS pixels at device scale factor 2, with touch), the 4× CPU slowdown, the 16 ms budget, the Chromium flags |
| `bench.ts` | Mounts the canvas as the app lays it out, with a part tray at its left (also the arena strip, and the canvas's remove target), the content catalogue and `resolveArt` from the art registry, and the canvas's testing entry (`probe`); waits for it to settle; moves the view; turns canvas millimetres into page points |
| `input.ts` | Real input through CDP: touch tap, drag and pinch; mouse click, drag and wheel |
| `pixels.ts` | The screenshot rule, a readable diff, and colour names (pure, Node-safe) |
| `screenshots.ts` | Screenshots compared with stored references by that rule, diffs written on failure, pixel probes |
| `probes.ts` | Probes on every power and signal line and every part a build must show, against a model of each tile and its picture (`expectedColour`, pure) |
| `mutations.ts` | Builds with a wire, or a part and its wires, taken out, for the mutation test (pure) |
| `performance.ts` | Frame-time measurement with the CPU slowed, and the pan, wheel and pinch a hand plays one input per frame |
| `plan.ts` | A content fixture as the steps that build it from an empty canvas, then the edits a child makes on it, and which fixtures take which edits (pure) |
| `parity.ts` | The parity check: what each path can do, which steps are compared, the comparison, verdicts, report lines and fixture groups (pure) |
| `paths.ts` | The input paths on the bench: commands (the reference), touch and pointer (each by drag and by tap-then-tap), the list view through its DOM; where a hand presses to reach a part or a line; and finding what each can do |
| `report.ts`, `reporter.ts`, `merge-report.ts` | The parity report: its lines and summary (dependency-free), printed and written when a run ends, and merged from CI's shards |
| `env.d.ts`, `provided.d.ts` | The DOM library and the Playwright provider's types for tools' Node-only types; the strict switch's type |

Tests: `test/e2e/*.e2e.ts` run in the browser under this config, and are not picked up by tools' own `vitest run`. `test/e2e-*.test.ts` hold the pure halves to account in Node, with the other tools tests.

| Test | Proves |
| --- | --- |
| `test/e2e/parity-1.e2e.ts` … `parity-4.e2e.ts` (`parity-suite.ts`) | Ground rule 8 on every content fixture and every edit, a quarter of the fixtures in each file; the per-fixture report |
| `test/e2e/screenshots.e2e.ts` | Every content fixture in Build mode with its real pictures matches its reference, and its probes see every line and part; the two arena presets the fixtures use, in Run mode |
| `test/e2e/screenshot-mutations.e2e.ts` | Each fixture without one wire, and without one part, fails both its reference and its probe |
| `test/e2e/gestures.e2e.ts` | The harness's hands reach the canvas as a child's would: a touch drag and a mouse drag pan exactly with the hand, a pinch and the wheel zoom about the right point, taps and clicks change nothing |
| `test/e2e/performance.e2e.ts` | Frame time on busy-workbench (content's 25-part fixture) with its pictures, in the iPad profile at 4× CPU slowdown, the best of five samples. Run by `pnpm perf` and CI's perf job, not by `pnpm e2e` or a shard (`PERFORMANCE_FILE` in `profile.ts`) |

## The bench

`mountBench(options)` mounts the canvas in a host at the page's left edge plus a tray (`TRAY_WIDTH`, 200 px), as brief Section 9 lays them out, and resolves once the renderer is up. `bench.offer(part)` makes the tray hand the next pointer pressed on it to `beginPlacement(part, pointer)`, as the app's tray does for a drag; a tap on the tray is the app's `beginPlacement(part)` with no pointer. Offered a prop template, the tray stands for the arena strip and calls `beginPropPlacement`. The tray is the canvas's remove target (`setRemoveTargets`), as the app's tray and strip are, so a part, wire or prop let go over it is removed. `bench.probe` is the canvas's tools-only testing entry (`@servo/canvas/testing`, packages/canvas/README.md "Testing entry"): the edits read the handles, the lines as drawn and Run-mode places from it. `settle(bench)` waits until every picture has loaded, every fade has finished and the grid is at rest. `reduceMotion(true)` makes fades and slides instant through CDP.

**The renderer's members.** The canvas interface has no way to say where a canvas point or a socket is on screen, or when a frame is final, and a hand needs all three. The harness reads them from the renderer's surface as built (task 3.1's `CanvasSurface`), through one cast in `hooksOf`, never by importing canvas internals, so it stays inside the package map: `ready`, `settled`, `gridOpacity`, `canvas`, `camera`, `scene` (its sockets, tiles and lines) and `requestFrame`. [renderer.md](../../../canvas/docs/renderer.md) lists only `scene` and `requestFrame` among its hooks for later canvas tasks; the rest are the surface's own. `hooksOf` names any that go missing. Between gestures the harness moves the view by writing the camera's centre and zoom (`setView`, `showPoints`), as a hand pans and zooms; the view is not part of the blueprint. One more member is optional: `wiring.fanned`, where the sockets of a crowd that fanned out went, as task 3.3's work in progress names it. Review R-3.8 (finding 5) asks for a tools-only testing entry on the canvas to replace all of these; a later canvas task gives it.

## Input

Every gesture is real input through the Chrome DevTools Protocol, in page coordinates (fractions kept): trusted touch events, as Playwright's touchscreen sends them, and trusted mouse events. `tap`, `drag`, `press`, `move` and `lift` take a hand (`'touch'` or `'mouse'`); `pinch` (two fingers, spreading while their midpoint travels) and `wheel` complete the set. A CDP call can return before the page has handled its event, touch especially on a loaded machine, so every gesture resolves only once the page has seen the pointer (or wheel) events it causes, at their points: the next step never reads the canvas early, and input never reaches a build loaded after it. A gesture that fails half way lets go of whatever it pressed. A drag makes one move by default: every event costs a frame, and one move to the end point is past the canvas's 8 px threshold. The browser reports a wheel event's position in whole pixels.

## Screenshots

**The rule** (`pixels.ts`). A pixel has changed when any of its colour channels differs from the reference's by more than 24 (of 255); a screenshot matches while at most 400 pixels have changed, 0.01% of a 2360 × 1640 shot. It counts pixels rather than averaging over the image, so a small change fails however big the screenshot is. Measured on the 19 content fixtures:

- the same build renders identically run after run here: 0 changed pixels, and no channel off by even 1;
- the smallest real change, a removed wire or part, changes 1,110 pixels (busy-workbench's caster, small at its fitting zoom); every removed wire changes at least 2,862.

`expectScreenshot(element, name)` compares with `test/e2e/__screenshots__/<name>.png`. The first run of a new name writes its reference and fails, to be reviewed; `pnpm e2e -u` rewrites every reference. A failure leaves `<name>.reference.png`, `<name>.actual.png` and `<name>.diff.png` (changed pixels in red over a faded reference) under `packages/tools/node_modules/e2e-screenshots/`, names them in its message, and CI uploads them as the `e2e-screenshot-diffs-<shard>` artifact. `compareWithReference` compares without asserting and never writes a reference.

**The probes** (`probes.ts`) read what a build must show from a real screenshot and the scene's own geometry, with no reference image, so they guard the references too:

- every power and signal line, along the stretch of it no socket and no other line covers, must be red or yellow (by hue, as brief Section 13 names them) in at least 90% of 48 samples for a power line, 30% for a dashed signal line;
- every part, sampled on a 48 × 48 grid over its tile wherever no part drawn after it, no socket and no line or linkage lies, must show at 90% of the counted points the colour its tile and picture give there. `loadPictures` rasterises each part's picture from the art registry, and `expectedColour` lays it in the tile as the canvas does: fitted inside the padding, centred, turned and flipped with the part. A point counts only where that colour is clear (no face edge or outline within 2 px, and away from the tile's rounded corners) and differs from what would show there without the part, the tile drawn under it or the bare workbench, by more than the screen's allowance for both. So a missing part fails its probe even where it sat on a chassis, and never passes for a present one.

A line or part with too little to judge (fewer than 4 uncovered line samples, or 12 counted points) is not probed; each fixture must have a probed line and a probed part. Measured on the 19 fixtures:

- every power line reads 100% red, and with one taken out at most 69% still does, where it crossed a red battery pack;
- 153 of the 169 parts are probed, each reading 100%; with any one of the 108 probed parts that hold nothing taken out, its probe reads 0%. The other 16 are mostly hidden under the parts they carry or by sockets (gearboxes under their wheels, a few battery packs and casters).

**The mutation test** (`screenshot-mutations.e2e.ts`) proves both: for each fixture, the build without the least visible probed line, and without the least visible probed part that holds nothing (with its wires), drawn in the reference's own view, must fail the reference and that probe.

`shoot(element)` and `capture(element)` decode a real screenshot for probes: `shot.at(point)` is the colour at a point in CSS pixels from the element's top left; `expectColour` checks one against a tolerance.

## The iPad profile and frame time

The profile is task 3.1's: a 1180 × 820 viewport at device scale factor 2, with touch. `measureFrames(gestures, frames)` slows the CPU 4× through CDP and plays each gesture one step per frame, timing every frame's main-thread work (its requestAnimationFrame callbacks, input and drawing together). The hand dispatches its pointer and wheel events itself, inside the frame, because CDP input arrives on its own schedule. The performance test asserts a median and p95 within 16 ms, and on a hardware GPU 50 fps or better; a software GPU (CI) draws far below 60 fps whatever the page does, so there it runs fewer frames and only prints the rate. One run of the gestures is one sample, and on a shared CI runner with SwiftShader one sample's p95 has read from 8.1 to 37.8 ms for the same code, the first after mounting nearly always the slowest. So the test takes `FRAME_SAMPLES` (5) samples from the fitted view, prints each, and holds `bestSample`, the one with the lowest p95, to the budget, as sim-core's tick cost takes the fastest of its batches: a busy runner only ever adds time. The budget is unchanged, over a whole run; a change that slows frames slows every sample. `run-animation.timing.ts` samples its Run the same way. The canvas README ("Frame time") says why not the median of the samples.

## The parity check

**The plan** (`planFor`). Each content fixture becomes the steps a child takes to build it from an empty canvas: the fixture's metadata and arena with nothing placed and no ids claimed.

1. Placements. A part the fixture holds (by its mount on a mount point, or its hub on a shaft) lands attached there, after its holder. A loose part lands on the free spot: the only place the list view can name (`ListView.placementsFor`), so the only one all paths share. Loose parts go biggest group first, so a robot's chassis takes the empty canvas's free spot, the origin, where the fixtures put it, and each loose part's group is placed before the next loose part.
2. Settings the fixture changes.
3. Every wire a placement did not make: power and signal lines, and drive linkages between held parts, in wire order.
4. A broken fixture's impossible drop, which every path must refuse, leaving the build as it was.
5. The edits a child makes on the build (task 7.6, `editTour`), in tours a plan takes whole:
   - `disconnect`: the power or signal line whose parts sit furthest apart in the fixture is removed, then Undo puts it back;
   - `move`: the last held part is moved to the free spot the list view names for it (`Move X to a free spot`), off its mount or shaft with what it holds;
   - `turn`: the first loose part (a robot's chassis) is turned a quarter turn clockwise;
   - `remove`: the first held part is removed with its wires, leaving what it held loose (D35), then Undo puts it all back;
   - `props` (on the open floor with no props): two of the arena strip's boxes are placed on the floor's free spot, the first is removed, the other is moved to the spot that frees, and Reset arena drops it;
   - `tidy`: Tidy wires; the routes every line is drawn along are compared, since the build does not change and no edit fires;
   - `clear-selection`: the first loose part is selected, then the selection cleared; the selection after each is compared;
   - `flip` (where the build has a manual switch): a Run starts, held at the Simulation's tick 0 frame, the switch is flipped, and the `control` the canvas fires is compared; Stop gives the build back unchanged.

   Every edit costs a gesture per path, so each fixture takes one tour (`assignTours`): fixtures in name order each take the tour that fits them and has been taken least so far. Every tour is taken on five fixtures or more (`test/e2e-plan.test.ts`). `SERVO_PARITY_TOURS=all` gives every fixture every tour that fits it, a sweep for a change to the canvas's edits that takes about four times as long.

**The paths** (`discoverPaths`). The reference is plain commands through the handle's `apply`, as the app, the spec card and the hint ladder send them: the third path until the list view exists. Then:

- touch drag and pointer drag: a part is dragged from the tray and let go where its mount or hub sits on its target (its frame origin on the free spot); a wire is dragged from socket to socket;
- touch tap-then-tap and pointer click-click: the tray's tap, then a tap on the target; a wire by a tap on each socket (brief Section 13);
- where a press cannot tell overlapping sockets apart and the canvas fans their crowd out instead (task 3.3), a hand goes on to the socket it meant, where it went: pressing the source again, or moving the wire's end on, or tapping again;
- the list view: the list action that does the step, through `perform`; a refused drop is one it never offers.

A setting goes through `apply` on the touch and pointer paths, as the spec card sends it (task 4.3). The free spot a gesture aims at comes from a dry run of the canvas's own `applyEdit`.

The edits go by hand on the touch and pointer paths, with nothing waiting and nothing selected before each:

- move: dragged by a point on the part so its frame origin lands on the spot; or tapped, its Move handle tapped, and the spot tapped. Framed as close as the canvas allows (up to 400%), as a child zooms in to set a part down beside the chassis rather than on a mount point: forgiveness radii are screen pixels;
- turn: the part tapped, then its rotate handle tapped, or dragged a quarter turn round the part's origin;
- remove a part, a line or a prop: dragged to the tray; or tapped and its bin tapped;
- place a prop: dragged from the strip to the floor's free spot, or offered by a tap and placed by a tap there; move a prop: dragged by its middle, or tapped, its Move handle tapped (task 7.3), and the spot tapped;
- tidy: the app's Tidy wires button (`tidyWires`); clear the selection: a tap on the part, then on empty workbench beside the build; flip: a tap on the switch where the Run draws it;
- Undo and Reset arena are the Run bar's buttons, the same on every path: Undo loads the build before the last `edit` the path fired, as the app's history does (packages/app/src/run-bar/history.ts), so a gesture that made two edits where the reference made one gives other bytes after its Undo.

A press goes where the canvas's own order of what lies on top (packages/canvas/src/scene/hit.ts) reaches what it means: on a part, the point nearest its middle with no socket or line within reach and no other part drawn over it; on a line, the point nearest halfway with no socket within reach and no line drawn over it within reach.

The list view does each step with the list action that does it, pressed in its DOM as a screen-reader user presses it: the subject's Actions button, the action's button, and the Actions button again to close it (in Run mode the actions show at once). A placement from the tray or the arena strip is the action the app's tray and strip perform through the model (`placementsFor`, `propPlacementsFor`). Clear selection is the `select` action with no selection (task 7.3); a flip is Open or Close. A spot the canvas's rules pick (a part's or a prop's free spot) is read from the list action that names it, so every path aims at the same spot.

**Finding what a path can do.** Before any fixture, each path tries one member per kind of step on a probe build: `apply` of a placement, a setting and a wire; `beginPlacement`; `listView`. A member a later task builds throws an error naming that task, and that kind of step waits on that path, for the tasks the error names and the task that builds the step there (packages/canvas/README.md, "Who builds what"). Gestures draw wires through the command layer task 3.3 builds with the sockets, so a wire waits on a gesture path while `connect` waits. A member that fails any other way counts as ready, so the path meets the failure on its step and the check fails.

**Comparing.** A step the reference cannot take yet, or one naming a part left out, is left out for every path. A path that cannot take every remaining step waits. The reference and each other path build the same steps from the same start, and their canonical blueprints (`serializeBlueprint`), with what they observed besides the build (the selections, the switch's control, the routes), must be the same bytes. A fixture is:

- `identical` when every path built every step of its plan to the reference's bytes;
- `partial` when the paths compared were identical but steps were left out or a path waited;
- `mismatch` when a path's bytes differ or it could not take a step it said it could;
- `pending` when no step could be compared on two paths yet.

A partial or pending fixture fails as a mismatch does: every canvas task has merged, so every path takes every step (task 7.6). `SERVO_PARITY_STRICT=0` lets only a mismatch fail, for a canvas change under way. A failure shows the canonical JSON diff, and the report line names the parts and wires that differ. A fixture's test has six minutes, a guard against a hang rather than a budget; once it times out, its paths stop between steps (Vitest's `signal`), so an abandoned build never sends input into the next fixture.

**Files.** The fixtures are split between `parity-1.e2e.ts` … `parity-4.e2e.ts` by `fixtureGroups`: heaviest first, each to the group with the fewest plan steps so far. Each file mounts its own bench, so CI runs them as separate shards; a new fixture joins a group by itself.

**The report.** One line per fixture, sorted, then the summary, printed when a run ends; the lines also go to `packages/tools/node_modules/e2e-report/parity.json`, which CI merges across shards:

```
busy-workbench: identical on commands, touch drag, touch tap-then-tap, pointer drag, pointer click-click and list view (25 placements, 1 setting and 32 wires)
kit-rolling-start: partial: identical on commands, touch drag, touch tap-then-tap, pointer drag and pointer click-click (8 placements); pending: needs task 3.3 (5 wires); list view needs task 3.6
kit-rolling-start: MISMATCH: touch drag: p3 position (40, -53) here, (40, -52.9) in commands; identical on commands, …
5 fixtures: 5 identical, 0 partial, 0 mismatched, 0 pending
```

The first line is the check on main with placement (3.2), wiring (3.3) and the list view (3.6) merged: every step compared on all six paths, crowded sockets included, with no change to the harness, and the summary is parity-1's shard. The second is how a fixture read while a canvas task was still to come. Plain commands stay the reference: the command layer every path ends in.

**Not covered.** Redo: the app has none (packages/app/README.md, the Run bar). Renaming and the arena preset picker: the app's name field and strip send `rename` and `set-arena` through `apply` on every path, with no canvas gesture, as a setting goes through the spec card. Re-snapping a part onto another mount point, taking it off its mount (`unmount`) and carrying a wheel onto another shaft: each has a list action and a gesture, but no tour takes them yet. The Delete key, which removes a selected part, wire or prop as its bin does. A loose part always lands unturned, which every content fixture's loose parts are.

**Findings** (task 7.6's sweep, every tour on every fixture). Every edit is identical on every path but two, where the canvas leaves a hand no way to match the list view. The tours step round both, and these are left for a canvas task:

1. Tap-then-tap cannot move a carried wheel to its free spot. A wheel moved off its shaft has a free spot that overlaps its own tile (meet-the-small-wheel-start, meet-the-large-wheel-start, meet-the-gearbox-one-wheel: `wheel-left`). The list view moves it there, and so does a drag. On touch tap-then-tap and pointer click-click, the tap after the Move handle lands on the wheel itself, and the canvas leaves it where it is (placement.md, decision 7). Any other tap lands at the free spot nearest that tap, not at this one. So the `move` tour takes a part held by a mount.
2. A line drawn wholly under other lines and sockets cannot be pressed. In meet-the-1-cell-battery-pack-start, the battery pack's minus line to the DC motor is covered along its length by sockets and by the line drawn over it. Touch and pointer cannot select it, bin it or drag it to the tray, while the list view removes it. The plus line in meet-the-dc-motor-wired is covered the same way. In meet-the-led-wired, only a window about 2 mm wide on the plus line is clear. So `disconnect` removes the first of the fixture's lines that a hand can press.

## CI

The `e2e` job in `.github/workflows/ci.yml` is a matrix of six shards that run side by side, each with a 10-minute timeout, Playwright's Chromium cached by Playwright's version, its parity lines uploaded as `e2e-report-<shard>`, and its screenshot diffs uploaded when it fails:

| Shard | Files |
| --- | --- |
| `views` | screenshots, their mutation test, gestures, frame time |
| `run-animation` | Run mode's recorded fixture Runs (task 3.5, packages/canvas/docs/run-animation.md) |
| `parity-1` … `parity-4` | one parity group each |

The parity shards run with `SERVO_PARITY_STRICT=1`, so a fixture left partial or pending fails CI. `test/e2e-ci-shards.test.ts` checks that every `test/e2e/*.e2e.ts` file is in exactly one shard. The `e2e-report` job then prints one report from the shards' lines with plain Node (`node packages/tools/src/e2e/merge-report.ts <folder>`). Within a shard the projects run one after the other: the runner has two cores, and SwiftShader would use both for each. The parity check runs on a 480 × 360 canvas with reduced motion, and the gestures on a 640 × 480 one, so a software GPU has few pixels to draw for each event. Every gesture step is real input, and a touch press waits for a frame with the canvas on the page (about 120 ms on a laptop), so parity's time grows with each canvas task; when it outgrows a shard, raise `PARITY_GROUPS` and add the files and shards.

## Decisions and open questions

Taken here, conservatively, for Drew and the orchestrator:

1. The harness reads the renderer's members at run time rather than the canvas interface, which offers no geometry. The orchestrator will give the canvas a tools-only testing entry in a later canvas task (review R-3.8, finding 5).
2. Loose parts land on the free spot on every path, so a fixture with more than one loose part is built in a different layout from its file. Parity compares the paths with each other, never with the fixture.
3. The touch and pointer paths set settings through `apply`, standing in for the spec card (task 4.3), and the tray is a stand-in for the app's (task 4.2).
4. Plain commands through `apply` are the reference, the third path until the list view exists, and stay the reference once it does: every path ends in the same command layer.
5. The view is moved directly between gestures, at the default zoom where a gesture's points fit, so screen-pixel forgiveness covers what it would for a child at the default zoom.
6. Wiring gestures follow a fanned-out crowd through `wiring.fanned`, as task 3.3's work in progress names it. If 3.3 names it otherwise when it merges, crowded fixtures (the bumper robot's) will fail parity on the gesture paths until `pressPlaceOf` in bench.ts follows it.
7. Chromium only. Real input goes through CDP, which WebKit lacks, so Safari's trackpad pinch (renderer.md, "Input") stays unverified; a WebKit project would need Playwright's own touchscreen and mouse through custom commands.
8. Screenshot references cover the content fixtures in Build mode and the arena presets in Run mode. Focus states, hints and the app's layouts at three screen sizes come with tasks 3.4, 4.1 and 4.6.
9. The screenshot references come from SwiftShader on macOS arm64 and have not yet been compared on CI's x86_64 (review R-3.8, finding 11). If the first CI run finds a few hundred anti-aliased pixels changed, its diff artifact shows them; raise the rule's 400 just above that noise, still far below the 1,110 of the smallest real change.

Taken in task 7.6, for Drew and the orchestrator:

10. Undo is the app's Run bar button on every path, modelled on the app's history (the builds the `edit` events carry, loaded back with `load`). The app has no Redo, so neither does the check.
11. Settings, renaming, the preset picker and Reset arena go through `apply` on the touch and pointer paths, as the spec card, the name field and the Run bar send them; the list view has settings of its own and no Reset arena.
12. A spot the canvas's rules pick (a moved part's or prop's free spot) is read from the list action that names it, and the hands aim there; a new prop's spot comes from a dry run of `applyEdit`.
13. Each fixture takes one tour of edits, so the edits cost each parity shard a minute or two rather than doubling it; `SERVO_PARITY_TOURS=all` takes them all. The fixtures are split into four parity groups (CI shards), up from three.
14. A partial or pending fixture fails by default (`SERVO_PARITY_STRICT=0` to relax), since every canvas task has merged.
15. A move is framed at up to 400%, so a part let go beside the chassis is not caught by a mount point's 48 px forgiveness, as a child zooms in to set a part down there. The tidy waits for the pictures to load, since routes go round each picture as drawn.
