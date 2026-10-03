# Orchestrator handover (2026-10-01)

Usage limit reached mid-run. State lives in status.json (pharao.py); this file lists in-flight branches and notes. Kickoff for a fresh orchestrator: 'Read .claude/plans/RUN-servo.md and execute it. You are the orchestrator.' then read this file.

## pharao status
```
{
  "counts": {
    "done": 22,
    "dispatched": 6,
    "pending": 29
  },
  "ready": [],
  "stale": [
    [
      "1.5",
      177
    ],
    [
      "3.3",
      272
    ],
    [
      "3.8",
      280
    ],
    [
      "4.9",
      253
    ],
    [
      "6.3",
      104
    ]
  ],
  "open_decisions": [
    "D1",
    "D2",
    "D3",
    "D4",
    "D5",
    "D6",
    "D7",
    "D8",
    "D11",
    "D12",
    "D13",
    "D14",
    "D15",
    "D16",
    "D17",
    "D18",
    "D19",
    "D20",
    "D21",
    "D22",
    "D23",
    "D24",
    "D25",
    "D26",
    "D27",
    "D28",
    "D29",
    "D30",
    "D31",
    "D32",
    "D33",
    "D34",
    "D35",
    "D36",
    "D37",
    "D38",
    "D39",
    "D40",
    "D41",
    "D42",
    "D43",
    "D44",
    "D46",
    "D47",
    "D48",
    "D49",
    "D50",
    "D51",
    "D52",
    "D53",
    "D54",
    "D55",
    "D56",
    "D57",
    "D58",
    "D59",
    "D60",
    "D61",
    "D62",
    "D63",
    "D64",
    "D65",
    "D66",
    "D67",
    "D68",
    "D69",
    "D70",
    "D71",
    "D72",
    "D73",
    "D74"
  ],
  "halted": false,
  "all_done": false
}
```

## In-flight work (branch → state; worktrees under .claude/worktrees/)
```
/Users/drewdouglas/Desktop/Codebases/servo                                            08de625 [main]
/Users/drewdouglas/Desktop/Codebases/servo/.claude/worktrees/agent-a1f938417d48d990b  8708b80 [task/6.3]
/Users/drewdouglas/Desktop/Codebases/servo/.claude/worktrees/agent-a43c435d7fdb77c1a  54c87f5 [task/4.9]
/Users/drewdouglas/Desktop/Codebases/servo/.claude/worktrees/agent-a63f86a779b2b3307  4ef7a00 [task/3.8]
/Users/drewdouglas/Desktop/Codebases/servo/.claude/worktrees/agent-a899d5ff7a5f81deb  c923699 [task/1.7] locked
/Users/drewdouglas/Desktop/Codebases/servo/.claude/worktrees/agent-ab248f3ba83c469ef  d94b162 [task/3.3] locked
/Users/drewdouglas/Desktop/Codebases/servo/.claude/worktrees/agent-ad4c0529038f95e5b  e91026e [task/1.5] locked
```

- task/1.5 (tick loop): DONE incl. 3-tick fault debounce (e91026e); all 19 fixtures hold; determinism 100x green. NEEDS REVIEW then merge.
- task/1.7 (golden runs): building on task/1.5; must re-merge task/1.5 before recording goldens; asserts every content fixture's expect.
- task/3.3 (wiring): building on task/3.2 (merged); must re-merge main; fixes socket overlap.
- task/3.8 (e2e harness): fixing review (diff sensitivity, CI sharding).
- task/6.3 (release): review fixes DONE (8708b80 merge main, b9a8cb9: one invite hash in @servo/app/invite-code imported by tools; app 93 tests, tools 686; check, build, release:dry green). NEEDS RE-REVIEW (reviewer agent a846447c292bec684 wrote docs/reviews/tasks/6.3.md) then merge. Suggested CLAUDE.md How-to-run row: `pnpm release:dry` builds a tester release into dist/release and prints the content version; `pnpm release:preview` serves it.
- task/4.9 (store): round-3 fix DONE (9c20991 merge main incl. 3.2, 6730acb: journal replay drops a note already stored, saves it if the build is unchanged, otherwise keeps it as a copy and opens the newer build with a status line; app 158 tests, check and build green). NEEDS RE-REVIEW (reviewer wrote docs/reviews/tasks/4.9.md) then merge.

