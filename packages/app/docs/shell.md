# The app shell (task 4.1)

Back to the [README](../README.md). The code is in [src/shell/](../src/shell/); [src/App.tsx](../src/App.tsx) puts the slots in and [src/index.ts](../src/index.ts) mounts it (`mountApp`).

The shell is the frame round the canvas (brief Section 9): the regions, where they sit at every screen size, tucking them away, the header and the zoom control. What goes in the regions is other tasks' work, through slots.

## Regions

The canvas fills the screen behind the edges. Everything else lies over it, as edge-mounted panels and floating controls with soft shadows where they overlap it (brief Section 11).

| Region | Where | In the DOM |
| --- | --- | --- |
| Canvas | The whole screen, under everything | `<main>`: the canvas's host, which `mountCanvas` fills |
| Header | Top edge, 52 px | `<header>` (banner): Home, the kit and level name, the goal line and hint button, the blueprint's name, the sound control, Save |
| Part tray | Left edge, 112 px wide; bottom edge, 112 px tall, in portrait | `<section aria-label="Part tray">` |
| Spec card | Right edge, under the header, 320 px wide | `<aside aria-label="Spec card">`; its text scrolls |
| Arena strip | Along the top of the canvas, between the header's tab and its own | `<section aria-label="Arena strip">` |
| Run bar | Bottom centre of the canvas the header and tray leave; always there | `<section aria-label="Run bar">`: the room kept for it, with the bar centred in it |
| Zoom control | Bottom corner on the spec card's side, below the card | `role="group"`, "Zoom": Zoom in, Fit, Zoom out |

Portrait means taller than wide. [layout.ts](../src/shell/layout.ts) computes every box from the shell's own size (its host's, followed with a ResizeObserver), so the shell lays out the same in the page and in a test harness. [place.ts](../src/shell/place.ts) puts each box on the page by transform; [shell.css](../src/shell/shell.css) gives the look and the motion.

## At most 30% of the canvas covered

The edges the brief names (the header, the part tray, the spec card and the Run bar) together never cover more than 30% of the canvas, so at least 70% of the screen is canvas a child can see, in every state. The Run bar is counted at the full room the layout keeps for it, 440 × 64 px, whatever it holds. The arena strip, the zoom control and the tabs are tools on the canvas, as the brief's table places the arena strip, and are not counted.

The spec card is a readable 320 px wide (300–340 px asked). Its height is the one size that gives way: as tall as keeps the 30% with everything open, and short enough to leave the zoom control room below it. It is worked out for that state, so it never changes as edges tuck, and tucking only ever uncovers more canvas. The card never covers the canvas fully.

| Screen (CSS px) | Spec card | Canvas seen, everything open | With every edge tucked |
| --- | --- | --- | --- |
| 10-inch landscape, 1180 × 820 | 320 × 358 | 70.0% | 97.1% (the Run bar stays) |
| 13-inch, 1366 × 1024 | 320 × 661 | 70.0% | 98.0% |
| Tablet portrait, 820 × 1180 | 320 × 398 | 70.0% | 97.1% |

The unit tests check every combination of tucked edges, Build and Run, both hands and the card stepped aside on these screens, and with everything open every screen whose short side is 744–1440 px and long side 1024–2560 px, either way up.

## Tucking

- The header, the tray, the spec card and the arena strip each have a tab. The tab's name is the region's, `aria-expanded` says whether the region shows, and `aria-controls` names it.
- The Run bar has no tab and never tucks: it is the one control a child must always reach (brief Section 9: "always visible").
- The header's, the tray's and the spec card's tabs are pull tabs on the canvas side of their edge, so they stay on screen when the edge is tucked. The arena strip's tab is at the strip's end.
- A tucked region slides out, then stops being drawn and is `inert`, so nothing in it takes focus.
- Run mode moves the tray out whatever its tuck state, and its tab with it (brief Section 9); Build brings it back as the child left it.
- Tuck states persist on the device in localStorage under `servo.shell.tucked`, a JSON list of the tucked edges, for example `["tray","specCard"]`. They are written only when the child changes one. A storage that is missing, full or blocked is caught, and the tucks then last for the visit. They are UI state, so they are not in the store (task 4.9), and not per profile. A saved `runBar` from before it stopped tucking is ignored.

## The spec card never covers a port being wired

While a finger or pointer drags on the canvas (a wire, a part, a pan or a pinch), the spec card steps aside off the screen edge, and it comes back when every finger lifts. A tap does not move it. Drags count once they pass the canvas's own drag threshold (8 px at drag sensitivity 1). The shell only listens, so the canvas's input is unchanged. Tap-then-tap wiring is not a drag: `setSpecCardAside(true)` keeps the card aside until `setSpecCardAside(false)`, for tasks 3.3 and 4.3 to call once the canvas reports a wire in progress.

## Motion

UI motion is 160 ms (brief Section 11). Panels and the controls beside them slide by transform. The canvas never moves or resizes when an edge tucks. It resizes only when the screen does (a tablet turning, a window resized), and then it draws again in the same frame (packages/canvas, `CanvasSurface.resized`), so it never shows its cleared, black buffer. `prefers-reduced-motion` makes every move instant.

## Slots

`<Shell slots={…}>` takes a React node per slot ([shell.tsx](../src/shell/shell.tsx), `ShellSlots`). An empty slot shows nothing. [App.tsx](../src/App.tsx) fills them with [placeholders](../src/shell/placeholders.tsx) of real words only: disabled Home and Run buttons, and the tray, spec card and arena strip showing their names. Save is task 4.9's ([save.tsx](../src/shell/save.tsx), [store.md](store.md), "In the app"). The shell also takes `child`, the child's records, and `start`, a build it loads onto the canvas once the canvas is mounted (task 4.9).

