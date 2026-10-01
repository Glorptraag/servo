# The tick loop and the recorder

Back to the [README](../README.md). Task 1.5. `src/loop/` is `createSimulation` and the `Simulation` it gives: the tick loop around the solvers, the event stream, snapshots and restore. `src/recorder/` builds the schema's RunRecord. What a Run looks like from outside (time, events, faults, snapshots, records) is in [runs.md](runs.md); this page is how the loop does it.

| File | What |
| --- | --- |
| `loop/index.ts` | `createSimulation`: checks, models, warm-up, tick 0 |
| `loop/setup.ts` | The checks and the canonical copy; `SimulationSetupError`; the Run's fingerprint |
| `loop/models.ts` | Every solver's model, built once per Run, and the orders frames keep |
| `loop/tick.ts` | One tick: the solvers in order and their hand-offs; readouts and flows |
| `loop/frame.ts` | Faults debounced (`FAULT_DEBOUNCE_TICKS`); readouts → this tick's events; events → `frame.live` |
| `loop/warm.ts` | Warming the electrical solver's caches for every switch position |
| `loop/snapshot.ts` | The whole state as bytes, and back |
| `loop/simulation.ts` | The `Simulation`: `step`, `input`, `snapshot`, `restore`, `record`, `dispose` |
| `recorder/index.ts`, `changes.ts` | The RunRecord, and `fixed` from the build changes (D31) |

## createSimulation

1. **Checks**, in this order. The first input refused rejects with a `SimulationSetupError` holding every issue its validator gives:
   - the blueprint, through the graph builder (its structure, the part records it uses, then the whole build against the catalogue). A `GraphInputError` becomes a `SimulationSetupError` with the same `issues`;
   - the arena preset (`validateArenaPreset`), and that it is the one `blueprint.arena.preset` names (`value.inconsistent` at `$.id`);
   - the seed: a whole number from 0 to 4294967295.

   A legal build always passes, however wrong it is. The error is recognised by `name === 'SimulationSetupError'`; the package exports only types and `createSimulation`.
2. **The copy.** `serializeBlueprint(canonicalizeBlueprint(…))`, parsed and deeply frozen: `simulation.blueprint`, and the snapshot every record names. The graph is built again from the copy. The arena preset is copied too. The caller's objects are never touched.
3. **The physics engine** loads its WebAssembly the first time (`initMechanics`, D11). It is the only wait.
4. **Models**: the graph, then the electrical, behaviour, program and mechanical models. None changes during the Run; only the electrical solver's caches grow, keyed by what decides their value.
5. **The warm-up** (below), then **tick 0**.

## One tick

`solveTick(models, state, tick)` runs the steps in brief Section 6's order. Each reads only what the steps before it gave this tick, or what the last tick left in the state:

| Step | Reads | Gives the loop |
| --- | --- | --- |
| 1. Controls | Each manual switch as the child set it (an input made at the last tick applies now); each contact switch as the last tick's mechanics left it; each motor-driver channel's command from the last tick | The schema's `ControlState` |
| 2. Electrical | The controls; each actuator's actual rpm and load from the last tick's mechanics (`electricalActuators`), for its back-EMF and draw | Volts, currents and charge per part; current per power line; power, loop and isolation faults (the control search, short and feeder steps); the drained charges |
| 3. Program | This tick's port volts (is each brain on?); the levels the sensors sampled as the last tick ended | The levels each brain drives, carried along the signal lines this tick; each brain's next state |
| 4. Behaviour | Port volts; the switches (channels at their settings, or a driven signal); this tick's signal levels; the loads the last tick's mechanics gave (Infinity where held) | rpm, angle, light, closed; motor, hum and buzz; signal, torque, drive and mount faults; each channel's command; each drive linkage's rpm |
| 5. Mechanical | This tick's behaviour | Poses; contact switches; actual rpm and load per actuator; squeal and knock; floor and balance faults |
| 6. Sensor sampling | Where the mechanics left the arena | Nothing at Levels 1–2: the schema has no sensor primitive yet. Level 3 fills this step and the order stays |

