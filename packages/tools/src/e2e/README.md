# The canvas e2e harness (task 3.8)

Back to the [tools README](../../README.md). The harness drives the real canvas (`@servo/canvas`) over the real content (`@servo/content` and its `FIXTURES`) in Playwright's Chromium, with Vitest browser mode. It generalises task 3.1's and 3.2's browser helpers (packages/canvas/test/browser/) so later tasks test through one set of hands, one screenshot setup and one device profile. Its first job is ground rule 8: touch, pointer and the list view give the same blueprint, byte for byte.

```sh
pnpm e2e                                   # at the repo root: pnpm art, then every harness file (packages/tools: vitest run --config src/e2e/vitest.config.ts)
pnpm e2e test/e2e/parity-1.e2e.ts          # some files only, as a CI shard runs them
pnpm e2e -u                                # rewrite the screenshot references
SERVO_PARITY_STRICT=1 pnpm e2e             # gate G3: a parity fixture with a step left out or a path waiting fails
```

Chromium must be installed once per machine: `pnpm --filter @servo/tools exec playwright install chromium`. The art registry is gitignored, so `pnpm e2e` runs `pnpm art` first; the bench refuses to start while any part has no picture.

## Files

| Path | What it does |
| --- | --- |
| `vitest.config.ts` | Two browser projects in the iPad profile, one after the other: `e2e` on SwiftShader (parity, screenshots and their mutation test, gestures), then `performance` on the machine's own GPU, alone. The reporters, and `provide` for the strict switch |
| `profile.ts` | The iPad profile (1180 × 820 CSS pixels at device scale factor 2, with touch), the 4× CPU slowdown, the 16 ms budget, the Chromium flags |
| `bench.ts` | Mounts the canvas as the app lays it out, with a part tray at its left, the content catalogue and `resolveArt` from the art registry; waits for it to settle; moves the view; turns canvas millimetres into page points |
| `input.ts` | Real input through CDP: touch tap, drag and pinch; mouse click, drag and wheel |
| `pixels.ts` | The screenshot rule, a readable diff, and colour names (pure, Node-safe) |
| `screenshots.ts` | Screenshots compared with stored references by that rule, diffs written on failure, pixel probes |
| `probes.ts` | Probes on every power and signal line and every part a build must show, against a model of each tile and its picture (`expectedColour`, pure) |
| `mutations.ts` | Builds with a wire, or a part and its wires, taken out, for the mutation test (pure) |
| `performance.ts` | Frame-time measurement with the CPU slowed, and the pan, wheel and pinch a hand plays one input per frame |
| `plan.ts` | A content fixture as the steps that build it from an empty canvas (pure) |
| `parity.ts` | The parity check: what each path can do, which steps are compared, the comparison, verdicts, report lines and fixture groups (pure) |
| `paths.ts` | The input paths on the bench: commands (the reference), touch and pointer (each by drag and by tap-then-tap), the list view; and finding what each can do |
| `report.ts`, `reporter.ts`, `merge-report.ts` | The parity report: its lines and summary (dependency-free), printed and written when a run ends, and merged from CI's shards |
| `env.d.ts`, `provided.d.ts` | The DOM library and the Playwright provider's types for tools' Node-only types; the strict switch's type |

Tests: `test/e2e/*.e2e.ts` run in the browser under this config, and are not picked up by tools' own `vitest run`. `test/e2e-*.test.ts` hold the pure halves to account in Node, with the other tools tests.

