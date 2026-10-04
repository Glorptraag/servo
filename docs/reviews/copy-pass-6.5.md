# Copy pass 6.5: spec cards and hints

Task 6.5. Every spec card (14 part records) and every challenge (15 at Level 1, 19 at Level 2) was read against `docs/brief.md` Section 12, with Section 5 and the reviewer voice notes in `docs/reviews/tasks/4.7.md` and `4.8.md` in mind. The rules applied: short, concrete, second person or about the part, no praise, no exclamation marks, no rhetorical questions, real names, and no closing full stop on a callout line.

**Sign-off request for Drew (decision queue).** The orchestrator should queue this as a decision: *"Copy pass 6.5: sign off the challenge edits in table 1, and rule on the part-card proposals in table 2 and on questions Q1 to Q4 (docs/reviews/copy-pass-6.5.md)."* Task 6.5 is done when Drew's sign-off is recorded.

## Finding that limits the pass: part-record text is in the golden hashes

Each golden file holds a hash of every part record its Run uses (`part <id> <hash>`, from `packages/tools/src/golden-runs/run.ts`). The hash covers the whole record, card text included. A trial edit to one word of the DC motor's `does` line made 94 golden cases differ. Two canvas test copies (`packages/canvas/test/fixtures/busy-workbench.json` and `circuit-crew.json`) also hold full part records, and `canvas-fixture-copies.test.ts` checks them against content.

At first, this task could not change golden files or canvas fixtures, so the card edits were only proposed. The orchestrator then ruled that a golden hash change caused only by text is intended, and allowed the two canvas copies to be refreshed. Table 2 is now applied: see "Golden acceptance" below.

## Table 1: challenge edits made (commit 6ac5a50)

Only text fields were changed. Ids, goals, ladder structure, wire changes and fixtures are as they were. `pnpm golden` still matches all 109 Runs.

| Challenge | Field | Was | Now | Why |
| --- | --- | --- | --- | --- |
| `meet-the-battery-pack` (L1) | goalLine | Wire the battery pack's plus to the DC motor so the DC motor turns | Wire the battery pack's plus to the DC motor's plus so the DC motor turns | Names the port, as the buzzer and LED goal lines do |
| `meet-the-1-cell-battery-pack` (L2) | goalLine | Wire the 1-cell battery pack's plus to the DC motor and watch how it turns | Wire the 1-cell battery pack's plus to the DC motor's plus and watch how the DC motor turns | Names the port; "it" could mean the battery pack |
| `one-motor-backwards` (L2) | title | One motor backwards | One DC motor backwards | Real name (4.7 F7 nit) |
| `one-motor-backwards` (L2) | hint 2, pulse-part | This DC motor turns forward with plus from side B and minus back to the battery pack | This DC motor turns forward with plus from side B and minus back to minus | Shorter; matches the "Minus back to minus" lines |
| `push-the-heavy-box` (L2) | hint 7, pulse-part | This DC motor turns its wheel with no gearbox, too weakly to push the heavy box | This DC motor is too weak to push the heavy box without a gearbox | Shorter, plainer order |
| `meet-the-servo-motor` (L2) | hint 2, pulse-port | This servo motor's plus takes one battery pack only | This servo motor's plus takes power from one battery pack only | "takes one battery pack" read as a thing, not power |

## Table 2: part-card edits (applied after the orchestrator's ruling)

| Part | Field | Now | Proposed | Why |
| --- | --- | --- | --- | --- |
| `dc-motor` | failure hint `no-circuit` | This motor is not in a loop with the battery pack | This DC motor is not in a loop with the battery pack | Real name; every challenge line already says "This DC motor" (4.7 F7) |
| `dc-motor` | failure hint `low-voltage` | This motor is not getting enough power | This DC motor is not getting enough power | Same |
| `dc-motor` | failure hint `overload` | This motor cannot turn its load | This DC motor cannot turn its load | Same |
| `dc-motor` | failure hint `reversed` | This motor's plus and minus are swapped | This DC motor's plus and minus are swapped | Same |
| `dc-motor` | teachingNote `overload` | A motor can turn only so much load. … | A DC motor can turn only so much load. … | Same |
| `servo-motor` | failure hint `no-signal` | The servo is waiting for a signal | This servo motor is waiting for a signal | Real name as the terminology list has it; matches the card's other hints (Q1) |
| `wheel-large` | failure hints (3) | This wheel … | This large wheel … | Names the part; matches "This large wheel needs a shaft in its hub" in the challenges |
| `wheel-small` | failure hints (3) | This wheel … | This small wheel … | Same |
| `motor-driver` | teachingNotes `no-power`, `low-voltage`, `reversed` | … with no fault of their own: the fault is the driver's. | … with no fault of their own: the fault is in the motor driver. | Real name, and plainer |
| `motor-driver` | does | Passes power from the battery pack to two motors, and sets each one forward, backward or stopped. | Passes power from the battery pack to two DC motors, and sets each one forward, backward or stopped. | Real name |
| `motor-driver` | gives | Gives: power (red) out to two motors. | Gives: power (red) out to two DC motors. | Real name |
| `chassis` | does | The chassis (frame) holds every part of your robot together. | *Not applied.* Proposed: Holds every part of your robot together, like a frame. | The validator rejects it (`terminology.gloss_alone`: "frame" must stand beside "chassis"). The line stays as it was. |

Read and kept as they are: every other card field on the 2-cell and 1-cell battery packs, caster, switch, bumper switch, buzzer, gearbox, LED and servo motor (does, needs, gives, popular mechanics, safety note, card lines, hints, teaching notes). They are already short, concrete and named, with no praise or exclamation marks.

