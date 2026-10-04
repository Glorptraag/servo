# Performance (task 6.1)

Plan P6-1: 25-part builds at 60 fps on a 2020 iPad and a low-end Chromebook, and cold start under 3 s. This page holds the budgets, the stand-in profiles, how each figure is taken, the figures before and after this task's fixes, and what is still out of budget and why. Every figure here comes from Chromium on a development Mac standing in for the devices. None has been taken on a real 2020 iPad or Chromebook yet (see "Still to confirm on devices").

## Budgets

| Figure | Budget | Why this number |
| --- | --- | --- |
| Cold start, first visit | ≤ 3000 ms to ready | P6-1. "Ready" is the later of the first contentful paint and the app's `servo:interactive` mark (shell, tray and canvas up and taking input) |
| Cold start, from the cache | ≤ 3000 ms to ready | The same, on a later visit, served by the service worker (task 5.5). This is how a child usually opens the app |
| Frame time, p95 | ≤ 16 ms | 60 fps. The canvas harness's budget (`FRAME_BUDGET_MS`, packages/tools/src/e2e/profile.ts) |
| Frames delivered | ≥ 50 a second | The canvas harness's floor on a hardware GPU, allowing for a busy machine |

## Profiles

| Profile | Stands in for | Viewport | CPU | First-visit network |
| --- | --- | --- | --- | --- |
| `ipad-2020` | 2020 iPad (A12, 4 GB), landscape | 1180 × 820 CSS px at 2×, touch | 2× slowdown (CDP `Emulation.setCPUThrottlingRate`) | 20 Mbit/s down, 5 up, 20 ms round trip |
| `chromebook-low` | Low-end Chromebook (Celeron or MediaTek class, 4 GB) | 1366 × 768 at 1×, touch | 4× slowdown | the same |

The profiles live in `packages/tools/src/perf/profiles.ts`. The slowdowns are the ones the task names. A12 single-core speed is roughly half the M1 Max's, and an N4020-class Celeron roughly a quarter. A visit after the first loads from the service worker's cache and is not network-shaped. The server gzips text as a web host does. `vite preview` does not.

Machine for every figure below: MacBook Pro, Apple M1 Max, Chromium (Playwright 1.63, new headless) on the Metal GPU through ANGLE. The machine was shared with other builders the whole time, at load averages of 20 to 40 on 10 cores. Each figure is the median of three independent runs, each in a fresh browser context.

## What is measured, and how

`pnpm perf:app` at the repo root (`packages/tools/src/perf/main.ts`):

