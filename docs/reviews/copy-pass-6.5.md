# Copy pass 6.5: spec cards and hints

Task 6.5. I read every spec card (14 part records) and every challenge (15 at Level 1, 19 at Level 2) against `docs/brief.md` Section 12, with Section 5 and the reviewer voice notes in `docs/reviews/tasks/4.7.md` and `4.8.md` in mind. Each line had to:

- be short and concrete;
- speak in the second person, or about the part;
- contain no praise, exclamation mark or rhetorical question;
- use real component names;
- end without a full stop when it is a callout.

Review R-6.5 (`docs/reviews/tasks/6.5.md`) passed. Its findings F1, F4, F5 and F6 are fixed here.

## Sign-off request for Drew (decision queue)

The orchestrator should queue this wording: *"Copy pass 6.5: sign off every Before → After line in the two tables below, and answer Q1 to Q4 (docs/reviews/copy-pass-6.5.md)."* Task 6.5 is done when Drew's sign-off is recorded.

Each table lists every text field that differs from main (9be6576), in full. Nothing else in these files changed: no id, port, number, setting, wire change, ladder or goal.

### Part cards edited

| Part | Field | Before | After |
| --- | --- | --- | --- |
| `dc-motor` (L1) | hint `no-circuit` | This motor is not in a loop with the battery pack | This DC motor is not in a loop with the battery pack |
| `dc-motor` (L1) | hint `low-voltage` | This motor is not getting enough power | This DC motor is not getting enough power |
| `dc-motor` (L1) | hint `overload` | This motor cannot turn its load | This DC motor cannot turn its load |
| `dc-motor` (L1) | teachingNote `overload` | A motor can turn only so much load. Asked for more, such as up a steep ramp or against a wall, the shaft stops and the motor hums while it draws the most current it ever draws, so the battery pack drains fast. | A DC motor can turn only so much load. Asked for more, such as up a steep ramp or against a wall, the shaft stops and the motor hums while it draws the most current it ever draws, so the battery pack drains fast. |
| `dc-motor` (L1) | hint `reversed` | This motor's plus and minus are swapped | This DC motor's plus and minus are swapped |
| `wheel-large` (L1) | hint `not-driven` | This wheel needs a shaft in its hub | This large wheel needs a shaft in its hub |
| `wheel-large` (L1) | hint `lifted` | This wheel does not reach the floor | This large wheel does not reach the floor |
| `wheel-large` (L1) | hint `slipping` | This wheel is spinning in place | This large wheel is spinning in place |
| `motor-driver` (L2) | does | Passes power from the battery pack to two motors, and sets each one forward, backward or stopped. | Passes power from the battery pack to two DC motors, and sets each one forward, backward or stopped. |
| `motor-driver` (L2) | gives | Gives: power (red) out to two motors. | Gives: power (red) out to two DC motors. |
| `motor-driver` (L2) | needs | Needs: power (red) in, and a setting or a signal (yellow) for each motor. | Needs: power (red) in, and a setting or a signal (yellow) for each DC motor. |
| `motor-driver` (L2) | popularMechanics | A remote-control car has a motor driver inside, which runs its motor forward or backward. | A remote-control car has a motor driver inside, which runs its DC motor forward or backward. |
| `motor-driver` (L2) | cardLine `no-power` | No power in: its motors stay still. | No power in: its DC motors stay still. |
| `motor-driver` (L2) | teachingNote `no-power` | A motor driver passes power on to its motors, so it needs its own loop to the battery pack. With none, both outputs give nothing, and the motors wired to it stay still with no fault of their own: the fault is the driver's. | A motor driver passes power on to its DC motors, so it needs its own loop to the battery pack. With none, both outputs give nothing, and the DC motors wired to it stay still with no fault of their own: the fault is in the motor driver. |
| `motor-driver` (L2) | cardLine `low-voltage` | Too little power: it gives its motors nothing. | Too little power: it gives its DC motors nothing. |
| `motor-driver` (L2) | teachingNote `low-voltage` | A motor driver needs at least 2.5 volts to switch its outputs. On less, such as a 1-cell battery pack, it gives its motors nothing, and they stay still with no fault of their own: the fault is the driver's. | A motor driver needs at least 2.5 volts to switch its outputs. On less, such as a 1-cell battery pack, it gives its DC motors nothing, and they stay still with no fault of their own: the fault is in the motor driver. |
| `motor-driver` (L2) | cardLine `reversed` | Power in swapped: it gives its motors nothing. | Power in swapped: it gives its DC motors nothing. |
| `motor-driver` (L2) | teachingNote `reversed` | A motor driver works only with plus to plus at its power in. Wired the other way round it gives its motors nothing, and they stay still with no fault of their own: the fault is the driver's. A real one can be damaged this way. | A motor driver works only with plus to plus at its power in. Wired the other way round it gives its DC motors nothing, and they stay still with no fault of their own: the fault is in the motor driver. A real one can be damaged this way. |
| `servo-motor` (L2) | hint `no-signal` | The servo is waiting for a signal | This servo motor is waiting for a signal |
| `servo-motor` (L2) | teachingNote `no-signal` | A servo motor turns to the angle its signal asks for. With power but no signal it has nothing to follow, so it holds where it is and hums. A microcontroller gives that signal on a signal line (yellow), and no Level 2 part gives one. | A servo motor turns to the angle its signal asks for. With power but no signal it has nothing to follow, so it holds where it is and hums. The signal comes from a microcontroller on a signal line (yellow), and nothing in this kit gives one yet. |
| `wheel-small` (L2) | hint `not-driven` | This wheel needs a shaft in its hub | This small wheel needs a shaft in its hub |
| `wheel-small` (L2) | hint `lifted` | This wheel does not reach the floor | This small wheel does not reach the floor |
| `wheel-small` (L2) | hint `slipping` | This wheel is spinning in place | This small wheel is spinning in place |