## Challenges read and kept unchanged

Level 1: `cross-the-arena`, `drive-forward`, `meet-the-caster`, `meet-the-dc-motor`, `meet-the-large-wheel`, `meet-the-switch`, `no-way-out`, `over-the-hill`, `push-the-box`, `stop-with-the-switch`, `switch-to-one-side`, `turn-in-a-circle`, `what-if-one-motor-on-the-switch`, `what-if-one-wheel`.

Level 2: `drive-and-light`, `drive-with-the-buzzer`, `light-until-the-wall`, `meet-the-bumper-switch`, `meet-the-buzzer`, `meet-the-gearbox`, `meet-the-led`, `meet-the-motor-driver`, `meet-the-small-wheel`, `spin-on-the-spot`, `stop-at-the-wall`, `stop-the-motor-driver`, `weak-battery-pack`, `what-if-one-cell`, `what-if-one-small-wheel`.

Every title, goal line and hint line in these was read. All are second person or about the part, use real names, have no praise, exclamation or question marks, and end without a full stop. Do-it lines say what they did.

## Questions for Drew

- **Q1.** The brief's own hint example is "The servo is waiting for a signal", and the servo motor card uses it word for word. Should it become "This servo motor is waiting for a signal" (table 2)? *Applied with table 2 under the orchestrator's ruling. Revert this one line if you want the brief's wording kept.*
- **Q2.** *Settled by the orchestrator: table 2 is applied in 6.5, and the golden changes are accepted (see below).*
- **Q3.** The LED's failure hint says "This LED's legs are swapped", and the challenges say "This LED's plus and minus are swapped". Should one wording be used everywhere, and which? *Default taken: both kept. Legs are what a child sees, and plus and minus match the port labels.*
- **Q4.** `spin-on-the-spot` says "Set motor A forward and motor B backward", using the motor driver's output names, not "DC motor". *Default taken: kept, because "motor A" and "motor B" are the setting labels on the motor driver.*

## Golden acceptance

**Orchestrator note.** A golden hash change caused only by part-record text is an intended change. It was accepted under the orchestrator's ruling for task 6.5, as CLAUDE.md allows for `pnpm golden --accept` with a note.

**What changed.** Applying table 2 changed the text of five part records: `dc-motor`, `motor-driver`, `servo-motor`, `wheel-large` and `wheel-small`. Before acceptance, `pnpm golden` flagged 98 content cases. Every flagged case showed the same three things:
- `inputs: the part record(s) … changed`;
- `ticks: all N are the same`;
- `faults: the same`.

All 11 schema cases matched, because they use the schema's example parts. The count is 98, not the 94 from the first trial, because that trial changed only the DC motor.

**Hash-only proof.** After `pnpm golden --accept`, a throwaway script compared each changed golden file with its `HEAD` version, line by line. It lives in the scratchpad and is not committed. A line counts as allowed only if it is identical, or if both versions are `part <id> <16 hex>` with the same id. Result: *98 golden files changed; 98 differ only in part-record hash lines; 0 differ otherwise.* No tick hash, tick state line, fault line, run-record hash, blueprint, arena, seed or input line changed. The `+part` lines by part:

| Part | Golden files whose hash line changed |
| --- | --- |
| dc-motor | 94 |
| wheel-large | 78 |
| motor-driver | 18 |
| servo-motor | 4 |
| wheel-small | 4 |

**Accepted cases (98, all `content/`).**
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

**Canvas test copies.** `packages/canvas/test/fixtures/busy-workbench.json` and `circuit-crew.json` were updated by string replacement of the changed text lines only. A check confirmed three things:
- each copied part record now equals its content record;
- every key outside `parts` is unchanged;
- each file has 13 lines changed, all of them `hint`, `teachingNote`, `does` or `gives` lines.

The orchestrator's note allows these files to be touched for this task.

**Design smell for 6.4's sweep.** The golden part hash covers the whole part record (`packages/tools/src/golden-runs/run.ts`, `sha256(canonicalJson(part))`). Card text, hints and teaching notes therefore churn about 100 goldens, even though they cannot change a Run. Goldens should hash only the fields sim-core reads: behaviour, body, needs, ports and settings. Then a copy edit needs no `--accept`. Separately, a code comment in `packages/sim-core/src/electrical/needs.ts:93` still quotes the old motor-driver wording ("the fault is the driver's"). It is not content, so it is left to that sweep.

## Checks

Run after the part edits and golden acceptance. The machine was heavily loaded (load average 30 to 45).

- `pnpm validate-content packages/content --terminology packages/content/terminology`: 109 records, no issues.
- `pnpm golden`: 109 Runs match, and every fixture's expect holds (102).
- `pnpm --filter @servo/content test`: 311 passed.
- `pnpm --filter @servo/tools test`: 1713 of 1714 passed, including both hint-ladder tests and the canvas-copy check. One test in `release-cli.test.ts` failed on a 5 s timeout. Re-run alone once, the file passed (17 of 17).
- `pnpm --filter @servo/canvas test`: 527 of 528 passed. One browser test in `run-animation.test.ts` (switch flips, read-only canvas) failed with "the canvas is still moving" after 177 s. Re-run alone once, the file passed (12 of 12).
- `pnpm lint` and `pnpm typecheck`: clean.
- No test quoted the old text. The e2e screenshot references in `packages/tools/test/e2e/__screenshots__` show only the canvas, with no card or hint text, so none is affected.
