# Review 6.4 · packages/tools
Base: main 69f37ce. Reviewer: task 6.4 sweep.

## Verdict

16 findings: 0 high, 3 medium, 9 low, 4 nit. There are open rule-7 findings: TLS-1 and TLS-2 (medium) and TLS-3 (low). The validator misses exclamation marks and character names in authored blueprint names, and the banned list has gaps for reward words, robot sounds and celebratory symbols. There is one open rule-8 finding: TLS-4 (medium). The e2e parity harness compares touch, pointer and list view byte for byte only for placing, mounting, wiring and a refused drop. Everything else holds: the tools suite (1717 tests), lint, typecheck, `pnpm golden` and `pnpm validate-content` are all green.

## Commands run

| Command | Result |
| --- | --- |
| `pnpm --filter @servo/tools test` | 27 files, 1717 of 1717 passed (625 s, load around 16 to 30) |
| `pnpm --filter @servo/tools typecheck` | clean |
| `pnpm lint` | clean, `--max-warnings 0` |
| `pnpm golden` | 109 Runs match their golden files; 102 content fixture expects hold |
| `pnpm validate-content packages/content --terminology packages/content/terminology` | 109 records, no issues |
| `pnpm validate-content <scratchpad>/probe` (23 throwaway records outside the repo, made by a scratch script from real content records with one injected string each) | 5 issues. 18 of the 23 injected strings passed: see TLS-1 and TLS-2 |
| Scratch script that lists every string-valued JSON path in packages/content, grouped by kind | Every child-visible field is in `systemText`. Everything outside it is an id, enum, colour, unit or timestamp |
| `grep` for `@servo/tools` / `packages/tools` in app, canvas, parent, content, schema, sim-core | Only comments, docs and golden-file headers. No import |
| `grep` of the step kinds in `src/e2e/plan.ts`, and of the edit kinds in `canvas/src/interface.ts` | The parity plan has 4 step kinds; the canvas has 17 edit kinds (TLS-4) |
| `grep` for `alert(`, `confirm(`, `<dialog`, `showModal` in tools src | none |
| `grep` for `heading=360` in `packages/sim-core/golden` | Present, for example twice in kit-circuit-crew.golden (TLS-14) |

No probe file was put in the repo. The scratch records lived in the session scratchpad.

## Rules 1-14

1. Holds. `formOf` picks a placeholder form from behaviour primitive kinds only (`placeholder-art/forms.ts:41-58`). Gate robots and trays come from content records. The perf harness's `data-part="motor-driver"` is a dev-only measurement selector (TLS-15 is about its comment).
2. Holds, as support. Goldens compare whole files as text (`golden-runs/cli.ts:171-174`), with a full sha256 of the run record and a sha256 of each tick's events. The determinism test compares `canonicalJson` of the whole record, events included, on fresh and restored Simulations in turn.
3. Holds. `gate/robots.ts` uses the schema's `checkPortPair` and `socketOf`. Tools have no type rules of their own.
4. Holds. GateRun's Stop restores tick 0, and the determinism test alternates `restore(start)` with fresh Simulations. The duplication is TLS-11.
5. Holds. Tools persist no blueprint. Goldens hash `canonicalJson` of the blueprint.
6. Runtime holds: nothing imports tools. Findings TLS-5 and TLS-6 (missing guard tests).
7. Findings TLS-1, TLS-2 and TLS-3. Tools' own CLI strings and the gate page's lines have no exclamation marks and no praise.
8. Finding TLS-4.
9. Holds. The gate page reports faults in a status line (`gate/page.ts:105-125`), and tools src has no dialog.
10. Holds. Tools hold no Level 3 feature. The gate page picks Level 1 fixtures only.
11. Not assessable from the tree. Every task review exists in docs/reviews/tasks.
12. Holds. Tiles are vector paths in shades of `identity.colours`, sized from `body.size`, and keyed through `registry.json`. `art/final/` holds only `.gitkeep`. Fidelity gaps are TLS-9; the missing `realWorldArt` keys are TLS-10.
13. Holds. D32 is queued (unresolved), and the validator README lists its conservative readings.
14. Mostly holds: the READMEs match the code. Drift: TLS-7 (golden churn on copy edits), TLS-13, TLS-15.

