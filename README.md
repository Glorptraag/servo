# Servo

A digital robotics kit for children: real parts, wired together on a big canvas, simulated deterministically, with failure states as the teaching device. Planning is complete; the codebase does not exist yet. This folder holds everything an agent needs to build it.

## What is here

| Path | What it is |
| --- | --- |
| `CLAUDE.md` | The agent guide: reading order, the 14 ground rules, package map, terminology, how the plan is executed. Every session reads this first. |
| `docs/brief.md` | Product and design brief (export of the Claude doc). The product's source of truth. |
| `docs/plan.md` | Agentic build plan (export of the Claude doc): phases, work packages, gates, testing, session protocol. |
| `docs/decisions.md` | The eight decisions held for Drew, with the default the build proceeds on. |
| `docs/images/` | The three drawings from the docs: canvas layout, package map, roadmap. |
| `docs/gates/` | Written by the orchestrator as each gate G0–G6 comes up (checklists, results). Empty until then. |
| `.claude/plans/PLAN-servo.md` | The executable decomposition: 57 tasks across 7 phases with model labels, files, done-when lines and gates. |
| `.claude/plans/status.json` | Live state of every task and the decision queue. Never hand-edit; use `pharao.py`. |
| `.claude/plans/RUN-servo.md` | The orchestrator's run brief. |
| `.claude/plans/pharao.py` | The state engine (`ready`, `prompt`, `dispatch`, `done`, `fail`, `decision`, `status`, `graph`). |

## How to start the build

Open a Claude Code session in this folder on the most capable model available and paste:

```
Read .claude/plans/RUN-servo.md and execute it. You are the orchestrator.
```

The orchestrator dispatches task 0.1 (monorepo scaffold) first, then fans out. It will stop and ask at the human gates: G2 (read every spec card), G3 (wire both Level 1 robots by hand on a tablet and a laptop), G4 (three children build unaided), G5 (a family runs a week offline), G6 (five families, two weeks).

Useful commands:

```
python3 .claude/plans/pharao.py status
python3 .claude/plans/pharao.py ready
python3 .claude/plans/pharao.py graph
python3 .claude/plans/pharao.py decision list
python3 .claude/plans/pharao.py decision resolve D1 --answer "confirmed"
```

## Before the first run

Answer D1–D3 in `docs/decisions.md` if you want to steer them; otherwise the defaults apply (reframe as written, TypeScript web-first stack, private GitHub repo). Initialise git in this folder and push it to the chosen host so reviewer workers and CI have somewhere to run.

## Keeping the docs in sync

`docs/brief.md` and `docs/plan.md` are exports. When the Claude docs change, re-export them here before the next orchestrator session:

- Brief: https://claude.ai/code/artifact/08cdf597-8cae-4de4-9927-1172642f975b
- Plan: https://claude.ai/code/artifact/a21cd97b-54ec-45fe-b840-fb4bdda8d268
