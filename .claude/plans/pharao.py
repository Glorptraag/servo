#!/usr/bin/env python3
"""pharao.py — deterministic state engine for Pharao plans.

Lives in .claude/plans/ next to status.json. Stdlib only. Every mutation is
flock-guarded and atomically written, so any number of concurrent workers can
call it safely. The orchestrator and workers should use this instead of
hand-editing status.json.

Commands:
  validate                 check schema, cycles, dangling refs, batch consistency
  suggest-gates            file-overlap analysis -> proposed missing gates
  ready [--json]           the READY set (unblocked, unparked), batches collapsed
  dispatch ID [ID...]      mark dispatched (accepts batch IDs like B1)
  done ID --by WORKER      mark done, then print newly unblocked tasks
  fail ID --by WORKER [--error MSG]
                           record failure; script decides retry / escalate / park
  park ID --reason MSG     park a task (and, transitively, report what it blocks)
  unpark ID                return a parked task to pending
  decision add --question Q --recommendation R --blocks 2.3,2.4 [--confidence C]
  decision list | decision resolve DID [--answer TEXT]
  prompt ID                emit the token-lean worker prompt (task or batch)
  status [--json]          summary, stale-dispatch detection, halt-state check
  graph                    mermaid dependency graph
  reset ID                 force a task back to pending (clears retries)

Exit codes: 0 ok · 1 validation errors / not found · 2 halt condition (status --check).
"""

import argparse
import json
import os
import sys
import tempfile
import time
from datetime import datetime, timezone

try:
    import fcntl
except ImportError:  # non-POSIX fallback: no locking, still atomic replace
    fcntl = None

HERE = os.path.dirname(os.path.abspath(__file__))
STATUS = os.environ.get("PHARAO_STATUS", os.path.join(HERE, "status.json"))
LOCK = STATUS + ".lock"
EVENTS = os.path.join(os.path.dirname(STATUS), "events.jsonl")

STALE_MIN = {"micro": 30, "standard": 90}
TIERS = ["haiku", "sonnet", "opus"]


def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class Lock:
    def __enter__(self):
        self.f = open(LOCK, "w")
        if fcntl:
            fcntl.flock(self.f, fcntl.LOCK_EX)
        return self

    def __exit__(self, *a):
        if fcntl:
            fcntl.flock(self.f, fcntl.LOCK_UN)
        self.f.close()


def load():
    with open(STATUS) as f:
        return json.load(f)


def save(state):
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(STATUS) or ".", prefix=".status.")
    with os.fdopen(fd, "w") as f:
        json.dump(state, f, indent=2)
        f.write("\n")
    os.replace(tmp, STATUS)


def log_event(kind, **data):
    rec = {"ts": now(), "event": kind, **data}
    with open(EVENTS, "a") as f:
        f.write(json.dumps(rec) + "\n")


def mutate(fn):
    """Run fn(state) under lock; save if it returns truthy; return its result."""
    with Lock():
        state = load()
        result = fn(state)
        if result is not None:
            save(state)
        return result


def tasks_of_batch(state, bid):
    return [tid for tid, t in state["tasks"].items() if t.get("batch") == bid]


def expand_ids(state, ids):
    """Expand batch IDs into their member task IDs; pass task IDs through."""
    out = []
    for i in ids:
        members = tasks_of_batch(state, i)
        out.extend(members if members else [i])
    return out


# ---------------------------------------------------------------- validate

