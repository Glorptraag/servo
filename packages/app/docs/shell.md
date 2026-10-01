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
| Spec card | Right edge, under the header, 320 px wide, while a part is selected | `<aside aria-label="Spec card">`; its text scrolls |
| Arena strip | Along the top of the canvas, from beside the header's tab to beside where the spec card shows | `<section aria-label="Arena strip">` |
| Run bar | Bottom centre of the canvas beside the tray; always there, never moving | `<section aria-label="Run bar">`: the room kept for it, with the bar centred in it |
| Zoom control | Bottom corner on the spec card's side, below the card; never moving | `role="group"`, "Zoom": Zoom in, Fit, Zoom out |

Portrait means taller than wide. [layout.ts](../src/shell/layout.ts) computes every box from the shell's own size (its host's, followed with a ResizeObserver), so the shell lays out the same in the page and in a test harness. [place.ts](../src/shell/place.ts) puts each box on the page by transform; [shell.css](../src/shell/shell.css) gives the look and the motion.

## The Run/Stop button never moves

The Run bar and the zoom control sit where the Build layout with everything open puts them, in every state: Run and Stop, every tuck, a selection coming or going, the card stepping aside. Pressing Run and then Stop hits the same spot every time, though Run takes the tray away. In portrait that leaves canvas under the Run bar while the tray is away. Only the screen's size and the hand move them.

## At most 30% of the canvas covered

The header, the part tray and the spec card where they show, the Run bar, the zoom control and the tabs that show never cover more than 30% of the canvas, so at least 70% of the screen is canvas a child can see, in every state. The Run bar is counted at the full room the layout keeps for it, 440 × 64 px, whatever it holds. The arena strip is a layer of the canvas, as the arena is, and is not counted.

The spec card is a readable 320 px wide (300–340 px asked). Its height is the one size that gives way: as tall as keeps the 30% with everything open and the card showing, and short enough to leave the zoom control room below it. It is worked out for that state, so it never changes, and every other state uncovers more. The card never covers the canvas fully, and its text scrolls; task 4.3 fits the Level 1–2 cards without scrolling at the 10-inch size where it can.

| Screen (CSS px) | Spec card | Canvas seen, everything open, a part selected | Every edge tucked, nothing selected |
| --- | --- | --- | --- |
| 10-inch landscape, 1180 × 820 | 320 × 315 | 70.0% | 95.9% |
| 13-inch, 1366 × 1024 | 320 × 617 | 70.0% | 97.1% |
| Tablet portrait, 820 × 1180 | 320 × 355 | 70.0% | 95.9% |

The unit tests check every combination of tucked edges, Build and Run, a part selected or not, the card stepped aside or not, and both hands on these screens, and with everything open every screen whose short side is 744–1440 px and long side 1024–2560 px, either way up.

## The spec card

