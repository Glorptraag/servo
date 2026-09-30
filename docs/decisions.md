# Decisions held for Drew

As of 2026-09-30. Each row is mirrored in the plan's decision queue (`python3 .claude/plans/pharao.py decision list`). The build proceeds on the default until Drew answers; answer by resolving the decision (`pharao.py decision resolve D{n} --answer "..."`) or by editing this file and telling the orchestrator.

| # | Decision | Needed by | Default if unanswered | Answer |
| --- | --- | --- | --- | --- |
| D1 | Confirm the reframe (parts over story, less character — the reading of "too emotive") and the extended age ladder to about 12 with Levels 1–2 as launch scope | Phase 0 | As written in docs/brief.md Sections 1–2 | |
| D2 | Stack: TypeScript web-first app, 2D canvas renderer, small 2D physics library, local-first store with sync | Phase 0 | Accept; task 0.1 proposes concrete libraries in docs/stack.md | |
| D3 | Repository host and CI | Phase 0 | GitHub, private, GitHub Actions | |
| D4 | Name the eleventh part family (the earlier draft named ten of eleven) and confirm the Level 1–2 parts lists in tasks 2.1 and 2.2 | Phase 2 | Ten families; lists as written | |
| D5 | Kit names: "Rolling Start" (L1) and "Circuit Crew" (L2) | Phase 2 | Placeholders kept | |
| D6 | Part render style and background treatment for final art (Higgsfield style sheet) | Phase 6 or later | Vector placeholders ship to testers | |
| D7 | Tester families and devices for G4 and G6 | Phase 4 | Orchestrator drafts the observation sheets; Drew recruits | |
| D8 | Monetisation, and whether a classroom layer follows G6 | After G6 | Nothing built | |

## Also open in the brief (docs/brief.md Section 14)

- Does Servo the robot have a face? The brief says no (ground rule 7).
- Tablet-first with desktop equal, or keep phone as a full target? The brief assumes phone is library-and-replay only.
- Share the existing e-learning suite's design conventions so Servo can align with them (suite alignment row, brief Section 7).

## Decisions already made in the brief (do not reopen without Drew)

- Sandbox first; kits and challenges layered on top; no separate lesson screen.
- Knowledge ladder Name → Connect → Configure → Diagnose → Design; Levels 1–2 are launch scope.
- The full ~60-part catalogue lives in a browsable Library; a curated kit tray per level; drag-out from the Library only from Level 3.
- Wire colours: power red, signal yellow, mechanical grey, with line-style and port-shape twins for colour-blind users.
- No points, coins, streaks, lives, mascot or robot face; failure is behaviour, hints are drawn on the canvas.
- Blueprint is the only persisted format; hardware bridge and classroom layer are designed for in the blueprint format but not built in v1.