- **Tick 0** solves the circuit with no time passing (`solveElectrical`: no drain) and passes `seconds: 0` to behaviour and mechanics, so nothing moves and no arm sweeps. Every switch is at rest, and contact switches take their probes' state from tick 1. The brains run at tick 0 too, so a servo motor on a Level 3 brain's output has its signal from the start (docs/program.md left this to 1.5).
- **A signal-driven channel** reaches the electrical solver a tick late: the solver runs before the program step, so it takes the command the behaviour runtime worked out last tick. The behaviour runtime itself takes this tick's signal, or else the channel's setting. With the v1 no-op brain (D41) every command is its setting, so nothing is late.
- **Faults** are merged, not judged again. Each solver applies the schema's rule to the needs it owns, and a failure mode is active while its solver makes it so. A part's faults are the union, in its record's order.
- The solvers never write into their inputs. The loop's state is plain data, replaced each tick.

## Readouts, events and live state

- **Readouts** per placed part, in ValuePayload's order: `volts`, `milliamps` and `charge` from the electrical solver; `rpm`, `angle`, `light` and `closed` from the behaviour runtime. The set of fields a part reports is fixed by its primitives, so tick 0 gives them all. Only finite numbers are reported, with −0 as 0. `signal` is not reported (open question 2).
- **Sounds**: the behaviour runtime's (motor, hum, buzz) and the mechanics' (squeal, knock), at most one of each, in RUN_SOUNDS order.
- **Poses**: the mechanics' bodies: the robot's root part, loose parts (D19) and props.
- **Events** are the difference between this tick's readouts, with faults debounced (below), and the last frame's live state, in the fixed order [runs.md](runs.md) gives.
- **Live state** (`liveOf`) is what folding this tick's events into the last frame's live state gives: a subject no event names keeps its object, and any other takes this tick's readouts of each kind it has events for. The events carry every difference, so `frame.live` is exactly the fold of every event from tick 0, and a test folds the whole stream independently at every tick to prove it.
- Events, live states, the frame and the blueprint are frozen, so a frame's reader cannot change the Run.

## Faults are debounced

The orchestrator's ruling on task 1.5. One-tick glitches had reached run records: a motor driver browning out at tick 0 (`busy-workbench`), a wheel slipping for a tick as the robot meets a prop of 700 g or more, a bumper switch closing for a tick as the robot settles at a wall (review R-1.4). None is a lesson.