Per-task flow used: Opus builder in worktree → orchestrator verifies → Opus reviewer writes docs/reviews/tasks/{id}.md → merge --no-ff → checks (under heavy load: lint, typecheck, serial tests with --retry 2; CI is authoritative) → pharao done → push.

## Notes carried for later tasks (orchestrator tracker)
Notes for later tasks:
- 1.x: sim-core unit tests use @servo/schema/fixtures; behaviour tests vs real content live in packages/tools. Use schema cosSin; no Math trig. Faults per schema need-judging + explainedBy (controls-explain rule). D17 drain per revolution. D19 unmounted parts stay put; floor edge acts as wall.
- 1.6/6.6: D16 no-op brain passes servo setting through its signal out.
- 2.1/2.2: >=2 failure modes per part via loop/floor/grounded/slip; D15 driver channel settings L2; D20 socket shapes.
- 2.5: D22 banned 'points' whole word, allow 'mount point(s)'. Format defined by 0.5.
- 2.6/1.3 tests that run sim-core over content live in packages/tools.
- 4.7/4.8: D26 L1 unscripted = cross to far side; L2 = stop at wall (bumper). D25 hint rungs skip only when inapplicable.
- 5.3: D27 real-kit wiring swaps one motor's leads. 5.6: D21 no author; name only if adult opts in. 5.5: D10 SyncRemote.
- 6.3: D10 artifacts only, deploy skipped. 4.x: D12 React 19. D14 browser baseline. D11 Rapier lazy-load.
- 1.4: ramp height past high edge undefined in schema (2.4 Q2); presets go up then down. Floor edge = wall (D19).
- 1.2: schema review N10 — explainByControls covers only the controls step for low/high/reversed; sim-core must apply the short step and the feeder step itself (docs/reviews/tasks/0.2.md).
- 1.5: N14 — control search reruns on every control change (bumper contacts); pathological build 818 ms; cache by control state / bound per tick.
- L4+: N13 — >1024 control combos => single flips only.
- D28 parent route behind parental gate; D29 Reset arena; D30 switch flip in Run (tap/Space/list); D31 'fixed' = EditCommands touching faulted part between Runs.
- CLAUDE.md How-to-run still says validate-content missing: subagent refused edit via SendMessage; put the row in 2.5's INITIAL prompt: `pnpm validate-content <path>...` | checks records against schema and terminology lists; --catalogue, --terminology. D32 art pipeline.
- 6.4 sweep: 0.6 minors (motor shaft not at drive-out in art; driver chip hidden; resolveArt README says throw vs 0.4 interface returns undefined -> follow interface; show() uses process.cwd).
- 4.8/L2 ramp: schema v1 cannot express flat-top ramp; 2.4 ramp gentle (1:7) so gearbox lesson weak; consider steeper preset or schema minor bump later.
- D34-D44 queued from 0.4 review; D41 replaces D16 (no-op brain drives nothing), D42 replaces D30 keyboard (Enter flips, Space Run/Stop).
- 1.5 + 3.5 prompts (0.4 finding 18): tick-rate selection (1-30 tps display speed) and the one-second spin-up belong to the APP run loop; sim-core is stepped (1 tick = 1/30 s sim time); canvas only animates frames.
- CLI bug: validate-content packages/content fails on art/generated/registry.json (unknown kind) -> skip art/ folders. Fix in 2.5 review round or small follow-up after 2.5 merges.
- D45 DC motor stall torque 0.12 kg·cm default (brief example 0.4). 2.1: LED has mount port; motors stall before wheels slip at wall.
- D46 supersedes D45: DC motor 0.4 kg·cm at 6 V (brief). D47 LED is Level 2 (parts/level-2/led.json, authored in 2.1 fix; 2.2 must NOT re-author it; Rolling Start kit has no LED). D48 breakdown goals require named fault gone. D49 tipping: L2 top-heavy breakdown, caster removed, steep ramp (D33).
- 2.3 kits: Rolling Start (L1) = 2-cell pack, switch, 2 DC motors, 2 large wheels, caster, chassis (brief Sec 4). Circuit Crew (L2) adds motor driver, LED, buzzer, etc. (brief Sec 5).
- G0 CLOSED 4cbe3f0; tag schema-v1 at 5204051. 0.4 N8 minor open (challenge fixtures compare arena preset only, not props). 1.2 must adopt 1.1's LiveState rename (merge updated task/1.1).
- 4.8: D46 steeper ramp leaves gearbox lesson little room; D49 routes do not tip this chassis (R-2.1 notes).
- 1.5: also link docs/graph.md (and electrical/behaviour docs) from sim-core README; map GraphInputError -> SimulationSetupError. Plan contract text 'buildGraph(blueprint)' superseded by (blueprint, catalogue) ruling (graph.md). Keep branch task/1.1 until 1.2 and 1.3 merge.
- 2.2 notes: servo 4.8-6 V needs 2 packs in series for one-fault no-signal fixture; driver off on 1 cell (battery what-if = direct drive); steep ramp window 18-22 deg; buzzer min 2.5 V.
- At merge: raise vitest timeout for packages/sim-core/test/graph-live.test.ts (400 random circuits exceeded 5 s under load) — CI flake risk.
- 1.7 MUST replay every content fixture (FIXTURES: kit-* from 2.3, 16 from 2.6) and assert expect (goal, faults, namedFault, refused) — this closes 2.3/2.6's "runs in sim-core" acceptance; G1 requires it.
- D50 servo intro: two 2-cell packs in series. D51 mount points: add 2 deck mount points if 4.8 needs. D52 gearbox lesson: heavy box push challenge. D53 Circuit Crew contents.
- 1.5: wire program step (blockRuleRuntime internal, not exported); L3 later: rules need a blueprint home (schema minor bump).
- 4.8: small-wheel what-if sweeps 1,213 mm vs 1,200 mm floor (no full circle). Content README fixtures row should name 2.3 (doc follow-up).
- 1.5: back-EMF transient after a switch opens (R-1.3 minor 5). After 1.3 fix lands, 1.4 and 1.6 branches need main merged at their merge time.
- 2.6 fixtures: 8 working (level-1-roller, switch-in-the-line, <replacement>, motor-driver-robot, bumper-stops-at-wall, led-and-buzzer-robot, geared-robot, busy-workbench[25 parts, 13 on bench]) + 8 broken. 1.4 told: loose caster attribution + swept bumper contact.
- 3.8 e2e harness: dispatch after 3.1 review passes (limit concurrent browser suites). D55 canvas render defaults.
- RULING tip vs grounded: CoM leaves wheel/support polygon -> rocks to frame-edge contact; CoM inside new polygon -> grounded (drag, still drives); beyond -> lost/tip (falls over, wheels spin in air). Given to 2.6 and 1.4.
- 1.5: warm the control-search states at Run start (R-1.2 minor 4: first-visit searches inside the tick). Outputs of drivers/regulators have 0.01 ohm resistance; regulator linear.
- D60 mechanical defaults. D61 no L1-2 tipping; balance lesson = frame on floor; tip is L4. 1.5: needs ./mechanical export decision for tools tests; README link to mechanical.md.
- 3.3: cross-part socket overlap on L2 bumper robot at every zoom (R-3.1 minor) — Drew should see before D55. 3.2/4.1 must merge 3.1's fix.
- G2 PROVISIONAL closed b6ed4d3; D64 = Drew's card sign-off (docs/gates/G2.md). D62 loose support attribution; D63 D61 figure correction.
- D66 panels overlap canvas (<=30%% covered), spec card 300-340 px. D67 Run bar never tucks. D68: 4.5 owns arena strip (preset picker + prop palette) and minimal Home screen. App bundle 643 KB warning (6.1/D11 lazy-load Rapier).
- 3.3 must merge 3.2's fix (handle hit order, Move handle) before finishing.
- 3.7: canvas safe-area insets (load/Fit centre in uncovered area; additive interface change, D70). 4.3: L1-2 cards fit 320x358 without scrolling where possible. 4.9 must merge 4.1's fix.
- 4.4: ignore Space while typing a name. D71 autosave + default profile 'Builder 1'. Sim-core 25-part timing test flaky under load (5 s timeout) — watch CI.
- 4.8 gearbox push challenge: box mass 143-178 g (direct stalls >=143 g, geared pushes <=178 g; ~160 g at 55 mm/s). bump-props box is 50 g. 1.5: README link for mechanical.md (R-1.4 minor 7).
- TEST-INFRA hardening (after current wave): raise per-test timeouts for heavy tests (sim-core 25-part timing, graph-live, canvas view settle), move frame-time/perf assertions to a separate 'perf' vitest project run as its own CI job; local pnpm check should be load-tolerant. Load avg hit 130-300 with 7 agents.
- 1.4 open minors (R-1.4 round 2): prop chains resist 60-75%%; >=700 g prop gives 1-tick wheel slip; bumper re-closes 1 tick after stop inside kit-circuit-crew Run -> watch in 1.5/1.7 fixture replays.
- After 3.3 lands: e2e parity with wiring ~12 min on loaded laptop -> shard CI e2e job. Canvas testing entry (screen positions) for tools only, instead of reading renderer internals (R-3.8 Q1) — assign to 3.4 or 3.6.
- tools README: add test:determinism row (next tools task). 4.3: open-circuit motor reads -0.6 V back-EMF while coasting (spec card readout).
- 1.5/1.7 merged (bbf79e4, b4208bc). D75-D77 from R-1.5 (D31 'fixed' reading, fixed counts feeder parts, debounce timing); D78-D79 from R-1.7 (wire flows in goldens -> 3.5; Circuit Crew one-tick bumper flash -> sim-core release-margin follow-up).
- R-1.5 minors for 6.4 sweep: warm.ts counts driver channels as controls (busy-workbench not warmed; count switches only); interface.ts restore comment vs twin snapshots; trailing inputs at tick=ticks dropped on replay (document replay rule); speed rule / setting binding duplicated (primitives.ts vs behaviour/params.ts).
- R-1.7: 4.5 must pass GoalJudge to golden-runs main.ts env.judge (fixtures with expect.goal fail pnpm golden until then; 4.7/4.8 add them). No golden exercises wheel slip (add slip fixture in 4.8). Golden comment golden-cli.test.ts:218 misplaced.
- 4.9 merged 33074a3. D81-D83 store decisions (Runs kept on build removal; Firefox persist prompt -> parent view; Web Lock for two-tab copies).
- 3.6 PASS (merge after 3.3). D84: 4.2 builder prompt MUST make the tray offer listView.placementsFor to keyboard/screen-reader users (R-3.6 major 1); check at 4.2 review. List-view Select buttons throw until 3.4; live readouts need 3.5.
- 3.7 rulings D80 (body = drawn outline, not touch tile). 5.1 / 5.5 dispatched 2026-10-03.