### Challenge lines edited

| Challenge | Field | Before | After |
| --- | --- | --- | --- |
| `meet-the-battery-pack` (L1) | goalLine | Wire the battery pack's plus to the DC motor so the DC motor turns | Wire the battery pack's plus to the DC motor's plus so the DC motor turns |
| `meet-the-1-cell-battery-pack` (L2) | goalLine | Wire the 1-cell battery pack's plus to the DC motor and watch how it turns | Wire the 1-cell battery pack's plus to the DC motor's plus and watch how the DC motor turns |
| `meet-the-servo-motor` (L2) | hint 2, pulse-port | This servo motor's plus takes one battery pack only | This servo motor's plus takes power from one battery pack only |
| `one-motor-backwards` (L2) | hint 2, pulse-part | This DC motor turns forward with plus from side B and minus back to the battery pack | This DC motor turns forward with plus from side B and minus back to the battery pack's minus |
| `one-motor-backwards` (L2) | title | One motor backwards | One DC motor backwards |
| `push-the-heavy-box` (L2) | hint 7, pulse-part | This DC motor turns its wheel with no gearbox, too weakly to push the heavy box | This DC motor is too weak to push the heavy box without a gearbox |

Two canvas test copies hold a copy of the motor driver, DC motor and large wheel records: `packages/canvas/test/fixtures/busy-workbench.json` and `circuit-crew.json`. Their text was changed to match the part table above. Nothing else in them changed.

### Read and kept

- **Part cards.** All other text on the 2-cell and 1-cell battery packs, caster, chassis, switch, bumper switch, buzzer, gearbox, LED and servo motor was kept.
- **The chassis `does` line.** I tried "Holds every part of your robot together, like a frame.", but the validator rejects it (`terminology.gloss_alone`: "frame" must stand beside "chassis"). The line stays "The chassis (frame) holds every part of your robot together."
- **Level 1 challenges kept:** `cross-the-arena`, `drive-forward`, `meet-the-caster`, `meet-the-dc-motor`, `meet-the-large-wheel`, `meet-the-switch`, `no-way-out`, `over-the-hill`, `push-the-box`, `stop-with-the-switch`, `switch-to-one-side`, `turn-in-a-circle`, `what-if-one-motor-on-the-switch`, `what-if-one-wheel`.
- **Level 2 challenges kept:** `drive-and-light`, `drive-with-the-buzzer`, `light-until-the-wall`, `meet-the-bumper-switch`, `meet-the-buzzer`, `meet-the-gearbox`, `meet-the-led`, `meet-the-motor-driver`, `meet-the-small-wheel`, `spin-on-the-spot`, `stop-at-the-wall`, `stop-the-motor-driver`, `weak-battery-pack`, `what-if-one-cell`, `what-if-one-small-wheel`.

