# The app shell (task 4.1)

Back to the [README](../README.md). The code is in [src/shell/](../src/shell/); [src/App.tsx](../src/App.tsx) puts the slots in and [src/index.ts](../src/index.ts) mounts it (`mountApp`).

The shell is the frame round the canvas (brief Section 9): the regions, where they sit at every screen size, tucking them away, the header and the zoom control. What goes in the regions is other tasks' work, through slots.

## Regions

| Region | Where | In the DOM |
| --- | --- | --- |
| Header | Top edge, 52 px | `<header>` (banner): Home, the kit and level name, the goal line and hint button, the blueprint's name, the sound control, Save |
| Part tray | Left edge, 112 px wide; bottom edge, 112 px tall, in portrait | `<section aria-label="Part tray">` |
| Canvas | Everything the header and tray leave | `<main>`: the canvas's host, which `mountCanvas` fills |
| Spec card | Over the canvas's right side, top to bottom of the canvas | `<aside aria-label="Spec card">`, with the only panel shadow, because it lies over the canvas |
| Arena strip | Along the top of the canvas, between the two top tabs | `<section aria-label="Arena strip">`, floating |
| Run bar | Bottom centre of the canvas the child can see | `<section aria-label="Run bar">`, floating |
| Zoom control | Bottom corner of the canvas on the spec card's side | `role="group"`, "Zoom": Zoom in, Fit, Zoom out |

Portrait means taller than wide. [layout.ts](../src/shell/layout.ts) computes every box from the shell's own size (its host's, followed with a ResizeObserver), so the shell lays out the same in the page and in a test harness. The CSS in [shell.css](../src/shell/shell.css) gives the look and the motion.

## The canvas keeps 70% of the screen

The canvas the child sees is the canvas's box less the spec card, which slides over it without resizing it, so the build does not move (brief Section 10). The arena strip, the Run bar, the zoom control and the tabs float on the canvas and count as canvas, as the brief's table places them on it.

Only the spec card's width gives way. It is 280 px where the screen has room, and otherwise as wide as keeps the canvas at 70% with the header, the tray and the card all showing. It is worked out for that state, so it never changes as edges tuck, and tucking only ever gives the canvas more room.

| Screen (CSS px) | Spec card | Canvas, everything open | Everything tucked |
| --- | --- | --- | --- |
| 10-inch landscape, 1180 × 820 | 186 px | 70.0% | 100% |
| 13-inch, 1366 × 1024 | 246 px | 70.0% | 100% |
| Tablet portrait, 820 × 1180 | 153 px | 70.0% | 100% |

The unit tests check every combination of tucked edges, Build and Run, and both hands on these screens, and with everything open every screen whose short side is 744–1440 px and long side 1024–2560 px, either way up.

## Tucking

- Every region has a tab: the header, the tray, the spec card, the arena strip and the Run bar. The tab's name is the region's, `aria-expanded` says whether the region shows, and `aria-controls` names it.
- The header's, the tray's and the spec card's tabs are pull tabs on the canvas side of their edge, so they stay on screen when the edge is tucked. The arena strip's tab is at the strip's end and the Run bar's beside the bar.
- A tucked region slides out, then stops being drawn and is `inert`, so nothing in it takes focus.
- Run mode moves the tray out whatever its tuck state, and its tab with it (brief Section 9); Build brings it back as the child left it. The spec card, the Run bar and the arena strip stay.
- Tuck states persist on the device in localStorage under `servo.shell.tucked`, a JSON list of the tucked edges, for example `["tray","specCard"]`. They are written only when the child changes one. A storage that is missing, full or blocked is caught, and the tucks then last for the visit. They are UI state, so they are not in the store (task 4.9), and not per profile.

## Motion

UI motion is 160 ms (brief Section 11). Panels slide by transform. The canvas's box and the layer floating on it grow and shrink with them, and the canvas follows its host: it draws again in the same frame as each resize (packages/canvas, `CanvasSurface.resized`), so a slide never shows its cleared, black buffer. `prefers-reduced-motion` makes every move instant.

## Slots

`<Shell slots={…}>` takes a React node per slot ([shell.tsx](../src/shell/shell.tsx), `ShellSlots`). An empty slot shows nothing. [App.tsx](../src/App.tsx) fills them with [placeholders](../src/shell/placeholders.tsx) of real words only: disabled Home, Save and Run buttons, and the tray, spec card and arena strip showing their names.