- At rest it is away, and so is its tab. It slides in when a part is selected and out when nothing is, or a wire or a prop is (brief Section 9, and the layout figure's "slides in on tap"). The shell follows the canvas's `select` events; `useShell().selection` tells task 4.3 which part to show. The real canvas selects from task 3.4.
- Tucked by the child, it stays tucked for the next part, and across a reload, with its tab at the screen edge to bring it back.
- It never covers a port being wired. While a finger or pointer drags on the canvas (a wire, a part, a pan or a pinch), it steps aside off the screen edge, and it comes back when every finger lifts. A tap does not move it. Drags count once they pass the canvas's own drag threshold (8 px at drag sensitivity 1). The shell only listens, so the canvas's input is unchanged. Tap-then-tap wiring is not a drag: `setSpecCardAside(true)` keeps the card aside until `setSpecCardAside(false)`, for tasks 3.3 and 4.3 to call once the canvas reports a wire in progress.

## Tucking

- The header, the tray, the spec card and the arena strip each have a tab. The tab's name is the region's, `aria-expanded` says whether the region shows, and `aria-controls` names it.
- The Run bar has no tab and never tucks: it is the one control a child must always reach (brief Section 9: "always visible").
- The header's, the tray's and the spec card's tabs are pull tabs on the canvas side of their edge, so they stay on screen when the edge is tucked. The arena strip's tab stays beside where the card shows, so neither it nor the strip moves as the card comes and goes.
- A tucked region slides out, then stops being drawn and is `inert`, so nothing in it takes focus.
- Run mode moves the tray out whatever its tuck state, and its tab with it (brief Section 9); Build brings them back as the child left them.
- Tuck states persist on the device in localStorage under `servo.shell.tucked`, a JSON list of the tucked edges, for example `["tray","specCard"]`. They are written only when the child changes one. A storage that is missing, full or blocked is caught, and the tucks then last for the visit. They are UI state, so they are not in the store (task 4.9), and not per profile. A saved `runBar` from before it stopped tucking is ignored.

## The safe area (task 3.7)

`layout.safeArea` says how far in from each side the canvas a child can see begins: past the header, the tray and the card where they show, the Run bar's room at the bottom, and the zoom control's column on the card's side when the card is away. The shell calls `onSafeArea(safeArea, canvas)` with it once the canvas is up and whenever it changes, so that once task 3.7 lets the canvas take safe-area insets, App.tsx passes them on and load and Fit centre the build in the canvas a child can see. Until then App.tsx passes nothing, and the canvas centres the build on the whole screen.

## Motion

UI motion is 160 ms (brief Section 11). Panels and their tabs slide by transform. The canvas, the Run bar and the zoom control never move when an edge tucks. The canvas resizes only when the screen does (a tablet turning, a window resized), and then it draws again in the same frame (packages/canvas, `CanvasSurface.resized`), so it never shows its cleared, black buffer. `prefers-reduced-motion` makes every move instant.

## Type

One rounded sans-serif where the device has one: Nunito, Varela Round, then the system's rounded face (`ui-rounded`), then the system face. No bold-only face such as Arial Rounded MT Bold: on Apple devices it would draw every word bold, and bold marks real names. No font ships yet; which one does is task 5.7's.

## Slots

`<Shell slots={…}>` takes a React node per slot ([shell.tsx](../src/shell/shell.tsx), `ShellSlots`). An empty slot shows nothing. [App.tsx](../src/App.tsx) fills them with [placeholders](../src/shell/placeholders.tsx) of real words only: disabled Home, Save and Run buttons, and the tray, spec card and arena strip showing their names.

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
- `selection`: the canvas's selection; the spec card shows while it is a part.
- `tucked` and `setTucked(edge, tucked)`.
- `specCardAside` and `setSpecCardAside(aside)`: see above.
- `prefs` and `setPrefs(prefs)`: the canvas's prefs, which the shell keeps. `leftHanded` is the hook for task 5.7: it mirrors the tray, the spec card and everything on the canvas, and passes the canvas its prefs. The header reads left to right either way.
- `layout`: every region's box now, and the safe area.

## The zoom control

Zoom in and out step along a ladder of zooms a half power of two apart (0.5, 0.71, 1, 1.41, 2, 2.83, 4), so two taps double or halve and both the default and 400% are rungs ([zoom.ts](../src/shell/zoom.ts)). After a pinch the next tap lands on the nearest rung. Fit calls `canvas.fit()`. The canvas holds every zoom inside its limits.

## Running it

From the repository root: `pnpm dev` serves the app with Vite, `pnpm build` writes it to `packages/app/dist`, and `pnpm --filter @servo/app preview` serves that build. Dev and build run `pnpm art` first, so the parts have their placeholder pictures; without it every part draws as a neutral tile. The build targets D14's browsers. Until task 4.9 the app opens no store, so the canvas starts empty and nothing is saved.

## Tests

`pnpm --filter @servo/app test` runs two Vitest projects ([vitest.config.ts](../vitest.config.ts)):

- **unit** (Node): the layout maths, the tuck states' storage, the zoom ladder, and the package contracts.
- **browser** (headless Chromium, Playwright, as packages/canvas):
  - [layout.test.ts](../test/browser/layout.test.ts) opens the real page, index.html, in a frame the size of each target screen: 1180 × 820, 1366 × 1024 and 820 × 1180. It checks that the canvas fills the screen; where each region sits, with the spec card away at rest; at least 70% of the canvas uncovered with everything open, edge by edge as each tucks, and with everything tucked; that nothing lies over anything else; the landmarks, names and 44 px targets, and no tab for the Run bar; and that tuck states survive a real reload of the frame. Its motion tests check each move's timing, that the canvas, the Run bar and the zoom control never move, and that reduced motion moves nothing. One holds the page's animation frames and steps edge slides and a change of screen size, reading the canvas from real screenshots: a canvas that waited for its next frame to draw would read black there.
  - [shell.test.tsx](../test/browser/shell.test.tsx) mounts the shell with a stand-in canvas that can select a part. At each target screen and for each hand, it records the Run button's centre in Build mode and checks it after Run, Stop and every tuck, in both modes, a selection and the card stepping aside. At each target screen it shows the card and checks its width, place and the 70% floor. It also checks the card following the selection and keeping the child's tuck, slots, the header following the build, Run mode, the left-handed mirror, the card stepping aside for a drag but not a tap, the safe-area hook, the zoom control, refusing storage, and `mountApp` with the real canvas.

Two things about headless Chromium shape the tests. Above about 1180 × 820 it stops drawing frames for the test page, so the frames for bigger screens are scaled down to fit, which leaves the page inside them at full size. It also holds a composited transition until something else draws a frame. So the geometry tests ask for reduced motion and read where regions end up, and the motion tests read what each move is set to do, or step it by hand.

## Decisions and open questions

Rulings applied (orchestrator, 2026-10-01):
- The canvas fills the screen behind the edges, and at most 30% of it is covered.
- The spec card is 300–340 px wide, may scroll, and is away at rest, sliding in while a part is selected; its tuck persists.
- The Run bar never tucks and never moves.
- The arena strip is part of the canvas; the zoom control and the tabs count as covering it.
- The canvas takes safe-area insets from task 3.7; the shell has the hook.

Still open, for Drew and the orchestrator:
1. The spec card steps aside for every drag on the canvas, pans and pinches included: the simple rule that covers every wire drag. Tap-then-tap wiring needs the canvas to report a wire in progress (task 3.3); `setSpecCardAside` is ready for it.
2. Home has nowhere to go yet, and Save waits for task 4.9: both are disabled placeholders. No task owns what goes in the arena strip.
3. The header shows a kit's name only when one is passed in; which kit the sandbox's tray holds, and who sets it, is open (D68). A slot's owner edits App.tsx to swap in its part.
4. The zoom steps (half powers of two).
5. The child's level is 1 until progress (task 5.2) says otherwise.
6. Tuck states belong to the device, not to a child's profile.
