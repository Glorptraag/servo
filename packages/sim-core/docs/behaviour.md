# The behaviour runtime

Back to the [README](../README.md). Task 1.3. `src/behaviour/` runs every part's behaviour primitives each tick. It turns what the other solvers give (port volts and currents, signal levels, the load on each actuator) into what each part does: shaft speed, arm angle, light and sound. From that it gives the needs it judges, the failure modes they make active, and the effects a child sees.

Each primitive kind is implemented once, from its record's parameters (ground rule 1). Nothing here reads a part's id, name or family.

```ts
// In packages/sim-core/src (the tick loop, task 1.5):
import { behaviourModel, behaviourTick, startBehaviour } from '../behaviour/index.ts';

const model = behaviourModel(graph); // once per Run: settings applied, drive routes found
let state = startBehaviour(model); // every servo arm at its restDeg
const tick = behaviourTick(model, state, { power, controls, signals, loads });
state = tick.state;
```

The package exports this module as `@servo/sim-core/behaviour` for the behaviour fixtures in packages/tools, which cannot reach the graph: `behaviourModelOf(blueprint, catalogue)` builds the graph first. The app runs a Run through `createSimulation`.

## Where it sits in a tick

The tick loop (task 1.5) runs it after the electrical solver and before the mechanical solver, and decides where the program step falls. It reads the electrical solver's answer for this tick, the signal levels the loop gives it, and the mechanical solver's loads from the last tick. It imports neither solver: the loop passes their answers in.

| Need kinds | Judged by | Effects shown by |
| --- | --- | --- |
| power, loop, isolation | electrical solver (1.2), by the schema's rule (`wiredNeeds`, `explainByControls`, review N10) | this runtime, from the volts and currents: `still`, `slow`, `reverse`, `dark`, `dim`, `silent`, `quiet`, `off`. `drain` is the electrical solver's (D17) |
| signal, torque, drive, mount | this runtime | this runtime: `stall` and `hum`, `hold` and `hum`, `still`. A loose caster's `drag` is the mechanical solver's |
| floor, balance | mechanical solver (1.4) | mechanical solver: `slip`, `tip`, `drag` |

## Inputs: `BehaviourInputs`

Anything left out is at rest. A power port reads 0 V and 0 mA, a control sits at rest, a signal in carries no signal, an actuator turns no load, and the tick lasts 1/TICK_RATE s.

- **`power`**: per placed part, each power port's net `volts` and the `milliamps` flowing into the part through it. The electrical solver's per-part answer has this shape.
  - Only differences between ports are read. A primitive's volts are its + port less its − port.
  - Currents are read only to see whether a battery or a switch carries any (more than `FLOWING_MILLIAMPS`, 1 µA).
  - A load's light and sound follow its current. That current is fixed by its volts through the load rule, which is the same rule the electrical solver uses, so the runtime reads the volts.
- **`controls`**: the schema's `ControlState`, read as `wiredNeeds` reads it. A switch is closed only when its value is `true`, and a control left out sits at its rest (`graph.controls`).
- **`signals`**: per placed part, the level (0–1) on each signal in that something drives this tick. Levels are clamped to 0–1, and a value that is not a finite number carries no signal. In v1 nothing drives a signal (D41).
- **`loads`**: per placed part and actuator primitive, the torque resisting its drive in N·mm, from the last tick's mechanics.
  - It always resists, whichever way the actuator turns.
  - Below 0, and NaN, read as no load. `Infinity` is a wall, so it stalls the actuator.
  - The mechanical solver turns a wheel's torque into its actuator's load with the route's `torque` gain.
- **`seconds`**: simulated time the tick covers. Tick 0, before any time passes, passes 0, so no arm moves.

## Outputs: `BehaviourTick`

- **`parts`**: every placed part in id order, as a `PartBehaviour`:
  - `values`: `rpm`, `angle`, `light` and `closed`, in the schema's `ValuePayload` words. Each comes from the part's first primitive that gives it, in the record's order. Volts, milliamps and charge are the electrical solver's.
  - `sounds`: at most one of each, the loudest, in `RUN_SOUNDS` order:
    - `motor` while a shaft turns, at |rpm| ÷ noLoadRpm, or while an arm sweeps, at sweep ÷ degPerSecond;
    - `hum` while an actuator is stalled, or a servo holds with no signal, at drive volts ÷ ratedVolts;
    - `buzz` at a sounding load's level and `hz`.
    - Levels are at most 1. `squeal` and `knock` are the mechanical solver's.
  - `primitives`: each primitive's output in the record's order: its state, speed, angle, level, command, and whether it works (below).
  - `needs`: the signal, torque, drive and mount verdicts, in the record's order.
  - `faults`: its own failure modes those verdicts make active, in the record's order.
  - `effects`: what a child sees and hears, in `EFFECTS` order, from `BEHAVIOUR_EFFECTS`.
