# A Run in detail

Back to the [README](../README.md). The types are in [src/interface.ts](../src/interface.ts).

## Time

- One tick is 1/30 s of simulated time (the schema's `TICK_RATE`; a run record's `tickRate: 30`).
- The caller steps the simulation. How fast ticks play (1–30 a second), the one-second spin-up and slow motion are the app's clock. sim-core never reads the wall clock.
- Tick 0 is the starting state, solved before any time passes. Its frame holds every part's starting values and every body's pose, so the wires can light during the spin-up. `step()` gives ticks 1, 2 and on, and a record's `ticks` is the last one.
- Within a step: inputs made at the previous tick, then the electrical solver (power nets, battery drain), the program (brain rules, reading the previous tick's sensor samples), the mechanical solver (drive, collisions, tipping), and last the sensors sample the arena. So slow motion shows one tick of delay between a sensor and the motor it drives.

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

The rule is the schema's, and this package never restates it: a fault is what the child's controls cannot fix ([parts.md, "Needs, unmet ways and effects"](../../schema/docs/parts.md)). How sim-core applies it:

- **Wiring.** `controlsOf(blueprint, catalogue)` lists the switches and driver channels. sim-core passes their current settings to `wiredNeeds(blueprint, catalogue, state)`, which decides power `open`, loop `open` and isolation `shorted` and says, in `explainedBy`, why an unmet need is not a fault. The verdicts hold until a control changes (a flip, a driver command, a bumper switch's touch), so cache them per control state rather than searching inside every tick (schema review N14).
- **Voltages.** sim-core judges `low`, `high` and `reversed` on its own solver's voltages, explaining an unmet need in the schema's order. `explainByControls` covers only the controls step, so sim-core applies the short step and the feeder step itself, including loops made only of sources (schema review N10 in [docs/reviews/tasks/0.2.md](../../../docs/reviews/tasks/0.2.md)).
- **The rest** (signal, mount, drive, torque, floor, balance) comes from the simulation.
- **Events.** A fault event names one of the part's own failure modes. An unmet need with no failure mode for that way changes behaviour and emits no fault. A run record's `faults` holds only faults ([documents.md](../../schema/docs/documents.md)).

## Snapshots

`snapshot()` holds the whole state: solvers, the physics world, the random state, each brain's program state, inputs and the events so far. Equal states give equal bytes. The app snapshots at tick 0 and restores on Stop, so the next Run of an unchanged build, which keeps its seed (D37), starts from the identical state (ground rule 4). A snapshot restores only into the Simulation that took it.

## Run records

`record(context)` builds the schema's `RunRecord`:

- from sim-core: the blueprint snapshot and its `meta.id`, the seed, `ticks`, `inputs`, `events` (unless `context.events` is `'drop'`), `faults`, and `fixed`. `fixed` lists each fault of `context.previous` that this Run did not show, with the build changes between the two blueprints that touch the faulted part, its ports or its wires (D31);
- from the app: the id, wall-clock start and end, `runNumber`, profile, challenge, the goal verdict and hint use.

## The program slot

The loop calls `ProgramRuntime.run(tick, state)` for each part with a `program` primitive whose supply is at or above its `onVolts`, between the electrical and the mechanical solver. Inputs are signal levels from the previous tick's samples; the step gives the levels to drive this tick (an output left out carries nothing) and the brain's next state. The state is plain JSON (Level 3's variables and timers), which the loop holds between ticks and keeps in snapshots, written with the schema's `canonicalJson` so equal states give equal bytes. So `start` and `run` can both stay pure, and a Run still replays and restores exactly. In v1 every brain is the no-op: it runs no rules and drives nothing, so a servo motor on its output gets no signal (D41). Task 1.6 documents the slot further here, and Level 3 fills it.
