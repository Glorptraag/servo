# Servo — agent guide

Servo is a digital robotics kit for children (6–8 at launch, a ladder to ~12): real parts, wired together on a big canvas, simulated deterministically, with failure states as the teaching device. This file is what every agent session reads first. It is written from `docs/brief.md` (product and design brief) and `docs/plan.md` (agentic build plan); those two files are the source of truth for product decisions and are exports of Drew's Claude docs — refresh them from the docs before an orchestrator session, never edit them here.

## Reading order for any session

1. This file.
2. `docs/brief.md` — Sections 4 (core experience), 6 (technical architecture), 9 (canvas structure) and 10 (interaction design) at minimum. Workers on content also read Section 12 (voice).
3. `docs/plan.md` Section 2 (ground rules, repeated below) and Section 3 (package layout).
4. `.claude/plans/status.json` via `python3 .claude/plans/pharao.py ready` / `status` — never by opening the file to edit it.
5. Your own task's prompt from `python3 .claude/plans/pharao.py prompt {id}`.

Nothing else is assumed to be in context. Chat carries nothing between sessions; if a fact matters it is in a file here or in a test.

## Ground rules (a package that breaks one is rejected at review even if its tests pass)

Architecture

1. Parts are data. No part's identity, ports, behaviour or failure mode is written into UI or engine code. Adding a part touches only `packages/content` and its fixtures.
2. The simulation core is pure and deterministic: same blueprint + same arena + same seed gives the same run, tick for tick. `packages/sim-core` has no dependency on the UI, the DOM or the wall clock.
3. Wires join typed ports only (power, signal, mechanical; directional where the type is). The type rules live in one module in `packages/schema` that the canvas and the engine both import.
4. Build mode edits a blueprint; Run mode consumes a snapshot and never writes back. Stop restores the snapshot exactly.
5. The blueprint is the only persisted build format, versioned from day one with a migration path.
6. Every package exposes an interface file (types plus a one-page README) before its implementation; other packages build against the interface. `packages/canvas` reaches `sim-core` only through `packages/sim-core/src/interface.ts`.

Product

7. Real component names everywhere in code, content and UI: servo motor, DC motor, microcontroller, ultrasonic sensor, motor driver, LED, buzzer, battery pack, caster, gearbox, chassis. No character names, no mascot, no robot face, no points, coins, streaks or lives, no praise in system text, no exclamation marks in system text.
8. Every canvas action has a touch path, a pointer path and a list-view (screen-reader) path, delivered together, not later.
9. Failure modes are simulated behaviour, never error dialogs. Text hints follow the hint ladder: pulse the part → pulse the port → ghost wire → do it for me.
10. Levels 1–2 are launch scope. Level 3+ features are built only when a task explicitly names them.

Process

11. One task per branch; a task merges only with its `done_when` green and a reviewer report attached.
12. Placeholder art is vector, drawn from the part's schema colours and proportions, keyed through the swap registry. Agents never generate final art.
13. Anything not stated in `docs/brief.md`, `docs/plan.md` or this file is a question for Drew, raised through `pharao.py decision add`, not a guess. Pick the most conservative interpretation and flag it.
14. Definition of done for a task: interface unchanged or change noted; tests added and green; package README updated; content validated with `pnpm validate-content`; reviewer report filed; `pharao.py done {id}` run.

## Package map (one monorepo, strict dependency direction)

| Package | Owns | Depends on |
| --- | --- | --- |
| `packages/schema` | Part, port, wire, mount, blueprint, arena, challenge, run-record types; validators; blueprint versioning and migrations. Frozen at v1 after Phase 0. | nothing |
| `packages/content` | Parts records, kits, arenas, challenges, spec-card text, terminology lists, fixture blueprints | schema |
| `packages/sim-core` | Graph builder; electrical, program and mechanical solvers; tick loop; snapshot/restore; run recorder | schema |
| `packages/canvas` | Build surface: renderer, placement, wiring, selection, list view, Run animation | schema, sim-core (interface only) |
| `packages/app` | Shell, tray, library, spec card, Run bar, arena strip, challenges, hints, store, offline/sync, sound, a11y | schema, content, sim-core, canvas |
| `packages/parent` | Adult account, child profiles, progress view, parts-list export, card game | schema, app store |
| `packages/tools` | Content validator CLI, placeholder-art generator, swap registry, golden-run harness, canvas e2e harness, release | all, dev-only |

Arrows point down: content and sim-core know nothing about the UI; the UI never reaches past sim-core's interface. See `docs/images/package-map.png`.

## Terminology (also enforced by the content validator)

Use: battery pack, switch, bumper switch, DC motor, servo motor, motor driver, gearbox, wheel, caster, chassis (frame), LED, buzzer, microcontroller, line sensor, ultrasonic sensor, power line (red), signal line (yellow), mechanical linkage / mount (grey), blueprint (a saved build), kit (a curated bag of parts), challenge, breakdown, what-if, unscripted build, spec card, hint ladder, Build mode, Run mode, arena.
Never: mascot or character names for parts, "brain-y bit", "zappy wire", any robot voice, points, coins, streaks, lives, "great job".

## How to run

Filled in by task 0.1 (monorepo scaffold). Until then: `pnpm install`, `pnpm -r test`, `pnpm validate-content <path>`.

## Plan execution

This project uses a structured plan in `.claude/plans/`.

- Read the active plan: `cat .claude/plans/PLAN-servo.md`
- Check task status: `python3 .claude/plans/pharao.py status`
- The orchestrator brief: `.claude/plans/RUN-servo.md` — kickoff prompt: *Read .claude/plans/RUN-servo.md and execute it. You are the orchestrator.*

State is managed by `.claude/plans/pharao.py` — never hand-edit `status.json`.

When assigned a task:

1. Check it is unblocked: `python3 .claude/plans/pharao.py ready`
2. If blocked, pick another unit from the ready list instead
3. On completion: `python3 .claude/plans/pharao.py done {ID} --by {your worker ID}` — the command prints any tasks your completion just unblocked; note them in your output
4. On failure: `python3 .claude/plans/pharao.py fail {ID} --by {your worker ID} --error "..."`

Model guidance: `[OPUS]` tasks involve architectural or interface decisions (schema, sim-core solvers, canvas engine, reviewer sweep) and should run on the most capable model available; `[SONNET]` tasks are well-specified implementation and content; `[HAIKU]` is reserved for mechanical micro-tasks.

Human gates G2–G6 are never dispatched to a worker: the orchestrator writes the checklist to `docs/gates/`, queues a decision, and waits for Drew.

## Open decisions

`docs/decisions.md` lists D1–D8 with the default the plan proceeds on if unanswered. They are mirrored in the decision queue (`python3 .claude/plans/pharao.py decision list`).