def cmd_validate(args):
    state = load()
    tasks = state.get("tasks", {})
    errors, warnings = [], []

    for tid, t in tasks.items():
        for req in ("status", "model", "size"):
            if req not in t:
                errors.append(f"{tid}: missing field '{req}'")
        if t.get("model") not in TIERS:
            errors.append(f"{tid}: model '{t.get('model')}' not in {TIERS}")
        for dep in t.get("blocked_by", []):
            if dep not in tasks:
                errors.append(f"{tid}: blocked_by references unknown task '{dep}'")
        if t.get("size") == "standard" and t.get("batch"):
            errors.append(f"{tid}: standard tasks must not be batched (batch {t['batch']})")
        if not t.get("done_when"):
            warnings.append(f"{tid}: no 'done_when' — orchestrator can't verify it")
        if not t.get("files"):
            warnings.append(f"{tid}: no 'files' — conflict detection is blind to it")

    # cycle detection (iterative DFS)
    WHITE, GREY, BLACK = 0, 1, 2
    color = {tid: WHITE for tid in tasks}
    for start in tasks:
        if color[start] != WHITE:
            continue
        stack = [(start, iter(tasks[start].get("blocked_by", [])))]
        color[start] = GREY
        while stack:
            node, it = stack[-1]
            advanced = False
            for dep in it:
                if dep not in tasks:
                    continue
                if color[dep] == GREY:
                    errors.append(f"dependency cycle involving {node} -> {dep}")
                elif color[dep] == WHITE:
                    color[dep] = GREY
                    stack.append((dep, iter(tasks[dep].get("blocked_by", []))))
                    advanced = True
                    break
            if not advanced:
                color[node] = BLACK
                stack.pop()

    # batch consistency
    batches = {}
    for tid, t in tasks.items():
        if t.get("batch"):
            batches.setdefault(t["batch"], []).append(tid)
    for bid, members in batches.items():
        models = {tasks[m]["model"] for m in members}
        if len(models) > 1:
            errors.append(f"batch {bid}: mixed models {sorted(models)} across {members}")
        sizes = {tasks[m].get("size") for m in members}
        if sizes != {"micro"}:
            errors.append(f"batch {bid}: contains non-micro tasks")
        # members of a batch run sequentially in one worker; external deps only
        for m in members:
            same_batch_deps = [d for d in tasks[m].get("blocked_by", []) if d in members]
            if same_batch_deps:
                warnings.append(f"batch {bid}: {m} gated on batch-mates {same_batch_deps} (fine, but order them accordingly)")

    # file conflicts between potentially-concurrent tasks
    conflicts = file_conflicts(tasks)
    for a, b, shared in conflicts:
        errors.append(f"parallel file conflict: {a} and {b} can run concurrently but both touch {sorted(shared)}")

    for w in warnings:
        print(f"WARN  {w}")
    for e in errors:
        print(f"ERROR {e}")
    if not errors:
        print(f"OK — {len(tasks)} tasks, {len(batches)} batches, no cycles, no parallel file conflicts")
    return 1 if errors else 0


def ancestors(tasks, tid, memo):
    """All transitive blockers of tid."""
    if tid in memo:
        return memo[tid]
    memo[tid] = set()  # guard against cycles
    acc = set()
    for dep in tasks.get(tid, {}).get("blocked_by", []):
        if dep in tasks:
            acc.add(dep)
            acc |= ancestors(tasks, dep, memo)
    memo[tid] = acc
    return acc


def can_run_concurrently(tasks, a, b, memo):
    return b not in ancestors(tasks, a, memo) and a not in ancestors(tasks, b, memo)


def file_conflicts(tasks):
    """Pairs of order-unrelated tasks that write overlapping files."""
    memo = {}
    ids = sorted(tasks)
    out = []
    for i, a in enumerate(ids):
        fa = set(tasks[a].get("files", []))
        if not fa:
            continue
        for b in ids[i + 1:]:
            if tasks[a].get("batch") and tasks[a].get("batch") == tasks[b].get("batch"):
                continue  # batch-mates run sequentially in one worker
            fb = set(tasks[b].get("files", []))
            shared = fa & fb
            if shared and can_run_concurrently(tasks, a, b, memo):
                out.append((a, b, shared))
    return out


def cmd_suggest_gates(args):
    state = load()
    tasks = state["tasks"]
    conflicts = file_conflicts(tasks)
    if not conflicts:
        print("No missing gates suggested — no order-unrelated tasks share files.")
        return 0
    print("Suggested gates (earlier ID assumed upstream — review direction!):\n")
    for a, b, shared in conflicts:
        print(f'  gate {b} on {a}  — both touch {", ".join(sorted(shared))}')
    print("\nApply by adding the blocker to blocked_by in status.json, or soften "
          "with a stub/interface contract and split the files instead.")
    return 0


# ------------------------------------------------------------------ ready

