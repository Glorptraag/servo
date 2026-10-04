# Review 6.4 · packages/canvas
Base: main 69f37ce. Reviewer: task 6.4 sweep.

## Verdict

14 findings: 0 high, 3 medium, 9 low, 2 nit. Two of them, CAN-13 (nit) and CAN-14 (low), are carried brief items (Sections 11 and 13), not ground-rule breaks.

Rule 8 has open findings: CAN-1, CAN-2 and CAN-3 (medium), and CAN-4 to CAN-10 (low). Each has a follow-up task. There are no open rule-7 findings. Rules 1, 3, 4, 6, 9 and 12 hold. The probes show no part ids in `src/`, every wire judged by `planWire`, only type imports from `@servo/sim-core/interface`, and no dialogs.

## Commands run

| Command | Result |
| --- | --- |
| `pnpm --filter @servo/canvas test:unit` | 21 files, 313/313 passed (32 s) |
| `pnpm exec eslint --max-warnings 0 packages/canvas` (repo root) | exit 0 |
| `pnpm --filter @servo/canvas typecheck` | exit 0 |
| `vitest run --project unit test/wiring/rules.test.ts --reporter verbose` | 24/24. The slowest test without an explicit timeout took 802 ms (bumper-robot, `:31`). The `:72` sweep took 2339 ms against its 60 s timeout |
| `vitest run --project browser test/browser/list-view.test.ts test/browser/selection.test.ts` | 33/33 passed (67 s) |
| `vitest run --project browser test/browser/placement-e2e.test.ts test/browser/routing.test.ts -t "Move handle\|one tidy\|same blueprint by touch"` | 5/5 passed, 41 skipped |
| Probe `test/list-view/zz-probe-review.test.ts` (deleted afterwards) | The list view turns a mounted DC motor and takes it off the chassis (CAN-1). Two boxes get identical lines and labels (CAN-4) |
| `grep` for part ids and words (`'dc-motor'`, `servo`, `motor`, `battery`, `wheel`, `caster`, `chassis`, …) in `src/` | Only behaviour-primitive kinds (`'wheel'`, `'switch'`), the DOM `'wheel'` event and the `chassis` render layer, which is chosen by `frame` (a mount-point role). No part ids |
| `grep` for module specifiers in `src/` and `test/` | Only `@servo/schema`, `@servo/schema/fixtures`, `@servo/sim-core/interface` (7 type imports), `pixi.js`, `vitest` and `@servo/canvas`. No dynamic `import()` |
| `grep` for `alert(`, `confirm(`, `prompt(`, `<dialog`, `showModal` | None |
| `grep` for banned words, praise and `!` in string literals in `src/` | None in child-facing text. Only developer error messages |

## Rules 1-14

1. Holds. Parts are recognised by behaviour primitives (`run-animation/cast.ts:66-76`, `list-view/actions.ts:40-47`) and port roles (`placement/rules.ts:67`), never by id.
2. Not applicable to canvas. It never steps the simulation. It reads `performance.now` for UI motion only (`surface.ts:280,445`).
3. Holds. Every wire goes through `planWire` (`wiring/rules.ts:44`, `placement/rules.ts:76`, `list-view/actions.ts:117,236`). Wire kinds come from `checkPortPair` (`wiring/commands.ts:18-25`). Role filters only narrow the candidates before `planWire` runs.
4. Holds. `apply` refuses with `edit.locked` in Run mode (`surface.ts:357-359`). `applyRunFrame` never writes `this.current`, which is assigned only at `surface.ts:258,365`. `run-animation.test.ts` "Stop" puts every node back.
5. Holds. Canvas persists nothing. `load` validates and canonicalises.
6. Holds. `src/` reaches sim-core only as `import type … from '@servo/sim-core/interface'`. The testing entry is lint-fenced (`toolsOnly`).
7. Holds. The words come from part records, and the lines are plain (`placement/notices.ts`, `list-view/words.ts`, `dom.ts`). `model.test.ts:162` checks every label on every fixture.
8. **Findings CAN-1 to CAN-10.** See the inventory below.
9. Holds. Impossible drops get a colour cue at the socket (`wiring.test.ts:230-284`). There are no dialogs, and faults are drawn.
10. Holds. The only Level 3 hook is `unlockSettings` (task 6.6), and it changes only which settings the list offers.
11. Holds for the package. Nothing in the tree is task-specific.
12. Holds. Pictures come only from the injected `resolveArt` (`renderer/art.ts:51`). A key with no entry gets a neutral tile. The art copy lives in `test/` only (CAN-12 is the one stray helper).
13. Drift: CAN-1 contradicts R-3.2's Q2 ruling ("the list view should not turn a held part, or should take it off first").
14. Low: CAN-3 (surface.md promises tap-then-tap for every drag), CAN-11 (test timeouts) and CAN-12. The README is otherwise current with the code.