| Slot | Region | Owner |
| --- | --- | --- |
| `tray` | Part tray | 4.2 |
| `specCard` | Spec card | 4.3 |
| `runBar` | Run bar, within 440 × 64 px | 4.4 |
| `goal` | Header, the one-line goal | 4.5 |
| `hints` | Header, beside the goal | 4.6 |
| `save` | Header | 4.9 |
| `sound` | Header | 4.10 |
| `home` | Header | Not assigned yet (decision queue; D28 places the parent view behind Home) |
| `arenaStrip` | Arena strip | Not assigned yet (decision queue: the preset picker, Reset arena's arena and the props, D29, D36) |

A component in a slot reads the shell with `useShell()` ([context.ts](../src/shell/context.ts)):

- `content`, `level`, `kit`: what the app passes in. `kit` is shown in the header when given.
- `canvas`: the canvas handle, null for the first render only.
- `mode` and `setMode(mode)`: switches the canvas and the layout together. The run loop calls this, not `canvas.setMode`.
- `blueprint` and `load(blueprint)`: the build on the canvas, as `load` and every `edit` leave it. Load through the shell so the header's name follows.
- `child`: the child's records in the store (task 4.9), where Save keeps the build and later tasks keep Runs and find builds. Null when there is no store or no one profile in use.
- `tucked` and `setTucked(edge, tucked)`.
- `specCardAside` and `setSpecCardAside(aside)`: see above.
- `prefs` and `setPrefs(prefs)`: the canvas's prefs, which the shell keeps. `leftHanded` is the hook for task 5.7: it mirrors the tray, the spec card and everything on the canvas, and passes the canvas its prefs. The header reads left to right either way.
- `layout`: every region's box now.

## The zoom control

Zoom in and out step along a ladder of zooms a half power of two apart (0.5, 0.71, 1, 1.41, 2, 2.83, 4), so two taps double or halve and both the default and 400% are rungs ([zoom.ts](../src/shell/zoom.ts)). After a pinch the next tap lands on the nearest rung. Fit calls `canvas.fit()`. The canvas holds every zoom inside its limits.

## Running it

From the repository root: `pnpm dev` serves the app with Vite, `pnpm build` writes it to `packages/app/dist`, and `pnpm --filter @servo/app preview` serves that build. Dev and build run `pnpm art` first, so the parts have their placeholder pictures; without it every part draws as a neutral tile. The build targets D14's browsers. The app opens the store (task 4.9): with one profile on the device it opens that child's newest build, and otherwise the canvas starts empty and nothing is saved ([store.md](store.md), "In the app").

## Tests

`pnpm --filter @servo/app test` runs two Vitest projects ([vitest.config.ts](../vitest.config.ts)):

- **unit** (Node): the layout maths, the tuck states' storage, the zoom ladder, and the package contracts.
- **browser** (headless Chromium, Playwright, as packages/canvas):
  - [layout.test.ts](../test/browser/layout.test.ts) opens the real page, index.html, in a frame the size of each target screen: 1180 × 820, 1366 × 1024 and 820 × 1180. It checks that the canvas fills the screen; where each region sits; the spec card's width; at least 70% of the canvas uncovered with everything open, edge by edge as each tucks, and with everything tucked; that nothing lies over anything else; the landmarks, names and 44 px targets, and no tab for the Run bar; that tuck states survive a real reload of the frame; and, with real mouse input, that the spec card steps aside for a drag and not for a tap. Its motion tests check each move's timing, that the canvas never moves, and that reduced motion moves nothing. One holds the page's animation frames and steps edge slides and a change of screen size, reading the canvas from real screenshots: a canvas that waited for its next frame to draw would read black there.
  - [shell.test.tsx](../test/browser/shell.test.tsx) mounts the shell with a stand-in canvas: slots, the header following the build, Run mode, the left-handed mirror, the spec card stepping aside, the zoom control, refusing storage, and `mountApp` with the real canvas.

Two things about headless Chromium shape the tests. Above about 1180 × 820 it stops drawing frames for the test page, so the frames for bigger screens are scaled down to fit, which leaves the page inside them at full size. It also holds a composited transition until something else draws a frame. So the geometry tests ask for reduced motion and read where regions end up, and the motion tests read what each move is set to do, or step it by hand.

## Decisions and open questions

Rulings applied (orchestrator, 2026-10-01): the canvas fills the screen behind the edges and at most 30% of it is covered; the spec card is 300–340 px wide; the Run bar never tucks. Taken here within them, conservatively, for Drew:

1. Covered means the four edges the brief names, the Run bar at its full 440 × 64 px room. The arena strip, the zoom control and the tabs are tools on the canvas and not counted.
2. To keep the 30%, the spec card's height gives way: 358 px on the 10-inch landscape screen. Its text scrolls.
3. `canvas.fit()` frames the build in the whole screen, under the panels too: the canvas has no way to leave room for them. A large build can end up partly under the tray or the card. Fit that keeps clear of the panels needs a canvas interface change.
4. The spec card steps aside for every drag on the canvas, pans and pinches included: the simple rule that covers every wire drag. Tap-then-tap wiring needs the canvas to report a wire in progress; `setSpecCardAside` is ready for it.
5. Home has nowhere to go yet: a disabled placeholder. Save and the blueprint's name are task 4.9's ([store.md](store.md)). No task owns what goes in the arena strip.
6. The header shows a kit's name only when one is passed in; which kit the sandbox's tray holds is for tasks 4.2 and 4.5.
7. The spec card starts open, as in the brief's picture; task 4.3 decides whether it slides in only when a part is tapped.
8. The zoom steps (half powers of two).
9. The child's level is 1 until progress (task 5.2) says otherwise.
10. Tuck states belong to the device, not to a child's profile.
