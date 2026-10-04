# Review 6.4 · packages/schema
Base: main 69f37ce. Reviewer: task 6.4 sweep.

## Verdict

9 findings: 0 high, 1 medium, 7 low, 1 nit. No open rule-7 or rule-8 findings. Schema has no UI. Its validator and wiring messages reach only logs and tests: canvas `interface.ts:271` says so, the app's hint code `console.warn`s them, and sharing maps them to its own copy. A scan of src, fixtures and docs found no banned words and no exclamation marks.

The wire rules live in one module (`src/validate/wiring.ts`), and canvas, sim-core, tools and content all import it. A probe found that `planWire` and `validateBlueprint` agree on all 4,434 port pairs over the 7 valid fixtures. Blueprint versioning is sound. The open problems are process and drift:
- questions earlier reviews put to Drew that never reached the decision queue (SCH-1);
- a "frozen" migration step that depends on live v1 code (SCH-2);
- run-record snapshots that the version-2 recipe does not cover (SCH-3);
- stale docs and messages.

## Commands run

| Command | Result |
| --- | --- |
| `pnpm --filter @servo/schema test` | 14 files, 666 tests passed |
| `pnpm --filter @servo/schema typecheck` | clean |
| `pnpm exec eslint packages/schema` | clean (exit 0) |
| `pnpm validate-content --catalogue packages/schema/fixtures packages/schema/fixtures/{parts,arenas,challenges,kits/valid}` | 23 records, no issues (terminology included) |
| `pnpm validate-content packages/schema/fixtures/{parts,arenas,challenges,kits/valid}` (content catalogue) | 2 issues: `one-motor-backwards.json` `mount.misplaced` at `$.start.parts[3]` and `[4]` (SCH-7) |
| `git log --oneline -- packages/schema/src` | last change c9fed88 (task 0.3 merge). Nothing in `src/` changed after Phase 0 |
| `git log -- packages/schema` since c9fed88 | 39be418, df6bcfe, a7cca7b: docs and fixture text only, all noted in R-2.1, R-2.2 and R-2.3 |
| grep of canvas, sim-core, app, tools, parent and content for socket, direction and role logic | all legality goes through `checkPortPair` or `planWire`. Role literals in parent and in the canvas pre-filters (SCH-6) |
| scratch probe 1: `planWire` vs `validateBlueprint` over every ordered port pair of the 7 valid fixtures | 4,434 pairs. 476 power or signal wires accepted by both; 3,958 refused by `planWire`, and every refused wire written raw is also refused by `validateBlueprint`. 0 mismatches either way |
| scratch probe 2: `validateBlueprint` and `migrateBlueprint` on versions -1, 0, 0.5, "1", "2", 2, 1e400, null; a run record holding a v0 snapshot | newer versions are refused the same way on both paths; "Migrate it first" for unmigratable versions (SCH-4); the run record is refused with `blueprint.unsupported_version` (SCH-3) |
| scratch probe 3: diff of schema example parts against `packages/content/parts` (text fields ignored) | 11 of the 13 shared records differ in behaviour, ports, failure modes, body or level (SCH-7) |
| decision-queue read (status.json, read only) | 115 entries. None for R-0.3 Q1–Q3 or R-0.2 Q1–Q2 (SCH-1) |

## Rules 1-14

1. Holds. No part ids in src. `'switch'` appears only as a primitive kind. Behaviour is a closed primitive vocabulary.
2. Holds for schema. No clock or randomness. `cosSin` is used for angles. `new Date(ms)` in `migrate/v0-to-v1.ts:176` formats a stored number and does not read the clock.
3. Holds at the source. One module, used by canvas, sim-core, tools and content, and probe 1 agrees with the validator. Drift outside: SCH-6.
4. Not applicable. Schema has no Run. The type docs state the snapshot rule (`types/blueprint.ts:79-82`).
5. Holds:
   - `version`, `BLUEPRINT_VERSION` and a compile-time tie between them;
   - v0→v1 is tested;
   - newer versions are refused, never guessed;
   - the list stays contiguous.
   Future-proofing gaps: SCH-2 and SCH-3.
