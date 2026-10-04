# Review 6.4 · packages/parent
Base: main 69f37ce. Reviewer: task 6.4 sweep.

## Verdict

11 findings: 1 high, 1 medium, 7 low, 2 nit. One rule-7 finding is open and child-visible (PAR-1): the progress section's card-game count sits on screen just above the card the child is looking at. One rule-8 finding is open (PAR-2): every control is native and every path tried works, but about a dozen control-and-path pairs have no test. The package map, rule 1 and rule 9 hold, and so do most of the earlier deferred items. Several earlier defaults were never applied, and they are listed as low findings.

## Commands run

| Command | Result |
| --- | --- |
| `pnpm --filter @servo/parent test` | 15 files, 194/194 (unit and Chromium), 161 s |
| `pnpm --filter @servo/parent typecheck` | exit 0 |
| `pnpm exec eslint --max-warnings 0 packages/parent` | exit 0 |
| `grep -rnE "from '\|import\(\|import '" packages/parent/src` (excluding relative, react, `@servo/schema`, `@servo/app/store`) | no other import in src, static, dynamic or type. Tests also import `@servo/app`, `@servo/app/goal`, `@servo/content`, `@servo/sim-core` and schema fixtures, which is allowed (eslint.config.js scopes the map to src) |
| grep src for `confirm(`, `alert(`, `prompt(`, `<dialog`, `role="dialog"`, `showModal`, `console.`, `localStorage`, `location`, `history.` | none |
| grep src for banned words (score, points, coins, streak, lives, reward, badge, stars, great, well done, awesome, win, correct, brain, zappy, mascot, congrat, perfect) and for `!` inside string literals | none in any string. Only comments and identifiers (`close`, `point.label`, `mount-point`) match |
| Probe `test/browser/zz-probe-leak.test.tsx` (deleted): a kept round of 7 of 10, then Start a round, then read the bounding boxes at the suite's 1180×820 viewport | the count line "7 of 10 parts named in the card game, 4 Oct 2026." is at top 250 and visible; the card heading is at 391 and the picture at 431–631. The same probe showed that Escape on the remove group keeps the profile and returns focus to "Remove Robin" |
| Probe `test/export/zz-probe-servo.test.ts` (deleted): a servo motor added to the kit-circuit-crew fixture, mounted on the chassis's free mirrored mount point (`gear-right`) | `placeParts` gives `mirrored: true`. The only servo line is "Mount (grey): servo motor to chassis, right gearbox mount", with no real-kit note |
| `git status --short` at the end | only this file and another reviewer's `docs/reviews/schema.md` are untracked; both probes are deleted |

## Rules 1-14

1. Holds. No part id in src. The deck filters on `identity.level`, the export on behaviour fields (`mode: 'speed'`, `whenReversed`, `kind: 'driver'`), port roles and records, and pictures come from art keys. The export tests rename every placed id to show that none reaches the output.
2. Holds (does not apply to this package). The progress model is pure. Seeds come from `crypto.getRandomValues` in the view only.
3. Holds. The export reads `PORT_TYPE_STYLE` and port types from records and duplicates no compatibility rule.
4. Holds. Parent never saves a blueprint: it loads one through the child's scope and writes only profiles, card-game rounds and export events.
5. Holds. Blueprints are read through the store, which migrates them. Parent adds no persisted format.
6. Holds in src (`@servo/schema`, `@servo/app/store` only; lint-rules.test.ts:50, 105). PAR-4: `packages/app/parent.html` still reaches into `packages/parent/src` with no guard.
7. PAR-1 (high, the card-game count is visible to the child). The strings themselves are clean (grep above). PAR-6 and PAR-10 concern copy process and voice.
8. PAR-2 (medium, untested paths). PAR-3 (low, the access options and axe stop at the gate). PAR-11 (nit).
9. Holds. No dialog, alert or confirm. The removal confirm is inline (accounts/view.tsx:353-368), with Keep profile focused and Escape keeping the profile; this is a destructive-action confirm, not a failure state. Failures are one status line each.
10. Holds. The deck takes Level 1–2 records only (deck.ts:11-17). Nothing Level 3+ is built, and parent does not touch the 6.6 servo-angle flag.
11. Holds for the merged tasks; their reviews are on file.
12. Holds. Placeholder pictures are vector rects drawn from record colours and size (picture.tsx:14-38), keyed through `content.art`.
13. PAR-5, PAR-7, PAR-8: earlier defaults that were not applied, or whose premise has moved. They need a decision, not a guess.
14. PAR-9 (nit, README drift). Tests are green and the interface is unchanged.