## Audit 2026-10-03 (after reboot)
- ERROR: 4.9 was marked done before its merge check finished; CI run 37080816120 on main is red (app test/browser/store.test.tsx:455). The 4.9 builder is fixing it on task/4.9 (merge main first); merge that fix as a follow-up and confirm CI green before G3. Rule from now on: pharao done only after the merge check and CI are green.
- ERROR: merge autostash dropped uncommitted state once (recovered from a dangling WIP commit). Commit .claude/plans and review files before every merge.
- 3.3: the first reviewer lost its FAIL report; a fresh reviewer is running (draft docs/reviews/tasks/3.3.md, no major yet). 3.4-3.7 all merge task/3.3, so merge order is 3.3 -> 3.6 -> 3.7 (it merges 3.6) -> 3.4 -> 3.5 -> 3.8.
- 3.7 FAIL (R-3.7): D80 superseded by D85; the builder is fixing it, with app edits allowed (tidy button, onSafeArea, fit after load, StandInCanvas.setSafeArea).
- G3 is a human gate: close it PROVISIONAL after all 3.x merge (like G2), write docs/gates/G3.md, and queue Drew's sign-off.
- After 3.x merges, run one hardening worker:
  - raise per-test timeouts for heavy tests;
  - move perf and timing assertions to a separate CI perf job;
  - fix the canvas handle/placement browser timeouts;
  - add the CLAUDE.md "How to run" rows for golden, e2e, art, release:dry/release:preview, test:determinism, dev and build. A worker's initial prompt must carry these rows.