def ready_set(state):
    tasks = state["tasks"]
    ready = []
    for tid, t in tasks.items():
        if t["status"] != "pending":
            continue
        if all(tasks.get(d, {}).get("status") == "done" for d in t.get("blocked_by", [])):
            ready.append(tid)
    # collapse into batches, but only when the whole batch is ready
    units, seen_batches = [], set()
    for tid in sorted(ready):
        b = tasks[tid].get("batch")
        if not b:
            units.append({"unit": tid, "model": tasks[tid]["model"], "tasks": [tid]})
        elif b not in seen_batches:
            members = tasks_of_batch(state, b)
            if all(m in ready for m in members):
                units.append({"unit": b, "model": tasks[members[0]]["model"], "tasks": sorted(members)})
                seen_batches.add(b)
            else:
                # partial batch: dispatch ready members individually
                for m in sorted(set(members) & set(ready)):
                    units.append({"unit": m, "model": tasks[m]["model"], "tasks": [m]})
                seen_batches.add(b)
    return units


def cmd_ready(args):
    units = ready_set(load())
    if args.json:
        print(json.dumps(units, indent=2))
    elif not units:
        print("READY: (none)")
    else:
        for u in units:
            print(f'{u["unit"]:8s} [{u["model"].upper():6s}] {" ".join(u["tasks"])}')
    return 0


# --------------------------------------------------------------- mutations

def cmd_dispatch(args):
    def fn(state):
        ids = expand_ids(state, args.ids)
        for tid in ids:
            t = state["tasks"].get(tid)
            if not t:
                print(f"unknown task {tid}", file=sys.stderr)
                return None
            t["status"] = "dispatched"
            t["dispatched_at"] = now()
        log_event("dispatch", tasks=ids)
        print(f"dispatched: {', '.join(ids)}")
        return True
    return 0 if mutate(fn) else 1


def cmd_done(args):
    newly = []

    def fn(state):
        ids = expand_ids(state, [args.id])
        for tid in ids:
            t = state["tasks"].get(tid)
            if not t:
                print(f"unknown task {tid}", file=sys.stderr)
                return None
            t["status"] = "done"
            t["completed_at"] = now()
            t["completed_by"] = args.by
        log_event("done", tasks=ids, by=args.by)
        for u in ready_set(state):
            newly.append(u)
        return True

    if mutate(fn) is None:
        return 1
    print(f"done: {args.id}")
    if newly:
        print("NEWLY READY — dispatch now:")
        for u in newly:
            print(f'  {u["unit"]} [{u["model"].upper()}] {" ".join(u["tasks"])}')
    else:
        print("Nothing newly unblocked.")
    return 0


def cmd_fail(args):
    def fn(state):
        t = state["tasks"].get(args.id)
        if not t:
            print(f"unknown task {args.id}", file=sys.stderr)
            return None
        t["retries"] = t.get("retries", 0) + 1
        t.setdefault("errors", []).append({"ts": now(), "by": args.by, "error": args.error or ""})
        r = t["retries"]
        if r == 1:
            t["status"] = "pending"
            verdict = f"RETRY same tier ({t['model']}), append the error context to the prompt"
        elif r == 2:
            i = TIERS.index(t["model"])
            if i < len(TIERS) - 1:
                t["model"] = TIERS[i + 1]
            t["status"] = "pending"
            verdict = f"ESCALATED to {t['model']} — retry once"
        else:
            t["status"] = "failed"
            did = f"D{len(state.get('decision_queue', [])) + 1}"
            state.setdefault("decision_queue", []).append({
                "id": did,
                "question": f"Task {args.id} failed 3x. Last error: {(args.error or '')[:300]}",
                "recommendation": "Review task spec; likely under-specified or blocked by an unmodelled dependency.",
                "confidence": "low",
                "blocks": dependents_of(state, args.id),
                "resolved": False,
            })
            park_ids(state, dependents_of(state, args.id), f"blocked by failed task {args.id} ({did})")
            verdict = f"FAILED permanently — decision {did} queued; dependents parked; keep everything else moving"
        log_event("fail", task=args.id, retries=r, by=args.by)
        print(verdict)
        return True
    return 0 if mutate(fn) else 1


def dependents_of(state, tid):
    return sorted(t for t, v in state["tasks"].items() if tid in v.get("blocked_by", []))


def park_ids(state, ids, reason):
    for tid in ids:
        t = state["tasks"].get(tid)
        if t and t["status"] in ("pending", "dispatched"):
            t["status"] = "parked"
            t["parked_reason"] = reason


