# Review 6.4 · packages/sim-core
Base: main 69f37ce. Reviewer: task 6.4 sweep.

## Verdict

8 findings: 0 high, 0 medium, 7 low, 1 nit. No rule-7 or rule-8 finding is open. sim-core has no UI, and it emits no text a child sees: only failure-mode ids, sound ids and readout values that come from the records. Rules 1, 2, 3, 4 and 5 hold under probe. Every one of 103 content fixtures, deep-frozen, gives the same record as an unfrozen Run, a reordered blueprint and a restored Run, and 109 goldens match. What is left is stale docs, one undocumented replay rule, a warm-up gap, duplicated helpers, and the queued bumper re-close (D79).

## Commands run

| Command | Result |
| --- | --- |
| `pnpm --filter @servo/sim-core test` | 10 files, 345 tests passed (25.8 s) |
| `pnpm --filter @servo/sim-core typecheck` | exit 0 |
| `npx eslint --max-warnings 0 packages/sim-core` | exit 0 |
| `pnpm golden` | 109 Runs match their golden files; all 102 content fixtures' `expect` hold |
| Probe `packages/tools/test/zz-probe-simcore.test.ts` (deleted afterwards) | over all 103 content fixtures: a deep-frozen blueprint and arena give a record byte-identical to an unfrozen Run's; tick-0 snapshot bytes are equal; after `restore(start)` the frame's events, live and flows equal tick 0's, `snapshot()` bytes equal the original, and a replay gives the identical record; the caller's blueprint is unchanged; parts and wires reversed give a byte-identical record; a twin Simulation accepts the snapshot (103/103) |
| Same probe, trailing input | `switch-in-the-line`, 30 steps, then a flip: the record has `inputs [{tick:30,…}]` and `ticks 30`; replayed by the usual step loop, the record has `inputs []` |
| Same probe, busy-workbench | 8 controls (4 switches, 4 channels). Plain ticks take 0.7–0.8 ms; the first tick after each manual flip takes 4.0, 12.4 and 5.9 ms |
| `grep` over src for clocks, randomness, globals, `Intl`, `Reflect`, `Function`, `Math.sin/cos/tan/atan2/exp/log/pow/hypot`, `**`, `localeCompare` | none in code. The single `Math.sin` hit is in a comment (`mechanical/maths.ts:5`). Maths used: `sqrt`, `SQRT2`, `PI`, `abs`, `min`, `max`, `sign`, `floor`, `ceil`, `imul` |
| `grep` over src for quoted part ids and kind branches | no part id. Every branch is on a primitive kind, port kind or control kind from the schema |
| `grep` over canvas, parent and app for `@servo/sim-core` imports | canvas imports only `@servo/sim-core/interface`, always as `import type`. `interface.ts` has only type imports and exports |
| `npx vitest run test/sim-determinism.test.ts` in packages/tools (the default run, not the 100x sweep) | 111 tests passed (103 s): every content fixture and schema blueprint replays byte for byte 10 times, three of them 100 times |

## Rules 1-14

