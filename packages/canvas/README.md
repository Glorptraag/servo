# @servo/canvas

The build surface: renderer, placement, wiring, selection, list view and Run animation. It depends on `@servo/schema` and reaches sim-core only through `@servo/sim-core/interface` (ground rule 6). It never imports content: the app passes the catalogue and the art resolver in. Task 0.4 owns this interface, typed in [src/interface.ts](src/interface.ts); `@servo/canvas` exports those types, `mountCanvas` (task 3.1, [docs/renderer.md](docs/renderer.md)), and `applyEdit` for every command (tasks 3.2 and 3.3, [docs/placement.md](docs/placement.md) and [docs/wiring.md](docs/wiring.md)); tidy wires, the safe area and the zoom limits are task 3.7's ([docs/routing.md](docs/routing.md)). `canvas.listView` is task 3.6's list view ([below](#the-list-view-task-36-srclist-view)). Handle members of later tasks throw an error naming the task.

```ts
import { applyEdit, mountCanvas } from '@servo/canvas';
const canvas = mountCanvas(host, { catalogue, resolveArt, level, prefs });
canvas.load(blueprint);
canvas.on('edit', ({ command, blueprint }) => history.push(blueprint));
```

## Who builds what

Every canvas responsibility belongs to a Phase 3 task, so no app task writes canvas code.

| Task | Builds |
| --- | --- |
| 3.1 | `mountCanvas` (fills and follows its host), `load`, `blueprint`, `setMode`, read-only, `fit`, `zoom`, `setZoom` and `zoom`, `setLevel`, `setPrefs` (theme, typeface), `on`, `destroy`; the layers, pan, zoom and art |
| 3.2 | `applyEdit` for every command but wiring: place, move, rotate, remove, mount, unmount, settings, arena and props, rename, `batch`; `apply` and `edit`; `beginPlacement`, `beginPropPlacement`, `cancelPlacement`, `setRemoveTargets` and `placement`; drag sensitivity |
| 3.3 | `applyEdit` for `connect` and `disconnect`; wiring by drag and tap-then-tap, the glow on approach, the push-away on a wrong type, the spring back, crowded sockets fanning out, removing wires |
| 3.4 | `select`, `selection` and `select`; focus states; `showHint` and `clearHints` |
| 3.5 | `applyRunFrame`; Run-mode drawing; switch flips and `control` |
| 3.6 | `listView` and its DOM |
| 3.7 | `tidyWires` and the `tidy-wires` command, `setSafeArea`, zoom limits |
| 3.8 (tools) | The e2e harness and its parity checks over touch, pointer and the list view |

## The handle in brief

`load(blueprint)` validates, canonicalises and redraws, firing no `edit`. `apply(command)` takes the same path as touch, pointer and the list view. `setMode('build' | 'run')`: Run locks the build, and Build returns to it exactly as it was. `applyRunFrame(frame)` takes a `RunFrame` from `Simulation.step`. A read-only canvas (D43) refuses every edit and fires no `control`, for shared links and phone replay.

Events out: `edit` (the command and the resulting canonical blueprint), `select` (a part selection opens the spec card), `placement` (a tray part or prop landed or not), `control` (Run mode: a manual switch flipped by tap, click, Enter or the list view, D42) and `zoom`.

## One command layer (ground rule 8)

Touch, pointer and the list view only ever emit an `EditCommand`: `place-part`, `move-part`, `rotate-part`, `remove-part`, `connect`, `disconnect`, `mount`, `unmount`, `set-setting`, `set-arena`, `place-prop`, `move-prop`, `remove-prop`, `rename`, `tidy-wires`, or a `batch` of them. `tidy-wires` leaves the build as it is: routes are view state, so it fires no `edit`. One pure `applyEdit` applies them with the schema's `planWire`, id claims and canonical form, so the same steps give byte-identical blueprints on every path. A part on a mount or a shaft is stored where it holds the part. Moving a mounted part takes it off, and it re-snaps near another mount point (D34); removing a part leaves what was on it loose, says so, and Undo restores it (D35); props come only from the arena strip, in Build mode (D36). Impossible drops come back with the schema's `wire.*` codes and show as a colour cue at the socket, never as text; legal-but-wrong wiring is always accepted. Details and refusals: [docs/commands.md](docs/commands.md). Wiring by touch and pointer, the 32 px glow, the push-away and crowded sockets fanning out: [docs/wiring.md](docs/wiring.md).

## Drawing, Run mode and the list view

Canvas units are millimetres (the schema's geometry), drawn in the layer order of brief Section 9. Art comes from the injected `resolveArt`; a key with no picture gets a neutral tile, and a part on a mirrored mount point is drawn mirrored. In Run mode the canvas draws each frame it is given (dots along wires from `frame.flows`, wheels, servo arms, light, sounds' visual twins, stalls, tipping, the robot in the arena) and never writes to the blueprint. The list view is DOM beside the surface, offers the same legal actions as touch and pointer (including move and turn), lists the arena's props, and in Run mode flips switches. Details: [docs/surface.md](docs/surface.md). How task 3.1 draws, its scale, socket layout, layers, view and tests: [docs/renderer.md](docs/renderer.md).

## The list view (task 3.6, src/list-view/)

`canvas.listView` is the screen-reader and keyboard path (ground rule 8). Its model (`model.ts`) reads the build from the canvas and acts only through it: an edit goes to the canvas's own `apply`, the path touch and pointer take, so the same steps give byte-identical blueprints; a switch flip fires `control` (Run mode, never read-only); an inspection calls `select` (task 3.4). Its actions (`actions.ts`) are judged by the rules the canvas uses: `planWire` for every wire, `placeTargets` and `moveTargets` for mount points and shafts, the free spot for a part placed or moved without one (`defaultSpot`, `movedPartSpot`) and for a prop (`propSpot`). So it offers only legal actions, legal-but-wrong wires included, and never meets an impossible drop.

- Build mode, per part: select; move to a free spot, onto a free mount point, or (a hub) onto a free shaft; turn a quarter turn either way; each setting unlocked at the child's level, a step up or down or another option; remove, saying what it leaves loose (D35). Per port: wire to every port `planWire` allows, remove its wires; a mount: mount on a free mount point or take it off; a mount point: mount a part on it or take one off. Per wire: select, remove; with a power or signal line, tidy wires (task 3.7: the same `tidy-wires` command as the app's button; `perform` counts it as a change when the routes changed). Per prop: select; the child's own props move to a free spot or go (D36).
- Run mode: select, and flip a manual switch (its state from the frame's `closed` readout when frames have come, else what the list sent, else the record's starting state). Read-only: select only.
- `placementsFor(type)` and `propPlacementsFor(prop)` are the tray's and the arena strip's keyboard path: the app's tray offers them, since the canvas does not know the kit.
- Words (`words.ts`): real names from the part records, twins numbered in id order (`DC motor 1`, `DC motor 2`), ports by their labels: `DC motor 1, mounted on chassis left motor mount, plus (+) connected to switch side B`; `power line from 2-cell battery pack plus (+) to switch side A`; `box, 80 by 80 millimetres, ahead and to the left of the robot, part of the arena`. Parts and wires come in id order as a child counts (`p2` before `p10`).

The DOM (`dom.ts`) sits in the canvas's host after the canvas element: a labelled section of native lists and buttons, hidden until it takes focus and then shown over the canvas's top corner (the other corner for left-handed use), in the canvas's typeface and contrast. In Build mode each part, port, wire and prop has an Actions button that opens its actions (they are worked out only when asked for); in Run mode and read-only they show at once. Enter does an action, so Enter flips a switch; Space never does, since it is the app's Run and Stop (D42). Focus stays where it was across redraws, or falls back to the subject's Actions button. A polite live region says what each action changed: what was placed, added, moved, turned, set or removed, and which parts are loose now.

Tests: `test/list-view/model.test.ts` builds Rolling Start, Reversed Motor and Short Circuit from the list view alone, byte-identical to the commands touch and pointer give (with and without settings), and checks every offered action is legal and every legal wire is offered on every fixture. `test/browser/list-view.test.ts` builds Rolling Start by touch, tap-then-tap, and again from the list view with every wire by keyboard, and compares the bytes.
