# A Run in detail

Back to the [README](../README.md). The types are in [src/interface.ts](../src/interface.ts). How the loop does it is in [loop.md](loop.md).

## Time

- One tick is 1/30 s of simulated time (the schema's `TICK_RATE`; a run record's `tickRate: 30`).
- The caller steps the simulation. How fast ticks play (1–30 a second), the one-second spin-up and slow motion are the app's clock. sim-core never reads the wall clock.
- Tick 0 is the starting state, solved before any time passes: no battery drains, nothing moves, and every switch is at rest. Its frame holds every part's starting values and every body's pose, so the wires can light during the spin-up. The brains run at tick 0 too. `step()` gives ticks 1, 2 and on, and a record's `ticks` is the last one.
- Within a step: inputs made at the previous tick, with each contact switch as the previous tick's mechanics left it; then the electrical solver (power nets, battery drain), the program (brain rules, reading the previous tick's sensor samples), the behaviour runtime, the mechanical solver (drive, collisions, tipping), and last the sensors sample the arena (none at Levels 1–2). So slow motion shows one tick of delay between a sensor and the motor it drives, and between a bumper switch's touch and the circuit it opens.

## Events: the schema's `RunEvent` `{ tick, partId, kind, payload }`

| Kind | Subject | Fires when |
| --- | --- | --- |
| `value` | a placed part | its readouts change (only the fields that changed); at tick 0, all of them |
| `motion` | a body: the robot's root part (`robotRoot`), a loose part, or a prop `arena:<propId>` | its pose changes (the whole pose). Parts fixed to or carried by a body ride with it, placed by `placeParts` |
| `sound` | a placed part | a machine sound starts, changes or stops (level 0) |
| `fault` | a placed part | one of its own failure modes starts or ends, debounced: once it has been active, or inactive, for 3 consecutive ticks |

- **Readouts.** `volts`, `milliamps` and `charge` come from the electrical solver; `rpm`, `angle`, `light` and `closed` from the behaviour runtime. A part reports the same fields every tick, so tick 0 gives them all. A part with none (a chassis, a caster) has no value events.
- **Order within a tick**, fixed: placed parts in id order, then props in id order; for each, its `value` event, its `motion` event, its `sound` events in `RUN_SOUNDS` order (motor, hum, buzz, squeal, knock), then its `fault` events in its record's failure-mode order. It never depends on wire order, insertion order or the platform.
- `frame.live` is exactly the fold of every event so far, one entry per placed part and per prop, in the same order: a value event sets the readouts it carries, a motion event the pose, a sound event starts or changes a sound (level 0 stops it), and a fault event starts or ends a failure mode. A reader that joins late (the spec card, a restored Run) needs no history.
- `frame.flows` gives each power line (milliamps from `from` to `to`), signal line (its level, or `{}` while it carries none) and drive linkage (rpm), in wire id order, for the canvas's moving dots. Mounts have no entry. It is not recorded: a replay recomputes it.

## Inputs

- `input({ partId, kind: 'switch', closed })` flips a manual switch. It is recorded as a RunInput at the current tick and takes effect in the next step, so a run record replays exactly.
- It returns false, and records nothing, for a part with no manual switch (a bumper switch is a contact switch, moved only by its probe) or a switch already that way, counting flips made earlier in the same tick.
- **Replaying a record.** Make each input at its tick, before the step that applies it: from a fresh Simulation (or tick 0 restored), at each tick from 0 to `ticks − 1`, make that tick's inputs in the record's order and then `step()`. An input recorded at tick = `ticks` was made after the last step, so it changes no frame, but the record keeps it: make it after the last step, before `record()`, and the replay's record matches byte for byte. A test replays one.

## Faults

The rule is the schema's, and this package never restates it: a fault is what the child's controls cannot fix ([parts.md, "Needs, unmet ways and effects"](../../schema/docs/parts.md)). How sim-core applies it:

