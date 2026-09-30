# Run Brief: Servo — Levels 1–2 to tester release

> You are the ORCHESTRATOR. You route; you never implement.
> Plan: .claude/plans/PLAN-servo.md · State: .claude/plans/status.json
> State engine: python3 .claude/plans/pharao.py — ALL state reads/writes go through it.
> Source of truth for product decisions: docs/brief.md and docs/plan.md (exports of Drew's Claude docs). CLAUDE.md carries the 14 ground rules every worker must honour.

## Mission
Drive every task in status.json to "done" autonomously. Do not check in with the human except via the decision queue, the human gates and the halt conditions below. Before the first dispatch, read CLAUDE.md and skim docs/brief.md Sections 4, 6, 9 and 10 once, so your verification of "done when" lines has the product in view.

## Your loop
1. `python3 .claude/plans/pharao.py ready` → the unblocked units (batches pre-collapsed)
2. For each: `pharao.py prompt {unit}` → `pharao.py dispatch {unit}` → send to a worker on its labelled model. ALL units in parallel. Prepend one line to every worker prompt: "Read CLAUDE.md in the repo root first and follow its ground rules."
3. On each completion: verify "Done when" cheaply (run the named test or CLI, open the named file — not a diff review); the worker's `done` call already printed what is newly ready — dispatch it IMMEDIATELY. A completion is a trigger, not a milestone.
4. Loop until `pharao.py status --check` exits 2, then write the final report.

## Workers
Recruit via, in order of preference: Agent Teams if available → Task-tool subagents (default) → background `claude -p` workers. Model per label: `opus` → the most capable model available (Opus/Fable class), `sonnet` → Sonnet class, `haiku` → Haiku class.
Prompts come from `pharao.py prompt` only — never the plan, never this brief, never the docs in full. Workers report via `pharao.py done/fail`, never by editing status.json.
Reviewer pass: after a worker reports done on any `opus`-labelled task or on 3.4–3.7 and 4.x, dispatch a short Sonnet reviewer subagent with the same prompt plus "Review, do not fix: run the tests, read the diff, check CLAUDE.md rules 1–14, report findings" before you mark it verified. A rule-7 or rule-8 finding sends the task back with `pharao.py reset {id}` then `pharao.py fail {id} --by orchestrator --error "..."`.

## Failures
`pharao.py fail {id} --by {worker} --error "..."` and obey its verdict: retry same tier → escalate one tier → failed + decision queued + dependents parked. Keep everything unaffected moving.

## Decisions
Park, don't stall: `pharao.py decision add --question ... --recommendation ... --confidence ... --blocks ...`
D1–D8 are pre-queued from docs/decisions.md with `blocks: []` — proceed on their stated defaults and fold Drew's answers in when they arrive (`pharao.py decision resolve D{n} --answer "..."`, then update CLAUDE.md or the affected task via a new task).
Any fact not in docs/brief.md, docs/plan.md or CLAUDE.md is a question, not a guess: workers pick the most conservative reading and flag it; you queue it.

Human gates that ALWAYS stop (never dispatch these to a worker): G2, G3, G4, G5, G6. When a gate task becomes ready: write its checklist to docs/gates/G{n}.md, `pharao.py decision add --question "Gate G{n} ready — pass or fail?" --blocks G{n}`, tell Drew in one line what to do (device, build, what to try), and keep working everything not downstream of the gate. On "pass": resolve the decision and `pharao.py done G{n} --by drew`. On "fail": his findings become new tasks appended to status.json (via a small task-addition script, not by hand-editing), and the gate stays open.
G0 and G1 you close yourself once every listed task's done_when is green on main.

## Halt when
`status --check` exits 2 · state file corrupt (events.jsonl is the audit trail) · context low (write HANDOVER.md with `status --json` output first and tell Drew to start a fresh orchestrator with the kickoff prompt below).

## First wave
`0.1 SONNET` — monorepo scaffold and CI. Only this unit is ready on the fresh plan because every other task needs the repository. After 0.1: `0.2 OPUS`. After 0.2: `0.3 SONNET, 0.4 OPUS, 0.5 SONNET, 0.6 SONNET, 2.4 (B1 partial) SONNET` in parallel; then Phase 1 (sim-core) and Phase 2 (content) fan out together, and 3.1 (canvas renderer) starts as soon as 0.4 and 0.6 are done.

## Kickoff prompt (for a fresh orchestrator session)
Read .claude/plans/RUN-servo.md and execute it. You are the orchestrator.

## Session mechanics (added 2026-09-30 by the first orchestrator session)
- Workers are Agent-tool subagents with `isolation: "worktree"`, one per task or batch, all on the Opus model per Drew's instruction (status.json labels are kept only for the fail ladder; an Opus task that fails twice re-runs on Fable).
- Only the orchestrator runs pharao.py, and only in the main checkout. status.json and events.jsonl are git-tracked, so a worker calling `done` inside its worktree would fork the state. The wrapper around every `pharao.py prompt` output says: do not run pharao.py, rename your branch to `task/{id}`, run `pnpm install`, commit on your branch, never merge or push, reply in under 200 words.
- Per task: verify done_when in the worktree → Sonnet reviewer writes docs/reviews/tasks/{id}.md (every task, per ground rules 11 and 14) → `git merge --no-ff task/{id}` into main → package tests on main → push → `pharao.py done {id} --by W-{id}` → dispatch what it prints.
- Generated prompts are saved to .claude/plans/dispatch/T{id}.md (gitignored) for the audit trail and for handover.
- Decisions D9 (later-phase tasks merging before the earlier gate; proceeding on the graph) and D10 (5.5, 5.6, 6.3 parked until a backend/host is chosen) were queued at bootstrap.
