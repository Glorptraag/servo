# The program slot

Back to the [README](../README.md). Task 1.6. `src/program/` runs each brain's program every tick through the Run's `ProgramRuntime`, the block-rule interface in [src/interface.ts](../src/interface.ts), and puts what the brain drives on its signal lines. In v1 every brain is the no-op brain: it drives nothing (D41). Level 3 plugs its rules in as data, and the tick loop never changes for them.

```ts
// In packages/sim-core/src (the tick loop, task 1.5):
import { programModel, programTick, startProgram } from '../program/index.ts';

const program = programModel(graph, options.program); // once per Run; the no-op brain when `program` is left out
let slot = startProgram(program); // each brain at its runtime's start state
// Each tick, after the electrical solve and before the behaviour runtime:
const brains = programTick(program, slot, { tick, power }); // from Level 3, also `samples`
slot = brains.state; // plain JSON: canonicalJson(slot) is the slot's part of a snapshot
const parts = behaviourTick(model, state, { power, controls, signals: brains.signals, loads, seconds });
// brains.lines gives each signal line's WireFlow.signal.
```

A brain is a placed part's `program` primitive. In v1 only the microcontroller has one.

## Where it sits in a tick

The loop runs, in order: the electrical solver, then this slot, then the behaviour runtime and the mechanical solver; last, the sensors sample the arena (brief Section 6, [runs.md](runs.md#time)).

- The slot reads this tick's electrical answer, in the behaviour runtime's `PartPower` shape, to see which brains have power.
- A brain reads its inputs as they were at the end of the previous tick. It drives its outputs this tick, so a servo motor or a motor driver on an output follows it in the same tick.
- So a brain wired to another brain, or to itself, hears it one tick later, and a sensor's reading reaches a brain one tick after it was taken. Slow motion shows that delay.

Run it at tick 0 too, with no samples: otherwise a servo motor on a Level 3 brain's output would show its no-signal fault for tick 0 before the brain first drives it. With the no-op brain it makes no difference. Whether to do so is task 1.5's choice.

## The runtime contract

`ProgramRuntime` (src/interface.ts, task 0.4) has two methods, and both must be pure:

- `start({ partId, primitive })` gives a brain's state as a Run starts.
- `run({ partId, primitive, tick, inputs }, state)` gives `{ outputs, state }` for one tick.
  - `inputs` holds the level, 0–1, on each of the primitive's inputs that something drives. An input left out carries no signal.
  - `outputs` holds the level, 0–1, to drive on each output this tick. An output left out carries no signal, and a level of 0 is a signal (a servo motor at 0 turns to its `minDeg`).
  - `state` is the brain's state for the next tick: plain JSON with finite numbers. canonicalJson writes NaN as null, so a state holding NaN would not restore exactly.

A runtime is told only the brain's part and primitive. A runtime that needs more about the build (task 6.6's, for example) is made by its caller with the blueprint in hand.

## What the slot does each tick

`programTick(model, state, { tick, power, samples })` visits the brains in the model's order: part id, then the record's primitive order.

- **On or off.** A brain is on while the volts across its supply are at or above its `onVolts`, by the rule the behaviour runtime's `program` primitive works by (`switchedOn`, from the same module). A port left out, or a reading that is not a finite number, is 0 V, and reversed volts are below `onVolts`.
- **Off.** It drives nothing, its runtime is not called, and its state goes back to `start`. So it starts again from the beginning when power returns, as the record's failure mode says ("It switches off, and starts again when the power comes back").
- **On.** The runtime runs it with this tick's number, the levels on its inputs and the state its last step gave.
  - An input wired to a brain's output reads the level that output drove last tick.
  - Any other input reads `samples`: what the loop sampled at the end of the previous tick and carried to the signal ins with `routeSignals`. From Level 3 that is a sensor's reading. Nothing gives one in v1.
  - A signal in takes one line, so an input reads one or the other, never both.
- **Outputs.** The slot keeps only the primitive's own outputs, clamps each level to 0–1, writes −0 as 0, and drops a level that is not a finite number. A runtime cannot drive a port the brain does not have.
- **Lines.** `routeSignals` carries each output's level along every signal line from it, in the same tick:
  - `signals`: per placed part, in id order, the level on each signal in, in the record's port order. It is the behaviour runtime's `signals` input.
  - `lines`: the level on each signal line that carries one, in wire id order. It is the interface's `WireFlow.signal`; a line that carries no signal has no entry.
- **State.** `{ programs, driven }`, each in the model's brain order: every brain's program state, and the levels it drove this tick, which the brains wired to it read next tick.

The answer's `brains` gives each brain's `on`, `inputs` and `outputs` for readouts and tests. The behaviour runtime shows an unpowered brain's `off` effect and its failure modes; the slot shows nothing of its own.

## The no-op brain (D41)

`NO_OP_BRAIN` starts at `null`, drives nothing and keeps its state. `programModel(graph)` uses it when the Run passes no `program`. So in v1:

- a microcontroller's outputs carry no signal, whether it is on or off;
- a powered servo motor wired to one holds where it is and hums, its no-signal failure, exactly as with no signal line at all;
- a motor-driver channel wired to one takes its command from its setting, as with no signal line;
- below `onVolts` the brain is off (the behaviour runtime shows `off`).

Task 6.6's flagged Level 3 slot adds servo behaviour by passing a runtime of its own, without changing the loop. For example, with the flag on it could give each brain a block program that always sets the output wired to a servo motor to the level of that servo's angle setting.

## Block rules: Level 3's programs as data

Rules are data (ground rule 1). `blockRuleRuntime(programs)` is one generic `ProgramRuntime` that runs a `BlockProgram` for each brain, keyed by placed part id. It reads nothing about any part but the levels on the brain's own pins.

```ts
const programs = new Map([
  ['brain', { rules: [
    // "When the sensor on in 2 reads more than 0.5, set the servo motor on out 1 to 45°."
    { when: { kind: 'reading', input: 'in-2', compare: 'above', level: 0.5 }, then: [{ kind: 'set', output: 'out-1', level: 0.25 }] },
    // "Always run the motor driver's channel on out 2 at half."
    { when: { kind: 'always' }, then: [{ kind: 'set', output: 'out-2', level: 0.5 }] },
  ] }],
]);
createSimulation({ blueprint, catalogue, arena, seed, program: blockRuleRuntime(programs) }); // once the package exports it (Exports, below)
```

| Part | Kinds | Meaning |
| --- | --- | --- |
| `BlockRule` | `{ when, then }` | Each tick the brain is on, rules run in order. When `when` holds, the actions in `then` run in order, so a later action on the same output wins. |
| `BlockCondition` | `always` | Holds every tick. |
| | `reading` (`input`, `compare`, `level`) | Holds while the level on `input`, as sampled at the end of the previous tick, is more than `level` (`above`) or less than it (`below`). An input with no signal holds neither. |
| `BlockAction` | `set` (`output`, `level`) | Drives `output` at `level` from this tick on. |

- **Outputs hold their level.** An output carries no signal until an action sets it, then keeps that level until another action sets it, as a real microcontroller's pin does. So a rule that stops holding leaves its servo motor where it sent it, rather than letting go into the no-signal failure.
- **State.** The levels set so far are the brain's state, `{ levels }`, with ports in code-unit order. When the brain loses power the slot starts that state again, so every output goes back to carrying no signal.
- **Robust to odd data.** A level that is not a finite number sets nothing, and a condition or action of a kind it does not know does nothing.
- **Growing the vocabulary.** A new kind (a timer, a variable, a comparison between inputs) is a new member of `BlockCondition` or `BlockAction` and a case in `blockRuleRuntime`. Variables and timers live in the state beside `levels`, and timers can count `tick`. The slot and the loop do not change.

A rule reaches a part only through a signal line from one of the brain's outputs, as in a real build: that is the lesson of a brain that cannot power a motor straight from its pin.

## Determinism and cost

- No clock, randomness, trigonometry, `pow`, `exp` or `log`: comparisons and assignments only.
- Brains are visited in the model's order, lines in wire id order, and signal ins in part id order, then port order. No answer depends on the order levels were given in.
- `programTick` never changes its model, state or inputs. It never throws for a valid graph with the no-op brain or the block-rule runtime, whatever the volts or samples.
- The state is plain JSON, so equal states give equal bytes under `canonicalJson`, and a slot restored from those bytes runs on exactly as before (a test proves it).
- A tick visits each brain once and each signal line twice, with no search.

## Tests

**`test/program.test.ts`** uses the schema's example parts and blueprints only. It runs the slot with the graph and the behaviour runtime over many ticks, writing each net's volts by hand because the electrical solver (task 1.2) is not on this branch. It checks:

- the motor-off-pin fixture, a microcontroller with a servo motor on its out 1:
  - with the brain on, it runs without error and with no effect, so the servo motor holds and hums;
  - every tick is identical with the program step, without it, and with the signal line removed;
  - below `onVolts`, the brain is off and its program never runs;
- a bench with the brain driving a servo motor, a motor-driver channel and its own input:
  - the other parts behave exactly as in the same build with no brain;
  - the brain is on from exactly `onVolts`, by the behaviour runtime's rule;
  - it starts again from its start state when power returns;
  - its inputs arrive a tick late;
- the block-rule runtime through the same loop: a reading above a threshold sweeps the servo motor to 45°, outputs hold their level, a later action wins, a brain with no program drives nothing, and power loss starts it again;
- determinism, frozen inputs, a restore from canonical bytes, a renamed microcontroller (rule 1), and odd volts, samples and outputs.

## Decisions and open questions

- **Restart, not resume.** A brain that loses power starts again from `start`: the record's "starts again when the power comes back", read as a microcontroller's reset. Confirm for Level 3.
- **Held outputs.** The block-rule runtime's outputs keep their last level, like a real pin. The vocabulary (`always`, `reading` above or below, `set`) is the seed that proves the slot, and Level 3 owns it.
- **Where a brain's rules live.** The blueprint is the only persisted format (rule 5), and a run record replays from its blueprint snapshot. A Level 3 program therefore needs a schema minor bump, such as an optional program on the placed part, before Level 3 runs can replay.
- **Exports.** `blockRuleRuntime`, `NO_OP_BRAIN` and the block-rule types are internal to sim-core for now. `src/index.ts` (task 1.5) or a `./program` entry in package.json would expose them to the app; this task cannot change either. Until then the app can write its own `ProgramRuntime` against the interface.
- **Shared rules with the behaviour runtime.** The slot imports `switchedOn`, `signalLevel` and `clean` from `src/behaviour/primitives.ts`, so a brain is on by exactly the rule the behaviour runtime shows it working by. The behaviour index does not export them.
- **Settings driven by rules.** Brief Section 4 says settings "can also be driven by rules in the brain" from Level 3. Through the slot, a rule drives only what a signal line reaches. A part with no signal in, such as the LED, would need one added to its record (data) for a rule to drive it.
- **A brain's readout.** `ValuePayload.signal` holds one level, and the microcontroller has two outputs. Which one its spec card shows is a Level 3 question.
- **Commanding a channel backward** with a 0–1 level is still open ([behaviour.md](behaviour.md#decisions-and-open-questions)).