## Findings

**TLS-1 · medium · rule 7 · `packages/tools/src/validate-content/system-text.ts:56`**
What: Authored blueprint names get the banned list only. These are content fixtures' `meta.name` and a challenge's `start.meta.name`, which the README says "children see". The schema does not read `Blueprint.meta.name` as `Text`, so the schema's `text.exclamation` check never runs on it. The proper-name rule runs only on a part's `identity.name` (`validate.ts:146`). So an exclamation mark or a character name in a challenge's starting robot name passes.
Proof: These records were checked with `pnpm validate-content <scratchpad>/probe`:
- `challenges/probe-ch-name.json` with `start.meta.name: "Super robot!"`
- `blueprints/probe-bp-excl.json` with `meta.name: "Zoom robot!"`
- `blueprints/probe-bp-char.json` with `meta.name: "Sparky the robot"`

All three gave no issue. The same run reported `text.exclamation` for `"plus!"` in a port label.
Proposed fix: FU-TLS-1.

**TLS-2 · medium · rule 7 · `packages/content/terminology/banned.json` (checked by `packages/tools/src/validate-content/terminology.ts`)**
What: The banned list covers points, coins, streaks, lives and over 30 praise phrases. It misses these game-reward and robot-voice words:
- `reward(s)`, `star(s)`, `trophy`, `prize`, `unlock(ed)`, `win`/`winner`;
- singular `point` and `life` (only the plurals are listed);
- the robot sounds `beep` and `boop`;
- the spaced form `woo hoo`.

Celebratory symbols also pass in `Text` fields: an emoji such as 🎉 and the interrobang ‽. Content uses none of these today (a grep of parts, challenges, kits, arenas and fixtures found only `mount point`, which is a real name and so stays allowed).
Proof: Each of these probe records gave no issue:
- card lines: "wins you a reward", "three stars", "1 point", "Beep boop, turning the shaft", "Woo hoo the shaft turns", "Turns the shaft 🎉", "Turns the shaft‽";
- a cardLine: "you lose a life";
- a teaching note: "win the trophy";
- a hint: "unlock the next level";
- a challenge title: "Win a star";
- a kit name: "Prize kit";
- an arena name: "Trophy room".

The challenge hint "Nearly there, you earn a reward" was flagged for `earn` only.
Proposed fix: FU-TLS-2.

**TLS-3 · low · rule 7 · `packages/tools/src/validate-content/` (scope)**
What: The terminology lists are applied to content records only. UI copy written in code is never checked against `banned.json`: aria-labels, notices, status lines, the list view's lines, Settings and the parent page. Each package's voice tests carry their own short lists instead, for example `packages/app/test/a11y/prefs.test.ts:131` and `packages/canvas/test/list-view/model.test.ts:162`. Only `packages/parent/test/export/parts-list.test.ts:43` reads the real list. A banned word added to `banned.json` therefore never reaches UI copy.
Proof: `grep -rln "banned.json\|loadTerminology\|terminology" packages/*/src packages/*/test` finds the list used only in tools' validator tests, content's loader tests and parent's parts-list test.
Proposed fix: FU-TLS-3.

**TLS-4 · medium · rule 8 · `packages/tools/src/e2e/plan.ts:32-58`, `packages/tools/src/e2e/README.md` ("The parity check")**
What: The harness's byte-identical parity check runs commands, touch drag, touch tap-then-tap, pointer drag, pointer click-click and the list view. It does so for four step kinds only:
- `place` (loose, and attached by mount or hub);
- `connect`;
- `refuse` (an impossible drop);
- `setting`, which goes through `apply` on the touch and pointer paths, not through a hand.

