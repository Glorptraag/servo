# Review 6.4 · packages/content
Base: main 69f37ce. Reviewer: task 6.4 sweep.

## Verdict

9 findings: 0 high, 1 medium, 6 low, 2 nit. The content as shipped is clean on rule 7: 494 unique strings in parts, kits, arenas and challenges, with 0 exclamation marks, 0 question marks, 0 "Level" words and 0 banned words, and every one of the 104 hint ladders keeps the rule 9 order. The 3 rule 7 findings (CON-1 to CON-3) are gaps in the guard rather than in the text. The validator lets through a character name in prose, reward words such as "star" and "trophy", rhetorical questions and "Level 3" product words. The medium finding (CON-4) is R-4.8 Q1, still open: a what-if or guided Run with a battery short circuit counts as met. There are no rule 8 findings, because content has no controls.

## Commands run

| Command | Result |
| --- | --- |
| `pnpm validate-content packages/content --terminology packages/content/terminology` | 109 records, no issues |
| `pnpm --filter @servo/content test` | 7 files, 311/311 passed |
| `pnpm --filter @servo/content typecheck` | exit 0 |
| `pnpm exec eslint packages/content` | exit 0, no output |
| `pnpm golden` | 109 Runs match; 102 content fixture expects hold |
| scratchpad `dump.mjs`: every string value in parts, kits, arenas and challenges | 730 strings, 494 unique, read in full |
| scratchpad `check.mjs`: grep the strings for `?`, `!`, `\blevel\b`, reward and praise words; count hint full stops; measure card text per part | 0 `?`, 0 `!`, 0 "level"; one false hit ("just as hard"); 0 of 399 hint lines end in a full stop |
| scratchpad `ladders.mjs`: each ladder's step sequence and do-it change kinds | 104 ladders, all in the order pulse-part > pulse-port > ghost-wire > do-it, each rung at most once; see Checked and disproved for the skips |
| Validator probe 1 (scratchpad `probe/`, outside the repo): a part with "Great job: Sparky the buzzer…", "Does it work?", "You unlock this at Level 3.", "Buzzy says…", "…a star…a trophy…a reward"; a part named `Sparky` with "Great job!"; a challenge titled "Level 2: meet Buzzy" with "Can you make the buzzer sound?" and "Great job!"; a challenge with a reversed ladder | 9 issues caught: both `!`, every "great job" and "well done", `not_real_name` for `Sparky`, and `hint.bad_order`. **Not caught:** "Sparky the buzzer", "Buzzy", "meet Buzzy", both questions, "Level 3", "Level 2", star, trophy, reward |
| Validator probe 2 (scratchpad `probe2/`): kit named "Sparky and friends, great job!", arena "Win coins here", port label "my power in", setting "Earn a star", option "Awesome" | 6 issues caught (`!`, great job, coins, my, Earn, Awesome). **Not caught:** "Sparky", "Win", "star" |
| `grep -rn "unlockLevel"` in parts, app, canvas | Level 3 settings gated (see rule 10) |
| `grep` of the goals and hint triggers across all 34 challenges | No goal guards against `short-circuit`; no ladder triggers on `short-circuit` or `across-the-pack` |
| `git status --short` at the end | No file of mine besides this report; the probes lived in the scratchpad |

## Rules 1-14

