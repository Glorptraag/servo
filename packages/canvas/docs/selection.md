# Selection, focus states and hint rungs (task 3.4)

Back to the [README](../README.md). The contract is [src/interface.ts](../src/interface.ts): `select`, `selection`, the `select` event, `showHint` and `clearHints`.

## Files

| Path | What it does |
| --- | --- |
| `src/selection/controller.ts` | `SelectionController`: the one selection, taps that inspect, the prop's bin and Delete, drawing focus, the wire's label and the hint rungs |
| `src/selection/focus.ts` | Pure: a scene and a selection in, the renderer's emphasis out; a part's neighbours; what flows on a wire |
| `src/selection/hints.ts` | Pure: which parts, sockets and ghost wires a rung draws |
| `src/selection/views.ts` | The hint rungs and the ring round a selected prop, cut so nothing covers a socket |
| `src/testing.ts` | `@servo/canvas/testing`, for the e2e harness and canvas tests only (see the README) |

## One selection

- The canvas holds one selection: a part, a wire (a power line, a signal line, a drive linkage or a mount) or a prop, or none. `select` fires on every change, by any path, and never for a selection that did not change. A part selection is what opens the spec card.
- Paths that select, with the same result: a tap or a click (touch and pointer alike), the handle's `select` (the app; the list view, task 3.6), and in Build mode the tap that shows placement's handles or wiring's bin. Placement and wiring report what they show through `surface.selectionShown`, and selection passes its selection back to them (`placement.selectPart`, `wiring.showBin`), so the handles and the bin always match the selection.
- A tap on empty workbench clears it. So does an edit or a `load` that takes the selected thing away (Delete, the bin, Undo); a `load` that keeps it keeps it, firing nothing.
- The list view's Select actions (task 3.6) call the handle's `select`, so they show the same focus, handles and bin as a tap; its `hint` is the rung drawn now (`selecting.shownHint`), and it hears of every `showHint` and `clearHints`.
- `select` with an unknown kind throws a `RangeError`; one naming nothing on the canvas now (a part Undo took away) changes nothing.
- Run mode keeps the selection, for the spec card's live readouts. Placement's handles and wiring's bin go while the build is locked and come back on Stop. In Run mode, and on a read-only canvas (D43), a tap selects what it lands on, to inspect: a socket's part, a wire, a part, and on a read-only canvas in Build mode a prop. Nothing is removed.
- Props: a tap on one of the child's props selects it (placement's prop gesture reports it), and so does a tap on a preset's prop. The child's prop shows its bin beside it, laid out as a part's handles are (D44); a tap on the bin, or Delete, removes it with `remove-prop`. A preset's prop has no bin. A press on the build, or a tap on empty workbench, lets a prop go; a pan keeps it. In Run mode props move, so a tap does not reach them.

## Focus states (brief Section 9)

- **A part:** its tile is ringed (the renderer's `highlighted`); the lines on its ports and the parts at their other ends stay as they are; every other part and line is dimmed one step (`DIM_ALPHA`). "Connected" is one wire away by any line, a mount included, so a part on the chassis keeps the chassis, and the chassis keeps what is mounted on it.
- **A wire:** the line glows in its colour, both its sockets are haloed, and one word beside its middle says what flows on it: `power`, `signal`, `turning` (a drive linkage), or `mount`. The label is a callout (15 px type at every zoom), clear of every socket and of the bin. Nothing is dimmed.
- **A prop:** a neutral ring just outside its footprint, under the build. Nothing is dimmed.
- The arena is never dimmed: in Build mode it is already faint.

## Hint rungs (brief Section 10)

- `showHint` draws one rung, replacing the one before: `pulse-part` rings each matching part outside its sockets; `pulse-port` rings each matching socket in its wire colour; `ghost-wire` draws a see-through line, solid for power and dashed for signal, between every pair of matching sockets a wire could join (`checkPortPair`). A target by type matches every placed part of that type.
- Every rung draws in the hints layer, above everything, and is cut where it would cross any socket (a frame's mount points too), so it never covers a port.
- It returns false, and draws nothing, when nothing on the canvas matches. The step's `line` is never drawn: hints are drawn, not said. `selecting.shownHint` gives the rung for the list view's text twin (task 3.6).
- A rung pulses (1.2 s, from full strength down to 35% and back), changing only its opacity; with reduced motion it holds still and the canvas rests. It hides in Run mode and shows again on Stop. An edit re-matches it against the new build.

## Tests

- **unit**: `test/selection/focus.test.ts` (neighbours, dimming, wire highlights, the flow words) and `test/selection/hints.test.ts` (which parts, sockets and ghost wires a rung draws, the pulse).
- **browser**: `test/browser/selection.test.ts` is the done-when. Trusted mouse and touch through CDP select parts, wires and props; every `select` event is checked with its ids; `select` from the app; load and edits; Run mode and read-only taps; the prop's bin and Delete. Each focus state (a part, a power line, a drive linkage, a prop, a part in Run mode) and each rung has a screenshot in `test/browser/__screenshots__/selection.test.ts/`, backed by pixel probes: what dims and what does not, the halos, the rings, and every socket's middle unchanged under a rung. Positions come from the testing entry.