## Findings

**PAR-1 · high · rule 7, D40 · `packages/parent/src/progress/view.tsx:164-168`, `packages/parent/src/accounts/view.tsx:291-295`, `packages/parent/src/card-game/view.tsx:20`**
What: the progress section ends with "Parts named: n of 10 parts named in the card game, <date>." and is rendered directly above the card game. While the child watches a card, the latest round's count is on the same screen, about 140 px above the card heading. After a round, progress is remounted (`key={current.id rounds}`) and the new count appears above "That is all the cards.". R-5.4 F1 took the count off the game section only. D40 and the section's own intro ("The child sees only the pictures, never a result") say the child never sees a score.
Proof: browser probe at the suite's 1180×820 viewport (an iPad 13" in landscape), with a kept round of 7 of 10. After Start a round, the count line is at top 250 and bottom 268 (visible), the card heading at 391 and the picture at 431–631. The existing test `expectNoVerdict` checks only `section.servo-card-game`, so it cannot see this.
Proposed fix: FU-PAR-1.

**PAR-2 · medium · rule 8 · `packages/parent/test/browser/*.test.tsx`**
What: every control is a native button, radio, checkbox or text field of at least 44 px, so the paths share one handler. Rule 8 still asks for each path to be delivered with a test. These control-and-path pairs have none:
- the gate's Continue (accounts/view.tsx:108-122) by touch;
- Add (:397-413) by touch and by keyboard (Enter in the field);
- rename (:342-352): Rename, Save name and Cancel by touch; Save name and Cancel by pointer;
- remove (:353-368): Remove, Remove profile and Keep profile by keyboard (Enter or Space), and Escape keeping the profile. The probe shows Escape works, but no test asserts it;
- "Include the build's name in links" checkbox (:262-265) by pointer and by touch;
- card game (card-game/view.tsx): Start a round (:141) by touch; Show the name and Hide the name (:223) by touch and keyboard; Stop the round (:237) by touch and keyboard; Play another round (:179) by any path; Try keeping it again (:167) by pointer and touch;
- the parts list's Print (export/view.tsx:214) by touch; Close by touch is covered, but Print was never activated by keyboard (export.test.tsx:212 only focuses it).
Proof: the test inventory (`grep -n "it(\|tap(\|userEvent.click\|keyboard(" test/browser/*.tsx`), checked against each control. Already covered: the switch (pointer, touch, arrows), Copy link (all three), Parts list open and close (all three), and the marks (all three).
Proposed fix: FU-PAR-2.

**PAR-3 · low · rule 8 (accessibility reach) · `packages/app/parent.html:8-31`, `packages/parent/src/` (no read of `servo.access`), `packages/app/test/browser/a11y.test.tsx:190`**
What: the parent view takes none of the accessibility options: high contrast, dyslexia type, read-aloud and left-handed (R-5.7 Q2, accepted for launch by default). The axe suite now covers the gate (R-5.7 F1 fixed), but nothing past it: not the accounts list, progress, an open parts list, a card, or the data note.
Proof: `grep -rn "access\|prefs" packages/parent/src` finds nothing. parent.html has its own inline style with no tokens. a11y.test.tsx:190-200 stops at the "For adults" heading.
Proposed fix: FU-PAR-3.

**PAR-4 · low · rule 6 · `packages/app/parent.html:30`**
What: `import '../parent/src/page/main.ts'` climbs out of packages/app, past parent's `package.json` exports. R-5.2 finding 2 accepted this for launch, provided a tools guard stopped the pattern spreading. No such guard exists.
Proof: `grep -n "parent" packages/tools/test/lint-rules.test.ts` finds only TypeScript probes (lines 50, 69, 75, 105, 106). No test reads app's HTML entries.
Proposed fix: FU-PAR-4.

