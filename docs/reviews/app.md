# Review 6.4 · packages/app

Base: main 69f37ce. Reviewer: task 6.4 sweep.

## Verdict

18 findings: 0 high, 5 medium, 12 low, 1 nit.

Rule 8 is the weak point. There are four medium findings (APP-1 to APP-4) and four low ones (APP-5 to APP-8). Every control has a native touch, pointer and keyboard path in code, but only some of them have a test for each path. Several are proved only with a synthetic `element.click()`, which is none of the three. Rule 7 has one low finding: the data note shows code identifiers to the adult (APP-9). Every string the app itself shows passed the probe.

Rules 1, 3, 4, 5, 9, 10 and 12 hold. Open rule-7 findings: APP-9. Open rule-8 findings: APP-1 to APP-8.

## Commands run

| Command | Result |
| --- | --- |
| `pnpm --filter @servo/app test` (whole package, under load average 40+) | 57 files, 711 passed, 7 failed. Every failure was a timeout: goal.test, readouts.test, and the hints, layout, offline and run-bar browser tests, each taking 35 to 280 s |
| `vitest run` again on those six files alone (3 batches) | All pass: 8, 126, 104 and 20 tests. The 7 failures were load, not defects |
| `pnpm lint` | exit 0 |
| `pnpm --filter @servo/app typecheck` | exit 0 |
| `node scratchpad/strings.mjs grep`: a TypeScript-AST probe over every string literal, template and JSX text in `packages/app/src` (109 files, 1591 strings), checking banned words, praise and `!` | 3 hits, all false positives in `spec-card/README.md`: "unlocked", "unlockLevel", "points at real things" |
| The same probe over `docs/data-note.md`, `index.html`, `parent.html` and `src/perf/perf.html` | 0 hits |
| `node strings.mjs dump`: the 198 sentence-like strings, read by hand | No praise, no exclamation marks, no character names. Every line is a plain fact ("Goal met", "Place a part first.") |
| `grep` of `packages/app/src` for every part, arena and kit id in `packages/content` | No part id. The arena id `'open-floor'` appears at `home.tsx:33` and `index.ts:50` (APP-11) |
| `grep -E "alert\(\|confirm\(\|<dialog\|showModal\|role=\"dialog\"\|modal"` | Two `<dialog>`s: the library overlay and the places picker. Neither shows a failure state |
| `grep` for `level-3-slot`, `unlocked` and `program` | Every Level 3 path goes through `flags['level-3-slot']` (App.tsx:92-129) |
| `grep from '@servo/...'` across app src and test | Only package exports are imported; canvas is imported only as `@servo/canvas`, plus `/testing` in tests |
| `node scratchpad/links.mjs`: every Markdown link and backticked src/test path in the README, docs/ and src/*/README.md | All resolve |
| Two read-only subagent sweeps: a rule-8 control inventory, and every deferred item, each re-checked against the code | Folded into the findings below. Spot-checked: shell.test.tsx:133-137 `tap` is `element.click()`; hints.test.tsx:271 presses do-it with `userEvent.click` only; tray.test.tsx has no Close press for the places list |

## Rules 1-14

1. **Holds.** No part id in src. The Level 3 slot finds the servo motor's angle by its primitive (position actuator, `target`), at `program-view/rules.ts:60-61`. Nit APP-11: an arena id and the prop palette are written into the app.
2. **n/a.** app is not sim-core. The app's `freshSeed` (`run-loop.ts:69`) uses crypto, outside the engine, which is allowed.
3. **Holds.** No port-type rules in app. `'power'`, `'signal'` and `'mechanical'` appear only to draw port icons (`spec-card.tsx:47-49`) and to find mounts for do-it (`ladder.ts:163`).
4. **Holds.** RunLoop restores its snapshot on Stop (`run-loop.ts:302-313`). Every `canvas.apply` from the app is either guarded by `building` or refused by the canvas in Run mode (canvas `interface.ts:137`). Tests: `run-loop.test.ts:146`, `run-bar.test.tsx:231-253`.
5. **Holds.** The store, the autosave journal and share links all carry blueprint documents, validated through schema.
6. **Finding APP-10 (low).** `parent.html:30` imports `../parent/src/page/main.ts`, and the guard test review R-5.2 asked for was never added. Otherwise imports follow the package map, and lint is clean.
7. **Finding APP-9 (low)** for the data note. Every UI string in src passed the probe. "Brain" appears only in code comments and identifiers, as the brief's family name (brief Section 2), so it is not a finding.
8. **Findings APP-1 to APP-8.** Test gaps, one control with no visible name on touch, a VoiceOver path not checked on a device, and the spec card not stepping aside.
9. **Holds.** Failures are status lines (`role="status"`). The two dialogs are the library and the places picker (see Checked and disproved).
10. **Holds.** The flag-gated paths are the angle unlock, ProgramView and `program`. Library drag-to-canvas is not built (`library.tsx:2-4`).
11. **n/a** for a sweep.
12. **Holds.** `tray/picture.tsx` and `spec-card/picture.tsx` draw from the swap registry or the record's colours.
13. **Findings APP-12 to APP-16.** These are defaults from earlier reviews that were accepted but whose follow-up was never built.
14. **Findings APP-17 and APP-18** (doc drift, missing guard test). The README and its links are current.

## Findings

**APP-1 · medium · rule 8 · `packages/app/test/browser/hints.test.tsx:271`**
What: "Do it for me" is the fourth press of the hint button (`hint-button.tsx:66-76`, then `controller.ts:204-231`). It is tested by mouse only. Touch (:255) and Enter (:261-262) are tested only on the earlier rungs. Do-it is the one rung that edits the build, and no test shows it works by touch or keyboard.
Proof: `grep -n "touch(button)\|keyboard('{Enter}')" hints.test.tsx` finds only :255 and :262. Line 271 is `await userEvent.click(button)`.
Proposed fix: FU-APP-1.

**APP-2 · medium · rule 8 · `packages/app/test/browser/challenges.test.tsx:251-300`, `src/challenges/arena-strip.tsx:124-155`**
What: The arena strip has two kinds of button:
- **Props.** Placing a prop is a pointer action: tap-then-tap, or drag with `touch-action: none` (`challenges.css:105-107`). Neither is tested by finger. Tap-tap (:277) and drag (:285) use CDP mouse.
- **Presets.** Tested by mouse only (:257). The aria-disabled case is only DOM-clicked (:198-200).

Proof: `grep -n dispatchTouchEvent challenges.test.tsx` finds only :163-164, which is Home's New build.
Proposed fix: FU-APP-1.

**APP-3 · medium · rule 8 · `packages/app/test/browser/shell.test.tsx:133-137`, `frame.ts:149-150`, `layout.test.ts:290,317,353`, `store.test.tsx:139-517`, `release.test.ts:79-189`**
What: Five sets of controls are pressed only with `element.click()`. That is a synthetic click with `detail: 0`, which is not a touch, a pointer or a keyboard press:
- the edge tabs (`shell/edge-tab.tsx:40`)
- Zoom in, Fit and Zoom out (`zoom-control.tsx:19,22,28`)
- Save (`save.tsx:107`)
- the invite field and its submit button (`invite-gate.tsx:50-74`). The field is filled by setting its value plus an `input` event; no test types into it or presses Enter.

shell.test.tsx's helper is called `tap` but calls `element.click()`, so the test reads as a touch test when it is not.
Proof: `sed -n 133,137p shell.test.tsx` shows `element.click()`. No CDP touch, `userEvent.click` or `userEvent.keyboard` targets these controls.
Proposed fix: FU-APP-1.

**APP-4 · medium · rule 8 · see list**
What: Controls with one or more paths untested:
- No test on any path:
  - places-list Close (`tray/places.tsx:57`)
  - Home's Back to the build (`home.tsx:198`; challenges.test.tsx:131 checks only its text)
  - the For adults link (`App.tsx:111`)
- Only one path tested:
  - Faster (`run-bar.tsx:240`), keyboard only
  - Undo (:254), mouse only
  - Reset arena (:257), touch only
  - Home's open button, mouse only
  - New build, touch only
  - a saved build, keyboard only
  - a challenge, mouse only
  - the Library button, touch only (tray.test.tsx:384)
  - Library Close, mouse only (:481)
  - spec-card Read aloud (`spec-card.tsx:100`), mouse only
  - the name button (`name.tsx:45`), mouse or synthetic only
- Two paths tested:
  - Slower (:222), no keyboard
  - Tidy wires, no keyboard
  - places choices, Enter and synthetic click only (tray.test.tsx:330,350)

Proof: the rule-8 inventory. For example, `grep -n "Close" tray.test.tsx` finds only the Library's Close (:477-480), and `grep -n "RUN_BAR_TEXT.faster\|touch(reset\|userEvent.click(undo" run-bar.test.tsx` shows one path each.
Proposed fix: FU-APP-1.

**APP-5 · low · rule 8 · `packages/app/test/browser/shell.test.tsx:476-492`**
What: The Tidy wires button is tested only against the StandInCanvas. No test drives the real button against the real canvas, and the tools e2e suites touch no app control (R-3.7, line 181).
Proof: `grep -rn -i tidy packages/tools/src/e2e packages/tools/test/e2e*` finds nothing.
Proposed fix: FU-APP-2.

**APP-6 · low · rule 8 · `src/tray/tray.tsx:175-177`, `src/challenges/arena-strip.tsx:104`**
What: The screen-reader path (the places list, or placing a prop at once) is chosen when `event.detail === 0`. That holds for Enter in Chromium. Whether VoiceOver's double-tap on iPadOS gives `detail` 0 has never been checked. If it does not, a VoiceOver user gets tap-then-tap with no list. The same concern is open from R-4.2 #3 and R-4.5 F3. G3.md:20 already records a Safari list-view bug.
Proof: the only tests are Chromium keyboard tests (tray.test.tsx:314; challenges.test.tsx:269).
Proposed fix: FU-APP-3.

**APP-7 · low · rule 8 · `src/shell/shell.tsx:249`**
What: The spec card steps aside only for `dragging || asideAsked`. A tap-then-tap or list-view wire never moves it, so it can cover a port that the touch path needs and the drag path does not (R-4.3 minor 3, R-4.1 #4).
Proof: `grep -rn setSpecCardAside packages/app/src` finds only the definition (shell.tsx:110, :297, context.ts:45-49) and no caller. The canvas's `CanvasEventMap` (canvas `interface.ts:213-228`) has no wire-in-progress event.
Proposed fix: FU-APP-4.

**APP-8 · low · rule 8 · `src/shell/zoom-control.tsx:19-28`, `src/spec-card/spec-card.tsx:100`**
What: Zoom in, Fit, Tidy wires, Zoom out and Read aloud are icon-only. Two of them carry a `title`, a hover tooltip that a finger never shows. Screen readers get an `aria-label`, but a touch user sees no name.
Proof: the only `title=` attributes in src are those two lines. There is no visible text in the buttons.
Proposed fix: FU-APP-5.

**APP-9 · low · rule 7 · `docs/data-note.md:7-10`, `src/telemetry/note.ts:13-16`**
What: The adult's data note shows code identifiers, drawn as `<code>` by parent's `data-note.tsx:9`: `session-start`, `mode`, `runNumber`, `goalMet`, `what`. Its first paragraph also says "four kinds of event" and then lists five purposes, which reads as a mismatch. This is R-6.2 F4, still open.
Proof: `sed -n 7,10p docs/data-note.md`.
Proposed fix: FU-APP-6.

**APP-10 · low · rule 6 · `packages/app/parent.html:30`**
What: `import '../parent/src/page/main.ts'` climbs out of packages/app into parent's `src/`, past its exports. Lint cannot see this because it is in HTML. R-5.2 F2 accepted it for launch on condition of a tools guard test, and that test does not exist.
Proof: `grep -rln "parent/src/page" packages/tools packages/app/test` finds nothing.
Proposed fix: FU-APP-7.

**APP-11 · nit · rule 1 · `src/challenges/home.tsx:33`, `src/index.ts:50`, `src/challenges/arena-strip.tsx:33-45`**
What: The sandbox arena is found by the content id `'open-floor'`, written twice. The prop palette's sizes and weights are written into the app; they should come from the bump-props arena record. Neither is a part, but both are content in code.
Proof: the id grep in Commands run.
Proposed fix: FU-APP-12.

**APP-12 · medium · rule 13 · `src/challenges/goal.ts:171,198-199`**
What: GoalWatch refuses a Run on a shown fault only in breakdowns. So a what-if Run with a battery short-circuit can still count as met. R-4.8 Q1's default was "yes for what-ifs and breakdowns, via a goal-judge follow-up", and that follow-up was never built.
Proof: `this.breakdown = challenge.kind === 'breakdown'`, and `faultShown()` returns false for every other kind.
Proposed fix: FU-APP-8.

**APP-13 · low · rule 13 · `src/challenges/home.tsx:37-38`**
What: Home lists a level's challenges in content order, which is by id. Level 1 therefore opens with `cross-the-arena`, the unscripted build, and Level 2 opens with `drive-and-light` ahead of the `meet-*` introductions. R-4.7 Q4's default was to order by kind, then by id; that was not done.
Proof: `challengesByLevel` only filters; content sorts by id (`content/src/index.ts:218`).
Proposed fix: FU-APP-8.

**APP-14 · low · rule 13 · `src/sound/`**
What: Sound is not hushed when the tab is hidden. A Run left in a hidden tab drones on its held voices. R-4.10 Q3's default was yes, and D104 recommends doing it in this sweep.
Proof: `grep -rn visibilitychange packages/app/src` finds only `shell/save.tsx:88-91`.
Proposed fix: FU-APP-9.

**APP-15 · low · rule 13 · `src/sync/engine.ts:89-91`, `src/sync/changes.ts:271-289`**
What: R-5.5 F1/Q3 and F2/Q4 are both still open.
- An unreachable host sets `offline` and never retries; only `failed` backs off. While the browser believes it is online, recovery waits for an `online` event that never comes.
- A removal change deletes runs and card games without checking whether this device kept the profile.

Both are dormant until a sync host exists (D13).
Proof: the quoted lines.
Proposed fix: FU-APP-10.

**APP-16 · low · rule 13 · `src/sharing/view.tsx:15,97`**
What: The shared-build page gives the canvas `DEFAULT_PREFS`. It never reads the access options, so high contrast, the dyslexia-friendly typeface and the left-handed layout do not apply there. R-5.7 Q2's default was "accept for launch; queue a follow-up", and the follow-up was not queued.
Proof: `grep -n DEFAULT_PREFS src/sharing/view.tsx`.
Proposed fix: FU-APP-11.

**APP-17 · low · rule 14 · `src/release/settings.tsx:3`, `test/browser/release-page.html:9`, `release-page.ts:1`, `src/store/database.ts:69`**
What: Three comments no longer match the code:
- The Settings comment says "The parental gate in front of it is task 5.1's". No gate stands in front of /settings (`release/start.ts:17-24`). The page shows only versions and the access options, which Home also shows, so the code is fine and the comment is wrong.
- Two test comments name `release.test.tsx`; the file is `release.test.ts` (R-6.3 re-review #1).
- `SyncRow`'s JSDoc names only `meta.updatedAt` (R-5.5 F8).

Proof: `sed -n 1,4p src/release/settings.tsx`.
Proposed fix: FU-APP-12.

**APP-18 · low · rule 14 · `packages/app/vite.config.ts:20`**
What: The perf page is safe today:
- It is built only with `--mode perf`, into the tools' cache.
- The release runs plain `pnpm build` (`tools/src/release/cli.ts:72`).
- No route in `main.tsx` or `start.ts` leads to it.

But no test asserts that a release holds no perf page, so a later edit to vite.config.ts could ship it to children.
Proof: `grep -rn "perf.html" packages/*/test` finds nothing.
Proposed fix: FU-APP-7.

## Checked and disproved

- **Rule 9, dialogs.** `library.tsx:107` is the Parts Library overlay (brief Section 9). `places.tsx:46` is the keyboard and screen-reader placement list. Neither reports a failure. "The X has nowhere to go now" (places.tsx:47) is a state line, and the list stays usable with Close and Escape. Run failures are status lines (`run-bar.tsx:217`, `role="status"`).
- **Rule 7, "brain".** There are 24 uses, all in comments and identifiers in program-view and run-loop. "Brain" is the brief's family name (brief Sections 2-3, schema taxonomy `brain`). The banned forms are "brain-y" and "brainy", which do not appear. No UI string contains it.
- **Rule 4, Run edits.** The name, arena, Reset arena, Undo and do-it paths all either check `building` or go through `canvas.apply`, which refuses `edit.locked` in Run mode. Spec-card settings are disabled in Run (`settings.tsx:22,84`).
- **Rule 10, the sandbox kit.** The sandbox uses `kitForLevel(..., START_LEVEL = 1)`. Challenges carry their own level, at most 2 in content. The angle slider below Level 3 appears only with the flag (`App.tsx:123`, `slotSetting`).
- **Rule 6, sim-core access.** app imports `@servo/sim-core` (index), which the package map allows. Canvas's restriction to `/interface` does not apply to app.
- **The test failures.** All 7 pass when their files are re-run alone (Commands run).
- **The perf page reaching a child (R-6.1).** It is not in `pnpm build` output (R-6.1 table; `vite.config.ts:17-21`), and no app route reaches it. Only the missing guard test remains (APP-18).
- **Hover-only reveal.** There are no `:hover` rules, no `@media (hover)` and no mouseenter handlers in src. The only hover dependence is APP-8's tooltips.

## Deferred items from earlier reviews

| Item | Source review | Status now | Finding / evidence |
| --- | --- | --- | --- |
| Hush sound when the tab is hidden | R-4.10 F2, Q3 (D104) | holds | APP-14 |
| Part landing click | R-4.10 Q1 (D104) | holds, as the default (no click): `sound/cues.ts:45-47` clicks only on `connect` | decision still open in D104; no finding |
| StrictMode replay closes the sound sink for good | R-4.10 F3 | holds | `App.tsx:65-66`, `synth.ts:69,127,137`; dormant (no StrictMode in main.tsx) |
| Retry for an unreachable sync host | R-5.5 F1, Q3 | holds | APP-15 |
| Runs and card games of a profile removed elsewhere | R-5.5 F2, Q4 | holds | APP-15 |
| `httpRemote` has no timeout; `base` has no device id | R-5.5 F5-F7 | holds, deferred to D13 | `sync/remotes.ts:63` |
| Home orders challenges by id | R-4.7 Q4 | holds | APP-13 |
| doItCommand treats an already-joined add-wire as a refusal | R-4.7 (a) | fixed | `hints/ladder.ts:178-187,205`; `test/hints/ladder.test.ts:115` |
| Short circuit counts as met in what-ifs | R-4.8 Q1 | holds | APP-12 |
| Data note shows code identifiers | R-6.2 F4 | holds | APP-9 |
| Shared-build page ignores the access options | R-5.7 Q2 | holds | APP-16 |
| Parental gate not in the axe suite | R-5.7 F1 | fixed | `test/browser/a11y.test.tsx:190-208` |
| Chromebook stand-in Run frames over budget | R-6.1 Q2 (D115) | holds; queued for real-device measurement | `docs/perf.md:5,94-95`; no app finding until measured |
| Perf page reachable by a child | R-6.1 | disproved for the release; no guard test | APP-18 |
| Level 2 spec cards scroll in a 308 px card (motor driver 298 px over) | R-4.3 Q1, F4 | holds, as the default (reported, not asserted) | `shell/layout.ts:28,158-173`; `spec-card.test.tsx:287-290`. Not re-measured |
| Open app page ignores a profile switch or removal | R-5.1 F1, Q3 | fixed | `index.ts:129-157` (storage event plus BroadcastChannel) |
| How long the parental gate holds | R-5.1 Q4 | fixed (in parent: closes when the page is hidden) | `parent/src/accounts/view.tsx:78-85` |
| Shared-build replay builds RunLoop without a program | R-6.6 F1, Q2 (D102) | holds, dormant until a microcontroller ships | `sharing/replay.ts:44-51` |
| Servo angle control at Level 1 with the flag on does nothing | R-6.6 F2, Q1 | holds, as the default | README "Feature flags" |
| `midSentence` copied from the canvas | R-6.6 F4 | holds | `program-view.tsx:14`; nit, no new task |
| Spec card does not step aside during tap-then-tap wiring | R-4.3 minor 3, R-4.1 #4 | holds | APP-7 |
| Failure lines keyed by their text | R-4.3 F8 | holds | `spec-card.tsx:119`; folded into FU-APP-12 |
| Bumper switch `closed` readout labelled "Switch" | R-4.3 F6 | holds | `spec-card/readouts.ts:25`; folded into FU-APP-12 |
| Tidy button in ZoomControl, no real-canvas test | R-3.7 finding 4, line 181 | the button exists; the gap holds | APP-5 |
| Runs written elsewhere not seen | R-4.4 low 8 (D31) | holds | `run-bar/record.ts:59,87-93,159`; no new task (D31) |
| GateRun duplicates the loop in tools | R-4.4 low 6 | holds | `tools/src/gate/run.ts:1-7`; tools reviewer's item |
| Stale breakdown fault ladder after do-it | R-4.6 F1 | fixed | `hints/controller.ts:216-221`; `test/hints/controller.test.ts:240` |
| A trigger-less ladder restarts after any edit following its do-it | R-4.6 F2 | holds | `hints/controller.ts:259-262`; folded into FU-APP-8 |
| Challenge link lost on reload or on reopening a saved build | R-4.5 F5, Q3 | holds | `App.tsx:78`; folded into FU-APP-8 |
| Screen-reader path chosen by `detail === 0` | R-4.2 #3, R-4.5 F3 | holds, unverified on a device | APP-6 |
| parent.html reaches into parent's src; no guard | R-5.2 F2 | holds | APP-10 |
| parent.html not behind the tester invite gate | R-5.2 Q4 | holds, as the default | `release/start.ts:17-24`; no finding |
| Test comments name `release.test.tsx` | R-6.3 re-review #1 | holds | APP-17 |

## Proposed follow-up tasks

| Id | Title | Package | Done when | Fixes |
| --- | --- | --- | --- | --- |
| FU-APP-1 | Three-path tests for every app control | app | Every control in the rule-8 inventory has a browser test by CDP touch, by real mouse (`userEvent.click` or CDP mouse) and by keyboard (Enter/Space/arrows): do-it, arena props and presets, edge tabs, zoom, Save, invite form, places Close and choices, Home Back/open/New build/saved/challenge, For adults, Faster/Slower/Undo/Reset arena, Library button/Close, Read aloud, name button, Tidy wires. shell.test's `tap` is replaced by a real touch helper, and no `element.click()` counts as a path. App suite green | APP-1, APP-2, APP-3, APP-4 |
| FU-APP-2 | Tidy wires end to end | tools | A canvas e2e case presses the app's Tidy wires button by touch, pointer and keyboard on the real canvas and gets the routes `tidyWires()` gives | APP-5 |
| FU-APP-3 | VoiceOver check of the list-view path | app (gate checklist) | On an iPad with VoiceOver, double-tapping a tray tile opens the places list and double-tapping an arena prop places it, recorded in docs/gates. If not, the screen-reader path is chosen another way and tested | APP-6 |
| FU-APP-4 | Spec card steps aside during any wire | canvas, app | The canvas emits a wire-in-progress event (interface change noted), the shell steps the card aside for tap-then-tap and list-view wiring, and browser tests show it by touch, pointer and keyboard | APP-7 |
| FU-APP-5 | Visible names on icon buttons | app | Zoom in, Fit, Tidy wires, Zoom out and Read aloud show a visible name without hover (or the decision to keep them icon-only is recorded with Drew), and layout and axe tests stay green | APP-8 |
| FU-APP-6 | Data note in plain words | app, parent (docs) | `docs/data-note.md` and `note.ts` name events and fields in plain words with no code spans, the count of kinds matches the list, and emitters.test and the parent data-note test pass | APP-9 |
| FU-APP-7 | Build guards: parent.html reach and no perf page | tools | A tools test fails when any `packages/app/*.html` or src file reaches outside packages/app except `parent.html` to `packages/parent/src/page/main.ts`, and when `pnpm release:dry` output contains a perf page | APP-10, APP-18 |
| FU-APP-8 | Challenge-runner defaults from R-4.5 to R-4.8 | app | GoalWatch refuses a Run with a battery short-circuit in what-ifs and breakdowns. Home orders each level by kind, then by id. A trigger-less ladder does not restart after do-it. The decision on keeping the challenge link across reload is recorded. Tests for each; `pnpm golden` green | APP-12, APP-13 |
| FU-APP-9 | Hush sound in a hidden tab | app | The sound layer hushes (or suspends the AudioContext) on `visibilitychange` to hidden and restores the held voices on visible, with a test | APP-14 |
| FU-APP-10 | Sync retries and removal guard | app | An unreachable host backs off and retries like `failed`. A removal change deletes runs and card games only for a profile this device keeps. Sync tests cover both (may wait for D13) | APP-15 |
| FU-APP-11 | Shared-build page follows the access options | app | `mountSharedPage` reads the device's AccessStore and passes `canvasPrefsFor` to the canvas and theme, with an a11y browser test | APP-16 |
| FU-APP-12 | App doc and content-in-code tidy | app | settings.tsx:3, the release-page test comments and the `SyncRow` JSDoc match the code. The sandbox arena and the prop palette come from content records rather than literals (or are noted as accepted). Failure lines get stable keys, and the bumper switch's readout label comes from its record. App suite green | APP-11, APP-17 |