def cmd_park(args):
    def fn(state):
        park_ids(state, expand_ids(state, [args.id]), args.reason)
        log_event("park", task=args.id, reason=args.reason)
        print(f"parked {args.id}: {args.reason}")
        return True
    return 0 if mutate(fn) else 1


def cmd_unpark(args):
    def fn(state):
        t = state["tasks"].get(args.id)
        if not t:
            return None
        t["status"] = "pending"
        t.pop("parked_reason", None)
        log_event("unpark", task=args.id)
        print(f"unparked {args.id}")
        return True
    return 0 if mutate(fn) else 1


def cmd_reset(args):
    def fn(state):
        t = state["tasks"].get(args.id)
        if not t:
            return None
        t["status"] = "pending"
        t["retries"] = 0
        t.pop("dispatched_at", None)
        log_event("reset", task=args.id)
        print(f"reset {args.id} to pending")
        return True
    return 0 if mutate(fn) else 1


# --------------------------------------------------------------- decisions

def cmd_decision(args):
    if args.action == "list":
        q = load().get("decision_queue", [])
        open_q = [d for d in q if not d.get("resolved")]
        print(json.dumps(open_q, indent=2) if open_q else "Decision queue empty.")
        return 0

    def fn(state):
        q = state.setdefault("decision_queue", [])
        if args.action == "add":
            did = f"D{len(q) + 1}"
            blocks = [b for b in (args.blocks or "").split(",") if b]
            q.append({"id": did, "question": args.question, "recommendation": args.recommendation,
                      "confidence": args.confidence, "blocks": blocks, "resolved": False})
            park_ids(state, blocks, f"awaiting decision {did}")
            log_event("decision_add", id=did, blocks=blocks)
            print(f"queued {did}, parked: {blocks or 'nothing'}")
        else:  # resolve
            d = next((d for d in q if d["id"] == args.did), None)
            if not d:
                print(f"unknown decision {args.did}", file=sys.stderr)
                return None
            d["resolved"] = True
            d["answer"] = args.answer or ""
            for tid in d.get("blocks", []):
                t = state["tasks"].get(tid)
                if t and t["status"] == "parked":
                    t["status"] = "pending"
                    t.pop("parked_reason", None)
            log_event("decision_resolve", id=args.did)
            print(f"resolved {args.did}; unparked {d.get('blocks', [])}")
        return True
    return 0 if mutate(fn) else 1


# ------------------------------------------------------------------ prompt

def cmd_prompt(args):
    state = load()
    ids = expand_ids(state, [args.id])
    is_batch = len(ids) > 1
    tasks = state["tasks"]
    missing = [i for i in ids if i not in tasks]
    if missing:
        print(f"unknown: {missing}", file=sys.stderr)
        return 1
    header = (f"You are a worker on batch {args.id} — complete these tasks IN ORDER."
              if is_batch else
              f"You are a worker on task {args.id}: {tasks[args.id].get('title', '')}.")
    lines = [header, ""]
    for tid in ids:
        t = tasks[tid]
        if is_batch:
            lines.append(f"--- Task {tid}: {t.get('title', '')}")
        if t.get("description"):
            lines.append(t["description"])
        if t.get("files"):
            lines.append(f"Files you may touch: {', '.join(t['files'])}")
        if t.get("contracts"):
            lines.append(f"Interface contracts you must honour: {t['contracts']}")
        if t.get("done_when"):
            lines.append(f"Done when: {t['done_when']}")
        if t.get("errors"):
            lines.append(f"Previous attempt failed with: {t['errors'][-1]['error'][:500]}")
        lines.append("")
    lines += [
        "When finished with each task:",
        "1. Verify its acceptance criteria yourself.",
        f"2. Run: python3 {os.path.relpath(os.path.abspath(__file__))} done {{TASK_ID}} --by {{your-worker-id}}",
        "3. Reply with: files changed, how you verified, and any decision you made that wasn't in the spec.",
        "",
        "Do NOT read PLAN.md, RUN.md, or other tasks' specs. Do NOT edit status.json by hand.",
    ]
    print("\n".join(lines))
    return 0


# ------------------------------------------------------------------ status