## Questions for Drew

- **Q1.** The brief's own hint example, "The servo is waiting for a signal", is now "This servo motor is waiting for a signal", to match the terminology list. *Default: keep the change. Revert this one line if you want the brief's wording.*
- **Q2.** The LED's failure hint says "This LED's legs are swapped", and the challenges say "This LED's plus and minus are swapped". Should one wording be used everywhere? *Default: keep both. Legs are what a child sees, and plus and minus match the port labels.*
- **Q3.** `spin-on-the-spot` says "Set motor A forward and motor B backward". *Default: keep, because "motor A" and "motor B" are the motor driver's setting labels.*
- **Q4.** `docs/gates/G2.md` quotes the old card text that you read at gate G2 (R-6.5 F3), so the cards you are signing off here differ from that record. *Default: leave G2.md as it is, as a provisional record. The orchestrator is handling it.*

## Golden acceptance

**Orchestrator note.** A golden hash change caused only by part-record text is an intended change. Under the orchestrator's ruling for task 6.5, it is accepted with `pnpm golden --accept`, as CLAUDE.md allows with a note.

Each golden file stores a hash of every part record its Run uses (`part <id> <hash>`). The hash covers the whole record, card text included. So any text edit to a part changes the golden files of every Run that uses that part, even though no Run changes.

**Round 1 (commit 9133f5a).** Text edits to `dc-motor`, `motor-driver`, `servo-motor`, `wheel-large` and `wheel-small` made 98 content cases differ. In every one of them:

- `inputs: the part record(s) <ids> changed`;
- `ticks: all N are the same`;
- `faults: the same`.

All 11 schema cases matched, because they use the schema's example parts.

**Round 2 (R-6.5 fixes).** The further text edits to `motor-driver` and `servo-motor` made 22 cases differ again, in the same hash-only way. They were re-accepted:

- broken-servo-without-signal, broken-underpowered-pack, broken-wrong-type-wire, bumper-stops-at-wall, busy-workbench, kit-circuit-crew
- meet-the-motor-driver-reversed, meet-the-motor-driver-start, meet-the-motor-driver-wired
- meet-the-servo-motor-joined, meet-the-servo-motor-one-pack, meet-the-servo-motor-start
- motor-driver-robot
- spin-on-the-spot-one-motor-stopped, spin-on-the-spot-spinning, spin-on-the-spot-start
- stop-at-the-wall-bumper
- stop-the-motor-driver-hung-off-plus, stop-the-motor-driver-pressed, stop-the-motor-driver-start
- weak-battery-pack-fixed, weak-battery-pack-start

**Hash-only proof.** After each `--accept`, a throwaway script compared every changed golden file with the earlier version, line by line. It was not committed and has been removed. A line counted as allowed only if it was identical, or if both versions were `part <id> <16 hex>` with the same id. The results:

| Comparison | Result |
| --- | --- |
| Round 1 against 9be6576 | 98 golden files changed; 98 differ only in part-record hash lines; 0 differ otherwise |
| Round 2 against 9133f5a | 22 golden files changed; 22 differ only in part-record hash lines; 0 differ otherwise |
| Final tree against main 9be6576 | 98 golden files changed; 98 differ only in part-record hash lines; 0 differ otherwise |

No tick hash, tick state, fault, run-record hash, blueprint, arena, seed or input line changed.

These are the part hash lines that differ from main, counted by part:

| Part | Golden files |
| --- | --- |
| dc-motor | 94 |
| wheel-large | 78 |
| motor-driver | 18 |
| servo-motor | 4 |
| wheel-small | 4 |

**All accepted cases against main (98, all `content/`).**