1. Holds. `src/index.ts` is kind-generic and names no part. `src/fixtures.ts` names part ids only as `FIXTURES` data inside content. Adding a part means adding a file here and its fixtures.
2. Not applicable: content holds no simulation code. `pnpm golden` shows 109 Runs match.
3. Holds. `src/fixtures.ts` uses the schema's `planWire`, and content keeps no port-type rule of its own.
4. Not applicable.
5. Holds. Fixture blueprints are bare, versioned blueprints and pass `validateBlueprint` in validate-content.
6. Holds. The README and the `.` and `./fixtures` exports match the code. The only `@servo/content/fixtures` import from another package's `src` is `packages/app/src/perf/perf-page.ts`, a dev page (see Checked and disproved).
7. The content holds (0 banned words, `!`, `?` or "Level"). The guard has gaps: CON-1, CON-2, CON-3.
8. Not applicable: content has no controls. Every ladder ends in a do-it rung, which the list view relies on.
9. The order holds in all 104 ladders. Open items: CON-4 (a short circuit can count as met) and CON-5 (no short-circuit ladder).
10. Holds. The DC motor's `speed`, the LED's `colour` and the servo motor's `angle` all carry `unlockLevel: 3`. `packages/app/src/spec-card/model.ts:91` and `packages/canvas/src/list-view/actions.ts:136` filter on it, and the 6.6 slot unlocks only the angle. No Level 3 kit, challenge or part exists.
11. Holds. Reviews are attached for 2.1–2.6, 4.7, 4.8 and 6.5.
12. Holds. All 14 parts have `identity.art: "part/<id>"`. `art/final/` holds only `.gitkeep`, and `art/generated/` is gitignored and written by `pnpm art`. Key coverage is tested in `packages/tools/test/swap-registry.test.ts:240` and `packages/content/test/loaders.test.ts:91`.
13. Stale records: CON-6, CON-7, CON-8. Card length is still an open question: CON-9.
14. Holds. The validator, tests, typecheck and lint are all green, and the README matches the layout and the loaders.

## Findings

**CON-1 · low · rule 7 · `packages/tools/src/validate-content/terminology.ts:229`**
What: Only a part's `identity.name` is checked for character names (`not_real_name`, `proper_name`). A mascot name inside any other system-text field passes: a card line, a hint, a teaching note, a challenge title, a goal line, a kit or arena name, a blueprint name. Ground rule 7 bans "mascot or character names for parts" everywhere, not only in the name field.
Proof: probe 1 passed "Great job: Sparky the buzzer buzzes when power flows." (flagged only for "Great job"), the hint "Buzzy says the wires are swapped" (no issue) and the title "Level 2: meet Buzzy" (no issue). Probe 2 passed the kit name "Sparky and friends, great job!" for "Sparky".
Proposed fix: FU-CON-1.

**CON-2 · low · rule 7 · `packages/content/terminology/banned.json:1`**
What: The banned list has points, coins, badges, streaks and lives, but no other reward words: `star`/`stars`, `trophy`, `reward`/`rewards`, `prize`, `medal`, `win`/`won`/`winner`, `confetti`. Brief Section 8 names confetti, coins and badges, and the 6.4 brief names "stars as reward".
Proof: probe 1 passed "Here is a star for you, and a trophy, and a reward." (flagged only for "Well done"). Probe 2 passed "Win" in "Win coins here" and "star" in "Earn a star" (flagged only for coins and Earn).
Proposed fix: FU-CON-1.

**CON-3 · low · rule 7 · `packages/tools/src/validate-content/terminology.ts:148`**
What: Brief Section 12 says system text "never asks a rhetorical question". Product words such as "Level 2" or "unlock" are not for a child's card either (R-6.5 F4). Neither is checked, so the F4 leak was caught only by a human reader.
Proof: probe 1 passed "Gives: a buzz. Does it work?", "Can you make the buzzer sound?", "You unlock this at Level 3." and "Level 2: meet Buzzy". The content itself has no `?` and no "level" today (`check.mjs`).
Proposed fix: FU-CON-1.

**CON-4 · medium · rule 9 · `packages/content/challenges/level-2/what-if-one-cell.json:6`**
What: R-4.8 Q1 is still open. What-if and guided goals are motion predicates only: `what-if-one-cell` needs forward speed between 60 and 220. `packages/app/src/challenges/goal.ts:106` refuses named faults only for breakdowns. So a Run whose battery pack shows `short-circuit` can be reported as met, and the child is told a faulty circuit did the job. R-4.8 showed exactly this (`judgeRun` gave `met: true` with `battery short-circuit`). The F1 ladder fix keeps a hint from building the short, but a child can still build it by hand.
Proof: none of the 34 goals contains a `short-circuit` term (`grep` of every goal). The goal is unchanged since R-4.8, because d558c91 touched only ladders. No `short-circuit` handling appears in `packages/app/src` or `packages/sim-core/src`. There is no Drew ruling in `docs/decisions.md`.
Proposed fix: FU-CON-2.