- **Wiring.** `controlsOf(blueprint, catalogue)` lists the switches and driver channels. sim-core passes their current settings to `wiredNeeds(blueprint, catalogue, state)`, which decides power `open`, loop `open` and isolation `shorted` and says, in `explainedBy`, why an unmet need is not a fault. The verdicts hold until a control changes (a flip, a driver command, a bumper switch's touch), so they are cached per control state rather than searched inside every tick (schema review N14), and warmed for every switch position before tick 0 ([loop.md](loop.md#the-warm-up-review-r-12-minor-4-review-n14)).
- **Voltages.** sim-core judges `low`, `high` and `reversed` on its own solver's voltages, explaining an unmet need in the schema's order. `explainByControls` covers only the controls step, so sim-core applies the short step and the feeder step itself, including loops made only of sources (schema review N10 in [docs/reviews/tasks/0.2.md](../../../docs/reviews/tasks/0.2.md)).
  - One exception, the orchestrator's ruling D57: a motor driver that browns out reads `low`, and only a short or a feeder explains that, never the controls, so the child sees why its motors stopped. The parts it starves of volts are put down to it, straight after the short step. A supply wired the wrong way round still reads `reversed` ([electrical.md](electrical.md)).
- **The rest** (signal, mount, drive, torque, floor, balance) comes from the simulation: the behaviour runtime and the mechanical solver.
- **Merging.** Each solver applies the rule to the needs it owns, so the loop takes the union: a part's active faults are every failure mode any solver makes active, in its record's order.
- **Events.** A fault event names one of the part's own failure modes. An unmet need with no failure mode for that way changes behaviour and emits no fault. A run record's `faults` holds only faults ([documents.md](../../schema/docs/documents.md)), each once, from the tick it first showed.
- **Debouncing** (the orchestrator's ruling, [loop.md](loop.md#faults-are-debounced)). A failure mode shows, with its fault event, in `LiveState.faults` and in the record, only once it has been active for 3 consecutive ticks (0.1 s, `FAULT_DEBOUNCE_TICKS`), and ends once it has been inactive for 3. So a glitch of a tick or two never shows, and no fault shows before tick 2. Readouts, poses and sounds are never debounced.

## Snapshots

`snapshot()` holds the whole state: solvers, the physics world, each brain's program state, the switches, inputs, and the events and faults so far. Equal states give equal bytes. The app snapshots at tick 0 and restores on Stop, so the next Run of an unchanged build, which keeps its seed (D37), starts from the identical state (ground rule 4).

A snapshot carries a fingerprint of its Run: the canonical blueprint, the records of the parts it uses, the arena preset and the seed. `restore` throws for one from another Simulation, that is, one with another fingerprint. A Simulation made from the same inputs is the same Run (ground rule 2), so its snapshots restore too. Byte layout: [loop.md](loop.md#snapshots).

## Run records

`record(context)` builds the schema's `RunRecord`:

- from sim-core: the blueprint snapshot and its `meta.id`, the seed, `tickRate`, `ticks`, `inputs`, `events` (unless `context.events` is `'drop'`), `faults`, and `fixed`.
  - `fixed` (D31) lists each fault of `context.previous` that this Run did not show, in that record's order, with the build changes between the two blueprints that touch the faulted part, its ports or its wires: parts added and removed, wires added and removed, settings changed. A fault that went with no such change has no changes.
- from the app, as given: the id, wall-clock start and end, `runNumber`, profile, challenge, the goal verdict and hint use.

The record validates with the schema's `validateRunRecord` against the catalogue the Run used.

## The program slot

The loop calls `ProgramRuntime.run(tick, state)` for each part with a `program` primitive whose supply is at or above its `onVolts`, between the electrical and the mechanical solver, from tick 0. Inputs are signal levels from the previous tick's samples; the step gives the levels to drive this tick (an output left out carries nothing) and the brain's next state. The state is plain JSON (Level 3's variables and timers), which the loop holds between ticks and keeps in snapshots, written with the schema's `canonicalJson` so equal states give equal bytes. So `start` and `run` can both stay pure, and a Run still replays and restores exactly. In v1 every brain is the no-op: it runs no rules and drives nothing, so a servo motor on its output gets no signal (D41). Task 1.6 documents the slot further in [program.md](program.md), and Level 3 fills it.
