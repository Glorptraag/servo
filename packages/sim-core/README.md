# @servo/sim-core

The simulation engine. It turns a blueprint into a wired graph and steps it tick by tick through the electrical, program and mechanical solvers, giving RunEvents, live values and a run record. It is pure and deterministic (ground rule 2) and depends only on `@servo/schema` and Rapier's deterministic build ([docs/stack.md](../../docs/stack.md)). Phase 1 owns it: graph 1.1, electrical 1.2, behaviour 1.3, mechanical 1.4, loop and recorder 1.5, program slot 1.6. Task 0.4 owns this interface, typed in [src/interface.ts](src/interface.ts).

```ts
import { createSimulation } from '@servo/sim-core'; // the app and tools; a stub that rejects until task 1.5
import type { RunFrame } from '@servo/sim-core/interface'; // the canvas: this file only, types only
```

## Public surface

| Name | What |
| --- | --- |
| `createSimulation({ blueprint, catalogue, arena, seed, program? })` → `Promise<Simulation>` | Validates its inputs, copies the blueprint in canonical form and solves tick 0. Async so the physics engine's WebAssembly can initialise on the first call (D11: at the first Run). Rejects with a `SimulationSetupError` (`issues`) for invalid input, never for a legal-but-wrong build |
| `Simulation` | `blueprint`, `seed`, `tick`, `frame`, `step()`, `input(control)`, `snapshot()`, `restore(snapshot)`, `record(context)`, `dispose()` |
| `RunFrame` | `{ tick, events, live, flows }`: one tick, for the app and for `canvas.applyRunFrame` |
| `LiveState`, `WireFlow` | One subject's state now (`values`, `motion`, `sounds`, `faults`); what flows along one wire |
| `ControlInput`, `SimSnapshot`, `RunRecordContext` | A switch flip; the opaque whole state; what only the app knows about a Run |
| `ProgramRuntime`, `ProgramState`, `BrainTick`, `BrainStep` | The brain's program slot (task 1.6, Level 3) |
| `@servo/sim-core/behaviour` | Tools only: the behaviour runtime for packages/tools' fixtures, which lint refuses in every other package's src ([docs/behaviour.md](docs/behaviour.md)) |

`@servo/sim-core` re-exports every type. The catalogue is the schema's `makeCatalogue` result, passed in: sim-core never imports content. `arena` is the preset record that `blueprint.arena.preset` names, and the child's props come from `blueprint.arena.props`.

## In brief

- **Time.** One tick is 1/30 s of simulated time. The caller steps; display speed (1–30 ticks a second), the spin-up and slow motion are the app's clock.
- **Tick 0** is the starting state, before any time passes: its frame has every part's values and every body's pose, so the wires light before anything moves.
- **Events** are the schema's `RunEvent`: `value` and `sound` per placed part, `fault` when one of the part's own failure modes starts or ends, and `motion` per body (the robot's root part, a loose part or a prop `arena:<propId>`). Parts on the robot ride with it, placed by `placeParts`.
- **Live values.** `frame.live` is the fold of every event so far, so the spec card can join a Run at any tick. `frame.flows` gives each wire's flow for the canvas's dots and is not recorded.
- **Faults** are the schema's rule, by reference: `wiredNeeds(blueprint, catalogue, state)` with the controls' state (`controlsOf`), and `explainByControls` for the voltage ways, to which sim-core adds the short step and the feeder step itself (N10). Details: [docs/runs.md](docs/runs.md#faults).
- **Inputs.** `input()` records a switch flip at the current tick, effective from the next step, so a run record replays exactly.
- **Stop.** The app snapshots at tick 0 and restores on Stop, keeping the Simulation and its seed while the build is unchanged (D37). Nothing is ever written back to the blueprint (ground rule 4).
- **The program slot** (task 1.6). Each tick, between the electrical and the mechanical solver, every brain (a `program` primitive) whose supply is at or above its `onVolts` runs through the Run's `ProgramRuntime`: `start({ partId, primitive })` gives its first state, and `run({ partId, primitive, tick, inputs }, state)` gives `{ outputs, state }`. Details: [docs/program.md](docs/program.md).
  - `inputs` are the levels (0–1) on its signal ins as sampled at the end of the previous tick. `outputs` are the levels it drives this tick, which reach the signal ins they are wired to in the same tick. A port left out carries no signal.
  - The state is plain JSON (Level 3's variables, timers and held levels), kept in snapshots, so `start` and `run` stay pure. Below `onVolts` the brain is off: it drives nothing, and starts again from `start` when power returns.
  - Rules are data: `src/program/` runs Level 3's block rules ("when this input reads above a level, set this output") through one generic runtime, so the loop never changes for them. With no `program`, every brain is the v1 no-op: it drives nothing (D41).

## Rules every sim-core task keeps

- Same blueprint, catalogue, arena, seed, inputs and program give the same frames and run record on every device.
- No clocks, `Math.random` or UI globals (lint enforces it). The seed is the only chance.
- Every angle on a Run path goes through the schema's `cosSin`, never `Math.sin`, `cos`, `tan`, `atan2`, `exp`, `log`, `pow` or `hypot`. Plain arithmetic and `Math.sqrt` are safe.
- Parts, wires and nets are visited in a stable order (sorted by id), never insertion order.
- Rapier's profiler stays off, and its `timing*()` values never reach simulation state.
- `src/interface.ts` stays types only, so the canvas never pulls in the engine.

## Tests

sim-core's own tests use `@servo/schema/fixtures`, so they do not move when content does. Behaviour tests against the real content records and `@servo/content/fixtures` live in packages/tools, beside the golden-run harness (task 1.7), whose references live in `golden/`.