Twelve canvas actions are never compared across the three paths: `move-part`, `rotate-part`, `remove-part`, `disconnect`, `unmount`, `place-prop`, `move-prop`, `remove-prop`, `rename`, `tidy-wires`, `set-arena` and selection. Nor is a switch flip in Run mode (`control`). The canvas and app tests exercise each of these by touch somewhere (grep counts 1 to 14 files each). But no test proves the three paths give the same blueprint bytes for them. The tools README's "parity check that touch, pointer and list view give byte-identical blueprints" reads wider than it is.
Proof: The step-kind union in `plan.ts` (`'place' | 'setting' | 'connect' | 'refuse'`) set against the 17 `EditCommand` kinds in `packages/canvas/src/interface.ts:312-461`. The README's own line: "A setting goes through `apply` on the touch and pointer paths".
Proposed fix: FU-TLS-4.

**TLS-5 · low · rule 6 (lint list) · `packages/tools/test/lint-rules.test.ts`**
What: CLAUDE.md's "Lint and tsc catch" list includes "No enums or namespaces" (CLAUDE.md:89). No test proves that this check fires. It is enforced by tsc's `erasableSyntaxOnly` (`tsconfig.base.json:14`), not by ESLint. Every other rule in the list has at least one firing case:
- package map: 43 bypass cases;
- `.ts` imports: 4 tests;
- `src/` staying inside `src/`;
- purity: 15 expressions plus destructuring;
- `eslint-disable` having no effect.
Proof: `grep -rln "erasableSyntaxOnly\|enum " packages/*/test` finds nothing.
Proposed fix: FU-TLS-5.

**TLS-6 · low · rule 6 · `packages/app/parent.html:30` (guard belongs in tools)**
What: R-5.2 finding 2 asked for a tools test proving that only `packages/app/parent.html` reaches outside packages/app, and only to `packages/parent/src/page/main.ts`. Its default was "accept for launch, and add the guard test". The guard was never written. Lint cannot see HTML, so a second such entry would pass.
Proof: `grep -rn "\.\./parent/src\|outside packages/app" packages/app/test packages/tools/test` finds nothing.
Proposed fix: FU-TLS-5.

**TLS-7 · low · rule 14 / process · `packages/tools/src/golden-runs/run.ts:82`**
What: Each part used is hashed whole, with `sha256(canonicalJson(part))`. That covers spec-card text, hints, teaching notes and labels, none of which a Run reads. Task 6.5's copy pass therefore changed 98 golden files that differ only in `part <id> <hash>` lines, and needed a blanket `--accept`. This is R-1.7 finding 2 and R-6.5 Q3, whose default is "yes, in 6.4".
Proof: Code reading, `parts: partTypes.map(... sha256(canonicalJson(golden.catalogue.parts.get(id))) ...)`. Also docs/reviews/copy-pass-6.5.md, "Hash-only proof": 98 of 98 changed files differ only in part-hash lines.
Proposed fix: FU-TLS-6.

**TLS-8 · low · R-6.1 / rule 14 · `packages/tools/src/release/web.ts:57`**
What: The perf page stays out of a release only because the app's `vite.config.ts` adds `src/perf/perf.html` under `--mode perf`, and `pnpm build` uses production mode. The release's `checkWeb` refuses a build that lacks the versions or leaks a code. It does not refuse dev-only pages (`perf.html`, `src/perf/`), and no test asserts that a release's `web/` lacks them. A config change could ship the perf page to children with every check green. The G3 gate page is safe: only tools' own Vite config serves it.
Proof: `grep -n perf packages/tools/src/release/*.ts packages/tools/test/release-*.test.ts packages/app/test/browser/release.test.ts` finds nothing. `packages/app/vite.config.ts:20` holds the mode gate.
Proposed fix: FU-TLS-5.

**TLS-9 · low · rule 12 · `packages/tools/src/placeholder-art/forms.ts:138`, `:174`**
What: These are R-0.6 findings 1 and 2, and both still hold against the real content records:
- `motor-can` draws the shaft at the end of the can's longest axis. Content's DC motor (`parts/level-1/dc-motor.json`, size 64 × 22 × 20) puts its `shaft` drive-out on the side, at (21, 13, 10) with axis `+y`. So the canvas's shaft socket sits away from the drawn shaft.
- `circuit-board` draws the header strips at the full board height `z`. On content's motor driver (30 × 22 × 12) the near strip hides the chip.

