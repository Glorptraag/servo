# The canvas e2e harness (task 3.8)

Back to the [tools README](../../README.md). The harness drives the real canvas (`@servo/canvas`) over the real content (`@servo/content` and its `FIXTURES`) in Playwright's Chromium, with Vitest browser mode. It generalises task 3.1's and 3.2's browser helpers (packages/canvas/test/browser/) so later tasks test through one set of hands, one screenshot setup and one device profile. Its first job is ground rule 8: touch, pointer and the list view give the same blueprint, byte for byte.

```sh
pnpm e2e                                   # at the repo root: pnpm art, then the harness (packages/tools: vitest run --config src/e2e/vitest.config.ts)
pnpm --filter @servo/tools exec vitest run --config src/e2e/vitest.config.ts test/e2e/parity.e2e.ts   # one file
```

Chromium must be installed once per machine: `pnpm --filter @servo/tools exec playwright install chromium`. The art registry is gitignored, so `pnpm e2e` runs `pnpm art` first; the bench refuses to start while any part has no picture.

## Files

| Path | What it does |
| --- | --- |
| `vitest.config.ts` | Two browser projects in the iPad profile, one after the other: `e2e` on SwiftShader (parity, screenshots, gestures), then `performance` on the machine's own GPU, alone. The screenshot comparator and where references and diffs go. The reporters |
| `profile.ts` | The iPad profile (1180 × 820 CSS pixels at device scale factor 2, with touch), the 4× CPU slowdown, the 16 ms budget, the Chromium flags |
| `bench.ts` | Mounts the canvas as the app lays it out, with a part tray at its left, the content catalogue and `resolveArt` from the art registry; waits for it to settle; moves the view; turns canvas millimetres into page points |
| `input.ts` | Real input through CDP: touch tap, drag and pinch; mouse click, drag and wheel |
| `screenshots.ts` | Screenshot diffs against stored references, and pixel probes on real screenshots |
| `performance.ts` | Frame-time measurement with the CPU slowed, and the pan, wheel and pinch a hand plays one input per frame |
| `plan.ts` | A content fixture as the steps that build it from an empty canvas (pure, Node-safe) |
| `parity.ts` | The parity check: what each path can do, which steps are compared, the comparison, the report lines (pure, Node-safe) |
| `paths.ts` | The input paths on the bench: commands (the reference), touch and pointer (each by drag and by tap-then-tap), the list view; and finding what each can do |
| `reporter.ts` | Prints the parity report when the run ends |
| `env.d.ts` | Adds the DOM library and the Playwright provider's types to tools' Node-only types |

Tests: `test/e2e/*.e2e.ts` run in the browser under this config, and are not picked up by tools' own `vitest run`; `test/e2e-plan.test.ts` and `test/e2e-parity.test.ts` hold the pure halves to account in Node, with the other tools tests.

