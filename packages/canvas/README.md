# @servo/canvas

The build surface: renderer, placement, wiring, selection, list view and Run animation. It depends on `@servo/schema` and reaches sim-core only through `@servo/sim-core/interface` (ground rule 6). It never imports content: the app passes the catalogue and the art resolver in. Phase 3 owns it: renderer 3.1, placement 3.2, wiring 3.3, selection 3.4, Run animation 3.5, list view 3.6, tidy wires 3.7. Task 0.4 owns this interface, typed in [src/interface.ts](src/interface.ts); `src/index.ts` re-exports those types once task 3.1 adds the line.

```ts
import { applyEdit, mountCanvas } from '@servo/canvas'; // tasks 3.1–3.3
const canvas = mountCanvas(host, { catalogue, resolveArt, level, prefs });
canvas.load(blueprint);
canvas.on('edit', ({ command, blueprint }) => history.push(blueprint));
```

## Public surface

| Name | Owner | What |
| --- | --- | --- |
| `mountCanvas(host, { catalogue, resolveArt, level, prefs })` → `CanvasHandle` | 3.1 | The Pixi surface, with the DOM list view beside it, in `host` |
| `applyEdit(blueprint, command, catalogue)` → `EditResult` | 3.2, 3.3 | The one pure command layer: [docs/commands.md](docs/commands.md) |

## The handle

| Member | Does |
| --- | --- |
| `load(blueprint)` | Validates, canonicalises and redraws. Fires no `edit`: the app's Undo uses it |
| `blueprint` | The current build, in canonical form |
| `apply(command)` | The path touch, pointer and the list view take, for the app's own changes (settings, name, arena, do-it) |
| `setMode('build' \| 'run')` | Run locks the build; Build returns to it exactly as it was |
| `applyRunFrame(frame)` | Run mode: a `RunFrame` from `Simulation.step` |
| `showHint(step)`, `clearHints()` | Draws a hint rung (pulse part, pulse port, ghost wire) above everything, never over a port; false when nothing matches |
| `beginPlacement(part, pointer?)`, `cancelPlacement()`, `setRemoveTarget(tray)` | A tile from the app's tray, by drag or tap-then-tap; dropping on the tray removes |
| `select(selection)`, `selection` | A part or a wire |
| `fit()`, `tidyWires()` | Re-centre; re-route wires (view state, never stored) |
| `listView` | The screen-reader model |
| `setLevel`, `setPrefs`, `on`, `destroy` | Prefs are drag sensitivity, left-handed and high contrast |

## Events out

| Event | Carries | The app |
| --- | --- | --- |
| `edit` | The command and the resulting canonical blueprint | Records it for Undo and saving |
| `select` | The new selection | Opens the spec card for a part |
| `placement` | The tray part, and whether it landed | Clears the pending tile |
| `control` | Run mode: a manual switch flipped | Passes it to `Simulation.input` |

## One command layer (ground rule 8)

Touch, pointer and the list view only ever emit an `EditCommand`: `place-part`, `move-part`, `rotate-part`, `remove-part`, `connect`, `disconnect`, `mount`, `unmount`, `set-setting`, `set-arena`, `rename`, or a `batch` of them. One pure `applyEdit` applies them with the schema's `planWire`, id claims and canonical form, so the same steps give byte-identical blueprints on every path. Impossible drops come back with the schema's `wire.*` codes and show as a colour cue at the socket, never as text; legal-but-wrong wiring is always accepted. Details and refusals: [docs/commands.md](docs/commands.md).

## Drawing and Run mode

Canvas units are millimetres (the schema's geometry), drawn in the layer order of brief Section 9. Art comes from the injected `resolveArt`; with no entry a part is drawn from its schema colours and proportions, and a part on a mirrored mount point is drawn mirrored. In Run mode the canvas draws each frame it is given (dots along wires from `frame.flows`, wheels, servo arms, light, sounds' visual twins, stalls, tipping, the robot in the arena) and never writes to the blueprint. The list view is DOM beside the surface, offers the same legal actions, and in Run mode flips switches. Details: [docs/surface.md](docs/surface.md).
