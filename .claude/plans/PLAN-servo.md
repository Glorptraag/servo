# Plan: Servo — Levels 1–2 to tester release

> Pharao output — generated 2026-09-30 from docs/plan.md (Servo — Agentic Build Plan) and docs/brief.md. Review before executing. State lives in status.json; never hand-edit it — use `python3 .claude/plans/pharao.py`.

## Overview

Servo is a digital robotics kit for children: real parts wired together on a big canvas, simulated deterministically, with failure states as the teaching device. This plan builds Levels 1–2 (about 15 parts, 2 kits, 15–20 challenges) through seven phases and seven gates. G3 (Drew wires by hand) and G4 (children build unaided) decide the product; everything before them is scaffolding. Every worker reads CLAUDE.md first.

Model routing: `[OPUS]` for schema, sim-core solvers, the canvas engine (3.1–3.3), interface design and the reviewer sweep; `[SONNET]` for content, features and tooling; gate tasks are orchestrator/human checkpoints. Gate tasks listed in `human_gates` are never dispatched to a worker.

## Phases

### Phase 0: Foundations

Gate: G0 — schema frozen at v1, package interfaces published, CI green on an empty app. Closed by the orchestrator when every Phase 0 done_when passes.

#### Task 0.1: Monorepo scaffold and CI `[SONNET]` (standard)
- **Description**: Create the TypeScript monorepo with the seven packages named in CLAUDE.md (schema, content, sim-core, canvas, app, parent, tools), a shared tsconfig, lint, a test runner and a CI workflow. Propose the concrete libraries for the stack decisions in docs/decisions.md (2D canvas renderer, 2D physics, local-first store) in docs/stack.md and use them; do not add UI framework code yet. Extend CLAUDE.md's 'How to run' section with the real commands.
- **Files**: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.github/workflows/ci.yml`, `packages/schema/package.json`, `packages/content/package.json`, `packages/sim-core/package.json`, `packages/canvas/package.json`, `packages/app/package.json`, `packages/parent/package.json`, `packages/tools/package.json`
- **Done when**: `pnpm install && pnpm -r test` runs an (empty) test in every package and exits 0; CI workflow runs the same on push; CLAUDE.md 'How to run' lists working commands; docs/stack.md exists.
- **Parallel group**: A

#### Task 0.2: Schema v1: types and validators `[OPUS]` (standard)
- **Description**: Define the v1 types for Part, Port (typed power/signal/mechanical, directional where the type is), Wire, Mount, Blueprint, Arena, Challenge and RunRecord as described in docs/brief.md Section 6, plus validators for each. Include the part-record fields from the brief's Parts schema table: identity, ports, needs, behaviour rule, settings with unlock level, failure modes with teaching notes, spec-card layers. Write fixture blueprints: at least 3 valid and 10 invalid (one violation each).
- **Files**: `packages/schema/src/types/`, `packages/schema/src/validate/`, `packages/schema/fixtures/`, `packages/schema/README.md`
- **Done when**: `pnpm --filter schema test` passes; the fixture suite shows every valid fixture accepted and every invalid fixture refused with a named reason.
- **Contracts**: Blueprint = { version: 1, parts: PlacedPart[], wires: Wire[], arena: ArenaRef, meta }. Wire joins two PortRefs of the same PortType. Export everything from packages/schema/src/index.ts.
- **Gate**: Blocked on 0.1
- **Parallel group**: B

#### Task 0.3: Blueprint versioning and migrations `[SONNET]` (standard)
- **Description**: Add a version field discipline and a migration runner to the schema package so a stored blueprint of any earlier version migrates forward to the current one. Create a synthetic v0 fixture and a v0→v1 migration to prove the path.
- **Files**: `packages/schema/src/migrate/`, `packages/schema/fixtures/v0/`
- **Done when**: A v0 fixture migrates to v1, validates, and round-trips (migrate → serialise → parse) byte-identically; tests pass.
- **Gate**: Blocked on 0.2
- **Parallel group**: C

#### Task 0.4: Package interface READMEs `[OPUS]` (standard)
- **Description**: Write a one-page interface README and a TypeScript interface file for each package that other packages will build against: sim-core (createSimulation(blueprint, arena, seed) → step(), snapshot/restore, RunEvent stream, per-part live values), canvas (mount, load blueprint, edit events out, run events in, list-view model), app, content (loaders and validator API), parent (progress read model), tools. Name public functions, event shapes and the owning package. Nothing is implemented; stubs may throw.
- **Files**: `packages/sim-core/README.md`, `packages/sim-core/src/interface.ts`, `packages/canvas/README.md`, `packages/canvas/src/interface.ts`, `packages/app/README.md`, `packages/content/README.md`, `packages/parent/README.md`, `packages/tools/README.md`
- **Done when**: Each README names its public functions, events and owning package; each interface.ts compiles; orchestrator has reviewed and signed off in the PR.
- **Contracts**: RunEvent = { tick, partId, kind: 'value'|'motion'|'sound'|'fault', payload }. Canvas never imports sim-core internals — only packages/sim-core/src/interface.ts.
- **Gate**: Blocked on 0.2
- **Parallel group**: C

#### Task 0.5: Content validator CLI `[SONNET]` (standard)
- **Description**: Build a CLI (`pnpm validate-content <path>`) that checks a parts record, kit, arena or challenge against the schema and against a terminology list (real component names; banned character-style words). The terminology data file itself is authored in task 2.5 — read it from packages/content/terminology/ and treat a missing file as an empty list for now.
- **Files**: `packages/tools/src/validate-content/`
- **Done when**: CLI rejects a record with a character-style name or a missing port type with a readable message and non-zero exit; accepts the schema fixtures; tests pass.
- **Gate**: Blocked on 0.2
- **Parallel group**: C

#### Task 0.6: Placeholder-art generator and swap registry `[SONNET]` (standard)
- **Description**: Write a generator that emits one vector (SVG) tile per part from its schema record: true proportions, schema colours, consistent three-quarter view, no faces or characters. Implement the swap registry: every part references an asset key, and the registry resolves a key to the placeholder until a final render is dropped in.
- **Files**: `packages/tools/src/placeholder-art/`, `packages/tools/src/swap-registry/`
- **Done when**: Generator runs over the schema fixtures and emits one SVG per part; registry resolves every key; a missing final asset falls back to the placeholder; tests pass.
- **Gate**: Blocked on 0.2
- **Parallel group**: C

#### Task G0: Gate G0 · Foundations closed `[OPUS]` (micro)
- **Description**: Orchestrator-closed gate. Confirm every Phase 0 done_when passes on main, tag schema v1 as frozen, and write docs/gates/G0.md with the checklist and commit hashes.
- **Files**: `docs/gates/G0.md`
- **Done when**: docs/gates/G0.md exists with every Phase 0 task ticked and the schema v1 tag recorded.
- **Gate**: Blocked on 0.1, 0.2, 0.3, 0.4, 0.5, 0.6
- **Parallel group**: D

### Phase 1: Simulation core

Gate: G1 — golden runs pass for every Level 1–2 fixture; determinism proven. Closed by the orchestrator.

#### Task 1.1: Graph builder `[OPUS]` (standard)
- **Description**: Turn a validated blueprint into a wired graph: power nets (traced across power wires and switches), signal links (directional) and mechanical mounts (part-on-part). Live-net detection: a net is live only when it traces back to a source with both polarities. Legal-but-wrong builds must build without error; only schema-invalid input throws.
- **Files**: `packages/sim-core/src/graph/`
- **Done when**: Nets, links and mounts match the hand-written expectations for 8 fixture builds (add them under packages/sim-core/fixtures/graph/); tests pass.
- **Contracts**: Uses only packages/schema types; exports buildGraph(blueprint): SimGraph.
- **Gate**: Blocked on 0.2, 0.4
- **Parallel group**: E

#### Task 1.2: Electrical solver `[OPUS]` (standard)
- **Description**: Implement the lumped electrical model from docs/brief.md Section 6: sources, loads as current draws, per-net voltage, a battery whose capacity falls with draw, short-circuit detection. No transient physics. Pure functions over the SimGraph, deterministic.
- **Files**: `packages/sim-core/src/electrical/`
- **Done when**: A motor on a 1-cell vs 2-cell pack shows the speed ratio stated in the part record; a shorted pack drains in the specified time; tests pass.
- **Gate**: Blocked on 1.1
- **Parallel group**: F

#### Task 1.3: Behaviour runtime `[OPUS]` (standard)
- **Description**: Execute each part's behaviour rule from its content record every tick: inputs (net voltage, signal values, mechanical load) → outputs (shaft speed, light, sound, sensor reading) including the record's failure modes (no circuit → still; low voltage → slow + drain; overload → stall + hum; no signal → servo holds and hums). No part behaviour may be hard-coded in this package.
- **Files**: `packages/sim-core/src/behaviour/`
- **Done when**: DC motor, LED, buzzer, switch and servo behave per their Level 1–2 records including every failure mode, proven by behaviour fixtures generated from the content records; tests pass.
- **Gate**: Blocked on 1.1, 2.1
- **Parallel group**: F

#### Task 1.4: Mechanical solver `[OPUS]` (standard)
- **Description**: Apply actuator outputs to the chassis in a 2.5D top-down arena: differential-drive kinematics, simple collision with arena props, and tipping as a centre-of-mass check. Use the small 2D physics library chosen in docs/stack.md or a hand-rolled deterministic integrator; determinism wins over realism.
- **Files**: `packages/sim-core/src/mechanical/`
- **Done when**: A two-motor robot drives straight, turns on the spot when one motor reverses, stops at a wall, and tips with the top-heavy fixture; tests pass.
- **Gate**: Blocked on 1.3
- **Parallel group**: G

#### Task 1.5: Tick loop, clock, snapshot and recorder `[OPUS]` (standard)
- **Description**: Implement createSimulation per packages/sim-core/README.md: fixed-rate ticks (1–30 tps selectable), the solver order electrical → program → mechanical → sensor sampling, snapshot on Run and exact restore on Stop, a RunEvent stream, and a run recorder that serialises every tick's values. Seeded; no wall clock.
- **Files**: `packages/sim-core/src/loop/`, `packages/sim-core/src/recorder/`, `packages/sim-core/src/index.ts`
- **Done when**: Same seed produces identical run records across 100 runs of every fixture; Stop restores the snapshot byte-for-byte; the public API matches the README; tests pass.
- **Gate**: Blocked on 1.2, 1.4
- **Parallel group**: H

#### Task 1.6: Program runtime stub `[SONNET]` (standard)
- **Description**: Add the program (brain) slot: a block-rule interface and a no-op brain so Level 3 can plug in later without changing the loop. Document the interface in the sim-core README's program section.
- **Files**: `packages/sim-core/src/program/`
- **Done when**: Interface documented; a fixture containing a microcontroller runs without error and with no effect; tests pass.
- **Gate**: Blocked on 1.3
- **Parallel group**: G

#### Task 1.7: Golden-run harness `[SONNET]` (standard)
- **Description**: Build tooling that records a reference run per fixture blueprint into packages/sim-core/golden/ and a CI check that diffs the current run against it with a readable per-tick diff. Provide an explicit `--accept` path for intended solver changes.
- **Files**: `packages/tools/src/golden-runs/`, `packages/sim-core/golden/`
- **Done when**: Any solver change that alters a golden run fails CI with a readable diff; `--accept` regenerates; tests pass.
- **Gate**: Blocked on 1.5
- **Parallel group**: I

#### Task G1: Gate G1 · Simulation core closed `[OPUS]` (micro)
- **Description**: Orchestrator-closed gate. Golden runs pass for every Level 1–2 fixture and the 100-run determinism check is green on main. Record it in docs/gates/G1.md.
- **Files**: `docs/gates/G1.md`
- **Done when**: docs/gates/G1.md exists with the golden-run and determinism results recorded.
- **Gate**: Blocked on 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, G0
- **Parallel group**: J

### Phase 2: Parts content, Levels 1–2

Gate: G2 — about 15 parts and 2 kits validated; Drew has read every spec card. Orchestrator verifies the validator; Drew confirms the cards (human gate).

#### Task 2.1: Level 1 parts records `[SONNET]` (standard)
- **Description**: Author the Level 1 parts as schema records: battery pack, switch, DC motor, wheel, caster, frame/chassis, LED. Each has real name, family, domain, ports, needs, a plain-language behaviour rule the solvers can implement, at least two failure modes with a teaching note, settings with unlock levels, and spec-card layers 1–2 in the voice of docs/brief.md Section 12. No characters, no praise.
- **Files**: `packages/content/parts/level-1/`
- **Done when**: `pnpm validate-content packages/content/parts/level-1` passes; every part has ≥2 failure modes with teaching notes and spec-card layers 1 and 2.
- **Gate**: Blocked on 0.5
- **Parallel group**: E

#### Task 2.2: Level 2 parts records `[SONNET]` (standard)
- **Description**: Author the Level 2 parts: motor driver, buzzer, a second battery option, gearbox, bumper switch, a second wheel size, and a servo motor preview. Same fields and voice as Level 1, plus a popular-mechanics line on every part.
- **Files**: `packages/content/parts/level-2/`
- **Done when**: Validator passes; spec-card layers 1–2 plus a popular-mechanics line on every Level 2 part.
- **Gate**: Blocked on 2.1
- **Parallel group**: K

#### Task 2.3: Kits: Rolling Start and Circuit Crew `[SONNET]` (standard)
- **Description**: Define the two launch kits as content: 'Rolling Start' (Level 1) and 'Circuit Crew' (Level 2, placeholder name — see docs/decisions.md D5) listing their parts with tray grouping by family, and one working fixture robot per kit.
- **Files**: `packages/content/kits/`
- **Done when**: Each kit validates and its fixture robot builds a valid blueprint that sim-core runs without faults.
- **Gate**: Blocked on 2.2
- **Parallel group**: L

#### Task 2.4: Arena presets `[SONNET]` (micro, batch B1)
- **Description**: Author arena presets as content: open floor, wall stop, ramp, and bump props, each with floor bounds, walls, an optional line, and prop placements.
- **Files**: `packages/content/arenas/`
- **Done when**: Each preset loads and validates.
- **Gate**: Blocked on 0.2
- **Parallel group**: C

#### Task 2.5: Terminology and banned-words lists `[SONNET]` (micro, batch B1)
- **Description**: Author the terminology list (real component names with allowed plain-language glosses) and the banned-words list (character-style names, praise words, exclamation marks in system text) as data files the validator and later the UI read.
- **Files**: `packages/content/terminology/`
- **Done when**: Validator fails a record that uses a banned word and passes one that uses only listed terms.
- **Gate**: Blocked on 0.5
- **Parallel group**: C

#### Task 2.6: Fixture blueprints, working and broken `[SONNET]` (standard)
- **Description**: Author 8 working and 8 broken fixture blueprints across Levels 1–2 for the simulation and canvas teams. Each broken fixture has exactly one fault (reversed motor, missing return wire, servo without signal, underpowered pack, top-heavy chassis, short circuit, wrong-type wire attempt recorded as refused, loose caster) named in its metadata.
- **Files**: `packages/content/fixtures/blueprints/`
- **Done when**: All 16 validate; each broken fixture's named fault reproduces in sim-core (a failing assertion per fixture); tests pass.
- **Gate**: Blocked on 2.2, 2.4
- **Parallel group**: L

#### Task G2: Gate G2 · Parts content closed `[OPUS]` (micro)
- **Description**: Human-assisted gate. Orchestrator confirms the validator is green for all content; Drew reads every Level 1–2 spec card and signs off (queue a decision with the card list; do not close without his answer).
- **Files**: `docs/gates/G2.md`
- **Done when**: docs/gates/G2.md records validator results and Drew's sign-off on every spec card.
- **Gate**: Blocked on 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, G0
- **Parallel group**: J

### Phase 3: Build canvas and Run mode

Gate: G3 — Drew wires the two Level 1 kit robots by hand on a tablet and a laptop; both run; the list view drives the same build. HUMAN GATE.

#### Task 3.1: Canvas renderer and scene graph `[OPUS]` (standard)
- **Description**: Build the canvas package's renderer on the 2D canvas library from docs/stack.md: scene layers in the order the brief gives (arena floor and props → grid → chassis → mechanical linkages → parts → wires → ports and handles → hints), pan, pinch/scroll zoom with limits, Fit, and a grid that fades at rest. Placeholder art via the swap registry.
- **Files**: `packages/canvas/src/renderer/`, `packages/canvas/src/scene/`
- **Done when**: 60 fps (16 ms frame budget) on a 25-part fixture in the e2e harness's iPad profile; layer order verified by screenshot tests; tests pass.
- **Contracts**: Canvas imports sim-core only through packages/sim-core/src/interface.ts.
- **Gate**: Blocked on 0.4, 0.6
- **Parallel group**: M

#### Task 3.2: Part placement `[OPUS]` (standard)
- **Description**: Implement placement per docs/brief.md Section 10: drag from tray and tap-then-tap-canvas as equals; snap to a mount point or free spot within 48 px; a part dropped in the void slides to the nearest free spot; move, rotate handle, remove (drag to tray or select + bin); wires follow.
- **Files**: `packages/canvas/src/placement/`
- **Done when**: E2E scripts for the touch path and the pointer path both place every part of every fixture; tests pass.
- **Gate**: Blocked on 3.1
- **Parallel group**: N

#### Task 3.3: Wiring `[OPUS]` (standard)
- **Description**: Implement wiring: port sockets in wire colours (hollow empty, filled connected), drag-to-wire, same-type acceptance only, glow within 32 px of a matching port, push-away and right-colour glow on a wrong type, snap-back on cancel, 6 px wires with 24 px hit areas, 44 px port targets, re-route on move. Legal-but-wrong connections are allowed.
- **Files**: `packages/canvas/src/wiring/`
- **Done when**: Every legal fixture can be wired by script in both input paths; illegal wires are refused with the glow cue; tests pass.
- **Gate**: Blocked on 3.2
- **Parallel group**: O

#### Task 3.4: Selection and focus states `[SONNET]` (standard)
- **Description**: Selecting a part dims everything not connected to it by one step; selecting a wire highlights both ports and labels what flows on it; selection emits a spec-card-open event for the app.
- **Files**: `packages/canvas/src/selection/`
- **Done when**: Screenshot tests for each focus state pass; selection events are emitted with the right ids.
- **Gate**: Blocked on 3.3
- **Parallel group**: P

#### Task 3.5: Run-mode animation `[SONNET]` (standard)
- **Description**: Consume the sim-core RunEvent stream and animate it: moving dots along wires (red power, yellow signal), wheel spin at simulated speed, servo sweep, LED, buzzer visual twin, stall shudder, tipping with weight, one-second spin-up on Run. Wires lock in Run; Stop returns to Build.
- **Files**: `packages/canvas/src/run-animation/`
- **Done when**: Each failure mode in the broken fixtures is visibly distinct in a recorded run (screenshot per fixture); tests pass.
- **Gate**: Blocked on 3.3, 1.5
- **Parallel group**: P

#### Task 3.6: List view (screen-reader path) `[SONNET]` (standard)
- **Description**: Provide the structured parts-and-wires list ('DC motor, connected to battery pack power out') with the same actions as the canvas — place, wire, configure, remove — operable by keyboard and screen reader.
- **Files**: `packages/canvas/src/list-view/`
- **Done when**: A fixture built entirely from the list view produces a blueprint byte-identical to the same build wired on canvas; tests pass.
- **Gate**: Blocked on 3.3
- **Parallel group**: P

#### Task 3.7: Tidy-wires router and zoom limits `[SONNET]` (standard)
- **Description**: Add a 'tidy wires' action that re-routes wires around part bodies, and zoom limits that keep the build on screen.
- **Files**: `packages/canvas/src/routing/`
- **Done when**: Routed wires never cross a part body on the 25-part fixture; zoom cannot lose the build; tests pass.
- **Gate**: Blocked on 3.3
- **Parallel group**: P

#### Task 3.8: Canvas e2e harness `[SONNET]` (standard)
- **Description**: Build the e2e harness with touch emulation, pointer emulation, screenshot diffing, an iPad-class performance profile, and an input-path parity check that compares blueprints produced by touch, pointer and list view.
- **Files**: `packages/tools/src/e2e/`
- **Done when**: Harness runs in CI in under 10 minutes on the fixtures available at the time; parity check reports per fixture.
- **Gate**: Blocked on 3.1
- **Parallel group**: N

#### Task G3: Gate G3 · Drew wires both Level 1 robots by hand `[OPUS]` (micro)
- **Description**: HUMAN GATE. Orchestrator prepares a tablet and laptop build with the two Level 1 kit robots and writes docs/gates/G3.md with what to try (first wire attempt, a wrong-type drop, a run, a stop, the list view). Queue a decision and wait for Drew's pass/fail. Do not dispatch a worker for this task.
- **Files**: `docs/gates/G3.md`
- **Done when**: docs/gates/G3.md records Drew's pass on tablet and laptop and any findings filed as new tasks.
- **Gate**: Blocked on 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, G1, G2
- **Parallel group**: Q

### Phase 4: App shell, kits and challenges

Gate: G4 — three children aged 6–8 each build a Level 1 kit robot with no adult help beyond reading; hint ladder used, never bypassed. HUMAN GATE.

#### Task 4.1: App shell and layout `[SONNET]` (standard)
- **Description**: Build the app shell around the canvas per docs/brief.md Section 9: header (kit/level, one-line goal, Save, Home), part tray on the left (bottom in portrait), spec card sliding in on the right, Run bar bottom-centre, arena strip; every edge tuckable; the canvas never under 70% of the screen.
- **Files**: `packages/app/src/shell/`
- **Done when**: Layout tests at 10-inch landscape, 13-inch and tablet portrait pass; tuck states persist across reload; tests pass.
- **Gate**: Blocked on 3.1, 0.4
- **Parallel group**: N

#### Task 4.2: Part tray and library `[SONNET]` (standard)
- **Description**: Populate the tray from the current kit, grouped by family, with big tiles; add the Library button opening the full catalogue overlay with family and domain filters. Before Level 3 the library is browse-only.
- **Files**: `packages/app/src/tray/`, `packages/app/src/library/`
- **Done when**: Tray shows exactly the kit's parts; library overlay opens with working filters and no drag-out before Level 3; tests pass.
- **Gate**: Blocked on 2.3, 4.1, G3
- **Parallel group**: R

#### Task 4.3: Spec card `[SONNET]` (standard)
- **Description**: Build the spec card: layered text by level, real name and picture, ports, needs/gives, settings as dials and sliders in child-sized steps with the real unit shown, live readouts in Run, popular-mechanics line, speak-it button (text-to-speech of the exact on-screen words).
- **Files**: `packages/app/src/spec-card/`
- **Done when**: Every Level 1–2 part renders its card at Levels 1 and 2 without truncation at the 10-inch size; live readouts match the run record values; tests pass.
- **Gate**: Blocked on 2.2, 4.1, G3
- **Parallel group**: R

#### Task 4.4: Run bar and clock `[SONNET]` (standard)
- **Description**: One large Run/Stop toggle, slow-motion clock control (1–30 tps), Undo, Reset arena, one-second spin-up; Run disabled with a plain reason when nothing is placed.
- **Files**: `packages/app/src/run-bar/`
- **Done when**: Stop restores the build exactly; slow-motion shows per-tick steps with the tick's visual twin; tests pass.
- **Gate**: Blocked on 3.5, 4.1, G3
- **Parallel group**: R

#### Task 4.5: Challenge runner `[SONNET]` (standard)
- **Description**: Lay a challenge over the same canvas: header goal line, arena preset, goal detection from run records, a tick when the goal is met. No separate lesson screen.
- **Files**: `packages/app/src/challenges/`
- **Done when**: All Level 1–2 challenge fixtures detect success and non-success correctly; tests pass.
- **Gate**: Blocked on 2.4, 4.4
- **Parallel group**: S

#### Task 4.6: Hint ladder `[SONNET]` (standard)
- **Description**: Implement the hint ladder drawn on the canvas: pulse the part → pulse the port → ghost wire → do it for me. Triggers after two Runs that miss the goal or on request from the button beside the goal. Hint copy per docs/brief.md Section 12.
- **Files**: `packages/app/src/hints/`
- **Done when**: Each step renders without covering a port; 'do it for me' produces a valid wire; tests pass.
- **Gate**: Blocked on 4.5
- **Parallel group**: T

#### Task 4.7: Level 1 challenges `[SONNET]` (standard)
- **Description**: Author Level 1 challenges as content: 5 part introductions, 5 guided challenges with hint ladders, 2 breakdowns, 2 what-ifs, 1 unscripted build ('Cross the arena and stop at the wall'), each with goal, arena preset, kit, and fixtures.
- **Files**: `packages/content/challenges/level-1/`
- **Done when**: Each challenge has a passing fixture and at least one failing fixture; validator passes.
- **Gate**: Blocked on 2.6, 4.5
- **Parallel group**: T

#### Task 4.8: Level 2 challenges `[SONNET]` (standard)
- **Description**: Author Level 2 challenges: same shape as Level 1 with 6 guided challenges, including the switch, motor driver, buzzer and gearbox.
- **Files**: `packages/content/challenges/level-2/`
- **Done when**: Each challenge has a passing fixture and at least one failing fixture; validator passes.
- **Gate**: Blocked on 4.7
- **Parallel group**: U

#### Task 4.9: Blueprint save, load, duplicate; local-first store `[SONNET]` (standard)
- **Description**: Persist blueprints in a local-first store (library from docs/stack.md): save, load, duplicate, rename; run the schema migration on load; the blueprint is the only persisted build format.
- **Files**: `packages/app/src/store/`
- **Done when**: Round-trip of all fixtures; a v0 fixture migrates on load; tests pass.
- **Gate**: Blocked on 0.3, 4.1
- **Parallel group**: R

#### Task 4.10: Sound layer `[SONNET]` (standard)
- **Description**: Add sounds as machine feedback only: click on wire landing, rising whir on Run, motor hum by speed, buzzer, hollow knock on collision, soft tick per step in slow motion; each has a visual twin; mute persists; no music loop.
- **Files**: `packages/app/src/sound/`
- **Done when**: Audio events map one-to-one to run events in a recorded run; mute persists across reload; tests pass.
- **Gate**: Blocked on 4.4
- **Parallel group**: S

#### Task G4: Gate G4 · Three children build a kit robot unaided `[OPUS]` (micro)
- **Description**: HUMAN GATE. Orchestrator prepares the tablet build, the Level 1 kit and an observation sheet (first wire attempt, hint use, response to a failure state, whether an adult intervened) in docs/gates/G4.md, queues a decision and waits. Drew runs it with three children aged 6–8. Findings become new tasks, not patches.
- **Files**: `docs/gates/G4.md`
- **Done when**: docs/gates/G4.md records three observed sessions and Drew's pass.
- **Gate**: Blocked on 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, G3
- **Parallel group**: V

### Phase 5: Accounts, parent view, offline

Gate: G5 — a family with two child profiles uses Servo offline for a week and syncs cleanly; parent view matches the run records. HUMAN GATE.

#### Task 5.1: Adult account and child profiles `[SONNET]` (standard)
- **Description**: Child profiles under one adult account: no child email, no chat, no public sharing. Profile switch keeps builds and progress separate.
- **Files**: `packages/parent/src/accounts/`
- **Done when**: Profile switch isolates builds; no route or store query exposes another child's data (negative tests); tests pass.
- **Gate**: Blocked on 4.9
- **Parallel group**: S

#### Task 5.2: Progress view `[SONNET]` (standard)
- **Description**: Parent view of progress read from run records: parts met, unscripted builds passed, faults fixed, time in sandbox; nothing extra for the child to do.
- **Files**: `packages/parent/src/progress/`
- **Done when**: Figures reconcile to run records for all fixtures; tests pass.
- **Gate**: Blocked on 5.1, 4.5
- **Parallel group**: T

#### Task 5.3: Parts-list export `[SONNET]` (standard)
- **Description**: Printable parts list per blueprint with real names, family, quantity and a wiring summary, so a family can buy the real kit and rebuild it.
- **Files**: `packages/parent/src/export/`
- **Done when**: Export of each kit fixture lists every part once with its family; tests pass.
- **Gate**: Blocked on 5.1
- **Parallel group**: T

#### Task 5.4: Name-the-part card game `[SONNET]` (standard)
- **Description**: A two-minute adult-led card game in the parent view: show a part picture, the adult marks named/not named; used as the Level 2 check in the brief's success measures.
- **Files**: `packages/parent/src/card-game/`
- **Done when**: Draws from Level 1–2 parts only; records a result per child; tests pass.
- **Gate**: Blocked on 5.2
- **Parallel group**: U

#### Task 5.5: Offline and sync `[SONNET]` (standard)
- **Description**: Full sandbox and all downloaded levels work with no network; sync on reconnect with the conflict rule 'latest blueprint wins, both versions kept'.
- **Files**: `packages/app/src/offline/`, `packages/app/src/sync/`
- **Done when**: Airplane-mode e2e passes; the conflict fixture keeps both versions; tests pass.
- **Gate**: Blocked on 4.9
- **Parallel group**: S

#### Task 5.6: Adult-to-adult sharing `[SONNET]` (standard)
- **Description**: Read-only blueprint links between adults that open the build in replay without exposing profile data.
- **Files**: `packages/app/src/sharing/`
- **Done when**: A shared link opens the build in replay; profile data is absent from the payload (test); tests pass.
- **Gate**: Blocked on 5.1
- **Parallel group**: T

#### Task 5.7: Accessibility pass `[SONNET]` (standard)
- **Description**: WCAG 2.2 AA on all chrome; colour twins for wires (solid power, dashed signal, thick grey mechanical) and port shapes (round, square, hexagon); high-contrast theme; dyslexia-friendly type option; left-handed mirror layout; read-aloud on all text.
- **Files**: `packages/app/src/a11y/`, `packages/app/src/theme/`
- **Done when**: Automated a11y suite green; the manual checklist in docs/a11y-checklist.md is filled and signed by Drew (queue a decision for the sign-off).
- **Gate**: Blocked on 4.1, G4
- **Parallel group**: W

#### Task G5: Gate G5 · A family runs a week offline `[OPUS]` (micro)
- **Description**: HUMAN GATE. Orchestrator prepares a build for one family with two child profiles and a one-week offline protocol in docs/gates/G5.md; queues a decision; waits. Pass = clean sync after the week and parent view matching run records.
- **Files**: `docs/gates/G5.md`
- **Done when**: docs/gates/G5.md records the week's result and Drew's pass.
- **Gate**: Blocked on 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, G4
- **Parallel group**: X

### Phase 6: Hardening and tester release

Gate: G6 — five homeschool families run Levels 1–2 for two weeks; the brief's Section 14 success measures are read for the first time. HUMAN GATE.

#### Task 6.1: Performance `[SONNET]` (standard)
- **Description**: Hit the budgets: 25-part builds at 60 fps on a 2020 iPad and a low-end Chromebook profile; cold start under 3 s. Record measurements in docs/perf.md.
- **Files**: `packages/app/src/perf/`, `docs/perf.md`
- **Done when**: Measurements recorded in docs/perf.md meet the budgets in CI profiles or manual device runs.
- **Gate**: Blocked on 4.1, G4
- **Parallel group**: W

#### Task 6.2: Telemetry for the success measures only `[SONNET]` (standard)
- **Description**: Emit only the events the brief's Section 14 measures need: run records, session start mode, hint use, export events. Document every event in the parent view's one-screen data note (docs/data-note.md, rendered in the parent view).
- **Files**: `packages/app/src/telemetry/`, `docs/data-note.md`
- **Done when**: Every emitted event is listed in the data note and nothing else is emitted (test enumerates emitters); tests pass.
- **Gate**: Blocked on 5.2
- **Parallel group**: U

#### Task 6.3: Release pipeline `[SONNET]` (standard)
- **Description**: Web build, versioned content bundle and tester invite codes from a tagged commit; the content version shows in Settings.
- **Files**: `.github/workflows/release.yml`, `packages/tools/src/release/`
- **Done when**: A tagged commit produces a tester URL with the content version shown in Settings.
- **Gate**: Blocked on 0.1, 4.1
- **Parallel group**: C

#### Task 6.4: Reviewer sweep against the ground rules `[OPUS]` (standard)
- **Description**: Adversarial review of every package against CLAUDE.md rules 1–14; each finding logged in docs/reviews/<package>.md with severity; rule-7 (real names, no mascot/points) and rule-8 (three input paths) findings must be fixed via new tasks before G6.
- **Files**: `docs/reviews/`
- **Done when**: A review file per package exists; no open rule-7 or rule-8 findings.
- **Gate**: Blocked on 6.1, 6.2, 6.3, 5.7, 4.8, G5
- **Parallel group**: Y

#### Task 6.5: Copy pass on spec cards and hints `[SONNET]` (standard)
- **Description**: Edit every spec card and hint against the voice rules in docs/brief.md Section 12: short, concrete, second person, no praise, no exclamation marks, real names; then queue a decision for Drew to sign off each card.
- **Files**: `packages/content/parts/level-1/`, `packages/content/parts/level-2/`, `packages/content/challenges/level-1/`, `packages/content/challenges/level-2/`
- **Done when**: Validator passes; Drew's sign-off recorded in the decision queue.
- **Gate**: Blocked on 4.8
- **Parallel group**: U

#### Task 6.6: Level 3 slot behind a flag `[SONNET]` (standard)
- **Description**: Add a feature flag and a placeholder program view; with the flag on, the servo's angle setting unlocks and drives the servo in Run. Flag off by default.
- **Files**: `packages/app/src/program-view/`, `packages/app/src/flags/`
- **Done when**: Flag off by default; with it on, a servo angle can be set and the servo sweeps to it in a run; tests pass.
- **Gate**: Blocked on 1.6, 4.3
- **Parallel group**: S

#### Task G6: Gate G6 · Five families, two weeks `[OPUS]` (micro)
- **Description**: HUMAN GATE. Orchestrator ships the tester release, prepares the observation and measures sheet in docs/gates/G6.md, queues a decision and waits. Drew runs Levels 1–2 with five homeschool families for two weeks and reads the Section 14 measures for the first time.
- **Files**: `docs/gates/G6.md`
- **Done when**: docs/gates/G6.md records the two-week results and the measures.
- **Gate**: Blocked on 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, G5
- **Parallel group**: Z

## Dependency graph

Run `python3 .claude/plans/pharao.py graph` for the live Mermaid graph. Shape: 0.1 → 0.2 → {0.3, 0.4, 0.5, 0.6} → G0; sim-core (1.x) and content (2.x) run in parallel off the schema; canvas (3.x) starts off 0.4/0.6 and meets sim-core at 3.5; G3 gates the app features that sit on wiring (4.2–4.4); G4 gates the accessibility pass and performance work; G5 gates the reviewer sweep; G6 closes.

## Batches

| Batch | Tasks | Model | Group |
|-------|-------|-------|-------|
| B1 | 2.4, 2.5 | SONNET | C |

## Human gates

G2 (Drew reads every spec card), G3 (Drew wires both Level 1 robots), G4 (three children), G5 (a family, one week offline), G6 (five families, two weeks). The orchestrator prepares each gate's checklist in docs/gates/, queues a decision, and waits. G0 and G1 are closed by the orchestrator from test results.

## Status

Cosmetic mirror of status.json, updated at halt.

| Task | Status |
|------|--------|
| 0.1 | ⬜ |
| 0.2 | ⬜ |
| 0.3 | ⬜ |
| 0.4 | ⬜ |
| 0.5 | ⬜ |
| 0.6 | ⬜ |
| G0 | ⬜ |
| 1.1 | ⬜ |
| 1.2 | ⬜ |
| 1.3 | ⬜ |
| 1.4 | ⬜ |
| 1.5 | ⬜ |
| 1.6 | ⬜ |
| 1.7 | ⬜ |
| G1 | ⬜ |
| 2.1 | ⬜ |
| 2.2 | ⬜ |
| 2.3 | ⬜ |
| 2.4 | ⬜ |
| 2.5 | ⬜ |
| 2.6 | ⬜ |
| G2 | ⬜ |
| 3.1 | ⬜ |
| 3.2 | ⬜ |
| 3.3 | ⬜ |
| 3.4 | ⬜ |
| 3.5 | ⬜ |
| 3.6 | ⬜ |
| 3.7 | ⬜ |
| 3.8 | ⬜ |
| G3 | ⬜ |
| 4.1 | ⬜ |
| 4.2 | ⬜ |
| 4.3 | ⬜ |
| 4.4 | ⬜ |
| 4.5 | ⬜ |
| 4.6 | ⬜ |
| 4.7 | ⬜ |
| 4.8 | ⬜ |
| 4.9 | ⬜ |
| 4.10 | ⬜ |
| G4 | ⬜ |
| 5.1 | ⬜ |
| 5.2 | ⬜ |
| 5.3 | ⬜ |
| 5.4 | ⬜ |
| 5.5 | ⬜ |
| 5.6 | ⬜ |
| 5.7 | ⬜ |
| G5 | ⬜ |
| 6.1 | ⬜ |
| 6.2 | ⬜ |
| 6.3 | ⬜ |
| 6.4 | ⬜ |
| 6.5 | ⬜ |
| 6.6 | ⬜ |
| G6 | ⬜ |