- broken-chassis-on-the-floor, broken-loose-caster, broken-missing-return-wire, broken-reversed-motor, broken-servo-without-signal, broken-short-circuit, broken-underpowered-pack, broken-wrong-type-wire
- bumper-stops-at-wall, busy-workbench
- cross-the-arena-one-motor, cross-the-arena-roller
- drive-and-light-led-backwards, drive-and-light-start, drive-and-light-wired
- drive-forward-both-motors, drive-forward-one-motor
- drive-with-the-buzzer-on-plus, drive-with-the-buzzer-pressed, drive-with-the-buzzer-start
- geared-robot, heavy-box-direct-drive, kit-circuit-crew, kit-rolling-start, led-and-buzzer-robot, level-1-roller
- light-until-the-wall-led-on-plus, light-until-the-wall-start, light-until-the-wall-wired
- meet-the-1-cell-battery-pack-start, meet-the-1-cell-battery-pack-wired
- meet-the-battery-pack-start, meet-the-battery-pack-wired
- meet-the-bumper-switch-beside-the-motors, meet-the-bumper-switch-start, meet-the-bumper-switch-wired
- meet-the-caster-fixed, meet-the-caster-start
- meet-the-dc-motor-start, meet-the-dc-motor-wired
- meet-the-gearbox-fitted, meet-the-gearbox-one-wheel, meet-the-gearbox-start
- meet-the-large-wheel-fitted, meet-the-large-wheel-start
- meet-the-motor-driver-reversed, meet-the-motor-driver-start, meet-the-motor-driver-wired
- meet-the-servo-motor-joined, meet-the-servo-motor-one-pack, meet-the-servo-motor-start
- meet-the-small-wheel-fitted, meet-the-small-wheel-start
- meet-the-switch-beside-the-motor, meet-the-switch-not-pressed, meet-the-switch-pressed
- motor-driver-robot, no-way-out-fixed, no-way-out-start, one-cell-roller
- one-motor-backwards-fixed, one-motor-backwards-start
- over-the-hill-start, over-the-hill-wired
- push-the-box-both-motors, push-the-box-one-motor
- push-the-heavy-box-gearboxes-off, push-the-heavy-box-geared, push-the-heavy-box-into-the-wall, push-the-heavy-box-one-gearbox, push-the-heavy-box-start
- small-wheel-roller
- spin-on-the-spot-one-motor-stopped, spin-on-the-spot-spinning, spin-on-the-spot-start
- stop-at-the-wall-bumper, stop-at-the-wall-no-bumper
- stop-the-motor-driver-hung-off-plus, stop-the-motor-driver-pressed, stop-the-motor-driver-start
- stop-with-the-switch-hung-off-plus, stop-with-the-switch-not-pressed, stop-with-the-switch-pressed
- switch-in-the-line, switch-to-one-side-fixed, switch-to-one-side-start
- turn-in-a-circle-one-motor, turn-in-a-circle-start
- weak-battery-pack-fixed, weak-battery-pack-start
- what-if-one-cell-start, what-if-one-cell-swapped
- what-if-one-motor-on-the-switch-moved, what-if-one-motor-on-the-switch-start
- what-if-one-small-wheel-start, what-if-one-small-wheel-swapped
- what-if-one-wheel-off, what-if-one-wheel-start

**Canvas test copies.** Both files were updated by replacing only the changed string values. A check confirmed that each copied part record equals its content record and that every key outside `parts` is unchanged. Round 1 changed 13 string fields per file, and round 2 changed 8 more.

**Design smell for 6.4's sweep.** The golden part hash covers the whole part record (`packages/tools/src/golden-runs/run.ts`, `sha256(canonicalJson(part))`). As a result, card text, hints and teaching notes churn about 100 golden files, even though they cannot change a Run. Goldens should hash only the fields sim-core reads (behaviour, body, needs, ports and settings), so that a copy edit never needs `--accept`. R-6.5 F2 is also left to the orchestrator: a code comment in `packages/sim-core/src/electrical/needs.ts:93` still quotes "the fault is the driver's".

## Checks

These ran after the R-6.5 fixes on a heavily loaded machine.

- `pnpm validate-content packages/content --terminology packages/content/terminology`: 109 records, no issues.
- `pnpm golden`: 109 Runs match, and every fixture's expect holds (102).
- `pnpm --filter @servo/content test`: 311 of 311 passed.
- `pnpm --filter @servo/canvas test`: 528 of 528 passed.
- `canvas-fixture-copies.test.ts` and `level-2-hint-ladders.test.ts` in tools: 71 of 71 passed. The full tools suite last ran at 9133f5a: 1713 of 1714 passed, and the one `release-cli.test.ts` timeout passed when re-run alone.
- `pnpm lint` and `pnpm typecheck`: both exited 0.
- No test quoted the old text. The e2e screenshot references in `packages/tools/test/e2e/__screenshots__` show only the canvas, with no card or hint text, so none is affected.
