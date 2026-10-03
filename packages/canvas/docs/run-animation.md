# Run-mode animation (task 3.5)

Back to the [README](../README.md). The contract is `setMode` and `applyRunFrame` in [src/interface.ts](../src/interface.ts), and `RunFrame` in `@servo/sim-core/interface`. The code is `src/run-animation/`.

## Who owns what

- **The app's run loop (task 4.4) owns time**: when to step the Simulation, the display speed (1–30 ticks a second), slow motion and the one-second spin-up. It passes each frame to `applyRunFrame`.
- **The canvas owns drawing.** It draws only the frames it is given, never steps the simulation, and never reads a clock to decide what happens. Between two frames it tweens on `requestAnimationFrame`, over the time that passed between the last two frames (at most 1 s), so a Run at 30 ticks a second moves smoothly and one at 1 tick a second glides from tick to tick. With `prefers-reduced-motion` each frame shows at once.
- Frames are ignored in Build mode. A frame at the same or an earlier tick than the last (a restore) starts the drawing again.

## The spin-up

The app turns the spin-up on by applying tick 0's frame (`Simulation.frame` before the first step) and holding it for its second. While the latest frame is tick 0, every live wire's dots flow at their tick-0 speed and nothing else moves: the wires light before the robot does. When tick 1 arrives each wire's dots carry on to the next whole dot spacing, so from tick 1 on the picture is the same however long the spin-up held. No interface change was needed for this.

## What moves, and why (brief Section 11)

Raw values drive motion; debounced faults (`LiveState.faults`, 3 ticks) drive fault visuals. What a part gets follows its primitives, readouts and failure modes' `shows` effects, never its id or name (ground rule 1).

| Drawn | From | How |
| --- | --- | --- |
| Dots along a power line | `frame.flows` milliamps | In the wire's colour, lit (mixed 60% towards white, with the wire's dark edge), 36 px apart, moving from `from` to `to` for positive current at 4 mm/s per √mA (a 1 mA trickle crawls, a short races), capped at 300 mm/s. Below 0.1 mA the line is dead: no dots |
| Dots along a signal line | `frame.flows` signal | Yellow, at 60 mm/s × level; dead below 0.01. The line keeps its dashes (D20), so colour is never the only cue |
| Robot pose | each body's `motion` | The robot's root, loose parts and props move from where the build has them to where the frame puts them, through the arena's placement on the canvas. Every part on a body takes the same transform |
| Tilting and tipping | `motion.pitch`, `motion.roll` | The body is foreshortened along its own axes (cos of the tilt, never under 20%), and casts a shadow towards its low side. The fall's weight is the mechanics' own: the canvas tweens the poses it is given |
| Wheel spin | `rpm` and the `wheel` primitive's radius | Tread marks along both long edges slide at the tyre's surface speed, forward for positive rpm. A slipping or lifted wheel's marks run faster than the robot moves |
| Servo motor arm | `angle` and the position actuator's drive port | An arm from the drive port, pointing along the part's +x at `restDeg`, turning to the left as the angle grows |
| LED | `light` and the load's `emits.colour` | A glow in its own colour, as bright as `light`; dark or dim as the value says |
| Battery charge | `charge` | A gauge on the pack. While a fault that shows `drain` is active on the pack it fills in the power colour |
| Switch | `closed` | Contacts on the switch: the lever across them when closed, lifted when open |
| Sound twins | each sound in `LiveState.sounds` | Buzz: rings leaving the part (a pulse each beat); hum: a tremble beside it; motor: a whirr behind it; squeal: spikes at its corners; knock: a burst. Each as strong as its level. The sound itself is task 4.10 |
| Stall | a fault that shows `stall` | The part shudders, 2.5 px either side, once a tick |
| Drag | a fault that shows `drag` | Scrape marks on the floor behind the body's low edge, for as long as it lasts. A loose part's drag (a loose caster) is the robot's |