1. Holds. No part id in src. Solvers branch only on primitive kinds (`source`, `actuator`, `wheel`, …). Constants are generic physics (TOUCH_MM, GRAVITY, SUBSTEPS). A servo's `target` is never read (`behaviour/primitives.ts:66`).
2. Holds. Lint and grep are clean, Rapier's profiler is off (`mechanical/world.ts:53`), ids are sorted in code-unit order (`graph/build.ts:84,183`), and the blueprint is canonicalised before the graph is built (`loop/setup.ts:85`). Probe: reordering is byte-identical, and goldens match. SIM-2 is a cost gap, not a determinism one.
3. Holds. Wire kinds come from the schema's `checkPortPair` (`graph/build.ts:117`). No type rule is restated.
4. Holds. A deep-frozen blueprint runs (103/103), the caller's object is unchanged, and Stop's restore is byte-exact. SIM-3 is the replay rule beside it.
5. Holds. sim-core persists nothing but its versioned snapshot (`loop/snapshot.ts:25`, `mechanical/snapshot.ts:11`).
6. SIM-1, SIM-8. The canvas uses only the interface, and it is types only. The README's public surface matches `src/index.ts` and `package.json` exports. The restore comment is stale, and the README is not one page.
7. Holds. sim-core emits ids only (failure modes from records, `RUN_SOUNDS`, value keys). Error messages are developer-facing, and the app shows none of them (grep of packages/app/src for `SimulationSetupError` and `.message`: none). "brain" appears only in type names and comments.
8. Not applicable: no controls in sim-core.
9. SIM-7. Failures are fault events and simulated behaviour; sim-core shows nothing else. The bumper re-close is a false flash of behaviour.
10. Holds. The program slot and block-rule runtime are task 1.6's named scope, are internal (not exported), and run only when the app passes a `program`. Task 6.6 changed no sim-core file, and the servo angle reaches a Run only as a signal level from that runtime.
11. Holds. Nothing to check in this package beyond merged history.
12. Not applicable.
13. SIM-6. The block-rule vocabulary is still presented as Level 3's (R-1.6 minor 1). The loop.md questions are queued (D75–D79).
14. SIM-1, SIM-3, SIM-5, SIM-6. Docs are stale in four places. Tests are present and green.

## Findings

**SIM-1 · low · rule 6 / 14 · `packages/sim-core/src/interface.ts:95-96`**
What: `restore` says it "Throws when the snapshot came from another Simulation". It throws only when the fingerprint differs (`loop/simulation.ts:114`). A twin made from the same blueprint, records, arena and seed accepts the snapshot (loop.md decision 2). The interface comment was never updated, and the change was never noted as an interface change (R-1.5 minor 2).
Proof: probe, with a twin `createSimulation` from the same inputs. `twin.restore(start)` succeeded for 103/103 content fixtures.
Proposed fix: FU-SIM-1.

**SIM-2 · low · rule 2 (review N14 warm-up) · `packages/sim-core/src/loop/warm.ts:17`**
What: the warm-up skips any build with more than 6 controls, and it counts motor-driver channels, though it varies only the switches. `busy-workbench` (Level 2 parts, 4 switches and 4 channels) is never warmed, so the first flip of each manual switch searches inside a tick. The comments "none at Levels 1–2" (`warm.ts:12`) and "A Level 1–2 kit has at most 4" (`docs/loop.md:79`, `src/graph/live.ts:8`) are wrong for that fixture (R-1.5 minor 1).
Proof: probe on busy-workbench. `controlsOf` gives 8 controls. Plain ticks take 0.7–0.8 ms; the first tick after the flips of bench-switch, lamp-switch and switch takes 4.0, 12.4 and 5.9 ms. R-1.5 measured 20–146 ms under load.
Proposed fix: FU-SIM-2.

**SIM-3 · low · rule 4 (replay) / 14 · `packages/sim-core/docs/runs.md:28`, `README.md:42`**
What: an input made after the last step is recorded at `tick = ticks`. This is what happens when a child flips a switch and presses Stop before the next step. A replay that applies inputs before each step, up to `ticks`, drops that input, so its record differs. sim-core's docs claim "a run record replays exactly" and state no replay rule. The tools golden runner throws on such a case, but the app's shared-build replay has no written rule to follow (R-1.5 minor 3).
Proof: probe. `switch-in-the-line`: 30 steps, then `input(...)` returns true; the record has `inputs [{"tick":30,…}]` and `ticks 30`; the replayed record has `inputs []`.
Proposed fix: FU-SIM-1 (document the rule: apply inputs at `tick = ticks` after the last step, or have `record` leave them out, which is a decision for Drew).

