# Review: improvements structured as slots for content to fill

Date: 2026-10-07. From three read-only audits of the built app against `docs/brief.md` Sections 4, 5, 9, 10, 12 and 13: what the app writes into code that content should carry, what the content records leave thin, and what the brief describes that the app does not yet do. Each item below names the gap, the structure that fixes it (a schema field, an app slot, a validator rule, a fixture), what content then fills, and the plan task that carries it (tasks 7.24 to 7.35 in `.claude/plans/status.json`). Ground rule 1 is the test throughout: adding or changing a part, a challenge or an arena should touch only `packages/content`.

In one line: the app already renders every line content authors (names, labels, spec-card layers, fault lines, goal lines, hint rungs), but it never reads four things content already has (`introduces`, `FailureMode.hint`, `teachingNote`, the arena's props as records), judges what-ifs as if they had a right answer, and fixes in code three things content should decide (the order of a level's challenges, the names of props, the ports a failure is about).

## Part 1. Structural slots (schema, app, validator), then content

### A. Challenge order comes from content

- **Gap.** Content loads in id order, so Home listed the level's assessment first. Task 7.x in PR #4 sorts by kind along the brief's path (part introductions, guided, breakdowns, what-ifs, unscripted build), but within a kind the order is still alphabetical: "Meet the battery pack" before "Meet the caster" before "Meet the DC motor", whereas the teaching order is battery pack, DC motor, large wheel, caster, switch. The content README says so itself: "the order a child meets them in is not authored here".
- **Structure.** `Challenge.order?: number`, optional, additive (task 7.24). Home sorts a level by `order` when present, then by kind, then by id (7.25). The validator warns on two challenges of one level sharing an `order`, and on a level where some challenges have one and others do not.
- **Content fills.** An `order` on all 34 challenges, along the path a child should take (7.26).
- **Done when.** Home lists the authored order in the real content; the unit test covers a level with and without `order`; the content README no longer says the order is not authored.

### B. Props are records, with names

- **Gap.** The arena strip's two props ("Box", "Post", their sizes, grams and whether they move) are copied by hand into `arena-strip.tsx` from `arenas/bump-props.json`; the canvas list view names the post "cylinder" from its shape. A third prop in content would not reach the strip.
- **Structure.** `Prop.name?: Text`, optional (7.24). The strip reads its palette from the bump-props preset's props: name, shape, size, mass, fixed (7.25). The list view says the name when there is one, the shape when not. The spoken description is built from the record's fields.
- **Content fills.** Names for `box` and `post`, and any further prop (7.26).
- **Done when.** `PROP_PALETTE` is gone; the strip and the list view say the same name; a prop added to the preset in a test appears in the strip.

### C. The part introduction is a first meeting, not a guided challenge

- **Gap.** Brief Section 5: "the part appears, the child wires it into a working build, the spec card opens". The app never reads `Challenge.introduces`; a part introduction loads like any other challenge, nothing marks the new part, and the spec card opens only if the child happens to tap it.
- **Structure.** App only, no schema change (7.27): when a challenge with `introduces` opens, the canvas selects the introduced part so its spec card opens (Level 1 layer: name, picture, what it does, speak-it); once the goal is met the card opens on it again, so the meeting ends on the card. The hint ladder is unchanged.
- **Content fills.** Nothing new: `introduces` is already on all 13 part introductions. Content review: the `does` line is what a child meets first, so the thin ones get a second look (see Part 2, item 4).
- **Done when.** A browser test opens "Meet the switch": the card shows the switch on load and again when the goal is met; the list view's live region says the selection.

### D. What-ifs have no right answer

