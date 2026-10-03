# @servo/canvas

The build surface: renderer, placement, wiring, selection, list view and Run animation. It depends on `@servo/schema` and reaches sim-core only through `@servo/sim-core/interface` (ground rule 6). It never imports content: the app passes the catalogue and the art resolver in. Task 0.4 owns this interface, typed in [src/interface.ts](src/interface.ts); `@servo/canvas` exports those types, `mountCanvas` (task 3.1, [docs/renderer.md](docs/renderer.md)), `applyEdit` for every command (tasks 3.2 and 3.3, [docs/placement.md](docs/placement.md) and [docs/wiring.md](docs/wiring.md)), and Run mode's drawing through `applyRunFrame` (task 3.5, [docs/run-animation.md](docs/run-animation.md)). Handle members of later tasks throw an error naming the task.

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
| 3.7 | `tidyWires`, zoom limits |
| 3.8 (tools) | The e2e harness and its parity checks over touch, pointer and the list view |

## The handle in brief

`load(blueprint)` validates, canonicalises and redraws, firing no `edit`. `apply(command)` takes the same path as touch, pointer and the list view. `setMode('build' | 'run')`: Run locks the build, and Build returns to it exactly as it was. `applyRunFrame(frame)` takes a `RunFrame` from `Simulation.step`. A read-only canvas (D43) refuses every edit and fires no `control`, for shared links and phone replay.

Events out: `edit` (the command and the resulting canonical blueprint), `select` (a part selection opens the spec card), `placement` (a tray part or prop landed or not), `control` (Run mode: a manual switch flipped by tap, click, Enter or the list view, D42) and `zoom`.

## One command layer (ground rule 8)

Touch, pointer and the list view only ever emit an `EditCommand`: `place-part`, `move-part`, `rotate-part`, `remove-part`, `connect`, `disconnect`, `mount`, `unmount`, `set-setting`, `set-arena`, `place-prop`, `move-prop`, `remove-prop`, `rename`, or a `batch` of them. One pure `applyEdit` applies them with the schema's `planWire`, id claims and canonical form, so the same steps give byte-identical blueprints on every path. A part on a mount or a shaft is stored where it holds the part. Moving a mounted part takes it off, and it re-snaps near another mount point (D34); removing a part leaves what was on it loose, says so, and Undo restores it (D35); props come only from the arena strip, in Build mode (D36). Impossible drops come back with the schema's `wire.*` codes and show as a colour cue at the socket, never as text; legal-but-wrong wiring is always accepted. Details and refusals: [docs/commands.md](docs/commands.md). Wiring by touch and pointer, the 32 px glow, the push-away and crowded sockets fanning out: [docs/wiring.md](docs/wiring.md).

## Drawing, Run mode and the list view

Canvas units are millimetres (the schema's geometry), drawn in the layer order of brief Section 9. Art comes from the injected `resolveArt`; a key with no picture gets a neutral tile, and a part on a mirrored mount point is drawn mirrored. In Run mode the canvas draws each frame it is given (dots along wires from `frame.flows`, wheels, servo arms, light, sounds' visual twins, stalls, tipping, the robot in the arena) and never writes to the blueprint. How, and the spin-up: [docs/run-animation.md](docs/run-animation.md). The list view is DOM beside the surface, offers the same legal actions as touch and pointer (including move and turn), lists the arena's props, and in Run mode flips switches. Details: [docs/surface.md](docs/surface.md). How task 3.1 draws, its scale, socket layout, layers, view and tests: [docs/renderer.md](docs/renderer.md).