6. Holds. `src/index.ts` is the interface, the README is 52 lines, and the package exports only `.` and `./fixtures`.
7. Holds:
   - `PORT_TYPE_STYLE` uses the real line names;
   - the family label "Brain" is the brief's own (Section 3, line 60);
   - no exclamation marks or banned words;
   - the messages are not child-visible.
8. Not applicable (no controls).
9. Holds for schema: failure modes are data and no dialogs. Explanation gaps carried from R-0.2 remain: SCH-9.
10. Holds:
    - `ProgramPrimitive` is a documented no-op (`types/behaviour.ts:180-184`);
    - Level 3 line markings and the microcontroller exist only as types and a test fixture;
    - content has no Level 3 part;
    - the 6.6 flag lives in app.
11. Holds. Every schema change merged through a reviewed task.
12. Not applicable (identity colours only).
13. SCH-1: review questions never queued.
14. SCH-4, SCH-5, SCH-7, SCH-8: stale messages and docs. Tests, typecheck and lint are green.

Frozen at v1: holds. No type or validator change after the Phase 0 merges. The 0.3 change to 0.2's contract (`blueprint.newer_version`) landed inside Phase 0, but its sign-off question was never queued (SCH-1).

## Findings

**SCH-1 · medium · rule 13 · `docs/reviews/tasks/0.3.md:98-105`, `docs/reviews/tasks/0.2.md:119-125`**
What: five questions that earlier reviews put to Drew were never queued, so Drew never sees them and the build runs on unrecorded defaults:
- R-0.3 Q1: `blueprint.newer_version` changes task 0.2's merged contract, and app sharing and the store now rely on it;
- R-0.3 Q2: a migrated blueprint keeps a derived id;
- R-0.3 Q3: run-record snapshots on a version bump;
- R-0.2 Q1: each setting shows from its own unlock level (D48 covers only the DC motor's direction);
- R-0.2 Q2: mirrored mounts against the lighting in final art.

Proof: a read-only scan of `status.json` `decision_queue` (115 entries) for "newer", "derived", "snapshot", "migrat", "unlock", "mirror image" and "light" found none of them. `docs/decisions.md` lists only D1–D8.
Proposed fix: FU-SCH-1.

**SCH-2 · low · rule 5 · `packages/schema/src/migrate/v0-to-v1.ts:4-22`, `packages/schema/docs/migrations.md:40`**
What: R-0.3 finding 3 still holds. The step that is meant to be frozen imports `idNumber` (`validate/blueprint.ts:108`) and `canonicalJson` from live v1 code, plus shared reader-kit primitives (`readName`, `readLevel`, `readSlug`, `readUuid`). A later edit to any of them would silently change what v0→v1 accepts, or the ids and high-water marks it writes. Only the two pinned fixtures would notice. migrations.md:40 claims that later reader changes "never change it". The version-2 recipe (`migrations.md:81-86`) does not say to freeze these helpers.
Proof: `sed -n 1,25p packages/schema/src/migrate/v0-to-v1.ts`.
Proposed fix: FU-SCH-3.

**SCH-3 · low · rule 5 · `packages/schema/src/validate/run.ts:171`, `packages/schema/docs/migrations.md:81-86`**
What: R-0.3 finding 4 still holds. A run record, and a challenge's start build, read their blueprint with the current reader. After a version bump, every stored run record stops validating unless its snapshot is migrated first. The recipe covers stored blueprints only.
Proof: probe 2. A valid run record with its `blueprint` swapped for the v0 fixture is refused with `blueprint.unsupported_version` at `$.blueprint.version`.
Proposed fix: FU-SCH-3, after FU-SCH-1 settles R-0.3 Q3.

**SCH-4 · low · rule 14 · `packages/schema/src/validate/blueprint.ts:150-158`, `packages/schema/src/types/issue.ts:49`, `packages/schema/docs/validation.md:82`**
What: R-0.3 finding 2 still holds. `validateBlueprint` ends with "Migrate it first" for versions no migration can read: -1, 0.5, "1", "2" and Infinity. `ISSUE_CODES` and validation.md still describe `unsupported_version` as "not version 1", though newer versions have their own code. Only logs and tests see these messages.
Proof: probe 2. For example, `"2"` gives `blueprint.unsupported_version: … this one is version '2'. Migrate it first.`, while `migrateBlueprint` gives `value.wrong_type`.
Proposed fix: FU-SCH-2.

**SCH-5 · low · rule 14 · `packages/schema/docs/validation.md:31`, `packages/schema/docs/documents.md:15`**
What: R-0.3 finding 5 still holds. Both docs say every blueprint id is a random UUID v4 that the app generates. Migrated v0 blueprints carry a SHA-256-derived id, and only migrations.md says so.
Proof: lines as quoted. The derived-id section is at migrations.md:60-66.
Proposed fix: FU-SCH-2.

**SCH-6 · low · rule 3 · `packages/parent/src/export/parts-list.ts:198-203`; `packages/canvas/src/placement/rules.ts:67`; `packages/canvas/src/list-view/actions.ts:110-115`**
What: wire-kind and direction rules are re-derived from role literals outside the schema:
- The parts-list export decides mount or drive, and which end is the source, from `role === 'mount'` and `role === 'drive-out'`, instead of `checkPortPair`'s `kind` and `swap`. Canvas already has the schema-backed `wireKindOf` (`wiring/commands.ts:18`).
- The canvas snap and carry pre-filters hard-code the partner sockets (mount→mount-point, drive-in→drive-out) before calling `planWire`. `planWire` still gates acceptance, so nothing wrong can be accepted. But a pairing added in schema would never be offered there.
Proof: the grep in Commands run. These are the only role-literal kind or direction derivations outside schema and sim-core's behaviour code.
Proposed fix: FU-SCH-4.

**SCH-7 · low · rule 14 · `packages/schema/docs/parts.md:92`, `packages/schema/README.md:42-48`**
What: R-2.3 minor 2 still holds and has grown:
- parts.md says the example records "differ in places" and names only the LED and the buzzer;
- 11 of the 13 records shared with content differ in non-text fields;
- the microcontroller row has no content record;
- the schema's `one-motor-backwards` challenge no longer validates against the shipped catalogue.

Sim-core, app, canvas, parent and tools tests, and the 11 schema golden cases, run on these examples, so readers should know they are frozen Phase 0 data and not mirrors of content. parts.md also still does not state the loose-support (balance) attribution that R-2.6 minor 2 asked for (now D62).
Proof: probe 3. For example, `dc-motor` differs in `.behaviour`, `.ports`, `.failureModes` and `.body`, and `led` in `.identity.level`. The content-catalogue `validate-content` run gives 2 `mount.misplaced` issues.
Proposed fix: FU-SCH-2.

**SCH-8 · nit · rule 14 · `packages/schema/README.md:3`, `packages/schema/docs/decisions.md:34-40`, `packages/schema/test/part.test.ts:192-193`**
What: small stale items:
- The README says migrations "arrive with task 0.3", in the future tense.
- The open questions in decisions.md carry no D numbers. Queue entries D18 and D21 cite "schema README Q4" and "Q7", which no longer match the list: Q4 is now the mirrored-mount kit wiring (D27).
- Q5 (same-colour refusal cues) is answered by canvas design (`packages/canvas/docs/wiring.md:41,105`, the push-away) but is still listed as open.
- The test titles "the frame drags" and "frame on the floor" use the gloss alone (R-0.5). Test-only text.

Proof: lines as quoted.
Proposed fix: FU-SCH-2.

**SCH-9 · low · rule 9 · `packages/schema/src/circuit/wired.ts:593`, `packages/schema/src/circuit/wired.ts:295-318`**
What: R-0.2 N11 and N12 still hold. `wired.ts` is unchanged since the reviewed commit 8e203e6.
- N11: a motor behind a driver channel at stop, where the driver itself is unpowered, is explained by `controls: [channel]` when it should be `feeder`.
- N12: with two closed switches side by side across a pack, only the pack shows `short-circuit` and neither switch shows `across-the-pack`. A hint that pulses the faulted part would point at the pack, not at a switch to open.

Proof: `git log -1 --format=%h -- packages/schema/src/circuit/wired.ts` prints 8e203e6, the head R-0.2 probed.
Proposed fix: FU-SCH-5.

## Checked and disproved

- **Wire rules re-implemented in sim-core or canvas.** Disproved:
  - sim-core `graph/build.ts:117` and canvas `scene.ts:175`, `wiring/commands.ts:23`, `selection/hints.ts:42`, `placement/notices.ts:20` and `holding.ts:115` all call `checkPortPair`;
  - every drop, snap and list-view wire calls `planWire` (`wiring/rules.ts:44`, `placement/commands.ts:45`, `list-view/actions.ts:117,238`).
- **`planWire` and `validateBlueprint` disagree.** Disproved by probe 1: 0 mismatches in 4,434 pairs, both directions.
- **Schema types changed after the freeze.** Disproved: `git log -- packages/schema/src` ends at c9fed88. Later commits touch docs and fixture text only, and each was noted in its review (R-2.1, R-2.2, R-2.3).
- **An unknown future version is guessed at.** Disproved. Versions 2 and above give `blueprint.newer_version` from both `migrateBlueprint` and `validateBlueprint`, with the same message (`migrate.test.ts:149`, probe 2). App sharing maps it to its "newer" reason (`app/src/sharing/link.ts:281`).
- **Validator text reaches a child (rule 7).** Disproved:
  - canvas refusals are a colour cue with no text (`canvas/src/interface.ts:271`, `canvas/docs/wiring.md:41`);
  - hint do-it reasons go to `console.warn` (`app/src/hints/controller.ts:206,212`);
  - shared-link issues go to `console.warn` (`app/src/sharing/view.tsx:101`).
- **"Brain" family label breaks the terminology.** Disproved: brief Section 3 (line 60) names the family Brain. Parts use "microcontroller".
- **Level 3 features leak (rule 10).** Disproved:
  - the program primitive is a no-op;
  - content holds no Level 3 part (`packages/content/parts/level-{1,2}` only);
  - the kit validator refuses parts above the kit's level (`validate/kit.ts:104`).
- **Port colours duplicated.** Disproved: canvas, app, parent and tools read `PORT_TYPE_STYLE`.

## Deferred items from earlier reviews

| Item | Source review | Status now | Finding id or evidence |
| --- | --- | --- | --- |
| Finding 14: red 3V pin, skipping rungs | R-0.2 | holds (queued as D24 and D25, unanswered) | decision_queue |
| N10: short step for `low`, `high`, `reversed` | R-0.2 | fixed in sim-core | `sim-core/src/electrical/needs.ts:91-98` applies the short step |
| N11: `feeder` explanation | R-0.2 | holds | SCH-9 |
| N12: side-by-side switches not blamed | R-0.2 | holds | SCH-9 |
| N13: single changes above 1,024 combinations | R-0.2 | holds, documented; no Level 1–2 kit reaches it | `packages/schema/docs/decisions.md:15` |
| N14: control search inside the tick | R-0.2 | mitigated in sim-core (cached per control state, warm-up); remainder is sim-core's | R-1.2 minor 4, R-1.5 minor 1 |
| Q1: each setting at its own unlock level | R-0.2 | not queued (D48 covers the DC motor's direction only) | SCH-1 |
| Q2: mirrored art lighting | R-0.2 | not queued | SCH-1 |
| Q3: rotating a mounted part | R-0.2 | queued as D34 | decision_queue |
| Q4: same-colour refusal cue | R-0.2 | answered by canvas design (push-away); schema decisions.md Q5 is stale | SCH-8 |
| Q5: D23–D27 | R-0.2 | holds (queued, unanswered) | decision_queue |
| F1 / Q1: `newer_version` changes 0.2's contract | R-0.3 | not queued | SCH-1 |
| F2: "Migrate it first" for unmigratable versions | R-0.3 | holds | SCH-4 |
| F3: frozen step uses live v1 code | R-0.3 | holds | SCH-2 |
| F4 / Q3: run-record snapshots on a bump | R-0.3 | holds | SCH-3, SCH-1 |
| F5: docs say every id is random | R-0.3 | holds | SCH-5 |
| Q2: derived id | R-0.3 | not queued | SCH-1 |
| Test title "the frame drags" | R-0.5 | holds (test-only) | SCH-8 |
| F4: CLI uses schema fixtures as the default catalogue | R-0.5 | fixed (content has parts; the run notes "from packages/content") | Commands run |
| Minor 7: documents.md:73 "slip before stall" | R-2.1 | fixed | `documents.md:73` now says direct drive stalls |
| Minor 4: parts.md roster | R-2.2 | fixed (df6bcfe) | parts.md:94-108 |
| Minor 2: parts.md:92 names only some differences | R-2.3 | holds, and wider | SCH-7 |
| Minor 2: balance attribution undocumented | R-2.6 | queued as D62; parts.md still silent | SCH-7 |

## Proposed follow-up tasks

| id | title | package | done-when | fixes findings |
| --- | --- | --- | --- | --- |
| FU-SCH-1 | Queue the schema questions that never reached Drew | schema (orchestrator) | R-0.3 Q1–Q3 and R-0.2 Q1–Q2 are each in `decision_queue` with the default the build follows, and `packages/schema/docs/decisions.md` cites their D numbers | SCH-1 |
| FU-SCH-2 | Tidy schema docs and version messages | schema | `validateBlueprint` says "Migrate it first" only for whole numbers below `BLUEPRINT_VERSION` (test added); `ISSUE_CODES` and validation.md describe `unsupported_version` correctly; validation.md and documents.md point to the derived-id exception; parts.md:92 lists every example-vs-content difference, says the examples are frozen Phase 0 test data, and states the balance attribution (D62); README tense fixed; open questions carry D numbers, and Q5 is marked answered by canvas; the part.test.ts titles use "chassis"; schema tests green | SCH-4, SCH-5, SCH-7, SCH-8 |
| FU-SCH-3 | Freeze the v0→v1 step's helpers and extend the version-2 recipe | schema | v0-to-v1 imports only a frozen copy of the helpers it uses (or a test pins its output hashes over at least 200 seeded v0 documents); migrations.md:40 is accurate; the recipe says how run-record and challenge-start snapshots are handled, following FU-SCH-1's answer to R-0.3 Q3; schema tests green | SCH-2, SCH-3 |
| FU-SCH-4 | Use the schema's pair rule for wire kind and direction outside schema | parent, canvas | `parts-list.ts` takes mount or drive and the source end from `checkPortPair` (or canvas-style `wireKindOf`); the canvas snap and carry pre-filters find partner sockets with `checkPortPair(...).legal`, not role literals; parent and canvas tests green | SCH-6 |
| FU-SCH-5 | Close the R-0.2 N11 and N12 explanation gaps | schema | a motor behind a stopped channel of an unpowered driver is explained by `feeder`; each of two closed switches side by side across a pack shows `across-the-pack`; tests for both; any golden change accepted with an orchestrator note | SCH-9 |