1. Runs `pnpm art`, then builds the app twice. The release build (`vite build`) is used for the bundle and for cold start. The perf build (`vite build --mode perf`) adds one page, `packages/app/src/perf/perf.html`, used for frames. That page is the real app (`mountApp`) on a store that opens with content's 25-part `busy-workbench` fixture as the newest build. A release never builds it.
2. **Bundle.** Every JS and CSS file, raw and gzipped, plus what `index.html` loads before the app can start.
3. **Cold start.** For each profile, in a fresh context with the CPU slowed and the network shaped, it opens `/` and reads `first-contentful-paint` and the `servo:interactive` mark that `main.tsx` sets once `mountApp` resolves (`packages/app/src/perf/marks.ts`). It then waits for the service worker to install and opens `/` again in a new tab, served from the worker's cache.
4. **Frames on busy-workbench.** These run on the perf page, after the fit settles, with the CPU slowed:
   - Build: 120 frames of wheel zoom, then 120 of a two-finger pinch, dispatched in the frame as the canvas harness does.
   - Run at 30 ticks a second, for 150 frames after the one-second spin-up. The view is fitted and then zoomed out three steps, so the robot and the bench's test circuits stay drawn while the robot drives off. Measured once with nothing selected (`run`) and once with the motor driver's spec card and its live readouts showing (`runSpecCard`, selected through Run mode's list view).
   - The first Run's time from the press to Run mode. That time includes loading sim-core and the physics engine.
5. Holds each figure to its budget and exits non-zero if one is over (`--no-budget` only reports).

Each frame is timed two ways (`packages/tools/src/perf/page.ts`):

- **busy**: the reported frame time. It runs from the frame's first requestAnimationFrame callback until every task its callbacks queued has run, so it includes the React renders a Run frame's updates cause.
- **rAF work**: only the frame's requestAnimationFrame callbacks, summed. This is the canvas harness's measure (packages/tools/src/e2e/performance.ts), so the two can be compared.

Frames delivered is frames given ÷ elapsed time, so a dropped frame counts.

```sh
pnpm perf:app                                   # both profiles, 3 runs each, budgets enforced (about 4 minutes)
pnpm perf:app --profile ipad-2020 --runs 5      # one profile, more runs
pnpm perf:app --no-budget --json perf.json      # report only, with every sample and every frame's busy time
pnpm perf                                       # sim-core tick cost, canvas frame time, the canvas e2e frame tests (unchanged)
```

Chromium must be installed once (`pnpm --filter @servo/tools exec playwright install chromium`). `pnpm perf:app` is not part of `pnpm perf`, because Run frames are still out of budget (below) and the CI perf job would then always fail. Add it to the tools `perf` script once the Run-frame question is settled.

## Results: before and after

"Before" is main at 9be6576 with only the measurement added. "After" is this branch. Both were taken with the same harness, under the load described above.

### Bundle (release build)

| | Before | After |
| --- | --- | --- |
| Loaded before the app starts | 4846 KB (1696 KB gzipped) | **1397 KB (395 KB gzipped)** |
| Largest start chunk | `index` 3940 KB (1450 KB gzipped): app, sim-core and Rapier with its inlined WebAssembly | `store` 621 KB (161 KB gzipped): React, Dexie, content and schema, shared with parent.html |
| Lazy at the first Run | none | sim-core with Rapier, 3449 KB (1301 KB gzipped) |
| Every file | 4936 KB (1722 KB gzipped) | 4936 KB (1722 KB gzipped) |

Vite still warns about chunks over 500 KB: the lazy sim-core chunk (Rapier's compat build inlines its WebAssembly, which D11 accepts) and `store`. The service worker precaches every file, so the lazy chunk is on the device for offline Runs. R-5.5's airplane-mode test covers that.

### Cold start (ms; ready = later of first paint and interactive)

| Profile | Figure | Before | After | Budget |
| --- | --- | --- | --- | --- |
| ipad-2020 | first visit, ready | 2372 | **1488–1736** | ≤ 3000 |
| ipad-2020 | from cache, ready | 1488 | **1168–1176** | ≤ 3000 |
| ipad-2020 | first Run, press to Run mode | 640 | 794–819 | — |
| chromebook-low | first visit, ready | **3236 (over)** | **1976–2100** | ≤ 3000 |
| chromebook-low | from cache, ready | 2292 | **1728–1928** | ≤ 3000 |
| chromebook-low | first Run, press to Run mode | 1081 | 1013–1144 | — |

The "after" ranges are the medians of separate three-run sets on the same code (perf-lazy and perf-after), so the spread is the machine's load. The first Run now also loads the 3.4 MB chunk from the cache and parses it. On these figures that is within the noise of the 0.6–1.1 s it already spent creating the Simulation and compiling Rapier's WebAssembly. The Run bar's `loading` phase covers it.

### Frames on busy-workbench (busy p50 / p95 in ms, frames delivered a second)

| Profile | Mode | Before | After | Budget p95 |
| --- | --- | --- | --- | --- |
| ipad-2020 | Build, wheel | 4.4 / 8.3, 60 | 3.7 / 6.7, 60 | ok |
| ipad-2020 | Build, pinch | 5.5 / 15.2, 58 | 5.5 / 12.5, 60 | ok |
| ipad-2020 | Run, 30 tps | 8.2 / 22.6, 56 | 8.0 / 18.6–20.3, 56 | **over** |
| ipad-2020 | Run, spec card open | 9.8 / 31.6, 51 | 8.0–10.1 / 23.4–26.5, 50–53 | **over** |
| chromebook-low | Build, wheel | 9.0 / 14.2, 60 | 7.2–7.9 / 12.9–15.3, 60 | ok |
| chromebook-low | Build, pinch | 9.8 / 16.2, 59 | 9.0–9.3 / 15.6–18.2, 60 | at the edge |
| chromebook-low | Run, 30 tps | 9.5 / 30.6, 55 | 8.8–10.1 / 29.1–30.5, 54–55 | **over** |
| chromebook-low | Run, spec card open | 12.1 / 31.0, 52 | 11.1–14.2 / 31.3–36.3, 48–53 | **over** |

Build mode is within budget on the iPad profile. On the Chromebook profile the pinch's p95 sits at 16 ms, on either side of it from run to run. Run mode is over on both. The lazy load does not touch frame time; the changes in this table are the machine's load.

## The fixes, each with its figure

1. **sim-core lazy-loaded at the first Run** (`packages/app/src/run-bar/run-loop.ts`, `loadCreateSimulation`). D11 said the physics engine loads at the first Run. Only `init()` was deferred, though: run-loop.ts imported `createSimulation` statically, so the whole of sim-core and Rapier's inlined WebAssembly sat in the start chunk and was downloaded and parsed on every cold start. Run-loop.ts now imports sim-core dynamically. It is the app's only runtime import of sim-core; everything else imports types. What loads before start went from 1696 to 395 KB gzipped. The Chromebook profile's first visit went from 3236 ms (over) to 1976–2100 ms, and the iPad profile's from 2372 to 1488–1736 ms. `packages/app/test/perf/perf.test.ts` fails if any app file imports sim-core's code at load again.

Two candidate fixes were measured and **not** kept, because the numbers did not justify them:

- **Stepping the next tick ahead in the frame between ticks.** At 30 ticks a second on a 60 Hz display, every other frame steps the Simulation. The idea was to step one tick early, in the frame that draws none, so no frame would carry both a step and a tick's drawing. Interleaved A/B on the Chromebook profile, 5 rounds of 240 Run frames each, gave busy p95 24.4 ms without it and 26.3 ms with it, and frames over 16 ms went from 58 to 62. It did not help because the canvas draws every Run frame anyway, tweening and flowing the wires. Stepping early only moves the heavy frame, and it would have cost a tick of input latency to work around. Reverted.
- **Spec card readouts at 5 a second instead of 30.** Interleaved A/B on the Chromebook profile with the card open: busy p50 11.2 → 9.2 ms, p95 33.8 → 29.8 ms, 90 → 72 frames over 16 ms. That is real, but still far over budget, and it changes what the card shows. Not kept. It is listed as an option below.

## Why Run frames are still over, and where the time goes

CPU profiles of the perf build during a Run (CDP Profiler, unminified build, busy-workbench, 3 s windows, under the same load):

| Per tick or frame | No slowdown | 2× | 4× |
| --- | --- | --- | --- |
| sim-core `step()` per tick (every other frame) | ≈ 2.0 ms | 6.3–7.4 ms | ≈ 9.5 ms |
| of which the mechanical solver (Rapier) | ≈ 1.1 ms | 4.0–5.4 ms | ≈ 5–6 ms |
| canvas draw per frame (`frame`, Pixi render) | ≈ 1.2 ms | 2.8–4.3 ms | ≈ 5 ms |
| React per tick, spec card open (readouts, `useSyncExternalStore`) | — | ≈ 1.2 ms | ≈ 1.8 ms |

A frame that steps a tick carries the step and a full canvas draw, plus style, layout and GC. At 2× that is about 11–14 ms with spikes past 16. At 4× the step alone is over half the budget. The canvas harness's own Run test (`run-animation.timing.ts`) steps the Simulation before timing, so it never sees this cost. In the app, the run loop steps inside the frame.

The largest single cost is the mechanical solver. It restores the Rapier world from its snapshot bytes, steps it, and snapshots it again on every tick (packages/sim-core/src/mechanical/world.ts, so that a Run's state is plain bytes and a restored Run replays bit for bit). Every candidate fix is outside this task's files or changes behaviour, so each is a question below rather than a change here.

Two smaller costs, also outside this task's files:

- The canvas list view rebuilds its whole DOM once a simulated second during a Run (`readoutsDue`, packages/canvas/src/run-animation/readouts.ts). With 25 parts and 43 wires that shows up as single frames of 30–60 ms at 4×, roughly once a second.
- Pinch at 4× sits at the edge of the budget in the canvas renderer.

## Still to confirm on devices

All the figures above are stand-ins. These need a real run, with `pnpm release:dry && pnpm release:preview` served on the local Wi-Fi, or the perf page on a dev server:

1. A 2020 iPad (A12), Safari 17 or later: cold start (first visit and from the home-screen app), Build pan, zoom and pinch on busy-workbench, Run at 30 ticks a second with and without the spec card. The 2× stand-in may flatter or wrong the A12. Rapier's WebAssembly under Safari's JIT especially needs checking.
2. A low-end Chromebook (Celeron N4020 or MediaTek MT8183 class, 4 GB): the same list.

Safari has no CDP, so on the iPad the figures come from Web Inspector's timeline (frames, and the `servo:interactive` mark in the performance timeline) or from a screen recording at 60 fps.

## Questions for Drew (for the orchestrator's decision queue)

1. **Device runs.** Who runs the list above on a real 2020 iPad and a low-end Chromebook, and when? Default: the orchestrator writes it into the G6 tester checklist, and these stand-in figures stand until then.
2. **Run frames over budget on both profiles.** Pick one:
   - (a) sim-core keeps the live Rapier world between ticks and serialises it only when a snapshot is asked for (Stop, records). This is the biggest single saving, but every golden must stay byte-identical, which needs proving with `pnpm golden` and the determinism sweep, since a live world may not step bit-identically to a restored one;
   - (b) run the Simulation in a Web Worker, so main-thread frames carry only the canvas. This removes the cost on any device, at the price of the run loop stepping one tick ahead (a switch flip lands up to one tick, 33 ms, later) and an asynchronous Simulation API in the run loop, the recorder and the shared-build replay;
   - (c) hold the spec card's readouts and the list view's rebuild to a few times a second during a Run (measured: p95 33.8 → 29.8 ms at 4×; not enough alone);
   - (d) accept Run mode at under 60 fps on low-end devices, with Build mode held to 60.

   Default taken: none built. The figures are recorded, and the decision waits. (a) needs a sim-core task and (b) an app task of their own.
3. **The 2× and 4× slowdowns** stand in for the devices because the task names them. Confirm them, or replace them with figures from the device runs. Default: kept.
4. **`pnpm perf:app` in CI.** Should it join `pnpm perf` and the CI perf job now, failing until Run frames are within budget, or only once they are? Default: kept apart until then.
