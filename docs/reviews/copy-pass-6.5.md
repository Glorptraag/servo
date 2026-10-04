# Copy pass 6.5: spec cards and hints

Task 6.5. Every spec card (14 part records) and every challenge (15 at Level 1, 19 at Level 2) was read against `docs/brief.md` Section 12, with Section 5 and the reviewer voice notes in `docs/reviews/tasks/4.7.md` and `4.8.md` in mind. The rules applied: short, concrete, second person or about the part, no praise, no exclamation marks, no rhetorical questions, real names, and no closing full stop on a callout line.

**Sign-off request for Drew (decision queue).** The orchestrator should queue this as a decision: *"Copy pass 6.5: sign off the challenge edits in table 1, and rule on the part-card proposals in table 2 and on questions Q1 to Q4 (docs/reviews/copy-pass-6.5.md)."* Task 6.5 is done when Drew's sign-off is recorded.

## Finding that limits the pass: part-record text is in the golden hashes

Each golden file holds a hash of every part record its Run uses (`part <id> <hash>`, from `packages/tools/src/golden-runs/run.ts`). The hash covers the whole record, card text included. A trial edit to one word of the DC motor's `does` line made 94 golden cases differ. Two canvas test copies (`packages/canvas/test/fixtures/busy-workbench.json` and `circuit-crew.json`) also hold full part records, and `canvas-fixture-copies.test.ts` checks them against content.

This task may not change golden files or canvas fixtures, and `pnpm golden` must match byte for byte. So **no part record was edited.** The card edits this pass recommends are in table 2, with the exact text, ready to apply in a follow-up that may run `pnpm golden --accept` and refresh the two canvas copies. That follow-up changes no Run: the diffs would show `inputs: the part record … changed` with every tick the same.

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

## Table 2: part-card edits proposed (not applied, see the finding above)

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
| `chassis` | does | The chassis (frame) holds every part of your robot together. | Holds every part of your robot together, like a frame. | Every other `does` line starts with the verb under the name; keeps the simplification beside the name |

Read and kept as they are: every other card field on the 2-cell and 1-cell battery packs, caster, switch, bumper switch, buzzer, gearbox, LED and servo motor (does, needs, gives, popular mechanics, safety note, card lines, hints, teaching notes). They are already short, concrete and named, with no praise or exclamation marks.

## Challenges read and kept unchanged

Level 1: `cross-the-arena`, `drive-forward`, `meet-the-caster`, `meet-the-dc-motor`, `meet-the-large-wheel`, `meet-the-switch`, `no-way-out`, `over-the-hill`, `push-the-box`, `stop-with-the-switch`, `switch-to-one-side`, `turn-in-a-circle`, `what-if-one-motor-on-the-switch`, `what-if-one-wheel`.

Level 2: `drive-and-light`, `drive-with-the-buzzer`, `light-until-the-wall`, `meet-the-bumper-switch`, `meet-the-buzzer`, `meet-the-gearbox`, `meet-the-led`, `meet-the-motor-driver`, `meet-the-small-wheel`, `spin-on-the-spot`, `stop-at-the-wall`, `stop-the-motor-driver`, `weak-battery-pack`, `what-if-one-cell`, `what-if-one-small-wheel`.

Every title, goal line and hint line in these was read. All are second person or about the part, use real names, have no praise, exclamation or question marks, and end without a full stop. Do-it lines say what they did.

## Questions for Drew

- **Q1.** The brief's own hint example is "The servo is waiting for a signal", and the servo motor card uses it word for word. Should it become "This servo motor is waiting for a signal" (table 2)? *Default taken: left as the brief has it, proposed only.*
- **Q2.** Should the table 2 card edits go ahead in a follow-up task that may accept the golden hash changes and refresh the two canvas test copies? *Default taken: no part record edited in 6.5.*
- **Q3.** The LED's failure hint says "This LED's legs are swapped", and the challenges say "This LED's plus and minus are swapped". Should one wording be used everywhere, and which? *Default taken: both kept. Legs are what a child sees, and plus and minus match the port labels.*
- **Q4.** `spin-on-the-spot` says "Set motor A forward and motor B backward", using the motor driver's output names, not "DC motor". *Default taken: kept, because "motor A" and "motor B" are the setting labels on the motor driver.*

## Checks

- `pnpm validate-content packages/content --terminology packages/content/terminology`: 109 records, no issues.
- `pnpm golden`: 109 Runs match; every fixture's expect holds (102).
- `pnpm --filter @servo/content test`: 311 passed. `pnpm --filter @servo/tools test`: 1714 passed, including the Level 1 and Level 2 hint-ladder tests. No test quoted the old text.
- `pnpm lint` and `pnpm typecheck`: clean.
- E2e screenshot references (`packages/tools/test/e2e/__screenshots__`) show the canvas only, with no card or hint text, so none is affected.