| Test | Proves |
| --- | --- |
| `test/e2e/parity.e2e.ts` | Ground rule 8 on every content fixture; the per-fixture report |
| `test/e2e/screenshots.e2e.ts` | Every content fixture in Build mode with its real pictures, and the two arena presets the fixtures use in Run mode, against references in `test/e2e/__screenshots__/`; pixel probes that every part is drawn and that Run mode lays the floor down |
| `test/e2e/gestures.e2e.ts` | The harness's hands reach the canvas as a child's would: a touch drag and a mouse drag pan exactly with the hand, a pinch and the wheel zoom about the right point, taps and clicks change nothing |
| `test/e2e/performance.e2e.ts` | Frame time on busy-workbench (content's 25-part fixture) with its pictures, in the iPad profile at 4× CPU slowdown |

## The bench

`mountBench(options)` mounts the canvas in a host at the page's left edge plus a tray (`TRAY_WIDTH`, 200 px), as brief Section 9 lays them out, and resolves once the renderer is up. `bench.offer(part)` makes the tray hand the next pointer pressed on it to `beginPlacement(part, pointer)`, as the app's tray does for a drag; a tap on the tray is the app's `beginPlacement(part)` with no pointer. `settle(bench)` waits until every picture has loaded, every fade has finished and the grid is at rest. `reduceMotion(true)` makes fades and slides instant through CDP.

**The renderer's hooks.** The canvas interface has no way to say where a canvas point is on screen, where a socket is, or when a frame is final, and a hand needs all three. The harness reads them from the handle at run time (`ready`, `settled`, `gridOpacity`, `canvas`, `camera`, `scene.portByKey`, `requestFrame`: the hooks [renderer.md](../../../canvas/docs/renderer.md) lists for the later canvas tasks), never by importing canvas internals, so it stays inside the package map. `hooksOf` names any hook that goes missing. One more is optional: `wiring.fanned`, where the sockets of a crowd that fanned out went, which task 3.3 (in progress) gives. Between gestures it moves the view directly (`setView`, `showPoints`), as a hand pans and zooms; the view is not part of the blueprint.

## Input

Every gesture is real input through the Chrome DevTools Protocol, in page coordinates (fractions kept): trusted touch events, as Playwright's touchscreen sends them, and trusted mouse events. `tap`, `drag`, `press`, `move` and `lift` take a hand (`'touch'` or `'mouse'`); `pinch` (two fingers, spreading while their midpoint travels) and `wheel` complete the set. A CDP call can return before the page has handled its event, touch especially on a loaded machine, so every gesture resolves only once the page has seen the pointer (or wheel) events it causes, at their points: the next step never reads the canvas early, and input never reaches a build loaded after it. A drag makes one move by default: every event costs a frame, and one move to the end point is past the canvas's 8 px threshold. The browser reports a wheel event's position in whole pixels.

## Screenshots

`expectScreenshot(element, name)` compares a screenshot with the stored reference: pixelmatch, a pixel differs past 3% (YIQ), and up to 0.5% of pixels may differ, for anti-aliasing between machines. The pixels come from SwiftShader on every machine, so one reference serves a Mac and CI. The first run of a new name writes its reference and fails, to be reviewed; delete a reference to write it again. A failure leaves the actual image and a diff image (differing pixels in red over a faded reference) under `packages/tools/node_modules/.vitest-screenshots/`, names them in its message, and CI uploads them as the `e2e-screenshot-diffs` artifact.

`shoot(element)` decodes a real screenshot for pixel probes: `shot.at(point)` is the colour at a point in CSS pixels from the element's top left; `expectColour` and `expectNotColour` check one against a tolerance.

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
- where a press cannot tell overlapping sockets apart and the canvas fans their crowd out instead (task 3.3, in progress), a hand goes on to the socket it meant, where it went: pressing the source again, or moving the wire's end on, or tapping again;
- the list view: the list action that does the step, through `perform`; a refused drop is one it never offers.

A setting goes through `apply` on the touch and pointer paths, as the spec card sends it (task 4.3). The free spot a gesture aims at comes from a dry run of the canvas's own `applyEdit`.

**Finding what a path can do.** Before any fixture, each path tries one member per kind of step on a probe build: `apply` of a placement, a setting and a wire; `beginPlacement`; `listView`. A member a later task builds throws an error naming that task, and that kind of step waits on that path, for the tasks the error names and the task that builds the step there (packages/canvas/README.md, "Who builds what"). Gestures draw wires through the command layer task 3.3 builds with the sockets, so a wire waits on a gesture path while `connect` waits. A member that fails any other way counts as ready, so the path meets the failure on its step and the check fails.

**Comparing.** A step the reference cannot take yet, or one naming a part left out, is left out for every path. A path that cannot take every remaining step waits. The reference and each other path build the same steps from the same start, and their canonical blueprints (`serializeBlueprint`) must be the same bytes. Only a difference fails, or a path that cannot take a step it said it could: the test shows the canonical JSON diff, and the report line names the parts and wires that differ. A fixture's test has six minutes, a guard against a hang rather than a budget; once it times out, its paths stop between steps (Vitest's `signal`), so an abandoned build never sends input into the next fixture, and a gesture that fails half way lets go of whatever it pressed.