The R-0.6 Q2 default was "(a) tiles place shafts from the record's drive ports, once task 2.1 authors the real DC motor". Task 2.1 has landed.
Proof: `node -e` printed the content DC motor's body and mechanical ports. The forms code at the lines cited.
Proposed fix: FU-TLS-7.

**TLS-10 · low · rule 12 / D32 · `packages/tools/src/placeholder-art/cli.ts:107`**
What: The registry still resolves `identity.art` only. A `card.realWorldArt` key, which the schema calls a swap-registry key, is never tracked, and a photo dropped into `final/` for one is reported as "Not used". D32 is unresolved. Its default is "track realWorldArt keys with no placeholder", as a small tools follow-up. No content part has a `realWorldArt` key yet, so nothing fails today.
Proof: `status.json` holds D32 with `resolved: false`. The string-path listing of content shows no `card.realWorldArt`.
Proposed fix: FU-TLS-7.

**TLS-11 · low · rule 4 support / R-4.4 low 6 · `packages/tools/src/gate/run.ts:31`**
What: `GateRun` is still a second copy of the app's run loop: spin-up, 30 ticks a second, at most 4 steps a frame, and snapshot and restore. `@servo/app` does not export `RunLoop`; its exports are `.`, `./store`, `./goal`, `./hint-ladder` and `./invite-code`. A change to the app's loop, such as task 6.1's readout throttle, does not reach the G3 page.
Proof: The `exports` field of `packages/app/package.json`; the header comment of `gate/run.ts`.
Proposed fix: FU-TLS-8.

**TLS-12 · nit · `packages/tools/src/placeholder-art/cli.ts:53`**
What: This is R-0.6 finding 5. `show()` makes paths relative to `process.cwd()`, not to the `cwd` that `runArt` takes. Messages in tests therefore print absolute paths.
Proof: The line cited.
Proposed fix: FU-TLS-7.

**TLS-13 · nit · `packages/tools/test/golden-cli.test.ts:217`**
What: This is R-1.7 finding 6. The comment "Past three cases, the hint names none." sits above the assertion that names three cases. The no-names case is at :223-226.
Proof: `sed -n 210,232p`.
Proposed fix: FU-TLS-6.

**TLS-14 · low · readability · `packages/tools/src/golden-runs/summary.ts:41`**
What: This is R-1.7 finding 4. `formatNumber` does not wrap a heading that rounds to 360 back to 0. So `heading=360` stays in the goldens, and a tiny sign flip would diff as `0 → 360`, which reads as a full turn.
Proof: `grep -c "heading=360" packages/sim-core/golden/content/kit-circuit-crew.golden` gives 2; at least 3 more golden files have it.
Proposed fix: FU-TLS-6.

**TLS-15 · nit · rule 14 · `packages/tools/src/perf/main.ts:187`**
What: The comment says "The spec card of the build's microcontroller", but `selectPart` (:218-220) opens the motor driver's card ("Select motor driver 2").
Proof: The lines cited.
Proposed fix: FU-TLS-8.

**TLS-16 · nit · process · `.github/workflows/ci.yml`**
What: `pnpm gate:g3:test`, which builds and runs the Rolling Start robot on the G3 page by mouse, is in no CI job. The dev page can rot without notice before G6 testers use it.
Proof: `grep -n gate .github/workflows/ci.yml` finds only a comment about strict parity.
Proposed fix: FU-TLS-8.

## Checked and disproved

