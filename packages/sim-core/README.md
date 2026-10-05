# @servo/sim-core

The simulation engine. It turns a blueprint into a wired graph and steps it tick by tick through the electrical, program and mechanical solvers, giving RunEvents, live values and a run record. It is pure and deterministic (ground rule 2) and depends only on `@servo/schema` and Rapier's deterministic build ([docs/stack.md](../../docs/stack.md)). Phase 1 owns it: graph 1.1, electrical 1.2, behaviour 1.3, mechanical 1.4, loop and recorder 1.5, program slot 1.6. Task 0.4 owns this interface, typed in [src/interface.ts](src/interface.ts).

```ts
import { createSimulation } from '@servo/sim-core'; // the app and tools
import type { RunFrame } from '@servo/sim-core/interface'; // the canvas: this file only, types only

const simulation = await createSimulation({ blueprint, catalogue, arena, seed }); // tick 0
const start = simulation.snapshot();
simulation.input({ partId: 'switch', kind: 'switch', closed: false }); // takes effect in the next step
const frame = simulation.step(); // tick 1: { tick, events, live, flows }
const record = simulation.record({ id, startedAt, endedAt, runNumber: 1, hints: [] });
simulation.restore(start); // Stop: tick 0 again, byte for byte
```

## Public surface

The entry exports `createSimulation` and every type of [src/interface.ts](src/interface.ts), nothing else.

| Name | What |
| --- | --- |
| `createSimulation({ blueprint, catalogue, arena, seed, program? })` → `Promise<Simulation>` (`CreateSimulation`, `SimulationOptions`) | Validates its inputs, copies the blueprint in canonical form, warms the electrical solver for every switch position and solves tick 0. Async so the physics engine's WebAssembly can initialise on the first call (D11: at the first Run). Rejects with a `SimulationSetupError` for invalid input, never for a legal-but-wrong build |
| `SimulationSetupError` | An `Error` named `'SimulationSetupError'`, with the `issues` of the first input refused, as the schema's validators give them (a `GraphInputError`'s, for a blueprint). Recognise it by its `name` |
| `Simulation` | `blueprint`, `seed`, `tick`, `frame`, `step()`, `input(control)`, `snapshot()`, `restore(snapshot)`, `record(context)`, `dispose()` |
| `RunFrame` | `{ tick, events, live, flows }`: one tick, for the app and for `canvas.applyRunFrame` |
| `LiveState`, `WireFlow` | One subject's state now (`values`, `motion`, `sounds`, `faults`); what flows along one wire |
| `ControlInput`, `SimSnapshot`, `RunRecordContext` | A switch flip; the opaque whole state; what only the app knows about a Run |
| `ProgramRuntime`, `ProgramState`, `BrainInfo`, `BrainTick`, `BrainStep` | The brain's program slot (task 1.6, Level 3) |
| `@servo/sim-core/behaviour` | Tools only: the behaviour runtime for packages/tools' fixtures, which lint refuses in every other package's src ([docs/behaviour.md](docs/behaviour.md)) |

`@servo/sim-core` re-exports every type. The catalogue is the schema's `makeCatalogue` result, passed in: sim-core never imports content. `arena` is the preset record that `blueprint.arena.preset` names, and the child's props come from `blueprint.arena.props`.

Interface changes: task 7.10 (review R-6.4, SIM-4) rewrote `Simulation.restore`'s comment to say what it has always done: it accepts a snapshot from its own Simulation or from a twin with the same fingerprint, and throws for any other. No type or behaviour changed.

## In brief