**SIM-4 · low · rule 1 (one rule, one place) / 14 · `packages/sim-core/src/electrical/primitives.ts:16-32,74-83`, `src/behaviour/params.ts:10-54`, `src/behaviour/primitives.ts:37-46`**
What: the setting binding exists twice (`settingValue` in electrical/primitives.ts, and the private `settingValue`/`withParam` in behaviour/params.ts), and so does the speed rule (`steadyRpm` and `speedRule`). The two disagree in small ways: params.ts drops non-finite values, while `speedSettings` clamps without a finite check. `steadyRpm` is now called only from tests (`test/electrical*.test.ts`), so it is dead code in src exported through `electrical/index.ts:7`. R-1.3 left "keep one" to 1.5, and R-1.5 minor 4 found nothing merged. That still holds.
Proof: `grep -rn "steadyRpm\|settingValue\|speedRule" packages/sim-core/src packages/sim-core/test`.
Proposed fix: FU-SIM-3.

**SIM-5 · low · rule 14 · `packages/sim-core/docs/electrical.md:90`**
What: R-6.5 F2 is fixed in code. `src/electrical/needs.ts:93` now quotes "the fault is in the motor driver" (commit 2ab7d2c), matching `packages/content/parts/level-2/motor-driver.json:69`. But electrical.md:90 still says the record reads "the fault is the driver's". (The schema's example record `packages/schema/fixtures/parts/motor-driver.json:67,77` still says that too, which is the schema reviewer's to judge.)
Proof: `grep -rn "fault is the driver" packages/sim-core`, which hits only docs/electrical.md:90.
Proposed fix: FU-SIM-1.

**SIM-6 · low · rules 13 and 10, 14 · `packages/sim-core/README.md:45-48`, `docs/program.md:25`, `test/program.test.ts:377`**
What: R-1.6's program-slot doc points are still open.
- README:48 calls the seed vocabulary "Level 3's block rules", and README:47 lists "held levels" as Level 3's state. program.md:128 and types.ts:83 correctly say it is a seed that Level 3 owns (brief Section 15, sub-draft 6). (R-1.6 minor 1)
- program.md:25 says a motor driver on a brain's output "follows it in the same tick". loop.md:44 correctly says a signal-driven channel reaches the electrical solver a tick late. (R-1.6 minor 2)
- README:45 and `interface.ts:184` say a brain runs "at or above its onVolts". The shared rule is `volts > 0 && volts >= onVolts` (`behaviour/primitives.ts:103`), so a record with `onVolts` 0 is off at 0 V. (R-1.6 minor 5)
- The test comment says "When in 1 reads", but the rule reads `in-2`. (R-1.6 minor 6)
Proof: `grep -n` on each line cited.
Proposed fix: FU-SIM-1.

**SIM-7 · low · rule 9 · `packages/sim-core/src/mechanical/tick.ts` (contact switch state), golden `kit-circuit-crew.golden`**
What: the Circuit Crew kit robot's bumper switch opens at tick 169, closes again at tick 172 and opens for good at 173. For 1/30 s the LED lights, the buzzer sounds and the DC motors turn, which shows the child behaviour the build does not have. There is no release margin on the contact. D79 accepted this for G1 and recommends a sim-core follow-up, but none was ever queued as a task. The other 8 bumper goldens open once and stay open.
Proof: `awk '/^tick/{t=$2} /bumper.*closed/{print FILENAME" "t": "$NF}' packages/sim-core/golden/content/kit-circuit-crew.golden` prints `0: closed=true`, `169: closed=false`, `172: closed=true`, `173: closed=false`.
Proposed fix: FU-SIM-4 (after D79).

**SIM-8 · nit · rule 6 · `packages/sim-core/README.md`**
What: rule 6 asks for a one-page README. This one is 1,400 words, and its program-slot bullets repeat program.md (R-1.6 minor 3).
Proof: `wc -w packages/sim-core/README.md` gives 1400.
Proposed fix: FU-SIM-1.