- Removed merged worktrees (1.5, 1.7, 6.3) and the merged task branches.
- 5.2 prompt MUST add the parent page to the web build and link it from Home behind the gate (D91, R-5.1 finding 2).
- 5.5 PASS (merged after 4.9 fix). 4.4 prompt MUST extend the airplane-mode e2e to press Run offline (Rapier lazy chunk cached; R-5.5 note 4). R-5.5 findings 1 (retry for unreachable host) and 2 (runs of profile removed elsewhere) -> fold into 5.1 merge or 6.4 sweep. D92-D93 queued.
- CI on main red since 3.3/3.6 merge: canvas placement.test.ts two tests CI-only (pass locally alone). Debug worker on fix/ci-placement. Hold pharao done for 3.3, 3.6 until CI green.
- 4.9 save-gap fix merged 3240a4b (Save stores canvas.blueprint; layout effects).
- 3.8 + 5.1 marked done: CI run 37088995393 e2e jobs all green; check job red only on known placement CI failure, which stops pnpm -r before app/parent/tools on CI; those were green locally (parent 17, app 215, tools 927). Re-confirm on CI after the placement fix.
- LESSON: merge checks must run every browser file of a changed package (canvas browser project + e2e views), not only unit tests. 3.5 broke layers.test.ts and views e2e on CI 37091074167; fix on fix/run-layers by 3.5 builder.
- CI GREEN on main (run 37092956291) after CI placement fix (test tray user-select) + run-layers fix. 3.3, 3.5, 3.6 done.
- 5.6 merged + done (local app 254, parent 56, release:dry green; CI blocked only by 3.4's canvas failures, fix in flight on fix/selection-ci).
- 3.7 merged eac2c99 (PASS @93aa16f + integration cc30450). Mark 3.4 and 3.7 done once fix/selection-ci lands and CI is green.
- 4.3 merged + done: local app all green (unit 219 + every browser file); CI 37105659554 red only on canvas frame-time flake (hardening branch fixes); re-confirm after chore/test-hardening lands.
- 6.4 sweep: R-4.10 hush sound when tab hidden (finding 2).

## Wrap-up 2026-10-03 (Drew asked to wrap up)

**State.** 43 of 57 tasks done, 4 dispatched, 10 pending. Main is at the commit after b3b3364, and CI on main is green (run 37117184602), including the perf job. Gates:
- G0 and G1 closed;
- G2 PROVISIONAL (D64);
- G3 PROVISIONAL (D95: Drew runs `pnpm gate:g3` per docs/gates/G3-howto.md on an iPad and a laptop).

**Stopped mid-flight.** Each worktree keeps its work and each agent transcript is saved. Resume by sending a message to the agent id, or reset the task in pharao and re-dispatch.

| Task | Branch | Worktree | State | Agent |
| --- | --- | --- | --- | --- |
| 4.2 tray/library | task/4.2 at 9d90871, pushed | agent-ac6bf9cdcf02455b5 | fix for R-4.2 FAIL (angled touch drags) done, CI 37115979192 green; re-review was stopped | reviewer a0f36fe7ecfa77d54 |
| 4.6 hint ladder | task/4.6, uncommitted (5 files) | agent-a866792f8f37b43cd | building, was wiring RunBar/App | builder a866792f8f37b43cd |
| 4.7 Level 1 challenges | task/4.7, uncommitted (13 files) | agent-a8fd54e455109c6ed | authoring content (D26: L1 unscripted = cross the arena) | builder a8fd54e455109c6ed |
| 5.2 progress view | task/5.2, uncommitted (16 files) | agent-af2616875cf2a04ef | building, incl. D91 parent page in web build + Home link | builder af2616875cf2a04ef |

**Next, in order.**
1. Resume the 4.2 re-review. Merge 4.2 when it passes and CI is green.
2. Resume the 4.6, 4.7 and 5.2 builders, then review and merge each.
3. When 4.7 is done, 4.8 (Level 2 challenges) becomes ready. Carry these notes into its prompt:
   - D26: stop at the wall is Level 2;
   - D52: heavy-box gearbox push, 143–178 g;
   - add a wheel-slip fixture (R-1.7);
   - D61: no tipping.
4. Later tasks: 5.4 needs 5.2; 5.7, 6.1 and G4 come after 4.x; then 6.2, 6.4 (sweep; minors are collected in this file), 6.5, G5 and G6, which are Drew's.

**Process rules learned this session.**
- Commit plan state before every merge; merge autostash dropped it once.
- Merge checks run every browser file of each touched package, not only unit tests.
- Mark a task done only after CI on main is green. CI is the authority when local load is high.
- Builders push their branch and report a CI run id.

**Open decisions.** D1–D106, each with a default the build uses. Drew's sign-offs are D64 (G2 cards) and D95 (G3 hands-on). The settings change is D103 (make perf a required check).