**CON-5 · low · rule 9 · `packages/content/challenges/level-1/meet-the-switch.json:46`**
What: R-4.7 R3 still holds. No ladder in any challenge triggers on a battery pack's `short-circuit` or on the switch's or bumper switch's `across-the-pack`. A child who wires the switch across the pack in `meet-the-switch` (or in any switch or bumper-switch challenge) gets a hint button with no ladder that applies.
Proof: the triggers in `meet-the-switch` are `unwired`, `unwired` and `fault:outside-loop`. Across all 34 challenges the fault triggers are only `loose`, `no-circuit`, `outside-loop`, `reversed`, `low-voltage`, `not-driven` and `overload` (trigger listing).
Proposed fix: FU-CON-2.

**CON-6 · low · rule 13 · `docs/gates/G2.md:121`**
What: R-6.5 F3 still holds. Gate G2, the record Drew is asked to sign, still shows the cards as they were before the copy pass. Line 121 has the servo motor note "no Level 2 part gives one" and the hint "The servo is waiting for a signal". Lines 209–221 have the motor driver's "two motors", "its motors" and "the fault is the driver's".
Proof: `grep -n "two motors\|its motors\|no Level 2 part" docs/gates/G2.md` matches lines 121, 209, 211 and 219–221. The content has the new text (7644e58).
Proposed fix: FU-CON-3.

**CON-7 · low · rule 13 · `.claude/plans/status.json:2123` (decision D112)**
What: The queued copy-pass sign-off says "servo example line kept as the brief wrote it". The content reads "This servo motor is waiting for a signal", and `docs/reviews/copy-pass-6.5.md:69` (Q1) gives the default as keeping the change, not the brief's wording. Drew would be signing off a description that is the reverse of what shipped.
Proof: `sed -n 2123p .claude/plans/status.json`, and the `failureModes[0].hint` of `packages/content/parts/level-2/servo-motor.json`.
Proposed fix: FU-CON-3.

**CON-8 · nit · rule 13 · `packages/content/test/fixtures.test.ts:766`**
What: R-2.6 N1 still holds. The comment says the most front-heavy build is the one with a caster (30.9 mm, tipping from 49.7°). R-2.6 measured the same load without a caster as more front-heavy: 34.2 mm, about 48°. The conclusion does not change.
Proof: lines 766–768 and the assertion at line 810 are unchanged (`[30.9, 18, 27.2, 49.7]`).
Proposed fix: FU-CON-4.

**CON-9 · nit · rule 13 (R-4.3 Q1, open) · `packages/content/parts/level-2/motor-driver.json:53`**
What: Card length, measured for the 4.3 aim to fit "without scrolling where possible". The motor driver's Level 1 `does` line is 100 characters, the longest of the 14 parts (the DC motor's is 32). The 6.5 fix ("DC motors") made it longer, after 4.3 had already found the motor driver card 278 px over its panel.

| Part | Level 2 card text (characters) | Ports | Level 2 settings (options) | 4.3 overflow |
| --- | --- | --- | --- | --- |
| motor driver | 395 | 9 | 2 (6) | 278 px |
| 1-cell battery pack | 386 | 3 | 0 | 56 px |
| caster | 377 | 1 | 0 | 36 px |
| bumper switch | 368 | 3 | 0 | 56 px |
| gearbox | 365 | 3 | 0 | 76 px |
| chassis | 278 | 11 | 0 | 125 px |
| DC motor | 182 | 4 | 1 (2) | 53 px |