**The report.** One line per fixture, printed when the run ends, then the summary:

```
broken-wrong-type-wire: pending: needs task 3.2 (3 placements), needs tasks 3.2 and 3.3 (4 wires and 1 refused drop); list view needs task 3.6
kit-rolling-start: identical on commands, touch drag, touch tap-then-tap, pointer drag and pointer click-click (8 placements); pending: needs task 3.3 (5 wires); list view needs task 3.6
kit-rolling-start: MISMATCH: touch drag: p3 position (40, -53) here, (40, -52.9) in commands; identical on commands, …
19 fixtures: 0 identical, 0 mismatched, 19 pending
```

The first line is main as task 3.8 left it: no command reaches the canvas yet. The second is the check, unchanged, on main with task 3.2 merged: tried on that branch, every fixture's placements were identical on all five paths, and against task 3.3's work in progress so were every wire and the refused drop, crowded sockets included. When task 3.3 merges, wires and refused drops join the comparison; when task 3.6 does, the list view joins it. Plain commands stay the reference: the command layer every path ends in.

**Not covered yet.** Plans build fixtures, so they never move, turn or remove a part, and never place a prop: no content fixture needs it, and the turn handle and the arena strip are not reachable through the renderer's hooks. A loose part always lands unturned, which every content fixture's loose parts are.

## CI

The `e2e` job in `.github/workflows/ci.yml` runs `pnpm e2e` on ubuntu-latest within a 10-minute job timeout, with Playwright's Chromium cached by Playwright's version, and uploads screenshot diffs when it fails. The runner has two cores and SwiftShader draws a 2360 × 1640 frame there at about 2 fps, so:

- the projects run one after the other, never side by side;
- the parity check runs on a 480 × 360 canvas with reduced motion, and the gesture self-tests on a 640 × 480 one, so a software GPU has few pixels to draw for each event;
- vsync and the frame-rate limit stay on. Without them a gesture takes half the time on a many-core laptop, but the GPU process draws flat out and takes more than a core;
- every gesture step is real input, and a touch press waits for a frame with the canvas on the page (about 120 ms on a laptop), so the check's time grows with each canvas task. On a heavily loaded laptop it took about 9 minutes with task 3.2's placements and 12 with task 3.3's wires as well. If they push the job past its budget, run fewer gesture variants per fixture or shard the fixtures across jobs.

## Decisions and open questions

Taken here, conservatively, for Drew and the orchestrator:

1. The harness reads the renderer's hooks at run time rather than the canvas interface, which offers no geometry. A small testing entry on the canvas (where a canvas point and a socket are on screen, when a frame is final) would let it build against an interface instead.
2. Loose parts land on the free spot on every path, so a fixture with more than one loose part is built in a different layout from its file. Parity compares the paths with each other, never with the fixture.
3. The touch and pointer paths set settings through `apply`, standing in for the spec card (task 4.3), and the tray is a stand-in for the app's (task 4.2).
4. Plain commands through `apply` are the reference, the third path until the list view exists, and stay the reference once it does: every path ends in the same command layer.
5. The view is moved directly between gestures, at the default zoom where a gesture's points fit, so screen-pixel forgiveness covers what it would for a child at the default zoom.
6. Wiring gestures follow a fanned-out crowd through `wiring.fanned`, as task 3.3's work in progress names it. If 3.3 names it otherwise when it merges, crowded fixtures (the bumper robot's) will fail parity on the gesture paths until `pressPlaceOf` in bench.ts follows it.
7. Chromium only. Real input goes through CDP, which WebKit lacks, so Safari's trackpad pinch (renderer.md, "Input") stays unverified; a WebKit project would need Playwright's own touchscreen and mouse through custom commands.
8. Screenshot references cover the content fixtures in Build mode and the arena presets in Run mode. Focus states, hints and the app's layouts at three screen sizes come with tasks 3.4, 4.1 and 4.6.