## Checked and disproved

- **Part ids or part-specific behaviour in src (rule 1).** A grep for every Level 1–2 part id in quotes finds none. Branches on `'switch'` and `'wheel'` are control kinds and primitive kinds from the schema. Physics constants are generic.
- **Non-deterministic maths across engines (rule 2).** No transcendental `Math` call or `**` in src. Angles go through the schema's `cosSin`, and `atanDegrees` is arithmetic (`mechanical/maths.ts`). Rapier is the deterministic compat build. R-1.4 confirmed identical hashes in V8 and JavaScriptCore, and 109 goldens still match.
- **Order depending on insertion (rule 2).** Graph ids and wires are sorted, and the blueprint is canonicalised before the graph is built. `Object.keys` iterations are sorted (`program/rules.ts:13`, `recorder/changes.ts:30`) or run over objects whose key order the code fixes (snapshot.ts:18-20). Probe: reversed parts and wires give byte-identical records on 103/103 fixtures.
- **Run writes back to the blueprint (rule 4).** The deep-frozen probe raised no TypeError on 103 fixtures, and the caller's JSON is unchanged. `simulation.blueprint` is a frozen canonical copy (`loop/setup.ts:85`).
- **Stop does not restore exactly (rule 4).** After `restore(start)` the snapshot bytes are equal, the frame is equal, and the replayed record is byte-identical (103/103).
- **Canvas bypasses the interface (rule 6).** Every canvas import is `import type … from '@servo/sim-core/interface'`. `packages/parent/test/progress/runs.ts` imports `@servo/sim-core` in a test only, which is the parent reviewer's to judge.
- **User-visible strings from sim-core (rule 7).** Fault events carry failure-mode ids from records, and sound events carry `RUN_SOUNDS` ids. Thrown messages (`loop/setup.ts:13`, `loop/simulation.ts:62,114`) are for developers, and no app code shows them. No banned word or exclamation mark appears in src strings.
- **Level 3 servo angle outside the flagged slot (rule 10, R-6.6).** sim-core never reads `target`. A servo moves only on a signal level, and only a passed `ProgramRuntime` drives one. With no runtime, every brain is the no-op (D41). 6.6 touched no sim-core file.
- **No golden exercises a wheel slip (R-1.7 note 3).** Fixed. `push-the-heavy-box-into-the-wall.golden` has `squeal` and the `slipping` fault, and `meet-the-small-wheel-start` and `meet-the-gearbox-one-wheel` have `squeal`.
- **Flows not in goldens (R-1.7 finding 1, D78).** Fixed. Goldens now carry `wire:<id>` subjects (for example `bumper-stops-at-wall.golden:19`).
- **runs.md does not link program.md (R-1.6 minor 4).** Fixed: `docs/runs.md:61`.
- **loop.md decisions not in the queue (R-1.5 minor 5).** Fixed: D75–D79.

## Deferred items from earlier reviews