- **`drives`**: each drive linkage's rpm, signed as its drive-out turns, in wire id order. This is the interface's `WireFlow.rpm`.
- **`state`**: `{ arms }`, each position actuator's angle in degrees, in `model.arms` order.
  - It is plain numbers in a fixed order, so a snapshot of it gives equal bytes for equal states.
  - −0 is never written.

## The model: `behaviourModel(graph)`

The model is made once per Run, because a Run's snapshot never changes.

- **Settings.** Each parameter a setting binds (`BINDABLE_PARAMS`) takes the placed part's value, mapped by `mapSettingValue` or read from the chosen option. Values apply as the blueprint stores them, as `wiredNeeds` reads a channel's setting, whatever the unlock level. Out-of-range values are clamped to the parameter's domain.
- **Links.** A part's mount ports fixed to a mount point are `fixed`, and its drive-ins linked to a drive-out are `linked`.
- **Routes.** Each drive port an actuator reaches has a `DriveRoute`: the actuator, and the `speed` and `torque` gains of the gearboxes between.
  - A gearbox passes 1/ratio of the speed and ratio × efficiency of the torque.
  - While its mount is loose it passes nothing, since the housing turns instead.
  - A loop of gearboxes with no actuator in it turns nothing.

## The primitives, kind by kind

Rated values are measured at `ratedVolts`, so speed, torque and sweep rate scale with volts ÷ ratedVolts. Each kind works by the rule below.

| Kind | Works when | Rule |
| --- | --- | --- |
| `source` | current flows through it | The electrical solver solves it; this runtime only sees whether it gives current. |
| `switch` | current flows through it | `closed` comes from the controls. |
| `load` | its level is above 0 | The level is (volts − onVolts) ÷ (ratedVolts − onVolts), from 0 to at most 1: its current over ratedMilliamps. Reversed, `blocks` gives 0 and `works` gives the same as the right way round. |
| `actuator` speed | it is driven: \|throttle × volts\| ≥ startVolts | The drive is throttle × volts; `blocks` gives no drive reversed. Speed is noLoadRpm × (drive ÷ ratedVolts − load ÷ stallTorqueNmm). Where that reaches 0 it is `stalled`: the load is at least `capacityNmm` = stallTorqueNmm × drive ÷ ratedVolts. Reversed supply turns it the other way (`reverses`), and `reverse` flips it again. |
| `actuator` position | volts ≥ startVolts, the right way round | A load at or past holdingTorqueNmm × volts ÷ ratedVolts stalls it. With no signal it is `holding`. With a signal at level l it sweeps towards minDeg + l × (maxDeg − minDeg), at degPerSecond × (volts ÷ ratedVolts − load ÷ holdingTorqueNmm), then is `settled`. The arm's rpm is its turning this tick. |
| `driver` | supply ≥ onVolts | `command` is a driven signal's level, otherwise the control's setting, clamped to −1..1, with NaN read as stop. The output's volts are the electrical solver's. |
| `regulator` | supply ≥ volts + dropoutVolts | It holds its output; the output's volts are the electrical solver's. |
| `program` | supply ≥ onVolts | The program runtime (1.6) runs it while it works. |
| `ratio` | — | The output's rpm is the input's ÷ ratio while fixed, else 0. It reports whether it is `driven` and `fixed`. |
| `wheel` | — | The hub's rpm comes from the drive-out linked to it. How the robot rolls is the mechanical solver's. |
| `support` | — | It is `fixed` or not. Whether it reaches the floor is the mechanical solver's. |

## Needs this runtime judges