- **Tools at runtime (rule 6).** Every reference in app, canvas, parent, content, schema and sim-core is a comment, a doc or a golden-file header. Lint's package map forbids importing tools: lint-rules.test.ts allows tools to import parent, and nothing to import tools.
- **Part ids in tools src (rule 1).** A grep for part ids in tools src finds only placeholder forms keyed on primitive kinds (`forms.ts:41-52`), comments and examples in docs, and the perf harness's dev-only `motor-driver` selector.
- **Child-visible content fields left out of the validator.** I listed every string path in packages/content. Every child-visible field is in `systemText`:
  - part: name, port labels, setting and option labels, failure-mode lines, card lines;
  - arena and kit: `name`;
  - challenge: `title`, `goalLine`, every hint ladder's `steps[].line`, `start.meta.name`;
  - blueprint: `meta.name`.

  The rest are ids, enums, colours, units (`%`, `°`) and timestamps. The canvas's fixture copies equal content record for record (`canvas-fixture-copies.test.ts`), so they are covered transitively.
- **Exclamation and praise variants.** The validator catches all of these: `"plus!"`, the full-width `！`, the inverted `¡` and `GREAT-JOB` (probe records).
- **Golden comparison is byte for byte.** `cli.ts:171-174` compares the stored file and the new text as strings, after normalising CRLF only. Rounding cannot hide a change: each tick line carries a sha256 prefix of `canonicalJson(frame.events)`, and the file carries the full sha256 of the run record. `formatNumber` uses `toFixed`, which the language specification defines, so it gives the same text in every JavaScript engine. R-1.7's mutation M6 (currents × (1 + 1e-9)) was caught by this hash.
- **The determinism test compares the full record.** `canonicalJson(record)` includes `events`, which the recorder keeps by default (`sim-core/src/recorder/index.ts:44`). Runs alternate between fresh Simulations and `restore(start)`.
- **The perf page in a release build.** It is not built: `packages/app/vite.config.ts:20` adds it only for `--mode perf`, and `perf:app` builds into its own `--outDir`. The G3 page is served only by `src/gate/vite.config.ts`. (Unguarded: TLS-8.)
- **R-0.1 lint follow-ups.** N1 and N2 are closed and have firing tests (lint-rules.test.ts, the "Re-review findings N1-N3" block). N3 is closed, with its residual climbing template accepted and listed in CLAUDE.md. N4 is accepted. N5 is closed.
- **Exclamation marks in tools' own CLI text.** A grep for a letter followed by `!` in string literals in tools src finds none.

## Deferred items from earlier reviews

| Item | Source review | Status now | Finding id or evidence |
| --- | --- | --- | --- |
| DC motor shaft drawn away from its drive-out | 0.6 F1, Q2 | holds | TLS-9 |
| Motor driver chip hidden by header strips | 0.6 F2 | holds | TLS-9 |
| `card.realWorldArt` keys not in the registry | 0.6 F3, D32 | holds (D32 unresolved) | TLS-10 |
| README says `resolveArt` throws, while the 0.4 interface returns undefined | 0.6 F4 | fixed | `placeholder-art/README.md:53` now separates content's `undefined` from tools' throwing `resolveArt` |
| `show()` uses `process.cwd` | 0.6 F5 | holds | TLS-12 |
| No tools root README | 0.6 F6 | fixed | `packages/tools/README.md` |
| Flows missing from goldens | 1.7 F1 | fixed | `summarizeFlows`, `wire:<id>` subjects (D78) |
| Whole-record part hash churns goldens | 1.7 F2, 6.5 Q3, copy-pass-6.5 | holds | TLS-7 |
| `pnpm check` lacks `pnpm golden` | 1.7 F3 | holds, documented | CLAUDE.md "How to run" says CI's check job adds golden; no finding |
| `heading=360` not wrapped | 1.7 F4 | holds | TLS-14 |
| "expect DOES NOT HOLD:" wording | 1.7 F5 | fixed | `expect.ts:15` `shows` is what the Run shows; mismatches print separately |
| golden-cli.test.ts comment misplaced | 1.7 F6 | holds | TLS-13 |
| `GateRun` duplicates RunLoop | 4.4 low 6 | holds | TLS-11 |
| Guard that only parent.html leaves packages/app | 5.2 F2, Q2 | holds | TLS-6 |
| Perf page not reachable by a child | 6.1 | holds, unguarded | not built in production (`vite.config.ts:20`); TLS-8 |
| Chromebook stand-in Run p95 over budget | 6.1 Q2 | holds (decision open) | sim-core and app scope, not tools code; docs/perf.md states it |
| `release.test.tsx` named in two comments | 6.3 (b9a8cb9) F1 | holds | in packages/app (`test/browser/release-page.html:9`, `release-page.ts:1`), for the app review |
| Withdrawing one invite code; gated build on a tablet without https | 6.3 questions | open with Drew | no tools change until answered |
| Lint N1-N5 | 0.1 re-review | fixed or accepted | lint-rules.test.ts N1-N3 block; residual listed in CLAUDE.md |

