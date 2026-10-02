# Golden runs

Task 1.7. `pnpm golden` runs every content fixture and every valid schema blueprint through sim-core, checks each content fixture's `expect` against its Run, and diffs each Run against its reference in `packages/sim-core/golden/`. Any change to a Run fails it with a readable diff: a solver change, a part record, an arena or a fixture. CI runs it after the tests on every push (docs/plan.md Section 8: "a diff needs an orchestrator note to accept").

```sh
pnpm golden                                 # check every Run
pnpm golden switch-in-the-line schema       # one fixture, and every schema blueprint
pnpm golden --accept content/geared-robot   # rewrite that golden file from the Run as it is now
```

| Argument | Meaning |
| --- | --- |
| `<case>...` | `content/<fixture>` or `schema/<blueprint>`, a name an id ends with, or `content` or `schema` for all of one kind. With none, every case runs, and a golden file no case has is reported as stale. |
| `--accept` | Writes each golden file that differs or is missing, and with no case named removes stale ones. It prints what changed, in the same words as the check. |
| `-h`, `--help` | Prints the usage. |

The exit status is 0 when every Run matches its golden file (with `--accept`, when every case ran) and every `expect` holds, 1 otherwise, and 2 when the command is misused. Content with an issue stops it with exit status 1, before anything runs.

## What runs

- **Content fixtures** (`@servo/content/fixtures`): each with its own blueprint, seed, inputs and ticks. The command reads packages/content from disk with `readContentFixtures`, because content's loaders need Vite; a test holds it equal to `loadFixtures()`.
- **Schema blueprints** (`validBlueprints` in `@servo/schema/fixtures`), on the schema's example parts and arenas. They carry no Run, so each runs under `SCHEMA_PROTOCOL`, the same Run as task 1.5's determinism sweep: seed 2026, 30 ticks, every manual switch opened at tick 10 and closed at tick 20.
- Each Run is `createSimulation` from `@servo/sim-core`, with each input made at its tick, before the step that applies it, up to the last tick. The run record takes a fixed `RECORD_CONTEXT` (id, times, run 1, no hints), so it depends on the Run alone. A Run whose record does not keep exactly the case's inputs cannot run.

## What it checks

1. **Each content fixture's `expect`** (reviews R-2.3 and R-2.6), on every Run, whatever its golden file says, so a reference can never lock a fault in:
   - `faults`: exactly the run record's faults, by part and failure mode. A fault the Run shows that `expect` does not list is reported with its first tick, how many ticks it was active and the part's readouts there;
   - `namedFault`: one of the faults the Run shows;
   - `refused`: the schema's `planWire` refuses that wire on the fixture's blueprint, with that code;
   - `goal`, for a fixture that names a challenge: the challenge runner's verdict (`GoalJudge`). That runner is task 4.5, so until it lands, a fixture that expects a goal fails, saying so. No fixture has one yet.
2. **Each Run against its golden file**, byte for byte. When they differ, the diff says:
   - which of the Run's inputs changed: the blueprint, the arena, a part record (by id), the seed, the ticks or the switch presses. When none did, the simulation changed;
   - how many ticks differ, the first one, and each summarized field there, old → new (12 at most, then a count);
   - the faults only before (−) or only now (+), and the run record's hash, old → new.

With the DC motor's speed in `speedRule` (sim-core's behaviour runtime) made 5% lower, one of the 19 Runs that changed reads:

```text
  DIFFERS    content/level-1-roller               expect holds: no fault
             inputs: the same blueprint, arena, part records, seed, ticks and switch presses, so the simulation changed
             ticks: 91 of 91 differ, the first at tick 0:
               motor-left.rpm            86.2 → 81.9
               motor-left.sound.motor   0.431 → 0.409
               motor-right.rpm           86.2 → 81.9
               motor-right.sound.motor  0.431 → 0.409
               wheel-left.rpm            86.2 → 81.9
               wheel-right.rpm           86.2 → 81.9
             faults: the same
             run record: sha256 bf68382b3255… → 1d00e19a20db…
```

## The golden file

`<id>.golden` is text: a header, then each tick. Never edit one by hand; `--accept` writes it.

| Line | Holds |
| --- | --- |
| `golden 1` | The layout's version, `GOLDEN_FORMAT`. A change to the layout or to a precision below bumps it, and `--accept` rewrites every file |
| `case`, `seed`, `ticks` | The case's id, its seed and its last tick |
| `input <tick> <part> closed=<bool>`, or `inputs none` | The switch presses, as the run record keeps them |
| `blueprint`, `arena <id>`, `part <id>` | The first 16 hex digits of the SHA-256 of the canonical blueprint, the arena preset and each part record used, so a diff names the input that changed |
| `record` | The SHA-256 of the whole run record, as the schema's `canonicalJson` writes it |
| `fault <part> <failure> first-tick=<n>`, or `faults none` | The run record's faults |
| `subjects` | Every placed part, then every prop (`arena:<id>`), in `frame.live`'s order |
| `tick <n> <hash>` | The first 8 hex digits of the SHA-256 of that tick's events, then a line for each subject with a field that changed since the tick before (tick 0: every field) |

A subject's fields are its summary from `frame.live`, in this order: `volts`, `milliamps`, `charge`, `rpm`, `angle`, `light`, `signal`, `closed`, the pose (`x`, `y`, `heading`, `pitch`, `roll`: the robot's root part, loose parts and props), `sound.<name>=<level>` (with `@<hz>hz` where it has a pitch), and `faults`, the debounced failure modes active. `none` marks a sound that stopped or faults that ended.

Numbers are rounded to fixed places (`PRECISION`): volts 3 (millivolts), milliamps 1, charge 4, rpm 1, angle 1, light and signal 3, x and y 1 (a tenth of a millimetre), heading, pitch and roll 2, a sound's level 3. That keeps the files small (about 270 KB for all 26) and their diffs about changes a person can see. Each tick's hash and the record's hash still catch what the rounding hides: the diff then says the events differ below the summary's precision, and where the summary first differs.

## Accepting a change

Accept only a change you meant: a solver change, a retuned part record, a new fixture. Run `pnpm golden` first and read every diff; then `pnpm golden --accept <case>...` for the cases you meant, and say why in the task's notes for the orchestrator. Review `git diff packages/sim-core/golden/` like code: each changed tick line shows what moved. `--accept` never makes an `expect` hold; a fixture that does not hold is a finding for its content task or for the simulation.

## Not covered

- `frame.flows`, the canvas's moving dots: they are not recorded, so a replay recomputes them (packages/sim-core/docs/runs.md), and plan Section 8 diffs the run recorder.
- Many runs of one case: that is the determinism sweep, `pnpm --filter @servo/tools test:determinism`.

## Code and tests

`cases.ts` (the cases, and content from disk), `run.ts` (one Run), `summary.ts` (the per-tick summary), `file.ts` (the text, both ways), `diff.ts`, `expect.ts`, `cli.ts` and `main.ts` (the entry). Tests: `test/golden-runs.test.ts` (each part), `test/golden-cli.test.ts` (the command on a temporary folder, and the real entry under plain Node).