There is no idle animation: with no frame arriving and nothing tweening, the canvas draws nothing.

## Build and Run

- `setMode('run')` locks the build: `apply` refuses with `edit.locked`, wiring and placement take no pointer, and no `edit` fires.
- Parts are hit-tested where Run mode draws them.
- A tap or click on a manual switch fires `control` with the other position from the latest frame's. Enter flips the selected manual switch (D42), once task 3.4's selection lands. A read-only canvas fires none.
- The list view (task 3.6) reads each part's and prop's live state from the latest frame (`ListPart.live`, `ListProp.live`), and a manual switch's position from its `closed` readout. Its DOM is rebuilt on every change, so it is told of frames only on the Run's first frame, when a switch flips or a fault starts or ends, and otherwise once every 30 ticks (a simulated second), counted in ticks (`readouts.ts`).
- `setMode('build')` puts every node, line and prop back where the build has them and drops the Run's drawing. The canvas never writes to the blueprint (ground rule 4); the app restores the Simulation's snapshot.

## Files

| Path | What |
| --- | --- |
| `cast.ts` | What can move in a build, from the scene and part records |
| `state.ts` | A frame folded into the drawing's state, tick by tick, and the blend between two frames. Pure |
| `affine.ts` | Body and node transforms. Pure |
| `look.ts` | Sizes, speeds and rates |
| `overlay.ts` | Per-part drawing: treads, arm, glow, gauge, contacts, sound twins |
| `dots.ts` | Dots along live wires |
| `marks.ts` | Scrape marks and shadows on the arena floor |
| `animator.ts` | `RunAnimator`: takes frames, tweens, paints, hit-tests in Run mode |
| `readouts.ts` | When the list view reads the live readouts again |

Hooks added to the renderer for this task: `PartView.run` (a container above each part's body, in its layer), `ArenaView.drawProps(arena, palette, moved)`, and on the surface `run` (the animator), `flip(partId)`, Run-mode `hitAt`, the floor marks in the arena group and the dots in the wires layer. `run.tellsOf(partId)`, `run.dots.dotsOn(wireId)`, `run.dots.fillOf(type)`, `run.marks.scratches(bodyId)`, `run.partPoint` and `run.endsOf` say where things are drawn, for the e2e proof.

## Tests

- `test/run-animation/state.test.ts` (unit): the cast, the state and blend, transforms, dot, tread and scrape placement.
- `test/browser/run-animation.test.ts` (browser, hand-built frames): the robot moving as one, the lock, switch flips and read-only, the shudder, a fall, the spin-up, the tween, Stop.
- `packages/tools/test/e2e/run-animation.e2e.ts`: the eight broken content fixtures and `led-and-buzzer-robot` run through `createSimulation` and screenshotted, each tell probed in the pixels, every pair of screenshots different. References in `packages/tools/test/e2e/__screenshots__/run-animation.e2e.ts/`. `run-animation-performance.e2e.ts` times the 25-part `busy-workbench` in Run mode. Run both with `pnpm art && pnpm --filter @servo/tools e2e:run-animation`.

## Decisions and open questions

Taken here conservatively, for Drew:

1. The spin-up is tick 0's frame held, not a new handle member.
2. Dot speed follows √mA, capped; dots are the wire's colour lit.
3. Tread marks along the wheel tile's edges stand for the spinning tyre, since the art is a three-quarter view.
4. Fault visuals follow the failure mode's `shows` effects: `stall` shudders, `drag` scrapes, `drain` turns the pack's gauge to the power colour. Other effects are behaviour the raw values already show.
5. A loose part's `drag` scrapes under the robot it would hold up.
6. Sound twins are drawn in the label colour, not a status colour.
7. Open: tipping is drawn as foreshortening and a shadow from above; no Level 1–2 build tips (D49), so no content fixture shows it yet.
8. Open: the short in `broken-short-circuit` is a wire between two adjacent sockets, so its dots sit under them; its tell is the draining gauge and every other wire dead.