**PAR-5 · low · rule 13 · `packages/parent/src/export/parts-list.ts:154`**
What: R-5.3 Q2's default (say nothing about a servo motor on a mirrored mount) rested on "no Level 1–2 kit mounts a servo motor there". Circuit Crew (Level 2) has both a servo motor and the chassis, so a child's own build can mount it on a mirrored point. The parts list then prints a plain mount line, and the real servo's arm sweeps the other way to the app's.
Proof: servo probe above. `mirrored: true`, and the only servo line is the mount line. Crossing is gated on `mode === 'speed'`, which a servo motor (`mode: 'position'`) never meets.
Proposed fix: FU-PAR-5 (decision, then a note line if Drew wants one).

**PAR-6 · low · Section 12 voice, rule 13 · `docs/data-note.md:7-10`, rendered by `packages/parent/src/accounts/data-note.tsx:8-9`**
What: the adult-facing data note still shows code identifiers (`session-start`, `runNumber`, `goalMet`, `mode`, `step`, `what`). R-6.2 F4 and Q6 set the default to plain words only, and it was not applied. R-6.2's F5, F7 and F8 are fixed.
Proof: `cat docs/data-note.md`. data-note.tsx renders each code span as `<code>`.
Proposed fix: FU-PAR-6.

**PAR-7 · low · rule 13 · `packages/parent/src/card-game/view.tsx:19-20`**
What: R-5.4 Q2's default for near-twins (2-cell and 1-cell battery pack, large and small wheel) was "the adult accepts the family name, and the intro gets one line saying so". README decision 5 instead leaves it as "the adult's call", and the intro tells the adult nothing.
Proof: `CARD_GAME_TEXT.intro` has no line about family names. README.md:202.
Proposed fix: FU-PAR-5.

**PAR-8 · low · rules 11, 13 · `packages/parent/src/index.ts:45-46`, `packages/parent/src/progress/model.ts:151`, `packages/parent/src/progress/view.tsx:162`, README.md:68**
What: D39 kept "time in the sandbox" absent "until task 6.2's telemetry". 6.2 has landed, but it records only `session-start`, with no end or duration, so the figure still cannot be computed. The interface and README still say "absent until that telemetry exists", which is no longer true, and no decision covers the gap.
Proof: `packages/app/src/telemetry/events.ts:13,45` has only `'session-start': { mode }`. The view still prints "Not measured yet."
Proposed fix: FU-PAR-5.

**PAR-9 · nit · rule 14 · `packages/parent/README.md:3`, `:126`**
What: line 3 says the tests read `@servo/content`, but they also import `@servo/app` (test/browser/app-page.ts:3), `@servo/app/goal` and `@servo/sim-core`. The 5.3 section's description of `PartsListExport` does not mention its `actions` slot (R-5.6 info; the slot is named only under Shared links).
Proof: import grep above. README.md:126.
Proposed fix: FU-PAR-5.

**PAR-10 · low · rule 7 (process), rule 13 · `packages/parent/src/**` text tables**
What: `PARENT_TEXT`, `PROGRESS_TEXT`, `EXPORT_TEXT`, `LIST_TEXT`, `CARD_GAME_TEXT` and `PAGE_TEXT` say they are "for the copy pass", but copy pass 6.5 covered spec cards and hints only. The terminology validator runs on content records, not on these tables. Today's grep finds no banned word, praise or exclamation mark, so nothing is broken, but no line has been read against Section 12 or signed off.
Proof: docs/reviews/copy-pass-6.5.md:1-3 (scope), and no mention of any parent table in it.
Proposed fix: FU-PAR-6.

**PAR-11 · nit · rule 8 · `packages/parent/src/card-game/view.tsx:93-101`**
What: after the tenth mark, the card unmounts and focus falls to `body` during `saving`, until `done` or `failed` moves it (the residue of R-5.4 F2). It is brief on a local store.
Proof: code reading. The effect has no branch for `saving`.
Proposed fix: FU-PAR-2 (focus the status line while saving, with a test).

## Checked and disproved