- **Time.** One tick is 1/30 s of simulated time. The caller steps; display speed (1–30 ticks a second), the spin-up and slow motion are the app's clock.
- **Tick 0** is the starting state, before any time passes: its frame has every part's values and every body's pose, so the wires light before anything moves.
- **Each step**, in order: the controls (inputs made at the last tick, contact switches as the last tick left them), the electrical solver, the program slot, the behaviour runtime, the mechanical solver, then sensor sampling (none at Levels 1–2). Details: [docs/loop.md](docs/loop.md); the mechanical solver's drive, collisions and balance: [docs/mechanical.md](docs/mechanical.md).
- **Events** are the schema's `RunEvent`: `value` and `sound` per placed part, `fault` when one of the part's own failure modes starts or ends, and `motion` per body (the robot's root part, a loose part or a prop `arena:<propId>`). Parts on the robot ride with it, placed by `placeParts`. Within a tick they come in a fixed order: parts by id, then props, and value, motion, sounds, faults for each ([docs/runs.md](docs/runs.md)).
- **Live values.** `frame.live` is the fold of every event so far, so the spec card can join a Run at any tick. `frame.flows` gives each wire's flow for the canvas's dots and is not recorded.
- **Faults** are the schema's rule, by reference: `wiredNeeds(blueprint, catalogue, state)` with the controls' state (`controlsOf`), and `explainByControls` for the voltage ways, to which sim-core adds the short step and the feeder step itself (N10). Each solver judges its own needs and the loop merges them. A fault shows only once it has lasted 3 ticks (0.1 s) and ends once gone for 3, so glitches of a tick or two never reach the record; readouts, poses and sounds are never debounced. Details: [docs/runs.md](docs/runs.md#faults).
- **Inputs.** `input()` records a switch flip at the current tick, effective from the next step, so a run record replays exactly: each input made at its tick before the step that applies it, and one at tick = `ticks` after the last step ([docs/runs.md](docs/runs.md#inputs)).
- **Stop.** The app snapshots at tick 0 and restores on Stop, keeping the Simulation and its seed while the build is unchanged (D37). Nothing is ever written back to the blueprint (ground rule 4). A snapshot restores into its own Simulation or a twin of the same blueprint, part records, arena and seed (the same fingerprint), and nowhere else.
- **Records.** `record(context)` gives the schema's RunRecord of the ticks so far, which `validateRunRecord` accepts, with `fixed` from the previous Run (D31).
- **The program slot** (task 1.6). Each tick, between the electrical and the mechanical solver, every brain (a `program` primitive) whose supply is at or above its `onVolts` runs through the Run's `ProgramRuntime`: `start({ partId, primitive })` gives its first state, and `run({ partId, primitive, tick, inputs }, state)` gives `{ outputs, state }`. Details: [docs/program.md](docs/program.md).
  - `inputs` are the levels (0–1) on its signal ins as sampled at the end of the previous tick. `outputs` are the levels it drives this tick, which reach the signal ins they are wired to in the same tick. A port left out carries no signal.
  - The state is plain JSON (Level 3's variables, timers and held levels), kept in snapshots, so `start` and `run` stay pure. Below `onVolts` the brain is off: it drives nothing, and starts again from `start` when power returns.
  - Rules are data: `src/program/` runs Level 3's block rules ("when this input reads above a level, set this output") through one generic runtime, so the loop never changes for them. With no `program`, every brain is the v1 no-op: it drives nothing (D41).

## Inside

The solvers are internal: they import each other by relative path, and the package entry exports none of them.

- [docs/graph.md](docs/graph.md): the wired graph (task 1.1) that every solver reads.
- [docs/electrical.md](docs/electrical.md): the electrical solver (task 1.2), which gives the volts, currents, battery drain and electrical faults of each tick.
- [docs/behaviour.md](docs/behaviour.md): the behaviour runtime (task 1.3), which turns volts, signals and loads into what each part does, and judges the signal, torque, drive and mount needs.
- [docs/mechanical.md](docs/mechanical.md): the mechanical solver (task 1.4): drive, collisions, ramps and balance in the arena, and the floor and balance needs.
- [docs/program.md](docs/program.md): the program slot (task 1.6), the no-op brain and the block-rule runtime.
- [docs/loop.md](docs/loop.md): the tick loop and the recorder (task 1.5): the order of a tick, events, the warm-up, snapshots, cost and open questions.
- [docs/runs.md](docs/runs.md): a Run in detail, from outside.

## Rules every sim-core task keeps

- Same blueprint, catalogue, arena, seed, inputs and program give the same frames and run record on every device.
- No clocks, `Math.random` or UI globals (lint enforces it). The seed is the only chance.
- Every angle on a Run path goes through the schema's `cosSin`, never `Math.sin`, `cos`, `tan`, `atan2`, `exp`, `log`, `pow` or `hypot`. Plain arithmetic and `Math.sqrt` are safe.
- Parts, wires and nets are visited in a stable order (sorted by id), never insertion order.
- Rapier's profiler stays off, and its `timing*()` values never reach simulation state.
- `src/interface.ts` stays types only, so the canvas never pulls in the engine.

## Tests

sim-core's own tests use `@servo/schema/fixtures`, so they do not move when content does. The one exception, `test/busy-workbench.json`, is a frozen copy of the content fixture, run on the schema's example parts (`busyWorkbench` in `test/loop-support.ts`) for the warm-up's eight-control test. Behaviour tests against the real content records and `@servo/content/fixtures` live in packages/tools, beside the golden-run harness (task 1.7), whose references live in `golden/`. `test/loop.test.ts` covers the tick loop and the recorder. `packages/tools/test/sim-determinism.test.ts` replays every valid schema blueprint and every content fixture 10 times (three content fixtures 100 times), compares the run records byte for byte and reports each fixture's `expect`. `pnpm --filter @servo/tools test:determinism` runs every one of them 100 times; it is not part of `pnpm check`.

Timing tests are named `test/*.perf.ts` and run apart, under `vitest.perf.config.ts`: `pnpm --filter @servo/sim-core perf`, or `pnpm perf` at the root with every package's. `test/electrical.perf.ts` holds the 25-part per-tick cost. `pnpm test` leaves them out, so a busy machine's timing never fails it.
