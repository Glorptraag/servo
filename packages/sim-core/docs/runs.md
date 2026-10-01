# A Run in detail

Back to the [README](../README.md). The types are in [src/interface.ts](../src/interface.ts).

## Time

- One tick is 1/30 s of simulated time (the schema's `TICK_RATE`; a run record's `tickRate: 30`).
- The caller steps the simulation. How fast ticks play (1–30 a second), the one-second spin-up and slow motion are the app's clock. sim-core never reads the wall clock.
- Tick 0 is the starting state, solved before any time passes. Its frame holds every part's starting values and every body's pose, so the wires can light during the spin-up. `step()` gives ticks 1, 2 and on, and a record's `ticks` is the last one.
- Within a step: inputs, then the electrical solver (power nets, battery drain), the program (brain rules, reading the previous tick's sensor samples), the mechanical solver (drive, collisions, tipping), and last the sensors sample the arena. So slow motion shows one tick of delay between a sensor and the motor it drives.
- `input()` records a switch flip at the current tick, and it takes effect in the next step.

## Events: the schema's `RunEvent` `{ tick, partId, kind, payload }`

| Kind | Subject | Fires when |
| --- | --- | --- |
| `value` | a placed part | its readouts change (only the fields that changed); at tick 0, all of them |
| `motion` | a body: the robot's root part (`robotRoot`), a loose part, or a prop `arena:<propId>` | its pose changes. Parts fixed to or carried by a body ride with it, placed by `placeParts` |
| `sound` | a placed part | a machine sound starts, changes or stops (level 0) |
| `fault` | a placed part | one of its own failure modes starts or ends |

- `frame.live` is exactly the fold of every event so far, one entry per placed part and per prop. A reader that joins late (the spec card, a restored Run) needs no history.
- `frame.flows` gives each power line, signal line and drive linkage what flows along it (milliamps from `from` to `to`, a signal level, rpm), for the canvas's moving dots. It is not recorded: a replay recomputes it.
- The order of events within a tick is fixed by task 1.5 and documented here. It never depends on wire order, insertion order or the platform.

## Faults

- The schema's `wiredNeeds` decides power `open`, loop `open` and isolation `shorted`, judged as wired: every switch closed, every motor-driver channel at full forward. A verdict with `explainedBy` shows no fault on that part, because the part it names shows its own.
- sim-core judges `low`, `high` and `reversed` on the voltages of the same as-wired circuit, and the other needs (signal, mount, drive, torque, floor, balance) from the simulation.
- Control never makes faults. A switch the child opens, or a motor-driver channel set to stop or reverse, changes behaviour only.
- A fault event names one of the part's own failure modes. An unmet need that has no failure mode for that way changes behaviour and emits no fault.

## Snapshots

`snapshot()` holds the whole state: solvers, the physics world, the random state, inputs and the events so far. Equal states give equal bytes. The app snapshots at tick 0 and restores on Stop, so a second Run of an unchanged build starts from the identical state (ground rule 4). A snapshot restores only into the Simulation that took it.

## Run records

`record(context)` builds the schema's `RunRecord`:

- from sim-core: the blueprint snapshot and its `meta.id`, the seed, `ticks`, `inputs`, `events` (unless `context.events` is `'drop'`), `faults`, and `fixed`, which lists each fault of `context.previous` that this Run did not show, with the build changes between the two blueprints;
- from the app: the id, wall-clock start and end, `runNumber`, profile, challenge, the goal verdict and hint use.

## The program slot

`ProgramRuntime.run(BrainTick)` returns `BrainOutputs`. The loop calls it for each part with a `program` primitive whose supply is at or above its `onVolts`, between the electrical and the mechanical solver. Inputs are signal levels from the previous tick's samples; outputs are the levels to drive this tick, and an output left out carries nothing. A runtime must be a pure function of its input. In v1 every brain is the no-op: it runs no rules and drives nothing. Task 1.6 documents the slot further here, and Level 3 fills it (D16 decides how a servo's angle setting meets its signal).

## Open question

Which build changes count as the fix in `fixed`: every change between the two Runs (the reading above), or only the ones that touch the faulted part?