| Test | Proves |
| --- | --- |
| `test/e2e/parity-1.e2e.ts` … `parity-3.e2e.ts` (`parity-suite.ts`) | Ground rule 8 on every content fixture, a third of them in each file; the per-fixture report |
| `test/e2e/screenshots.e2e.ts` | Every content fixture in Build mode with its real pictures matches its reference, and its probes see every line and part; the two arena presets the fixtures use, in Run mode |
| `test/e2e/screenshot-mutations.e2e.ts` | Each fixture without one wire, and without one part, fails both its reference and its probe |
| `test/e2e/gestures.e2e.ts` | The harness's hands reach the canvas as a child's would: a touch drag and a mouse drag pan exactly with the hand, a pinch and the wheel zoom about the right point, taps and clicks change nothing |
| `test/e2e/performance.e2e.ts` | Frame time on busy-workbench (content's 25-part fixture) with its pictures, in the iPad profile at 4× CPU slowdown |

## The bench

`mountBench(options)` mounts the canvas in a host at the page's left edge plus a tray (`TRAY_WIDTH`, 200 px), as brief Section 9 lays them out, and resolves once the renderer is up. `bench.offer(part)` makes the tray hand the next pointer pressed on it to `beginPlacement(part, pointer)`, as the app's tray does for a drag; a tap on the tray is the app's `beginPlacement(part)` with no pointer. `settle(bench)` waits until every picture has loaded, every fade has finished and the grid is at rest. `reduceMotion(true)` makes fades and slides instant through CDP.

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

The profile is task 3.1's: a 1180 × 820 viewport at device scale factor 2, with touch. `measureFrames(gestures, frames)` slows the CPU 4× through CDP and plays each gesture one step per frame, timing every frame's main-thread work (its requestAnimationFrame callbacks, input and drawing together). The hand dispatches its pointer and wheel events itself, inside the frame, because CDP input arrives on its own schedule. The performance test asserts a median and p95 within 16 ms, and on a hardware GPU 50 fps or better; a software GPU (CI) draws far below 60 fps whatever the page does, so there it runs fewer frames and only prints the rate.

## The parity check

**The plan** (`planFor`). Each content fixture becomes the steps a child takes to build it from an empty canvas: the fixture's metadata and arena with nothing placed and no ids claimed.

1. Placements. A part the fixture holds (by its mount on a mount point, or its hub on a shaft) lands attached there, after its holder. A loose part lands on the free spot: the only place the list view can name (`ListView.placementsFor`), so the only one all paths share. Loose parts go biggest group first, so a robot's chassis takes the empty canvas's free spot, the origin, where the fixtures put it, and each loose part's group is placed before the next loose part.
2. Settings the fixture changes.
3. Every wire a placement did not make: power and signal lines, and drive linkages between held parts, in wire order.
4. A broken fixture's impossible drop, which every path must refuse, leaving the build as it was.

**The paths** (`discoverPaths`). The reference is plain commands through the handle's `apply`, as the app, the spec card and the hint ladder send them: the third path until the list view exists. Then:

- touch drag and pointer drag: a part is dragged from the tray and let go where its mount or hub sits on its target (its frame origin on the free spot); a wire is dragged from socket to socket;
- touch tap-then-tap and pointer click-click: the tray's tap, then a tap on the target; a wire by a tap on each socket (brief Section 13);
- where a press cannot tell overlapping sockets apart and the canvas fans their crowd out instead (task 3.3), a hand goes on to the socket it meant, where it went: pressing the source again, or moving the wire's end on, or tapping again;
- the list view: the list action that does the step, through `perform`; a refused drop is one it never offers.

A setting goes through `apply` on the touch and pointer paths, as the spec card sends it (task 4.3). The free spot a gesture aims at comes from a dry run of the canvas's own `applyEdit`.

**Finding what a path can do.** Before any fixture, each path tries one member per kind of step on a probe build: `apply` of a placement, a setting and a wire; `beginPlacement`; `listView`. A member a later task builds throws an error naming that task, and that kind of step waits on that path, for the tasks the error names and the task that builds the step there (packages/canvas/README.md, "Who builds what"). Gestures draw wires through the command layer task 3.3 builds with the sockets, so a wire waits on a gesture path while `connect` waits. A member that fails any other way counts as ready, so the path meets the failure on its step and the check fails.

**Comparing.** A step the reference cannot take yet, or one naming a part left out, is left out for every path. A path that cannot take every remaining step waits. The reference and each other path build the same steps from the same start, and their canonical blueprints (`serializeBlueprint`) must be the same bytes. A fixture is:

- `identical` when every path built every step of its plan to the reference's bytes;
- `partial` when the paths compared were identical but steps were left out or a path waited;
- `mismatch` when a path's bytes differ or it could not take a step it said it could;
- `pending` when no step could be compared on two paths yet.

Only a mismatch fails, unless `SERVO_PARITY_STRICT=1` (for gate G3), which fails a partial or pending fixture too. A failure shows the canonical JSON diff, and the report line names the parts and wires that differ. A fixture's test has six minutes, a guard against a hang rather than a budget; once it times out, its paths stop between steps (Vitest's `signal`), so an abandoned build never sends input into the next fixture.

**Files.** The fixtures are split between `parity-1.e2e.ts`, `parity-2.e2e.ts` and `parity-3.e2e.ts` by `fixtureGroups`: heaviest first, each to the group with the fewest plan steps so far. Each file mounts its own bench, so CI runs them as separate shards; a new fixture joins a group by itself.

**The report.** One line per fixture, sorted, then the summary, printed when a run ends; the lines also go to `packages/tools/node_modules/e2e-report/parity.json`, which CI merges across shards:

```
broken-wrong-type-wire: pending: needs task 3.2 (3 placements), needs tasks 3.2 and 3.3 (4 wires and 1 refused drop); list view needs task 3.6
kit-rolling-start: partial: identical on commands, touch drag, touch tap-then-tap, pointer drag and pointer click-click (8 placements); pending: needs task 3.3 (5 wires); list view needs task 3.6
kit-rolling-start: MISMATCH: touch drag: p3 position (40, -53) here, (40, -52.9) in commands; identical on commands, …
19 fixtures: 0 identical, 19 partial, 0 mismatched, 0 pending
```

The second line is the check on main with task 3.2's placement merged. Against task 3.3's work in progress, every wire and the refused drop were identical too, crowded sockets included. When task 3.6 lands, the list view joins by itself, and a fixture can then read `identical`. Plain commands stay the reference: the command layer every path ends in.

**Not covered yet.** Plans build fixtures, so they never move, turn or remove a part, and never place a prop or flip a switch in Run mode: no content fixture needs it, and rule 8 for those rests on tasks 3.2's and 3.6's own tests (review R-3.8, Question 2). A loose part always lands unturned, which every content fixture's loose parts are.

## CI

The `e2e` job in `.github/workflows/ci.yml` is a matrix of four shards that run side by side, each with a 10-minute timeout, Playwright's Chromium cached by Playwright's version, its parity lines uploaded as `e2e-report-<shard>`, and its screenshot diffs uploaded when it fails:

| Shard | Files |
| --- | --- |
| `views` | screenshots, their mutation test, gestures, frame time |
| `parity-1`, `parity-2`, `parity-3` | one parity group each |

The `e2e-report` job then prints one report from the shards' lines with plain Node (`node packages/tools/src/e2e/merge-report.ts <folder>`). Within a shard the projects run one after the other: the runner has two cores, and SwiftShader would use both for each. The parity check runs on a 480 × 360 canvas with reduced motion, and the gestures on a 640 × 480 one, so a software GPU has few pixels to draw for each event. Every gesture step is real input, and a touch press waits for a frame with the canvas on the page (about 120 ms on a laptop), so parity's time grows with each canvas task; when it outgrows a shard, raise `PARITY_GROUPS` and add the files and shards.

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