Rows, ports and settings drive the overflow more than prose does (compare the chassis and the motor driver). Text trims would win back at most about one line per card.
Proof: `check.mjs` card measurement; the overflow figures are from `docs/reviews/tasks/4.3.md:61-73`.
Proposed fix: FU-CON-4, optional, once Drew answers R-4.3 Q1.

## Checked and disproved

- **Ghost-wire rung skipped where a single wire would show.** Five ladders end in a single add-wire with no ghost wire: `push-the-heavy-box` #9, #10 and #13, and `weak-battery-pack` #2 and #3. In every one, one end of the wire is a part not yet placed (`{"part": "gearbox"}`, or `{"part": "battery-pack-2-cell"}` after the swap), so there is nothing to draw a ghost to. That is a D25 skip (`docs/reviews/tasks/4.8.md:42`). `spin-on-the-spot` (pulse-part > do-it) changes a setting, which has no port. All other skips are multi-wire moves or removals.
- **R-6.5 F1, F2, F4 and F5.** Fixed in 7644e58. The motor driver says "DC motors" on every line. The servo motor's note ends "and nothing in this kit gives one yet". `one-motor-backwards` hint 2 ends "minus back to the battery pack's minus". The "the driver's" quote is gone from `packages/sim-core/src`.
- **Short forms in teaching notes** ("the motor turns slowly", "one motor wired the other way round"). These come after "A DC motor" in the same note. The validator README classes `motor` and `servo` as short forms of real names, and brief Section 12 itself writes "This motor has power in…".
- **What-if titles** ("What if one wheel comes off" and three others). They have no question mark, and they are real prompts the child answers by Running the build, not rhetorical questions. Brief Section 5 names the kind "What-if".
- **Kit names.** "Circuit Crew" is D5's placeholder, kept by default (`docs/decisions.md:11`). It is a kit name, not a part's.
- **The fixtures entry reaching the app.** `packages/app/src/perf/perf-page.ts` is the 6.1 perf page, built beside the web build and never into it (its header comment).
- **Canvas copies of part text** (`packages/canvas/test/fixtures/busy-workbench.json`, `circuit-crew.json`). 7644e58 updated them, and `packages/tools/test/canvas-fixture-copies.test.ts` keeps them equal to the records.
- **Terminology against CLAUDE.md.** Every "Use" component name is in `components.json`, with `chassis` glossed `frame`. Every "Never" item is banned: mascot(s), character(s), brain-y bit, zappy wire, robot voice as `I`/`me`/`my`/`myself`, points, coins, streaks, lives, great job. Extras are `gripper`, `breadboard`, `mount point` and the `brain` gloss, which are documented in the validator README with brief sources. Product terms (blueprint, kit, challenge, arena and so on) are not component names, so they are not listed, as designed.
- **The validator's claimed coverage.** `!` and banned words are caught in every field the README lists: part name, port, setting and option labels, card fields, hint, cardLine, teachingNote, challenge title, goal line and hint lines, kit and arena names (probes 1 and 2). Ladder order is caught (`hint.bad_order`).
- **The content registry test is vacuous in CI's `check` job** (it passes when `art/generated` is missing). This is covered anyway: `packages/tools/test/swap-registry.test.ts:240` runs the generator over content's parts.
- **R-2.6 minor 3.** Fixed. `reverseOf` (`packages/content/test/fixtures.test.ts:479`) reads the placed part's Direction setting.

## Deferred items from earlier reviews