### Rule 8 inventory: every canvas action, its three paths, and the test for each

T = touch, P = pointer, L = list view (keyboard or screen reader). "app" means the control lives in the app, which calls the canvas handle.

| Action | Touch | Pointer | List view | Tests |
| --- | --- | --- | --- | --- |
| Place part | Tray drag; tray tap then canvas tap | Same, click-click | `placementsFor`, offered by the app tray (`app/src/tray/places.tsx`) | T/P: `placement-e2e.test.ts:93` (4 paths, every fixture, bytes equal); L: `model.test.ts:52`, `list-view.test.ts:73`; all: tools `parity-*.e2e.ts` |
| Place onto mount or shaft | Drop within 48 px | Same | `Place X on <mount point>` | As above; `placement.test.ts:86` |
| Place prop | Strip drag; tap then tap | Same | `propPlacementsFor` (app: Enter calls `apply place-prop`) | T/P: `placement.test.ts:515`; L: `model.test.ts:248` |
| Move part | Drag; Move handle then tap | Same | `Move X to a free spot` | T/P: `placement.test.ts:236-275`, `placement-e2e.test.ts:138-185`; L: `model.test.ts:185`. Not in the parity harness (CAN-9) |
| Re-snap or mount a placed part | Drag near a mount point; Move handle | Same | `Move X to <mount point>`, `Mount X on …` | T/P: `placement.test.ts:257`, `placement-e2e.test.ts:142`; L: `model.test.ts:179` |
| Unmount | Drag off the mount | Same | `Take X off …` | T: `placement.test.ts:266`; L: `model.test.ts:185` |
| Rotate | Rotate handle tap or drag (free parts only) | Same | `Turn X a quarter turn …` (**every part, held ones too: CAN-1**) | T/P: `placement.test.ts:308,359`; L: `model.test.ts:185` |
| Remove part | Bin; drag to tray | Same, plus Delete | `Remove X and its n wires…` | `placement.test.ts:376` (bin by touch, Delete, tray by mouse); L: `model.test.ts:199`, `list-view.test.ts:158`. A canvas removal is not read out (CAN-2) |
| Start and land wire | Drag; tap then tap; fan for crowds | Drag; click-click | `Connect to Y, <port>` from the port | `wiring.test.ts:125,699`; `placement-e2e.test.ts:95`; L: `model.test.ts:107`, `list-view.test.ts:73`; parity harness |
| Impossible drop | Push-away and glow | Same | Never offered | `wiring.test.ts:231`; parity `refuse` step |
| Cancel wire | Let go in empty space; tap empty or the source | Same | Not needed (list actions are atomic) | `wiring.test.ts:166` |
| Carry wheel onto shaft | Wire hub to shaft | Same | `Move X onto <shaft>` | `wiring.test.ts:198`; `model.test.ts:235` |
| Remove wire | Bin; drag to tray | Same, plus Delete | `Remove <wire>` on the wire and on its ports | `wiring.test.ts:401,415`; `model.test.ts:207`. Not in the parity harness (CAN-9) |
| Tidy wires | App button | App button | `Tidy wires` on each line | `routing.test.ts:189` (button; list by finger, mouse and Enter) |
| Select part, wire or prop | Tap | Click | `Select X` | `selection.test.ts:107-135,198,325` |
| Deselect | Tap empty | Click empty | **None (CAN-6)** | `selection.test.ts:108` (T/P only) |
| Move prop | Drag only (**no tap-then-tap: CAN-3**) | Drag only | `Move the box to a free spot` | `placement.test.ts:515`; `model.test.ts:248` |
| Remove prop | Bin; drag to strip | Same, plus Delete | `Remove the box` (**two boxes read the same: CAN-4**) | `selection.test.ts:325`; `model.test.ts:248` |
| Setting | App spec card | App spec card (arrows) | `Set X <setting> to …` | L: `model.test.ts:64,207,223`; parity `setting` step goes through `apply` on T/P |
| Pan | One- or two-finger drag | Drag on empty canvas | **None, and Select does not bring a subject into view (CAN-5)** | `view.test.ts:89-135` |
| Zoom | Pinch | Wheel | App zoom control (`setZoom`) | `view.test.ts:67,151,165` |
| Fit | App button; after first load | Same | App button | `view.test.ts:23-52`, `routing.test.ts:313` |
| Run: flip manual switch | Tap | Click, or Enter on the selection | `Open X` / `Close X` | `run-animation.test.ts:92,107`; `selection.test.ts:260`; `list-view.test.ts:169` |
| Run: inspect | Tap | Click | `Select X` | `selection.test.ts:235,272` |
| Hint rungs (drawn) | n/a | n/a | Text twin read out | `selection.test.ts:214,550-630` |
| Run/Stop, slow motion, undo, rename, arena preset | App | App | App | Out of scope for canvas |