- **Parent imports past `@servo/app/store`** (static, dynamic or type): none in src (grep). The lint probes at lint-rules.test.ts:50 and :105 prove the rule fires.
- **A dialog for any failure**: none (grep). The inline removal confirm is the only confirm, and it is for a destructive action.
- **A score, verdict or name on the game screen**: none. `expectNoVerdict` passes on every card and on the closing line, the name is `hidden` until shown, and the picture has no `<text>` (R-5.4 checks). PAR-1 concerns the adjacent progress section only.
- **The card picture lacks alt text**: by design. The picture must not give the name away, and an adult using a screen reader gets the name through Show the name (`aria-expanded`, `aria-controls`).
- **The gate holds after the page is hidden** (R-5.1 Q4): `visibilitychange` to hidden closes the view (accounts/view.tsx:80-86). Tested in accounts.test.tsx:105 and card-game.test.tsx:193 (a round under way keeps nothing).
- **Another child's records reachable**: every read goes through `forProfile(current.id)`, and `readProgress` also drops records whose `profile` names someone else (load.ts:24-26). Tested in load.test.ts and accounts model tests.
- **The removal confirm works by keyboard**: Escape keeps the profile and returns focus to Remove (probe). Untested, though; see PAR-2.
- **Ids or child names reach the address or a log**: no `location`, `history` or `console` in src, and the browser tests assert the address and history are unchanged and no id is in the DOM.
- **Duplicate real-kit note keys** (`key={note}`, export/view.tsx:197): two identical notes need two mirrored speed actuators with no mirrored mount point of their own. No Level 1–2 part can do that, since only the chassis has mount points and it is never mounted.

## Deferred items from earlier reviews

| Item | Source review | Status now | Finding id or evidence |
| --- | --- | --- | --- |
| Parent view does not take the accessibility options (Q2) | R-5.7 | holds | PAR-3 |
| Parental gate not in the axe suite (F1) | R-5.7 | fixed for the gate; the view past it is still uncovered | a11y.test.tsx:190; PAR-3 |
| Minor 2: no page mounts the parent view | R-5.1 | fixed | packages/app/parent.html, src/page/main.ts, Home's "For adults" link (D91) |
| Q4: how long the gate holds | R-5.1 | fixed: asked again after the page is hidden | accounts/view.tsx:80-86; accounts.test.tsx:105 |
| Finding 1: an open app page ignores the switch | R-5.1 | fixed | app/src/store/device.ts:71 storage listener; parent test/browser/follow.test.tsx |
| Finding 3: choice not kept leaves no one in use | R-5.1 | fixed | `ChoiceNotKept`, model.ts:41-46, :70-75 |
| Finding 4: kept-copy line reaches another child | R-5.1 | fixed (app) | autosave.ts:287 `note.profile === opening` |
| Finding 5: focus after removal and rename; warning not tied to group | R-5.1 | fixed | view.tsx:146-151, :322-327, :357; accounts.test.tsx asserts all three |
| Finding 6: app opening the chosen profile untested | R-5.1 | fixed in effect | follow.test.tsx drives the real app through a switch |
| Finding 7: NameRefused message for control characters | R-5.1 | holds (accepted nit) | model.ts:35 |
| Finding 2: guard that only parent.html reaches outside packages/app | R-5.2 | holds | PAR-4 |
| Q1, D96: a short Run in between | R-5.2 | holds as the default (keep as built) | model.ts:110; README 5.2 decision 1 |
| Q4: invite gate on parent.html | R-5.2 | holds, open | main.ts:13 opens the store with no invite gate; README 5.2 decision 6 |
| Note 3, D39: time in sandbox | R-5.2 | holds, now stale | PAR-8 |
| Q2: servo motor on a mirrored mount, export line | R-5.3 | holds; reachable in Circuit Crew | PAR-5 |
| Findings 1, 2, 3: crossing wording, motor-driver Backward, `placeParts` | R-5.3 | fixed | LIST_TEXT.alreadyCrossed; parts-list.ts:169-176; :120 |
| Finding 4: templates outside the text table | R-5.3 | fixed | all in `LIST_TEXT` |
| Finding 5: print leaves blank pages | R-5.3 | fixed | PRINT_CSS uses `display: none`; export.test.tsx:237 |
| Q4: real motor polarity | R-5.3 | holds, open until the real kit is chosen | LIST_TEXT.polarity |
| F1: result shown on the game screen | R-5.4 | fixed on the game section; holds next to it | PAR-1 |
| F2: focus on failure | R-5.4 | fixed for `failed`; `saving` still drops focus | card-game.test.tsx:213; PAR-11 |
| F3: Play another round discards an unkept round | R-5.4 | fixed | no Play another round in `failed`; test asserts it |
| F4: hidden page keeps nothing, untested | R-5.4 | fixed | card-game.test.tsx:193 |
| F5: `canPlay` reshuffles | R-5.4 | fixed | view.tsx:131 `deckParts(content).length > 0` |
| Q2: near-twins, family name counts, intro line | R-5.4 | holds, default not applied | PAR-7 |
| Q1, Q4, Q5: kit parts, timer, partial rounds | R-5.4 | holds as defaults | README 5.4 decisions 1, 2, 4 |
| Finding 2 and Q4: runs of a profile removed elsewhere | R-5.5 | holds on the parent side as designed: shown under no one | load.ts:24-26; load.test.ts. The sync-side removal rule is app's |
| Info: README 5.3 omits the `actions` slot | R-5.6 | holds | PAR-9 |
| Finding 3: share intro overstated | R-5.6 | fixed | PARENT_TEXT.shareIntro |
| F4 and Q6: data note shows code identifiers | R-6.2 | holds | PAR-6 |
| F5, F7, F8: data-note wording | R-6.2 | fixed | docs/data-note.md:3, :10, :20 |