| Item | Source review | Status now | Finding id or evidence |
| --- | --- | --- | --- |
| F1 motor driver "DC motors" and "motors" mixed | R-6.5 | fixed | 7644e58; every line says "DC motors" |
| F2 "the fault is the driver's" in sim-core | R-6.5 | fixed | no match in `packages/sim-core/src` |
| F3 G2 shows pre-copy-pass card text | R-6.5 | holds | CON-6 |
| F4 servo note leaks "Level 2" | R-6.5 | fixed | "nothing in this kit gives one yet" |
| F5 one-motor-backwards "minus back to minus" | R-6.5 | fixed | now "the battery pack's minus" |
| F6 sign-off tables | R-6.5 | fixed | copy-pass-6.5.md rewritten in full; queued as D112, whose wording is wrong (CON-7) |
| Q1 servo hint wording | R-6.5 | open, default kept | CON-7 (D112 misstates it) |
| Q4 LED "legs" and "plus and minus" | R-6.5 | open, default kept | port label "plus (+), long leg"; hints use both; in D112 |
| R3 meet-the-switch short with no ladder | R-4.7 | holds | CON-5 |
| Q4 challenge order (Home lists by id) | R-4.7 | holds; app side | content has `kind` on every challenge and no order field. `packages/app/src/challenges/home.tsx:37` keeps content (id) order, so `cross-the-arena` comes first at Level 1. No content change is needed: this is for the app review |
| Q1 short circuit can count as met | R-4.8 | holds | CON-4 |
| F3 `heavy-box-direct-drive` has no goal expect | R-4.8 | fixed | `src/fixtures.ts:812-815`: `challenge: 'push-the-heavy-box'`, `goal: { met: false }` |
| minor 3 `turning` reads `reverse` from the record | R-2.6 | fixed | `fixtures.test.ts:479` `reverseOf` |
| N1 front-heavy comment | R-2.6 | holds | CON-8 |
| 0.6 DC motor shaft not at its drive-out; driver chip hidden | R-0.6 | out of package | The art is drawn by `packages/tools/src/placeholder-art/forms.ts`, and content holds only the keys and colours. For the tools review |
| Level 2 cards scroll in the 308 px panel | R-4.3 Q1 | open, default (scroll) | CON-9: longest texts are the motor driver, 1-cell battery pack, caster, bumper switch and gearbox |

## Proposed follow-up tasks

| Id | Title | Package | Done-when | Fixes findings |
| --- | --- | --- | --- | --- |
| FU-CON-1 | Close the voice gaps in the content validator | tools, content (terminology) | (a) `banned.json` adds star(s), trophy, reward(s), prize, medal, win/won/winner and confetti, with reasons. (b) The validator flags a question mark in any system-text field (`text.question`), and the words `level` and `unlock` in part and challenge system text (allow-list kept for adult-facing fields if any). (c) A capitalised word that is neither sentence-initial nor a listed term is flagged in every system-text field (`terminology.proper_name`), not only `identity.name`. (d) Each new check has a test in `packages/tools/test/validate-content*.test.ts` that reuses probes 1 and 2 from this review, and `pnpm validate-content packages/content` stays clean | CON-1, CON-2, CON-3 |
| FU-CON-2 | Short circuits never count as met, and have a ladder | content (and app if Drew rules for the judge) | Drew rules on R-4.8 Q1 through `pharao.py decision add`. Then either every what-if and guided goal adds `not` a battery `short-circuit` fault, or `GoalWatch` refuses a `short-circuit` Run for every kind. A fixture per level shows a shorted build with `goal.met: false`. Each challenge with a switch or bumper switch gets a ladder on `across-the-pack` or `short-circuit` (pulse the part, pulse the port, do-it removes the wire across the pack). The hint-ladder walk tests climb it | CON-4, CON-5 |
| FU-CON-3 | Bring the G2 gate record and D112 in line with the shipped copy | docs, orchestrator | `docs/gates/G2.md` card tables match the part records at main, or carry a dated note pointing to copy-pass-6.5.md. D112's text says the servo hint was changed to "This servo motor is waiting for a signal" (the R-6.5 Q1 default), corrected by the orchestrator through `pharao.py` | CON-6, CON-7 |
| FU-CON-4 | Content tidy: front-heavy comment and the longest card lines | content | `fixtures.test.ts:766-768` names the caster-free build (34.2 mm, about 48°), or says "with the caster". After Drew answers R-4.3 Q1, the motor driver `does` line, and if wanted the 1-cell battery pack, caster, bumper switch and gearbox lines, are trimmed and re-signed, with `pnpm golden --accept` for the part-hash lines | CON-8, CON-9 |
