# Placement (task 3.2)

Back to the [README](../README.md). The contract is [src/interface.ts](../src/interface.ts), [commands.md](commands.md) and [surface.md](surface.md); this page says how task 3.2 meets its part: `applyEdit` for every command but wiring, the handle's `apply` and `edit`, `beginPlacement`, `beginPropPlacement`, `cancelPlacement`, `setRemoveTargets` and `placement`, moving, turning and removing parts by touch and pointer, and drag sensitivity.

## Files

| Path | What it does |
| --- | --- |
| `src/placement/apply.ts` | `applyEdit`: runs a command's reducer, checks the result as `validateBlueprint` does, canonicalises it; batches all or nothing |
| `src/placement/commands.ts` | One pure reducer per command, and `joinPorts` (a wire through `planWire` and `claimWireId`) |
| `src/placement/holding.ts` | What holds what (`placeParts` as a tree), `settle`, `takeOff` (D34), `leftLoose` (D35) |
| `src/placement/rules.ts` | Snap targets from port roles, the nearest target, and the free spot for a new or moved part |
| `src/placement/free-spot.ts` | The free-spot search: outlines, clearance, the 5 mm lattice, rounding to 0.1 mm |
| `src/placement/props.ts` | Prop ids, canvas to arena and back, the free spot on the floor |
| `src/placement/controller.ts` | The touch and pointer paths: tray drags, tap-then-tap, moving, the handles, the Delete key, props, the one line |
| `src/placement/notices.ts` | What the one line says: a removal's wires and loose parts, a held part's turn |
| `src/placement/overlays.ts` | Where the handles and the line go: clear of every socket, inside the view |
| `src/placement/views.ts` | The ghost under the finger, the snap rings, the move, rotate and bin handles, the callout |

## The command layer