- **Gap.** Brief Sections 4 and 5: a what-if is "a working build and one thing to change, with no right answer". The app judges every what-if with a goal predicate, ticks "Goal met", marks it met on Home, and after two misses offers a hint ladder whose do-it makes the change for the child. The content README took that choice because `goal` is required.
- **Structure.** Keep `goal` (the golden harness and the fixtures need a predicate: "the change was made and the Run ran"). For kind `what-if` the app shows no tick and says no "Goal met"; the goal line stays as the instruction; Home marks a what-if "Tried" once a Run with the change has happened (the record's `goal.met`, which keeps meaning "the change was observed"); the hint button is there on request but never offers itself (7.28). Decision D131 holds the default.
- **Content fills.** A third what-if per level (7.33), written as a change and a thing to watch, never a question (the validator refuses `?`).
- **Done when.** The what-if browser test shows no tick after the change runs, "Tried" on Home, and no auto-offer; guided challenges are unchanged.

### E. Faults teach outside a ladder: the sandbox and the unscripted build

- **Gap.** Brief Section 10, case 2: "after two Runs without change, a hint offers to highlight the part that is missing something". Hints exist only inside a challenge with a ladder, so the sandbox and both unscripted builds say nothing about a fault beyond the spec card's fault line, and only if the child opens the card. Every part record already carries `FailureMode.hint`, a one-line callout in the brief's voice ("The servo is waiting for a signal"), which nothing reads.
- **Structure.** `FailureMode.port?: PortId`, optional: the port a failure is about, when it is about one (7.24). The hint controller gains a second source (7.29): with no ladder for the build's state, after two Runs of the same build (same `runKeyOf`) showing the same fault, the Hint button offers a ladder made from the part's failure mode: pulse the part with its `hint` line, then pulse the port when the mode names one. No ghost wire and no do-it, since the fix is the child's. The button shows in the sandbox only while such a ladder exists.
- **Content fills.** A review of every `hint` line as a drawn callout, and a `port` on each failure mode that is about one port (7.30).
- **Done when.** A sandbox roller with one DC motor unwired: two Runs, the button offers, a press pulses the motor and says its line; the unscripted build gets the same; a challenge with a ladder is unchanged.

### F. Teaching notes reach the adult

- **Gap.** Every failure mode has a `teachingNote` "for adults and reviewers". Nothing renders it, not even the parent view's list of faults fixed.
- **Structure.** The parent progress view shows the teaching note beside each fault seen or fixed (7.31). App only.
- **Content fills.** Nothing new; the notes exist.

### G. Goal lines fit the header

- **Gap.** 16 of 34 goal lines are longer than 70 characters; the five longest (86 to 96) still clip on a tablet held upright after PR #4's header change. No rule limits them.
- **Structure.** A validator rule: `goalLine` at most 80 characters (7.32), reported with the length.
- **Content fills.** Rewrites of the six lines over 80 (7.32).

## Part 2. Content fills with no structural change

1. **A third breakdown per level** (7.33). Five broken blueprints already exist with no challenge on them: `broken-loose-caster`, `broken-short-circuit`, `broken-chassis-on-the-floor`, `broken-servo-without-signal`, `broken-underpowered-pack`. Fourteen failure modes have no whole-robot fixture: caster and wheel `lifted`, switch and bumper switch `across-the-pack`, chassis `top-heavy`, 1-cell pack `short-circuit`, buzzer `reversed` and `low-voltage`, gearbox `loose`, LED `low-voltage`, servo `reversed` and `overload`, small wheel `slipping`.
2. **Safety notes** on the four parts without one: chassis, DC motor, large wheel, small wheel (7.34). Brief Section 13: every card that points at a real kit carries one.
3. **Spec lines** for Level 4 are out of launch scope, except the servo's draw and stall figures that D58 asks for (7.34).
4. **Thin or clashing lines** (7.34): the DC motor's `does` ("Turns electricity into spinning."); the chassis `does` opens with the name, every other part's with a verb; the buzzer's popular-mechanics line says "beeps", next to the banned "beep"; gearbox and large wheel both use a bike for their popular-mechanics image; three challenges say the LED's "plus and minus" where the part's ports are its long and short leg.
5. **Real-world pictures** (`realWorldArt`) are missing on all 14 parts. They wait for the art pipeline (ground rule 12), not for a content worker.

## Part 3. App-only improvements noted, not structured here

- **Level unlocking** (brief Section 5: passing the unscripted build opens the next level). Absent; `START_LEVEL` is a constant and Home is ungated by README decision 4. Task 7.35 is added and parked on decision D132.
- **The chassis at the canvas's centre** for a new build: decision D129, queued in PR #4.
- **Speak-it buttons** on the goal line, hint lines and tray tiles (Section 12: every line of system text). Today only the spec card has one; the rest need the read-aloud option on. Follow-up for the a11y owner.
- **Time in the sandbox** on the parent view reads "Not measured yet"; telemetry keeps no durations.
- **Kind labels, level labels, family and domain labels** stay in app and schema code. They are the brief's own words and change with the brief, not with content.

## Decisions queued

- **D130.** Optional additive fields on Challenge (`order`), Prop (`name`) and FailureMode (`port`) against the schema's v1 freeze. Default: allowed, since the freeze guards the blueprint, the only persisted format, and optional record fields with validators break no stored build.
- **D131.** What-ifs show no tick and no "Goal met"; Home marks them "Tried". Default: yes.
- **D132.** Level unlocking from the unscripted build's pass. Default: stays ungated until answered; 7.35 parked.

## Tasks added

| Task | Model | Carries | Blocked by |
| --- | --- | --- | --- |
| 7.24 | opus | A, B, E: the three optional schema fields, validators, docs | D130 |
| 7.25 | sonnet | A, B in the app and canvas | 7.24 |
| 7.26 | sonnet | A, B in content | 7.24 |
| 7.27 | sonnet | C | 7.25 |
| 7.28 | opus | D | 7.27 |
| 7.29 | opus | E in the app | 7.28 |
| 7.30 | sonnet | E in content | 7.24 |
| 7.31 | sonnet | F | none |
| 7.32 | sonnet | G | 7.26 |
| 7.33 | sonnet | Part 2 item 1 and D's third what-if | 7.28, 7.32 |
| 7.34 | sonnet | Part 2 items 2 to 4 | 7.30, 7.33 |
| 7.35 | sonnet | Level unlocking (parked) | 7.29, D132 |