def cmd_status(args):
    state = load()
    tasks = state["tasks"]
    counts = {}
    for t in tasks.values():
        counts[t["status"]] = counts.get(t["status"], 0) + 1

    stale = []
    for tid, t in tasks.items():
        if t["status"] == "dispatched" and t.get("dispatched_at"):
            try:
                age = (datetime.now(timezone.utc)
                       - datetime.fromisoformat(t["dispatched_at"])).total_seconds() / 60
            except ValueError:
                continue
            if age > STALE_MIN.get(t.get("size", "standard"), 90):
                stale.append((tid, int(age)))

    open_decisions = [d for d in state.get("decision_queue", []) if not d.get("resolved")]
    units = ready_set(state)

    all_done = counts.get("done", 0) == len(tasks)
    live = counts.get("pending", 0) + counts.get("dispatched", 0)
    halted = all_done or (live == 0 and len(tasks) > 0)

    if args.json:
        print(json.dumps({"counts": counts, "ready": units, "stale": stale,
                          "open_decisions": [d["id"] for d in open_decisions],
                          "halted": halted, "all_done": all_done}, indent=2))
    else:
        print(f"Plan: {state.get('plan', '?')}   " +
              "  ".join(f"{k}:{v}" for k, v in sorted(counts.items())))
        if units:
            print("READY: " + ", ".join(f'{u["unit"]}[{u["model"]}]' for u in units))
        if stale:
            for tid, age in stale:
                print(f"STALE: {tid} dispatched {age} min ago with no completion — "
                      f"consider `reset {tid}` and re-dispatch")
        if open_decisions:
            print("OPEN DECISIONS: " + ", ".join(d["id"] for d in open_decisions))
        if all_done:
            print("ALL DONE — write the final report.")
        elif halted:
            print("HALT: nothing pending or dispatched; everything remaining is parked/failed. "
                  "Report the decision queue.")
    if args.check:
        return 2 if halted else 0
    return 0


def cmd_graph(args):
    state = load()
    print("```mermaid\ngraph LR")
    for tid, t in sorted(state["tasks"].items()):
        mark = {"done": "✅", "dispatched": "🚚", "failed": "❌", "parked": "🅿️"}.get(t["status"], "")
        print(f'  {tid.replace(".", "_")}["{tid} {mark} [{t["model"]}]"]')
        for dep in t.get("blocked_by", []):
            print(f'  {dep.replace(".", "_")} --> {tid.replace(".", "_")}')
    print("```")
    return 0


# -------------------------------------------------------------------- main

def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("validate")
    sub.add_parser("suggest-gates")
    sp = sub.add_parser("ready"); sp.add_argument("--json", action="store_true")
    sp = sub.add_parser("dispatch"); sp.add_argument("ids", nargs="+")
    sp = sub.add_parser("done"); sp.add_argument("id"); sp.add_argument("--by", required=True)
    sp = sub.add_parser("fail"); sp.add_argument("id"); sp.add_argument("--by", required=True); sp.add_argument("--error", default="")
    sp = sub.add_parser("park"); sp.add_argument("id"); sp.add_argument("--reason", required=True)
    sp = sub.add_parser("unpark"); sp.add_argument("id")
    sp = sub.add_parser("reset"); sp.add_argument("id")
    sp = sub.add_parser("prompt"); sp.add_argument("id")
    sp = sub.add_parser("status"); sp.add_argument("--json", action="store_true"); sp.add_argument("--check", action="store_true")
    sub.add_parser("graph")
    sp = sub.add_parser("decision")
    sp.add_argument("action", choices=["add", "list", "resolve"])
    sp.add_argument("did", nargs="?")
    sp.add_argument("--question"); sp.add_argument("--recommendation", default="")
    sp.add_argument("--confidence", default="medium"); sp.add_argument("--blocks", default="")
    sp.add_argument("--answer", default="")

    args = p.parse_args()
    try:
        import signal
        signal.signal(signal.SIGPIPE, signal.SIG_DFL)
    except (ImportError, AttributeError, ValueError):
        pass
    fn = {
        "validate": cmd_validate, "suggest-gates": cmd_suggest_gates, "ready": cmd_ready,
        "dispatch": cmd_dispatch, "done": cmd_done, "fail": cmd_fail, "park": cmd_park,
        "unpark": cmd_unpark, "reset": cmd_reset, "prompt": cmd_prompt,
        "status": cmd_status, "graph": cmd_graph, "decision": cmd_decision,
    }[args.cmd]
    sys.exit(fn(args))


if __name__ == "__main__":
    main()