- `applyEdit(blueprint, command, catalogue)` looks the command's kind up in one reducer table (`REDUCERS` in `apply.ts`). A reducer returns a draft or a refusal; `applyEdit` then checks the draft with `validateBlueprint` and returns it in canonical form, or the first issue as the refusal. So every success is a blueprint the schema accepts, and every input path gets the same bytes for the same commands.
- Task 3.3 adds `connect` and `disconnect` as two more reducers in that table, using `joinPorts` and `settle`. Until then they throw an error naming task 3.3, as the handle's unbuilt members do.
- New ids come only from `claimPartId` and `claimWireId`. A prop takes `prop-<n>` above the highest among the preset's features and the arena's props.
- **Held parts are stored where their holder puts them.** Every command that changes what holds what, or where a holder sits, ends with `settle`: each part on a mount or a shaft is stored at `canvasPoseOf` of its holder's pose and its `placeParts` frame. A loose part stays where it is stored.
- **Moving and turning (D34).** `takeOff` removes the mount or drive linkage that holds the part, and again while another would hold it instead: a gearbox's input on a motor shaft takes over once its mount is gone, so it is removed too. The part goes where it is told; what it holds goes with it. A part off a mirrored mount point is no longer mirrored, so a wheel on its shaft moves to the shaft's side.
- **Removing (D35).** The part and every wire on its ports go. What it held is loose and stays where it was, except where something else now holds it.
- **`mount`** replaces a mount already on that port in one step; on the same mount point it changes nothing. `unmount` takes the mount on the part's mount port.
- **A place without a spot** (the list view, the hint ladder's do-it) is the free spot nearest the middle of the build's tiles, or the canvas origin when nothing is placed. It depends on the build alone, never the view.
- A hub attached to a shaft it cannot line up with (a wheel on a servo arm, which turns about +z) is joined but not carried: it lands where it was dropped, or at the free spot.
- A malformed command (no position, a port that is not `{ part, port }`, an unknown kind) comes back as a refusal (`value.wrong_type`, `value.not_allowed`), never a throw. So does a build `validateBlueprint` does not accept (its first issue), so nothing is built on one.

## Where a part may land

All from port roles and geometry (ground rule 1), shared by the command layer, the input paths and the list view (task 3.6 can use `placeTargets`, `moveTargets`, `defaultSpot` and `propSpot`).

- **Snap targets.** For a part from the tray: every free mount point its mount fits and every free shaft its hub fits, as `planWire` judges them, each with the pose the mount or shaft gives. For a part being moved: every free mount point its mount fits once it is off its own (its own among them), never one on itself or on anything it holds. Moves re-snap onto mount points only (D34); a part carried on a shaft that is dropped back on it stays on it.
- **Forgiveness.** A drop snaps when the dragged part's mount or hub is within 48 screen pixels of a target; a tap snaps when it lands within 48 px of one. The radius is divided by `prefs.dragSensitivity` (held at 0.05 or more), so a lower sensitivity forgives more (D44). The nearest target wins; a mount wins a tie with a shaft, so a gearbox dropped where its mount point and a motor shaft meet is mounted.
- **The free spot.** Otherwise the part lands loose: where it was let go when that spot is free, or the nearest free spot. Free means its tile, and the tiles of everything it carries, keep a socket's reach (half a 44 px socket, 8.8 mm) from every other tile, so no socket covers a neighbour. The search tries a 5 mm lattice round the drop, nearest first, ties by y then x. Places are rounded to 0.1 mm (a quarter of a pixel at the default zoom).
- **Props** land on the floor: wholly inside it, clear of the walls, of the other props and of the build as it starts a Run (its tiles mapped into the arena), heading 0 when new. Without a spot, the nearest free spot to the middle of the floor.

## The touch and pointer paths

Every gesture ends in one command through the handle's `apply`, the path the list view and the app take. `apply` refuses with `edit.locked` in Run mode and on a read-only canvas and with `edit.no_build` before a load, and fires `edit` only when the build changed.

- **From the tray** (`beginPlacement(part, pointer)`): the canvas follows that pointer through window listeners, wherever its events are captured, so a touch that started on the tray still works. The part rides under the finger (its frame origin at the finger), snapped to a target as it comes within reach, with the targets drawn as grey rings. Let go over a remove target (the tray), it is not placed. Let go off the canvas elsewhere, it lands at the canvas's edge. A pointer with no button down counts as none.
- **Tap-then-tap** (`beginPlacement(part)`): the rings show where the part can go, and the next tap on the canvas places it: on a part, a socket, a wire or empty canvas. A drag meanwhile still moves parts and the view. `cancelPlacement`, a second `beginPlacement` and Run mode end it, not placed. `placement` fires once per placement, after its `edit`; a placement the canvas cannot take (Run mode, read-only, nothing loaded, an unknown part) ends at once, not placed.
- **Moving.** Drag a part (past the drag threshold, 8 px divided by the drag sensitivity). It comes off its mount or shaft as it moves, carries what it holds, and its wires follow its ports; the mount it is leaving is hidden. Dropped near a free mount point it re-snaps (`mount`); back on its own mount point or shaft, nothing changes; dropped elsewhere it goes to the free spot (`move-part`); over a remove target it is removed. Dragging the chassis moves the robot.
- **Snap or slide.** A part whose free spot is within the forgiveness radius of where it was let go snaps there at once; one let go further away, in the void, slides there over 160 ms (instant with reduced motion). The same for a part from the tray.
- **Handles (D44).** A tap on a part shows its handles beside it, in a column on its right (its left for left-handed use): move, rotate and bin. Each is a 44 px disc on screen at every zoom. A tap on empty canvas hides them. The Delete key (and Backspace, the key Mac keyboards label delete) removes the part the handles are on; a tap on a part focuses the canvas for it, without adding it to the tab order.
  - **Move** is tap-then-tap for moving a placed part (rule 8, ruling on Question 1): tap it, and the rings show where the part can re-snap; the next tap on the canvas is where it goes, with the same snapping and D34 rules as a drag. Near a free mount point it re-snaps (`mount`); on the shaft it rides on, or on the part itself, it stays; anywhere else it comes off and goes to the free spot there (`move-part`), sliding when that is far. Its wires and what it holds go with it. A second tap on Move lets it be.
  - **Rotate** shows on a free part only (ruling on Question 2): a mount or a shaft sets a held part's turn, so a tap on a held part says so in one line instead, `Held by its mount: move it off to turn it` or `Held on a shaft: move it off to turn it`. A tap turns the part a quarter turn clockwise; a drag round it turns it in quarter turns too (ruling on Question 3), so a tap, a drag and the list view make the same turns.
  - **Bin** removes the part.
- **What the child sees on top is what a tap reaches** (brief Section 9: ports and handles above wires, above parts). After every redraw the rings and handles go back on top of the sockets, and the line stays above everything in the hints layer. The handles are laid out clear of every socket: beside the part's middle, then further along, then on its other side, then further out, inside the view where they fit. A socket still wins a press, so a tap on a socket never reaches a handle. The line is laid out clear of every socket and handle, and a tap on it only takes it away.
- **Props (D36).** `beginPropPlacement` works like a part, landing as `place-prop`. In Build mode a drag on one of the child's props moves it (`move-prop`), or removes it over a remove target (`remove-prop`); the preset's props stay put.
- **No long-press, no double-tap, no two-handed gesture.** A second finger always goes to the view: a part pressed but not yet dragged gives its finger back for the pinch, and once a drag is under way a second finger is ignored.
- **What a removal says** (brief Section 10: "removing a part removes its wires and says so"; D35; ruling on Question 4). When an edit by any path removes a part, the canvas says what went with it and what it left loose, in one plain line over where it was: `Removed with it: 2 wires. Loose now: large wheel`. Wires are the power and signal lines that went; mounts and drive linkages are how parts are held, so the parts they leave loose are named instead, each real name once. No dialog and no exclamation mark; the line keeps 15 px type at every zoom and goes with the next change or tap. Undo (loading the build from before) brings everything back and clears it. `placement.notice` holds the line for the list view to read out (task 3.6).

## Hooks in the renderer

Kept to what placement needs:

- `src/renderer/input.ts`: `taps` (an unclaimed pointer that lifts without panning or pinching is a tap), the second-finger rule above with `PointerClaim.yieldsToPinch`, and `busy` counting claimed pointers too, so the grid stays up while a part is dragged.
- `src/renderer/surface.ts`: the `placement` controller; `apply`, `beginPlacement`, `beginPropPlacement`, `cancelPlacement` and `setRemoveTargets`; `placement.refresh()` at the end of every rebuild, `modeChanged()` in `setMode` and `destroy()` in `destroy`.
- Selection (task 3.4, [selection.md](selection.md)): `placement.selectedPart` is the part whose handles show. Placement reports every change to it through `surface.selectionShown('part', id)`, and a tap on one of the child's props as `('prop', id)`; the handle's `select` sets it with `placement.selectPart(id)`.

## Tests

- **unit**: `test/placement/apply.test.ts` covers every command, its refusals, batches, purity and the byte-identical builds; `test/placement/rules.test.ts` covers snap targets, the nearest target, the free spot and props; `test/placement/overlays.test.ts` covers the lines and the layout of the handles and the line.
- **Byte-identical builds.** `test/helpers/plans.ts` turns each schema valid-blueprint fixture into one placement per part, holders first: attached by its mount or hub where the fixture holds it, loose at its place otherwise. Built by commands from an empty build (with `rename`, `set-arena` and `set-setting` for the rest), it must give, byte for byte, the fixture with its ids mapped onto the claimed `p<n>` and `w<n>` and only the wires placement makes. The power lines, signal lines and drive linkages between two held parts are `connect`'s, so task 3.3 extends the check to whole fixtures.
- **browser**: `test/browser/placement-e2e.test.ts` is the done-when: every part of every fixture placed by touch tap-then-tap, touch drag from a tray, click-click and mouse drag, real input through CDP, each giving the command-built blueprint, and all four the same bytes. It runs a 420 × 320 canvas at zoom 0.5 with reduced motion, because every input waits for a frame a software GPU draws. It also moves a placed, wired part by tap-then-tap with the Move handle, by touch and by pointer, and checks its wires stay. `test/browser/placement.test.ts` covers forgiveness and sensitivity, the free spot, remove targets, D34, what a removal says and its Undo, the handles, the Delete key, props, two fingers and `apply`. Over every schema fixture and the 25-part build, with either hand and at three zooms, it checks that no handle comes within reach of a socket, and taps every socket with every part selected to check that no handle acts; a real tap repeats the review's case, the servo motor's signal socket beside the selected motor driver.

## Decisions and open questions

Taken here, conservatively, and listed for Drew; the rulings on review R-3.2's Questions 1–4 are built in above:

1. A loose part keeps a socket's reach (8.8 mm) from every other tile. A part dropped on the chassis away from every free mount point slides off it rather than sitting on it unmounted.
2. A dragged part rides with its middle under the finger; nothing lifts it above the finger.
3. A part let go off the canvas, not over a remove target, lands at the canvas's edge rather than going back to the tray.
4. Places are rounded to 0.1 mm.
5. Backspace removes as Delete does.
6. The lines' words: `Removed with it: 2 wires. Loose now: large wheel` and `Held by its mount: move it off to turn it`. Wires count the power and signal lines. The copy is a content question.
7. A tap on the part the Move handle is moving leaves it where it is.
8. A part taken off a mirrored mount point stops being mirrored, so a wheel it carries swaps sides. The schema derives mirroring from the mount, so there is no other way to store it.
9. In Build mode the view's limits keep the centre over the build, so props can only be dropped near the robot; the list view's free spot reaches the whole floor. Task 3.7 owns the limits.
10. Mount points under another part are still offered (ruling on Question 5: as it is for now).

Left from review R-3.2, one line each:

- A wheel moved off its shaft re-snaps onto mount points only; putting it back on another shaft needs `connect`, so task 3.3 adds free shafts to the move targets (finding 5).
- The line reaches the app only through `placement.notice`; the interface has no field for it, so tasks 3.6 and 4.x add one for read-aloud (finding 8).
- The child's props are moved by dragging and removed by dragging, or by the bin and Delete once a tap selects them (task 3.4, finding 10).
- The choices above are not in the decision queue: queueing them is the orchestrator's (finding 12).
- Content's fixture blueprints are not in this package's e2e, which cannot import content; task 3.8's harness carries them (finding 13).