## Proposed follow-up tasks

| id | title | package | done-when | fixes findings |
| --- | --- | --- | --- | --- |
| FU-PAR-1 | Keep the card-game count off the child's screen | parent | While a round is playing, saving, failed or done, no card-game count or "parts named" text is in the viewport. For example, the progress section's Parts named line sits behind an adult "Show" disclosure, or the round takes the view on its own. A browser test asserts this at 1180×820 and 820×1180 with a kept round. Any new control has pointer, touch and keyboard tests. README updated | PAR-1 |
| FU-PAR-2 | Finish the rule-8 path tests in the parent view | parent | Each control listed in PAR-2 has a pointer, a CDP touch and a keyboard test, including Escape and Enter on the removal group and Play another round. Focus moves to the status line during `saving`, with a test. Tests green | PAR-2, PAR-11 |
| FU-PAR-3 | Parent page takes the access options; axe past the gate | app, parent | parent.html applies the stored `servo.access` options (contrast, type, left-handed; read-aloud as Drew decides). The axe suite checks the parent view past the gate (accounts, progress, an open parts list, a card shown, the data note) with the options off and all on. a11y checklist row added | PAR-3 |
| FU-PAR-4 | Guard the app's HTML entries | tools | A tools test reads `packages/app/*.html` and fails on any module import that leaves packages/app, other than `../parent/src/page/main.ts` from parent.html. A probe entry proves it fires | PAR-4 |
| FU-PAR-5 | Queue the parent's open defaults and bring the README up to date | parent (orchestrator for decisions) | Decisions queued with `pharao.py decision add`: servo motor on a mirrored mount (PAR-5), the near-twins intro line (PAR-7), and time in the sandbox now that 6.2 records no duration (PAR-8). The answered defaults are applied with unit tests: a note line, an intro line, and the interface comment and README. The README's dependency line and the 5.3 `actions` slot are corrected | PAR-5, PAR-7, PAR-8, PAR-9 |
| FU-PAR-6 | Copy pass for the parent view and data note | parent, app, docs | Every line of `PARENT_TEXT`, `PROGRESS_TEXT`, `EXPORT_TEXT`, `LIST_TEXT`, `CARD_GAME_TEXT` and `PAGE_TEXT` is read against Section 12 in a copy-pass table for Drew's sign-off. The data note uses plain words, with no code identifiers shown, and the identifiers move to a test-only mapping (R-6.2 Q6 default), with the copy-sync test updated. A test runs the terminology lists over the parent text tables | PAR-6, PAR-10 |