| Item | Source review | Status now | Finding id or evidence |
| --- | --- | --- | --- |
| Warm-up counts driver channels, busy-workbench not warmed | R-1.5 minor 1 | holds | SIM-2 |
| `restore` comment versus twin snapshots | R-1.5 minor 2 | holds | SIM-1 |
| Trailing input at tick = ticks dropped on replay; replay rule undocumented | R-1.5 minor 3 | holds | SIM-3 |
| Speed rule and setting binding duplicated | R-1.5 minor 4, R-1.3 note | holds | SIM-4 |
| loop.md decisions not in the queue | R-1.5 minor 5 | fixed | D75–D79 queued |
| `needs.ts:93` quotes "the fault is the driver's" | R-6.5 F2, copy-pass-6.5 | fixed in code; the doc copy holds | needs.ts:93 now matches the card (2ab7d2c); SIM-5 for docs/electrical.md:90 |
| Bumper switch release margin | R-1.7 Q2, D79, R-1.4 N3 | holds | SIM-7 (re-close at tick 172) |
| No golden exercises a wheel slip | R-1.7 note 3 | fixed | push-the-heavy-box-into-the-wall.golden |
| Block-rule vocabulary called Level 3's | R-1.6 minor 1 | holds | SIM-6 |
| program.md:25 motor driver "same tick" | R-1.6 minor 2 | holds | SIM-6 |
| README program section too long | R-1.6 minor 3 | holds | SIM-8 |
| runs.md "documents the slot further here" without a link | R-1.6 minor 4 | fixed | runs.md:61 links program.md |
| `onVolts` 0 rule versus "at or above" | R-1.6 minor 5 | holds | SIM-6 |
| test comment "in 1" versus `in-2` | R-1.6 minor 6 | holds | SIM-6 |
| Level 3 servo angle confined to the flag | R-6.6 | holds (confined) | see Checked and disproved |
| README does not link docs/graph.md; plan contract `buildGraph(blueprint)` | R-1.1 minor 7 | README fixed; the plan is not sim-core's | README "Inside" links graph.md |
| Searches inside a tick on first visit | R-1.2 minor 4 | partly fixed (warm-up); the rest holds | SIM-2 |
| Back-EMF coast and one-tick overload | R-1.3 minor 6 | disproved as a fault | debounced (D74), documented at loop.md:120-126 |
| Signal mappings (servo angle, channel command range) | R-1.3 Q1/Q2, D54 | open decision, not a defect | D54 unresolved; Level 3 only |
| README lacks a docs/mechanical.md link | R-1.4 minor 7 | fixed | README "Inside" |
| Rapier world reopened from bytes each tick (Chromebook Run p95) | R-6.1 Q2 | holds, queued as an option | `mechanical/tick.ts:183,269`; perf only, no rule broken |

## Proposed follow-up tasks

| Id | Title | Package | Done-when | Fixes findings |
| --- | --- | --- | --- | --- |
| FU-SIM-1 | Bring sim-core's docs and interface comments up to date | packages/sim-core (docs, comments, one test comment) | interface.ts `restore` says a twin's snapshot (same fingerprint) is accepted, noted as an interface change in the README. runs.md and the README state the replay rule for inputs at `tick = ticks`, or the decision raised for Drew is recorded. electrical.md:90 quotes the current card. The README and program.md call the block-rule vocabulary a provisional seed that sub-draft 6 replaces. program.md:25 matches loop.md:44. The `onVolts` wording matches `volts > 0 && volts >= onVolts`. program.test.ts:377 says `in 2`. warm.ts:12, loop.md:79 and graph/live.ts:8 drop "at most 4". The README fits one page. `pnpm check` is green, and `pnpm golden` reports every Run "same" | SIM-1, SIM-3, SIM-5, SIM-6, SIM-8 |
| FU-SIM-2 | Warm the wiring cache by switch count, not control count | packages/sim-core | `warmControls` caps on the number of switches (2^n positions, n ≤ 6), so `busy-workbench` is warmed. A test drives an 8-control build through a flip of each manual switch and asserts that the wiring cache does not grow inside a tick. Goldens are unchanged | SIM-2 |
| FU-SIM-3 | One setting binding and one speed rule | packages/sim-core | One `settingValue` is shared by the electrical model and `settledPrimitives`. `steadyRpm` is removed from src (tests use `speedRule` or a test helper). `pnpm test`, `pnpm golden` (all "same") and `test:determinism` are green | SIM-4 |
| FU-SIM-4 | Release margin on a bumper switch's contact | packages/sim-core (mechanical) | Gated on D79. A contact switch stays flipped until its probe has been clear by more than TOUCH_MM plus a margin for at least one tick. `kit-circuit-crew` shows no re-close after tick 169. Every other golden is "same", or is accepted with an orchestrator note | SIM-7 |