These needs come from the simulation, with no search of the controls ([runs.md](runs.md#faults)). A stall or a missing signal is a fault while it lasts.

- **signal**: `absent` while no level arrives at the port. It is judged only while the primitive that reads the port has power (a servo from its startVolts), because without power the part shows its power failure. It cannot hold and hum.
- **torque**: `exceeded` while the actuator on the port is stalled. It is judged only while the actuator is driven.
- **drive**: `absent` when the drive-in is not linked.
- **mount**: `absent` when the mount is not fixed (D19: an unmounted part shows its mount fault).

## Effects (`BEHAVIOUR_EFFECTS`)

Effects are observations in the schema's words, read from the outputs. They are not faults. The app shows faults; the effects are what the behaviour fixtures test the records' claims against.

| Effect | Shown when |
| --- | --- |
| `still` | Every turning output is at rest because nothing drives it: an idle actuator, a gearbox output or wheel at 0 rpm. |
| `slow` | An actuator turns or sweeps, but less than it would at its rated volts with the same load and settings. |
| `reverse` | A speed actuator turns the other way from the way its settings turn it. |
| `stall`, `hum` | An actuator is stalled. `hum` is any `hum` sound. |
| `hold`, `hum` | A position actuator holds, with power and no signal. |
| `dark`, `silent` | Its light, or its sound, is 0. |
| `dim`, `quiet` | Its light or sound is above 0 and below 1, which is less than at its rated volts. |
| `off` | Nothing in it that gives, carries or takes power works. Parts with only mechanical primitives are never off. |

`slow`, `dim` and `quiet` compare with the rated volts (the schema's definition), so a part run below its rated volts shows them whether or not a failure mode is active. A DC motor on a 2-cell pack, for example, is `slow` against its 6 V rating. A failure mode's claims are tested under its own condition. The working condition, at rated volts, shows none.

## Determinism and cost

- The arithmetic is plain: no `Math.pow`, `exp`, `log` or trigonometry, no clock and no randomness.
- Parts are visited in id order, primitives in the record's order, and sounds and effects come out in the schema's order.
- `behaviourTick` never changes its model, state or inputs. It never throws for a valid graph, whatever the numbers: NaN volts read as 0, and a short or missing state starts at rest.
- A tick is a few comparisons per primitive, with no search.

## Tests

- **`test/behaviour.test.ts`** uses the schema's example parts and blueprints only. It checks:
  - each kind's rule, including the speed ratio between a 1-cell and a 2-cell pack, the stall boundary, the sweep, the load curve, the commands, the routes through gearboxes and a loose gearbox;
  - every failure mode the runtime judges;
  - that a renamed record behaves identically (rule 1);
  - every primitive kind of the vocabulary;
  - determinism, frozen inputs and odd inputs.
- **`packages/tools/test/behaviour-content.test.ts`** holds the behaviour fixtures generated from the records. It runs over the Level 1–2 content records, and over the schema's example records until task 2.2 authors Level 2.
  - For each part it builds a bench and one tick's inputs from the record alone, with every need met, and checks that the part shows no effect and no fault.
  - For each failure mode it unmets that one need in its way:
    - power `open` 0 V, `low` 0.01 V below `minVolts`, `high` 0.01 V above `maxVolts`, `reversed` the working volts swapped;
    - loop `open` with no current;
    - isolation `shorted` with the pack's volts ÷ internalOhms through it;
    - no signal level;
    - a load of exactly what the actuator can give;
    - no drive linkage;
    - no mount.
  - The working volts are the rated volts of the primitive on that supply, or the middle of the need's range when none is rated.
  - The claims must show on every one of three ticks, and a need this runtime judges must make its failure mode active. Each claim it does not show must belong to a named solver.

## Decisions and open questions

- **The `./behaviour` export.** Lint lets a test import another package only through its exports, so the fixtures in packages/tools reach the runtime through a `./behaviour` entry in sim-core's package.json. The package map lets the app import it too; the README's public surface does not list it yet.
- **Signal to angle.** A servo commanded at level l goes to minDeg + l × (maxDeg − minDeg). Its `target` setting is not read here: how a Level 3 program uses it is open (schema question 2).
- **No signal from an unpowered brain.** A powered servo shows `no-signal` whenever no level arrives, as D41 intends for v1. The schema's feeder step (an unpowered driver's own fault stands for what it feeds) covers power needs only. Whether an unpowered brain should explain its servo's missing signal the same way is a Level 3 question.
- **Signal to command.** A driven signal sets a motor-driver channel's command to its level, so a signal drives forward only. How Level 3 drives a channel backward is open.
- **Servo with too little power.** Below its startVolts a servo does nothing: no hold, no hum, no sweep. With the example record (3.5 V start, 4.8 V minimum), a servo on one 2-cell pack (3 V) stays still, so D41's hold-and-hum lesson needs more volts. That is a question for task 2.2's record.
- **Buzzer on a 2-cell pack.** The example buzzer's range starts at 3 V, above what a 2-cell pack gives under load (about 2.8 V), so its low-voltage fault would show on the standard pack. That is also for task 2.2.
- **Servo sweep under load.** A servo's sweep slows with load in the same straight line as a DC motor's speed. The schema states only that it pushes up to holdingTorqueNmm.
- **Sound levels.** The levels and the use of `motor`, `hum` and `buzz` are this runtime's reading of brief Section 11. The app's sound design may rescale them.