## Proposed follow-up tasks

| Id | Title | Package | Done-when | Fixes findings |
| --- | --- | --- | --- | --- |
| FU-TLS-1 | Hold authored blueprint names to system-text rules | tools | Content blueprints' `meta.name` and challenges' `start.meta.name` are refused for exclamation marks (`text.exclamation` or a tools code) and for a stray capitalised word (`terminology.proper_name`); the three TLS-1 probe records each give an issue; content still validates clean; validator README updated | TLS-1 |
| FU-TLS-2 | Close banned-list gaps and refuse celebratory symbols | content, tools | `banned.json` adds reward(s), star(s), trophy, prize, unlock(ed), win, winner, point, life, beep, boop and `woo hoo` with reasons, keeping `mount point` allowed through the real name. The validator refuses emoji and `‽` in system text with a named code. Each TLS-2 probe string gives an issue; `validate-content-lists.test.ts` covers the new entries; content validates clean | TLS-2 |
| FU-TLS-3 | Check UI copy against the terminology lists | tools | A tools test collects the user-visible string literals and JSX text in app, canvas and parent src (aria-labels, notices, status and list-view lines) and runs them through `banned.json` and the exclamation rule. It fails on a planted banned word and passes on main | TLS-3 |
| FU-TLS-4 | Extend e2e parity to every canvas edit | tools (canvas testing entry if needed) | Parity plans and paths cover move-part, rotate-part, remove-part, disconnect, unmount, the prop edits, rename, tidy-wires, set-arena, a setting by hand and a Run-mode switch flip. Each fixture reports identical across touch, pointer and list view under `SERVO_PARITY_STRICT=1`; README lists the covered actions | TLS-4 |
| FU-TLS-5 | Guard tests for build structure | tools | (a) A tsc-backed test proves an `enum` and a `namespace` in a package fail typecheck. (b) A test proves `packages/app/parent.html` is the only file under packages/app that reaches outside it, and only to `packages/parent/src/page/main.ts`. (c) `checkWeb` refuses `perf.html` or `src/perf/` in a release's web build, with a release test | TLS-5, TLS-6, TLS-8 |
| FU-TLS-6 | Golden hash on what the Run reads | tools | A part's golden hash covers only the fields sim-core reads (body, ports less labels, behaviour, needs, failure-mode ids and needs, settings less labels). A card or hint text edit leaves `pnpm golden` green, with a test. Headings that round to 360 are written as 0. The golden-cli comment is moved. One `--accept` with an orchestrator note | TLS-7, TLS-13, TLS-14 |
| FU-TLS-7 | Placeholder art fidelity and photo keys | tools | `motor-can` draws its shaft at the record's drive-out port; motor driver strips are short enough to show the chip; `realWorldArt` keys are tracked with no placeholder per D32's default (or D32 ruled otherwise); `show()` uses the given cwd. Snapshots and the canvas art copy are refreshed | TLS-9, TLS-10, TLS-12 |
| FU-TLS-8 | Gate page on the app's run loop, in CI | app, tools | `@servo/app` exports its run loop through a tools-only entry agreed against the package map; `GateRun` is deleted in favour of it; `pnpm gate:g3:test` runs in a CI job; the perf/main.ts comment names the motor driver | TLS-11, TLS-15, TLS-16 |