| Slot | Region | Owner |
| --- | --- | --- |
| `tray` | Part tray | 4.2 |
| `specCard` | Spec card | 4.3 |
| `runBar` | Run bar | 4.4 |
| `goal` | Header, the one-line goal | 4.5 |
| `hints` | Header, beside the goal | 4.6 |
| `save` | Header | 4.9 |
| `sound` | Header | 4.10 |
| `home` | Header | Not assigned (D28 places the parent view behind Home) |
| `arenaStrip` | Arena strip | Not assigned (the preset picker, Reset arena's arena and the props, D29, D36) |

A component in a slot reads the shell with `useShell()` ([context.ts](../src/shell/context.ts)):

- `content`, `level`, `kit`: what the app passes in. `kit` is shown in the header when given.
- `canvas`: the canvas handle, null for the first render only.
- `mode` and `setMode(mode)`: switches the canvas and the layout together. The run loop calls this, not `canvas.setMode`.
- `blueprint` and `load(blueprint)`: the build on the canvas, as `load` and every `edit` leave it. Load through the shell so the header's name follows.
- `tucked` and `setTucked(edge, tucked)`.
- `prefs` and `setPrefs(prefs)`: the canvas's prefs, which the shell keeps. `leftHanded` is the hook for task 5.7: it mirrors the tray, the spec card and everything floating on the canvas, and passes the canvas its prefs. The header reads left to right either way.
- `layout`: every region's box now.

## The zoom control

Zoom in and out step along a ladder of zooms a half power of two apart (0.5, 0.71, 1, 1.41, 2, 2.83, 4), so two taps double or halve and both the default and 400% are rungs ([zoom.ts](../src/shell/zoom.ts)). After a pinch the next tap lands on the nearest rung. Fit calls `canvas.fit()`. The canvas holds every zoom inside its limits.

## Running it

From the repository root: `pnpm dev` serves the app with Vite, `pnpm build` writes it to `packages/app/dist`, and `pnpm --filter @servo/app preview` serves that build. Dev and build run `pnpm art` first, so the parts have their placeholder pictures; without it every part draws as a neutral tile. The build targets D14's browsers. Until task 4.9 the app opens no store, so the canvas starts empty and nothing is saved.

## Tests

`pnpm --filter @servo/app test` runs two Vitest projects ([vitest.config.ts](../vitest.config.ts)):

- **unit** (Node): the layout maths, the tuck states' storage, the zoom ladder, and the package contracts.
- **browser** (headless Chromium, Playwright, as packages/canvas):
  - [layout.test.ts](../test/browser/layout.test.ts) opens the real page, index.html, in a frame the size of each target screen: 1180 × 820, 1366 × 1024 and 820 × 1180. It checks where each region sits, the 70% floor with everything open, edge by edge as each tucks, and with everything tucked; the landmarks, names and 44 px targets; that the controls on the canvas never overlap; and that tuck states survive a real reload of the frame. Its motion tests check each move's timing, that reduced motion moves nothing, and that the canvas is never blank while the tray and the header slide out and back: they hold the slide and the page's animation frames, step through it, and read the canvas from real screenshots (a canvas that waited for its next frame to draw reads black there).
  - [shell.test.tsx](../test/browser/shell.test.tsx) mounts the shell with a stand-in canvas: slots, the header following the build, Run mode, the left-handed mirror, the zoom control, refusing storage, and `mountApp` with the real canvas.

Two things about headless Chromium shape the tests. Above about 1180 × 820 it stops drawing frames for the test page, so the frames for bigger screens are scaled down to fit, which leaves the page inside them at full size. It also holds a composited transition until something else draws a frame. So the geometry tests ask for reduced motion and read where regions end up, and the motion tests read what each move is set to do, or step it by hand.

## Decisions and open questions

Taken here, conservatively, for Drew:

1. The spec card lies over the canvas and counts against the 70%, which leaves it 153–246 px wide on the target screens with the tray open (table above). A wider card would need the card's area counted as canvas, or a narrower tray.
2. The Run bar and the arena strip float on the canvas and count as canvas, as the brief's table places them.
3. The Run bar is "always visible" in the brief's table, and also one of the edges that "can be tucked away". It can be tucked by the child and is never hidden by the app.
4. The arena strip tucks too, and stays as it is in Run mode, where the canvas itself lays the arena down ("expands on Run"). No task owns what goes in it (the preset picker, the props).
5. Home has nowhere to go yet, and Save waits for task 4.9: both are disabled placeholders.
6. The header shows a kit's name only when one is passed in; which kit the sandbox's tray holds is for tasks 4.2 and 4.5.
7. The spec card starts open, as in the brief's picture; task 4.3 decides whether it slides in only when a part is tapped.
8. The zoom steps (half powers of two).
9. The child's level is 1 until progress (task 5.2) says otherwise.
10. Tuck states belong to the device, not to a child's profile.
