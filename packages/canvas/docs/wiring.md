# Wiring (task 3.3)

Back to the [README](../README.md). The contract is [src/interface.ts](../src/interface.ts), [commands.md](commands.md) and [surface.md](surface.md); this page says how task 3.3 meets its part: `applyEdit` for `connect` and `disconnect`, drawing and removing wires by touch and pointer, the glow, the push-away, the spring back, and crowded sockets (review R-3.1, finding 2).

## Files

| Path | What it does |
| --- | --- |
| `src/wiring/commands.ts` | `connect` and `disconnect`, two more reducers in `applyEdit`'s table |
| `src/wiring/rules.ts` | Where a wire lands: every socket judged by the schema's `planWire`, the 32 px reach, the push-away. Pure |
| `src/wiring/crowds.ts` | Which sockets crowd, and where a crowd fans out. Pure |
| `src/wiring/motion.ts` | Durations and easings: the fan, the elastic settle, the spring back, the reach for a wrong socket. Pure |
| `src/wiring/controller.ts` | The touch and pointer paths: drag, tap-then-tap, removing wires, the fan, the cue |
| `src/wiring/views.ts` | What wiring draws over the sockets: glows, the waiting wire's ring, a fanned crowd, the wire's free end, a wire's bin |

## The command layer

- **`connect`** joins two ports in either order through `joinPorts` (task 3.2): `planWire` judges it and gives the stored orientation (signal out → in, drive-out → drive-in, power lower reference first), and it takes the next `w<n>` from `claimWireId`. A drive linkage then `settle`s the build, so the part on its drive-in end (a wheel) is stored on the shaft where `placeParts` carries it, unless that part is mounted; a hub that cannot line up with its shaft (a servo motor's arm) stays where it is. Refused with `planWire`'s `wire.*` and `ref.*` codes; a mount and a mount point with `edit.wrong_command`; a malformed port with `value.wrong_type`.
- **`disconnect`** removes a power line, a signal line or a drive linkage; a part the linkage carried stays where it is, loose. Refused with `edit.unknown_wire`, and with `edit.wrong_command` for a mount.
- **Legal but wrong is always accepted**: a reversed motor, a short across the pack, a DC motor on the microcontroller's 3V pin. Its failure on Run is the lesson.
- Every whole schema fixture, built from an empty build by its placements and then its connects, gives the fixture byte for byte, with its ids mapped onto the claimed `p<n>` and `w<n>` (`test/helpers/plans.ts`, `wiredFixture`). The e2e builds each one by hand on every input path and gets the same bytes.

## Where a wire lands

All from the schema's wiring module and port types (ground rules 1 and 3), shared by every input path, so a drag, a tap and the command always agree.

- **The sockets a wire meets** are the ports layer's: power and signal sockets, shafts and hubs. Mounts and mount points are not wired: a part is fixed by placing it (task 3.2), so a frame's mount points neither take a wire nor push one away.
- **Every socket is judged by `planWire`** as the wire starts: it takes the wire (the same colour, room for it, not a second wire between the same two ports), or it would refuse it with a `wire.*` code.
- **Reach**: 32 screen pixels, divided by the drag sensitivity (held at 0.05 or more), so a lower sensitivity forgives more (D44), and never shorter than a socket's own radius, so all of its 44 px target counts.
- **The rule** (`landingAt`), so a wire never lands on a socket other than the one it is on:
  - on a fanned-out socket's target (they are drawn above everything), that socket decides: it takes the wire, or refuses it;
  - nearest to where a fanned-out crowd was (its shadow), nothing: the wire goes on to one of the fanned sockets;
  - on one socket's 44 px target, that socket decides; on two at once, they overlap, and their crowd fans out first when one of them would take the wire;
  - between sockets, within reach of one that takes the wire, it lands there, unless another socket of its crowd is within reach too: then the crowd fans out first;
  - else within reach of one that refuses it, it is refused there; near its own source only, it goes back; anywhere else it goes back.
- **The glow** (brief Sections 4 and 10):
  - a wire under a finger snaps onto the socket it would land on, which glows strongly with a ring in its colour;
  - "the right colour glows": every socket that takes the wire glows in its colour while the wire waits for its tap, while a wrong socket pushes it away, and after a refusal until the next touch;
  - the glow is a halo in the socket's colour with the socket drawn again above it, so a socket covered by a neighbour shows when it is the one.
- **The push-away**: a socket that refuses the wire holds its free end a reach away from its centre, on the side the finger is; right on the centre, back the way the wire came.
- **Refused** is a colour cue at the socket and no text (brief Section 10): no edit, the wire springs back, and the right colour glows until the next touch. `wiring.cue` names the socket, the schema's code and the glowing sockets, for the list view (task 3.6) and the tests.

## The touch and pointer paths

Every gesture ends in one command through the handle's `apply`, the path the list view and the app take, so every path gives the same bytes. Touch, mouse and pen share one pointer path.

- **Drag**: touch or click a socket (its 44 px target), drag (past 8 px divided by the drag sensitivity), lift. Lifted on a socket that takes it, the wire lands and settles into it; on one that refuses it, it is refused; anywhere else it springs back.
- **Tap-then-tap and click-click** (brief Section 13), a full alternative: tap a socket and it waits there, ringed, the sockets that take it glowing; tap a socket that takes it and it draws out to it and settles. Tapped on a socket that refuses it, the wire reaches for that socket, is pushed away and springs back, and keeps waiting. Tapping its own source again, or empty canvas, lets it go.
  - While a wire waits, a drag on empty canvas still pans; a press near a socket can also drag the waiting wire there; a press on a part or a wire lets it go, and so does any change to the build.
- **No long-press, no double-tap.** A second finger takes a socket press that has not started dragging for the pinch; once a wire is under a finger, a second finger is ignored.
- **Locks**: nothing is wired in Run mode or on a read-only canvas, and Run mode ends whatever wire was on its way.
- **Who goes first**: wiring's pointer handler runs before placement's, because sockets and wires are drawn above the parts they sit on, except over the handles of a selected part (they take their press) and while a part from the tray waits for its tap (placement takes every tap).

## Crowded sockets (review R-3.1, finding 2)

Where parts sit close on a chassis, sockets of neighbouring parts overlap, at every zoom, because sockets scale with the build. A **crowd** is a group of sockets whose 44 px targets overlap (centres less than 44 px apart); a shaft and the hub or gearbox input on it sit on one spot by design, are full at both ends, and count as one member.

- The schema fixtures and the Level 1 builds have no crowds. The Level 2 **bumper robot** has four (the motor driver's minus 10 px from the left DC motor's minus, its `in-a` 10 px from the right DC motor's minus, its plus and `in-b` 26 px from the servo motor's minus, the bumper switch's sockets 34 px from the servo motor's arm), and the **Circuit Crew kit robot** four (the buzzer's minus and the driver's minus 5.6 px apart, the driver's `in-a` and the switch's `b` 5.6 px, the driver's plus and `in-b` 18.6 px from the LED's sockets).
- **A crowd fans out on demand.** When a press lands on two sockets' targets at once, or a wire cannot tell which socket of a crowd it is at, the crowd fans out round the finger over 150 ms: each socket moves out on a lead to a place of its own, a socket and an 8 px gap from the others, past the finger's reach (so the press or lift that opened it picks none), each leaning towards its own part, and inside the view and clear of every other socket where there is room within a socket of the smallest circle. Fanned sockets are drawn above everything on a backing disc and take presses first, so where a crowd has no room near by they cover their neighbours until the fan closes.
- So **every socket has its own unambiguous 44 px target at the default zoom**: a socket alone has it where it is; a crowded one, once its crowd fans out. The press that fans a crowd out does nothing else; the next press picks a socket. A wire lifted where the crowd was waits, as in tap-then-tap, for the tap on one of the fanned sockets.
- The fan closes on a press anywhere else, when a wire lands, when the build changes, and behind a dragged wire that goes on past it.
- At rest the canvas draws sockets where task 3.1's layout puts them, so a covered socket still shows as a sliver; whether it is empty or connected shows when its crowd fans out.
- Why not move the sockets for good: the dense middle of a Level 2 robot has no free room within reach of its parts, so a lasting layout would put sockets far from their parts or cover others anyway, and zooming does not help because sockets scale with the build. Spreading a crowded group when a finger lands among it is option 2 of the review's question 1.

## Removing a wire

- **Drag** a wire by its 24 px hit area onto a remove target (the tray): it comes off its sockets, rides under the finger and fades over the tray, and letting go there removes it (`disconnect`). Let go anywhere else, it goes back.
- **Tap** a wire and its bin shows beside its middle, clear of its hit area, on its right (on its left for left-handed use, D44); a tap on the bin removes the wire, as Delete or Backspace does. A tap anywhere else hides it.
- A drive linkage whose part does not sit on its shaft (a wheel joined to a servo motor's arm) is grabbed the same way; one that does is zero length, under the sockets, and comes off when its part is moved (D34).
- For task 3.4: `wiring.selectedWire` is the wire whose bin shows, set by the same tap that will select it, and a tap on a socket or a wire hides the part's handles (`placement.deselect()`).

## Wires follow their ports

While a part is dragged or turned, its wires are redrawn to its sockets on every move (task 3.2's drawing), and after the edit the rebuild draws them where the new build puts the sockets. Routing wires round parts is task 3.7.

## Look and motion

- The wire on its way is drawn by the renderer's `WireView`, exactly as a landed wire: power solid red, signal dashed yellow, mechanical thick grey, 6 px (brief Section 13). It draws in the wires layer whatever its type, so a drive linkage on its way stays above the parts it crosses, with a round plug at its free end.
- Glows, the waiting wire's ring, fanned sockets with their leads and the bin draw in the ports-and-handles layer, attached again on top after every rebuild, so they show above every socket (brief Section 9).
- A wire that lands settles into its socket with a short elastic overshoot over 180 ms (a tapped wire draws out from its source); one let go springs softly back over 160 ms; a crowd fans out over 150 ms. With reduced motion each is instant. Sound is the app's: a landing is an `edit` with a `connect`.

## Hooks in the renderer and placement

Kept to what wiring needs:

- `src/renderer/surface.ts`: constructs the `WiringController` after placement (`surface.wiring`), so its pointer handler goes first; `wiring.refresh()` after every rebuild, `modeChanged()` in `setMode`, `destroy()` in `destroy`, and `setRemoveTargets` passes the remove targets to it too.
- `src/placement/apply.ts`: `WIRING_REDUCERS` joins the reducer table, and the stub that threw for `connect` and `disconnect` is gone.
- `src/placement/controller.ts`: `Press` and `Gesture` are exported for wiring's gestures; `deselect()` hides a part's handles; `handleAt(world)` says whether a handle lies under a point.

## Tests

- **unit**: `test/wiring/commands.test.ts` covers `connect` and `disconnect`, their refusals, drive linkages, legal-but-wrong wiring, batches, purity, and every whole fixture built by commands, byte for byte. `test/wiring/rules.test.ts` drops a wire from every socket onto every socket of every legal fixture and the Circuit Crew kit robot, fanning a crowd out where the rule says: it lands exactly where `planWire` accepts the wire and is refused with its code everywhere else; and round every crowd, no drop lands on a socket other than the one under it. `test/wiring/crowds.test.ts` covers the crowds of both Level 2 builds, the fan's spacing and reach, and `spreadAngles`; `test/wiring/motion.test.ts` the durations and easings.
- **browser**: task 3.2's `test/browser/placement-e2e.test.ts`, extended, is the done-when of both tasks: every legal fixture built whole by hand on four paths (touch drags, touch tap-then-tap, mouse drags, click-click), every part placed and then every wire drawn by the same hand through real input through CDP, each giving the command-built blueprint and the fixture, and all four the same bytes. `test/browser/wiring.test.ts` covers the reach and its glow, drag sensitivity, the push-away, every kind of impossible drop on every path with its cue (by state, and by pixels on the screen), the spring back, legal-but-wrong wiring, a drive linkage by hand, 44 px socket targets, 24 px wire hit areas, removing wires, wires following their ports, the elastic settle, the locks, the pinch, and crowded sockets on both Level 2 builds at the default zoom.
- The Circuit Crew kit robot uses content's part records, which differ from the schema's examples. The canvas never imports content, so `test/fixtures/circuit-crew.json` is a copy of the fixture, its ten part records and its arena; the e2e harness (task 3.8, packages/tools) can check live content.
- The browser tests wait until the page has handled each input before they read the canvas, and a test's hands send nothing once the test has ended (`test/browser/wiring-hands.ts`), because input sent through CDP can arrive late on a loaded machine and a timed-out test must not press into the next one. The longest builds have their own timeouts.

## Decisions and open questions

Taken here, conservatively, and listed for Drew:

1. Crowded sockets fan out on demand (a press among them, or a wire that cannot tell them apart), rather than the socket layout changing for good. At rest a covered socket still shows as a sliver, and its empty or connected state shows when its crowd fans out.
2. Where a crowd has no room near by, the fan stays close and covers neighbouring sockets until it closes, rather than moving sockets far from their parts.
3. A wire lifted where it cannot tell which socket is meant waits, as in tap-then-tap, for a tap on a fanned socket, rather than springing back.
4. Tapped on a socket that refuses it, a waiting wire keeps waiting (the right colour glowing), rather than going.
5. The refusal cue is the push-away and the right colour glowing, until the next touch. Nothing marks the refusing socket itself.
6. Mount points are not wiring targets: a wire neither lands on nor is pushed away by one, so `wire.mechanical_mismatch` never arises from a canvas gesture (mounts are placed, task 3.2).
7. Removing a wire: drag it onto the tray, or tap it and its bin, or Delete. The bin is wiring's until task 3.4's selection takes it over.
8. A wire dragged off to be removed rides under the finger whole, off its sockets.
9. Polarity marks on power sockets (review R-3.1, question 4) are not drawn: this task's notes do not name them.
10. The reach scales with drag sensitivity as placement's 48 px does, and never falls below a socket's own radius (22 px).