## Findings

**CAN-1 · medium · rule 8 · `packages/canvas/src/list-view/actions.ts:124-131`**
What: the list view offers "Turn DC motor 1 a quarter turn clockwise" on every part, held ones included. Performing it takes the part off its mount (D34's `relocate`), and the label does not warn of this. Touch and pointer give a held part no rotate handle and say "Held by its mount: move it off to turn it" (`placement/controller.ts:872,398`; `placement.test.ts:326`). So a screen-reader user can make a change the canvas refuses by hand, and it knocks a motor off the chassis. R-3.2 Q2 ruled that the list should match. Afterwards the live region does say "is loose now".
Proof: the probe ran `actionsFor({part:'motor-left'})` on rolling-start and got `turn:motor-left:clockwise`. `perform` returned true, the wire count went 12 → 11 (the mount was removed), and `heldOf('motor-left')` read `loose`.
Proposed fix: FU-CAN-1.

**CAN-2 · medium · rule 8 · `packages/canvas/src/placement/controller.ts:222-226`, `src/list-view/dom.ts:300-309`**
What: the canvas's own lines never reach a screen reader. These are the removal line ("Removed with it: 2 wires. Loose now: large wheel") and the held line. `placement.notice` is read by nothing in `list-view/`, and it is not on `CanvasHandle`, so the app cannot read it either. A removal made by the bin, Delete or a drag to the tray is silent for a screen-reader user. The two paths also word the same removal differently. This is R-3.6 finding 2 and Q4, whose default was "yes, as a follow-up". It is still open.
Proof: `grep -rn notice src/list-view src/interface.ts` returns nothing. The only reader is `wiring/controller.ts:276` (`noticeCovers`, which handles hits only).
Proposed fix: FU-CAN-2.

**CAN-3 · medium · rule 8 · `packages/canvas/docs/placement.md:92`, `docs/surface.md:18`, `src/placement/controller.ts:366-369`**
What: a child's prop can be moved only by dragging. There is no Move handle or tap-then-tap path for props, although parts have one. surface.md:18 still promises that "Tap-then-tap is a full alternative to every drag", and brief Section 13 (motor) requires one. The list view's path exists ("Move the box to a free spot"), but it only offers the single free spot. This is R-3.2 finding 10, left to 3.4, and 3.4 added only the bin.
Proof: `propGesture` is drag-only (`controller.ts:368`). The prop's handles are only `propBin` (`selection/controller.ts:72`). placement.md:92 says so.
Proposed fix: FU-CAN-3.

**CAN-4 · low · rule 8 · `packages/canvas/src/list-view/actions.ts:305,312`, `src/list-view/dom.ts:191`**
What: two props of the same shape and size cannot be told apart in the list view. Their lines are the same, their "Actions for box" buttons are the same, and so are "Select the box" and "Remove the box". This is R-3.6 finding 5, still open.
Proof: the probe placed two 80 mm boxes and both read `box, 80 by 80 millimetres, ahead of the robot | Select the box; Remove the box`.
Proposed fix: FU-CAN-2.

**CAN-5 · low · rule 8 · `packages/canvas/src/renderer/input.ts:1-5`, `src/selection/controller.ts:121-127`**
What: panning has touch and pointer paths but no keyboard path. Selecting from the list view does not bring the subject into view either. A low-vision keyboard user at 400% zoom (brief Section 13) can reach only Fit and zoom about the centre, so they cannot look at one corner of a big build.
Proof: the canvas's only `keydown` listeners are for Delete/Backspace (placement, wiring, selection) and for Enter in Run mode (`surface.ts:211`). `select()` never moves the camera.
Proposed fix: FU-CAN-4.

**CAN-6 · low · rule 8 · `packages/canvas/src/list-view/actions.ts:255-320`**
What: the list view has no "clear selection" action, and the app never calls `select(null)`. After a keyboard user selects a part, the rest of the build stays one step dimmer and the handles stay. Only a tap or click on empty workbench clears it.
Proof: no action in `actionsFor` has `selection: null`. `grep -rn "select(null)" packages/app/src` returns nothing.
Proposed fix: FU-CAN-2.

**CAN-7 · low · rule 8 · `packages/canvas/src/list-view/dom.ts:306,308`**
What: when an action has gone stale (`findAction` finds nothing, or `perform` returns false), the list view says nothing, so the screen-reader user hears silence. This is R-3.6 finding 4 (its second half), still open.
Proof: `if (!action) return;` and `if (this.model.perform(action)) this.say(…)` have no else branch.
Proposed fix: FU-CAN-2.

**CAN-8 · low · rule 8 · `packages/canvas/src/placement/controller.ts:361,627-634`**
What: while the Move handle waits, the held line from the tap that selected the part stays up. A tap on it only hides it, so the tap-then-tap move does not happen where the line sits, which is just above the part. This is R-3.2 finding 14, still open.
Proof: `pressed` tests `callout.covers` before `relocating` (`:361`), and `startRelocation` never calls `hideNotice`.
Proposed fix: FU-CAN-3.

**CAN-9 · low · rule 8 (tests) · `packages/tools/src/e2e/plan.ts:21`, `src/e2e/parity.ts:73-78`**
What: the cross-path parity harness compares only `place`, `setting`, `connect` and `refuse`. Move, rotate, remove part, remove wire, unmount, re-snap, prop moves and removals, and switch flips are never compared byte for byte across touch, pointer and the list view. They are tested per path, and some hands are missing: a part dragged to the tray by touch, the bin by mouse, and the list's DOM for these actions, which is tested only through the model.
Proof: `StepKind = 'place' | 'setting' | 'connect' | 'refuse'`, and the parity table above.
Proposed fix: FU-CAN-5.

**CAN-10 · low · rule 8 · `packages/canvas/src/wiring/controller.ts:907-909`, `src/placement/controller.ts:240-254`**
What: `beginPlacement` does not let a waiting wire go. The wire's ring, its glows, an open fan or a wire's bin stay drawn while wiring defers every press, so a tap on a visible bin or fanned socket places the tray part there instead. This is R-3.3 finding 5, still open, found by reading the code.
Proof: `deferring()` returns true while `placement.placing` is set, and `begin` calls only `endIncoming`, `hideNotice` and `select(undefined)`.
Proposed fix: FU-CAN-3.

**CAN-11 · low · rule 14 · `packages/canvas/test/wiring/rules.test.ts:31,93`**
What: two O(sockets²) sweeps still run under Vitest's default 5 s timeout. Only `:72` got an explicit 60 s timeout. R-3.3 finding 2 recorded failures at 7.2 s under load.
Proof: `sed -n 31p;91p;93p`. The verbose run shows `:31` taking 802 ms and `:93` taking 550 ms on bumper-robot here, so only load separates them from the 5 s timeout.
Proposed fix: FU-CAN-6.

**CAN-12 · nit · rule 14 · `packages/canvas/src/renderer/picture.ts:39`**
What: `svgProportions` is shipped in `src/`, but only `test/helpers/art.ts:6` uses it. This is R-3.7 finding 14, still open.
Proof: `grep -rn svgProportions packages/*/src packages/*/test`.
Proposed fix: FU-CAN-6.

**CAN-13 · nit · brief Section 11 (not a ground rule) · `packages/canvas/src/wiring/controller.ts:750`**
What: a refused tap-then-tap wire reaches and springs back as one 280 ms motion (`REACH_MS + SPRING_BACK_MS`), beyond the brief's 120-200 ms UI motion. This is R-3.3 finding 6, still open.
Proof: `motion.ts:10,12` give 160 and 120.
Proposed fix: FU-CAN-6.

**CAN-14 · low · brief Section 13 (not a ground rule) · `packages/canvas/src/renderer/art.ts:18`, `src/renderer/views.ts:42`**
What: pictures are rasterised at 4×, and names are sharp only up to 200% zoom. At the brief's 400% zoom for low-vision users, pictures and names blur. This is R-3.1 finding 8, documented in renderer.md:78 and still unowned.
Proof: `ART_RESOLUTION = 4`, `LABEL_SHARP_TO_ZOOM = 2`.
Proposed fix: FU-CAN-7.

## Checked and disproved

- **Rule 6 through dynamic or type-position imports.** No `import(` appears anywhere in `src/`. All 7 sim-core imports are `import type` from `/interface`.
- **Rule 1 through `'wheel'` and `'switch'` literals.** Both are behaviour-primitive kinds (`cast.ts:68,75`) or the DOM wheel event (`input.ts:88`). The chassis layer is chosen by a mount-point role (`scene/layout.ts:209`).
- **Rule 3 duplication in `placement/notices.ts` and `list-view/model.ts`.** Both use `checkPortPair` or `wireKindOf`, which wrap the schema.
- **Rule 4.** `applyRunFrame` touches only the animator and the list's readouts. Stop calls `rebuild()` from the untouched `current` (`surface.ts:272-277`).
- **R-3.6 finding 7 (Run-mode list snapshots rebuilt every frame).** Mitigated. `readoutsDue` (`run-animation/readouts.ts:22-26`) calls `list.changed()` only on the first frame, on a discrete change, or once per simulated second.
- **R-3.6 finding 3 (no `live` or `hint` passed to the list).** Fixed at `surface.ts:223-227`. Tested in `selection.test.ts:214` and `list-view.test.ts:169`.
- **R-3.6 finding 4 (Select buttons throw).** Fixed. `select` is built, and `selection.test.ts:198` covers it.
- **R-3.7 finding 13 (Run dots cut across a tidied route).** Fixed by `animator.ts:227` `pathOf`, tested in `run-animation.test.ts:207`.
- **Tidy-wires button, `onSafeArea` and fit after the first load (R-3.7 Q3 / finding 4).** All three are in: `app/src/shell/zoom-control.tsx:25`, `App.tsx:150`, `shell/shell.tsx:241`. The list path and the button path are tested to give identical routes (`routing.test.ts:189`), which passed here.
- **The Run-animation e2e in CI (R-3.5 finding 5 / Q4).** Fixed. `ci.yml:51-52` runs a `run-animation` shard, `pnpm e2e test/e2e/run-animation.e2e.ts`.
- **R-3.4 finding 3 (an extra `null` select on a path change).** Fixed. `letGo`, `pressBegan` and `pressEnded` (`selection/controller.ts:237-254`) defer the clear to the lift, and selection.md:19 documents it.
- **The R-3.4 `lostpointercapture` nit.** Fixed (`selection/controller.ts:102`).
- **R-3.2 Q1 (no tap-then-tap move for parts).** Fixed with the Move handle. `placement-e2e.test.ts:138-185` passed here by touch and by mouse with equal bytes.

## Deferred items from earlier reviews

| Item | Source review | Status now | Finding id or evidence |
| --- | --- | --- | --- |
| Q1, tap-then-tap move (Move handle) | R-3.2 | fixed | `placement-e2e.test.ts:138`, passed |
| Finding 10, props drag-only | R-3.2 | holds | CAN-3 |
| Finding 14, held line swallows the Move tap | R-3.2 | holds | CAN-8 |
| Finding 15 / Q6, held line on every tap | R-3.2 | holds (default kept, for G4) | `controller.ts:398` |
| Q2, list view should not turn held parts | R-3.2 | holds | CAN-1 |
| Finding 2, sweep timeouts (`:31`, `:93`) | R-3.3 | holds | CAN-11 |
| Finding 3 / Q1, crowded sockets at rest (D65) | R-3.3 | holds (default: fan on demand, check at G3) | `docs/wiring.md:62` |
| Finding 4 / Q2, sensitivity floor | R-3.3 | holds (app concern; canvas floor 0.05) | `wiring/controller.ts:35,912` |
| Finding 5, placement does not release a waiting wire | R-3.3 | holds | CAN-10 |
| Finding 6, 280 ms reach and spring | R-3.3 | holds | CAN-13 |
| Finding 3, extra `null` select | R-3.4 | fixed | `selection/controller.ts:237-254` |
| `lostpointercapture` nit | R-3.4 | fixed | `selection/controller.ts:102` |
| Finding 6, pulse redraws every frame | R-3.4 | fixed per R-3.4 re-review; perf not re-measured here | `selection.test.ts:606` |
| Finding 5, Run-animation e2e not in CI | R-3.5 | fixed | `ci.yml:51-52` |
| Finding 1, keyboard tray path | R-3.6 | fixed (app) | `app/src/tray/places.tsx:19` |
| Finding 2 / Q4, announce `placement.notice` | R-3.6 | holds | CAN-2 |
| Finding 3, `live` and `hint` not wired | R-3.6 | fixed | `surface.ts:223-227` |
| Finding 4, silent on stale perform | R-3.6 | holds (second half) | CAN-7 |
| Finding 5, props not numbered | R-3.6 | holds | CAN-4 |
| Finding 7, Run-mode snapshot cost | R-3.6 | disproved (throttled) | `readouts.ts:22` |
| Finding 4 / Q3, tidy button, `onSafeArea`, fit after first load | R-3.7 | fixed | `zoom-control.tsx:25`, `App.tsx:150`, `shell.tsx:241` |
| Finding 8, router timing on a 2020 iPad | R-3.7 | holds (G3 measurement) | not measurable here |
| Finding 13, Run dots on tidied routes | R-3.7 | fixed | `run-animation.test.ts:207` |
| Finding 14, `svgProportions` in `src/` | R-3.7 | holds | CAN-12 |
| Finding 8, blur past 200% | R-3.1 | holds | CAN-14 |
| Finding 5, harness casts renderer members | R-3.8 | canvas side fixed (`src/testing.ts`). Tools still uses `hooksOf` (`tools/src/e2e/bench.ts:107`), which is for the tools reviewer | — |
| Copy pass 6.5 | copy-pass-6.5.md | nothing deferred for canvas | test copies re-synced, checked by tools `canvas-fixture-copies.test.ts` |

## Proposed follow-up tasks

| id | title | package | done-when | fixes findings |
| --- | --- | --- | --- | --- |
| FU-CAN-1 | List view turns only free parts | canvas | `actionsFor` offers no turn for a part held by a mount or shaft (or labels it "Take X off … and turn it", per Drew's Q2 ruling). A model test over every fixture asserts that the list's turn actions equal the parts that show a rotate handle | CAN-1 |
| FU-CAN-2 | List view speaks for every path | canvas | Canvas lines (removal, held) are read in the list's live region when they change, through a `ListHost.notice` hook. Props are numbered like parts ("box 1", "box 2"). A stale or no-op action says "Nothing changed". A "Clear selection" action is offered while something is selected. Browser test: a bin removal on the canvas is announced. Model test: two boxes have distinct labels | CAN-2, CAN-4, CAN-6, CAN-7 |
| FU-CAN-3 | Tap-then-tap fixes: prop Move handle, held line, waiting wire | canvas | A selected child's prop shows a Move handle beside its bin, and tap-then-tap moves it, tested by touch and by mouse with equal bytes. Starting Move hides the held line. `beginPlacement` lets a waiting wire go and closes the fan and the bin. surface.md:18 holds as written | CAN-3, CAN-8, CAN-10 |
| FU-CAN-4 | Keyboard view: bring into view and pan | canvas | `select` from the list view pans the camera, within the limits, so the subject is in the uncovered canvas. Arrow keys pan when the canvas has focus. A browser test at zoom 4 shows a far part after a list Select | CAN-5 |
| FU-CAN-5 | Parity harness covers every edit | tools | `StepKind` gains move, rotate, remove-part, disconnect, unmount, move-prop and remove-prop. Touch, pointer and the list view (through the DOM) give byte-identical blueprints on the content fixtures. A switch flip gives the same `control` on all three paths | CAN-9 |
| FU-CAN-6 | Canvas test and motion hygiene | canvas | `rules.test.ts:31` and `:93` have explicit 60 s timeouts. `svgProportions` moves into `test/helpers/`. The refused-wire reach and spring totals 200 ms or less, with a test on the total | CAN-11, CAN-12, CAN-13 |
| FU-CAN-7 | Sharp pictures and names to 400% | canvas | Art and labels re-rasterise by zoom step (or tile size), so a part's picture and name at 400% pass a sharpness probe. Frame time holds in `pnpm perf` | CAN-14 |