- `FAULT_DEBOUNCE_TICKS` (3 ticks, 0.1 s, in `loop/frame.ts`) is the one place the rule lives.
- A failure mode shows only once it has been active for 3 consecutive ticks: then its fault event fires, it joins `LiveState.faults`, and the run record lists it with that tick as its `firstTick`. So no fault shows before tick 2.
- It ends only once it has been inactive for 3 consecutive ticks, with its end event at the third.
- A fault that flickers back before then never moved: its count starts again. The counts (`pending` in the loop's state) are in snapshots, so a restore mid-count replays exactly.
- Readouts, poses and sounds are never debounced: they show every tick as it really is, so a glitch is still visible in the values (a short's current, a switch closing for a tick).
- With it, all 19 content fixtures meet their `expect`.

## Flows

Every power line, signal line and drive linkage has an entry, in wire id order; mounts have none.
- A power line: the electrical solver's current along it, from its `from` port to its `to` port.
- A signal line: the level the program step drives along it this tick, or `{}` while it carries none.
- A drive linkage: the behaviour runtime's rpm, signed as its drive-out turns.

## The warm-up (review R-1.2, minor 4; review N14)

Before tick 0, `warmControls` builds the circuit and the schema's wiring verdicts (`wiredNeeds`, whose control search is the costly part) for every position of the switches, with each channel at its setting. Manual switches and contact switches are all the controls a Level 1–2 Run can move, so no wiring search runs inside a tick. A test drives the bumper robot into a wall and checks that the cache never grows.

- Only builds with at most 6 controls (`LIVE_TABLE_CONTROLS`) are warmed: at most 64 positions, each searching at most 63 others. A Level 1–2 kit has at most 4. A bigger build searches a position the first time a tick meets it: review N14's ten switches and forty motors would take about 0.6–0.8 s for each new position.
- The electrical solver's own answers for voltage-way needs (`low`, `high`, `reversed`) are searched under a key inside the tick, the first time, and kept in its state (docs/electrical.md). Those depend on the charges, so they are not warmed.
- The caches belong to the Simulation's models, so they outlast a restore: a Run started again after Stop (D37) starts warm.

## Snapshots

`snapshot()` writes the loop's whole state, and `restore()` reads it back:
- a header of five little-endian 32-bit words: the format, the Run's fingerprint, the tick, and the lengths of the next two parts;
- the state as JSON (ASCII only, one byte a character): the electrical state (charges and kept answers), the behaviour state (arms), each brain's program state (through `canonicalJson`) and the levels it drove, the switches, the channels' commands, each actuator's actual drive and load, the samples, the live state and flows of the frame, the faults' debounce counts, and the inputs, events and faults so far;
- the mechanical solver's bytes: its header and Rapier's snapshot of the world.

Objects keep their keys in the order the code that builds them gives, which JSON keeps both ways. So a restored state is the one that was taken, and a Run resumed from a snapshot records the same bytes as one that never stopped. A test steps, restores and compares snapshots byte for byte.

**The fingerprint** is a 32-bit FNV-1a hash of the canonical blueprint, the records of the parts it uses, the arena preset and the seed. `restore` throws for bytes whose fingerprint, tick or format is not this Run's. A Simulation made from the same inputs is the same Run (ground rule 2), with the same fingerprint, so its snapshots restore into either (decision 2 below).

## The recorder

`record(context)` copies the logs into the schema's RunRecord; [runs.md](runs.md#run-records) lists its fields. `fixed` (D31) compares the previous Run's blueprint with this one (`buildChanges`):
- parts added and removed (a part whose type changed is both), wires added and removed (a wire is the two ports it joins, either way round), then settings changed (one that went back to its default has no `value`), each in id order;
- a change touches a fault's part when it is that part, one of its settings, or a wire on one of its ports;
- moving a part changes none of these, and a change to the arena touches no part, so neither is listed.

## Determinism

- The loop adds no arithmetic of its own beyond comparisons, and no clock, randomness or global. Subjects, wires and controls are visited in fixed orders.
- **Chance.** Nothing at Levels 1–2 is random, so nothing draws on the seed. The seed is recorded, and it is part of the fingerprint. The first solver that needs chance takes a seeded generator (splitmix32, say) and keeps its state in the loop's state, so in snapshots.
- **Tests**, in `pnpm check`:
  - `test/loop.test.ts` compares two runs byte for byte wherever it replays: a Run and its replay from its own record's inputs, a Run resumed from a mid-Run snapshot and one that never stopped, the same build written two ways, two Simulations of one Run. It folds the whole event stream independently at every tick of every valid schema blueprint;
  - `packages/tools/test/sim-determinism.test.ts` runs the many-run sweeps and compares every record byte for byte: three representative content fixtures 100 times (`switch-in-the-line`, `broken-servo-without-signal`, `broken-short-circuit`), every other content fixture with its own inputs and ticks (30 to 360) 10 times, and every valid schema blueprint 10 times for 30 ticks with its manual switches flipped both ways. Every other run is a fresh Simulation, and the rest restore tick 0 as Stop does. Each record validates with `validateRunRecord`.
- **The sweep**, `pnpm --filter @servo/tools test:determinism`, outside `pnpm check`: every content fixture and every valid schema blueprint 100 times each, the same way.
- **Why the sweeps live in packages/tools.** Vitest runs nine test files at once here. sim-core's suite holds timing-sensitive tests (the electrical solver's cost under 1 ms, the mechanics' 5 s defaults), which passed with little margin while the machine was loaded. Every extra busy worker beside them costs that margin, so the loop's own tests are one short file, and the sweeps run in packages/tools, after every other package.

## Cost

Measured on the 25-part `busy-workbench` content fixture, on an M1 Max (8 performance and 2 efficiency cores) shared with other sessions. Each figure is the fastest of 15 or more Runs of 90 ticks, so that the machine's load decides as little as it can.

- **The whole tick: 0.96–1.01 ms** through the public API (the tools test) with the machine nearly idle (load average 15), with medians near 1.45 ms. Under the load of 60 to 250 that other sessions put on the machine for most of the task, the same test gave 0.86–1.49 ms. It is about 1 ms, not well under it.
- **Where it goes**, at load 15: the mechanics 0.43 ms, the electrical solver 0.13 ms, the behaviour runtime 0.10 ms, the program slot under 0.01 ms, and the loop's own work about 0.1 ms (readouts and flows 0.03 ms, events 0.035 ms, live state 0.04 ms). The rest is allocation and garbage collection across a whole tick, which a profile of each step alone does not show.
- These agree with reviews R-1.2 and R-1.4 (the electrical solver at 0.10–0.13 ms a tick on a 25-part build, the mechanics at a median of 0.47–0.72 ms on this one). Most of the mechanics' time is restoring and snapshotting Rapier's world every tick (docs/mechanical.md). That is where a faster tick would come from, and it is outside this task: keeping the world open between ticks while its bytes are unchanged (review R-1.4's suggestion for finding 4) would remove most of it.
- Setting up a Simulation took 6–120 ms per content fixture under heavy load, after the first Run's WebAssembly load: two graph builds, the models, the world and the warm-up.

## The back-EMF coast (review R-1.3, finding 6)

When a switch opens, a DC motor whose circuit it broke reads the volts its own back-EMF leaves across it, at 0 mA, and so shows as turning for a few ticks while the robot coasts. That is the electrical solver's and the behaviour runtime's model; the loop passes it on as it is, and documents it here.

- **Measured** on `switch-in-the-line` and `kit-rolling-start` (content records, the switch opened at full speed): each motor reads 2.24 V falling to 0.98 V over 7 ticks, turning from 73 to 33 rpm with its `motor` sound fading, then idle. The robot coasts 66 mm in 17 ticks (0.57 s) and stops. No fault shows on any Level 1–2 fixture.
- **The tail.** Once idle, an open-circuit motor still rolling reads its back-EMF less noLoadMilliamps × its winding resistance, which goes negative as it slows: to −0.6 V over the last 7 ticks (0.23 s) before the robot stops, then 0. Its power need is `open`, explained by the switch, so no `reversed` fault shows, but the spec card reads a small negative volts for that moment (open question 3).
- **Two motors driving each other.** Review R-1.3 found a one-tick `overload` when one of two parallel motors carries a load as the switch opens. No fixture shows it, and a fault that short never shows now: faults are debounced (above).

## Decisions and open questions

Decisions taken here (conservative readings, for review):

1. **`fixed` from the blueprints.** The interface gives the recorder the previous run record, not the EditCommands the canvas applied, and sim-core cannot see EditCommands (they are the canvas's type). So `fixed` lists the build changes between the two blueprints, in the schema's BuildChange words, that touch the faulted part (D31). A wire removed and put back between two Runs is no change.
2. **Another Simulation.** `restore` refuses a snapshot whose fingerprint (blueprint, part records, arena, seed) differs from its own. A twin made from the same inputs is accepted, because it is the same Run; snapshots stay a pure function of the state, so equal states give equal bytes across Simulations. A program runtime cannot be fingerprinted: restoring one runtime's states into another's is the caller's mistake.
3. **Input.** A flip is refused when the switch is already that way, counting flips made earlier in the same tick. A part with two manual switches would flip both; no part has more than one.
4. **Tick 0 runs the brains**, as docs/program.md suggested, so a Level 3 brain's output carries its level from the first frame.

Open questions, for the orchestrator to queue:

1. **EditCommands in `fixed`.** If D31 means the commands themselves, `RunRecordContext` needs a field for them (task 0.4's interface), and the recorder would filter what the app passes.
2. **The `signal` readout.** ValuePayload's `signal` is one level, and a microcontroller has two outputs (docs/program.md). No Level 1–2 part drives a signal, so the readout is left out until Level 3 says which output a spec card shows and how "no signal" reads.
3. **An open-circuit motor's volts** (above) read negative while it rolls to a stop. A note for the electrical solver's owner.
4. **Run length.** Every powered part reports changed volts most ticks while a pack drains, so a full record keeps about one event per part per tick: 2,820 events for the 3 s of the 25-part `busy-workbench` fixture. Long sandbox Runs may want the `events: 'drop'` summary (tasks 4.4 and 4.9).
5. **Exports.** `blockRuleRuntime` and the block-rule types stay internal (docs/program.md). The app needs them only at Level 3, so the entry does not export them yet.
