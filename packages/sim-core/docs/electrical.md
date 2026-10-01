# The electrical solver

Back to the [README](../README.md). Task 1.2. `src/electrical/` solves the power graph once a tick: the volts on every net, the current through every part, port and power line, each battery's sag and charge, short circuits, and the verdict on every power, loop and isolation need. It is the lumped model of brief Section 6: sources, loads as current draws, a battery whose capacity falls with draw, no transient physics.

Like the graph, it is internal to sim-core. The tick loop (task 1.5) imports it by relative path:

```ts
import { buildGraph } from '../graph/index.ts';
import { electricalModel, initialElectricalState, solveElectrical, stepElectrical } from '../electrical/index.ts';

const model = electricalModel(buildGraph(blueprint, catalogue)); // once per Run
let state = initialElectricalState(model); // every battery full
const tick0 = solveElectrical(model, state, { controls }); // no time passes
const next = stepElectrical(model, state, { controls, actuators }); // one tick: solve, then drain
state = next.state;
```

## One tick

| In | What |
| --- | --- |
| `state.charge` | Each source's charge, 0–1, indexed like `graph.sources` (an output's stays 1) |
| `state.explained` | Explanations found at the current control state (below). Plain data in a fixed order: keep it in the snapshot |
| `inputs.controls` | The schema's `ControlState`. A control left out sits at rest; a channel's command is clamped to −1..1, and NaN reads as stop |
| `inputs.actuators` | Per use, as last tick left it: `rpm` (a drive's shaft speed) and `loadNmm`. The solver order is electrical, program, mechanical, so a motor's back-EMF and load come from last tick |

| Out (`solution`) | What |
| --- | --- |
| `netVolts` | Per net. Each separate circuit reads from its reference net at 0 V: the − of its first source in graph order, else its first net. A net nothing drives reads 0 |
| `sources` | Per source: `emfVolts` (open-circuit), `volts` (terminals), `milliamps` (out of +), `sagVolts` (`emf − volts`, current × internalOhms for a battery), `charge`, `giving` |
| `uses` | Per use: `volts` across its supply and `milliamps` into its + (a driver's or regulator's supply includes what its output passes on) |
| `parts` | Per placed part, read as the schema's `ValuePayload` (`volts`, `milliamps`, `charge`), with every power port's `volts` and `milliamps` (from the net into the part) |
| `switches`, `wires` | Current through each switch and along each power line (`from` → `to`, as `WireFlow` counts it) |
| `shorts`, `verdicts`, `faults` | Below |

`stepElectrical` then drains each battery by the current through it over one tick (1/30 s); `solveElectrical` keeps the charges. Both are pure: the same model, state and inputs give the same bits.

## The model, per primitive

Everything comes from the record's parameters; nothing branches on a part's id, name or family (ground rule 1). A primitive's current is a continuous, piecewise-linear, non-decreasing function of the volts across it.

| Primitive | Model |
| --- | --- |
| `source` (battery) | Open-circuit volts E = emptyVolts + (volts − emptyVolts) × charge, behind internalOhms. A short draws E ÷ internalOhms. Drained (charge 0) it gives nothing |
| `switch` | Closed, it joins its terminals' nets into one node; open, nothing |
| `load` | Nothing below onVolts; then a straight line through ratedMilliamps at ratedVolts. `blocks`: nothing reversed; `works`: the same curve reversed |
| `actuator` speed (DC motor) | A winding of ratedVolts ÷ stall current, with back-EMF (ratedVolts ÷ noLoadRpm) × last tick's rpm, plus noLoadMilliamps while it turns, the way it turns. At throttle d the winding sees d × volts and the supply carries d × its current. `blocks`: no current the wrong way |
| `actuator` position (servo motor) | Draws idleMilliamps + (stallMilliamps − idleMilliamps) × min(1, load ÷ holdingTorqueNmm), rising in a straight line from 0 V to startVolts; nothing reversed |
| `program` | Draws `milliamps`, rising in a straight line from 0 V to onVolts; nothing reversed |
| `driver` | Its supply draws idleMilliamps (ramping to onVolts). Each channel at command n: an ideal transformer of ratio \|n\| from the supply, less dropVolts, behind 0.01 Ω, one way (by the sign of n), up to maxMilliamps; the supply carries \|n\| × the output current. Below onVolts the channel browns out and gives nothing for the rest of the tick |
| `regulator` | Its output holds `volts` while the supply is above volts + dropoutVolts and follows the supply less dropoutVolts below that, behind 0.01 Ω, up to maxMilliamps; its supply carries the output current |

`steadyRpm(spec, volts, loadNmm, throttle, reverse)` gives the speed a DC motor settles at: noLoadRpm × (throttle × volts ÷ ratedVolts − load ÷ stallTorqueNmm), still below startVolts, stalled past its torque. With that speed fed back, the winding carries exactly what the load needs: the solver's steady state. The behaviour runtime and the mechanical solver (tasks 1.3 and 1.4) own the motion; this is the curve they can use.

## Solving

- Nodes are nets joined by closed switches (`liveAt`). Every unknown node volt goes into one symmetric positive definite matrix, eliminated in net order with no pivoting.
- An output's transformer adds one outer product to that matrix, so it stays symmetric.
- Every primitive's curve is non-decreasing, so the operating point minimises a convex, piecewise-quadratic function.
  - Damped Newton finds it: solve with each branch on its current segment, then walk towards that answer only while the function falls.
  - It always ends.
  - In 27,000 random circuit states of up to 12 parts, every one settled within 8 solves; 98% took 1 to 3.
- Where a curve is flat, the solver adds a slope of 1e-9 S (`LEAK_SIEMENS`), measured from 0 V. So no net is left without a voltage, and an off LED or a dangling leg draws nothing.
  - It is never reported.
  - Currents under 0.1 µA (`NOISE_MILLIAMPS`) read 0, so leaks and rounding never show.
- Determinism: plain arithmetic in a fixed order. No `Math.pow`, `exp`, `log` or trig, no clock, no randomness. Caches are keyed by what decides their value.

## Batteries

- **Sag and drain.** A pack sags by its current × internalOhms. Each tick its charge falls by |current| × 1/30 s ÷ capacityMah.
- **Current either way drains it.** A pack pushed backwards by a stronger one drains too. Both packs' `short-circuit` failure modes show `drain`.
- **A short** starts at volts ÷ internalOhms (5 A for the 1-cell pack, 7.5 A for the 2-cell). As the charge goes, the open-circuit volts fall to emptyVolts, and the current falls with them.
- **Drain time from the records:**
  - T = (internalOhms × capacity ÷ (volts − emptyVolts)) × ln(volts ÷ emptyVolts).
  - The 1-cell pack: 35.0 s, 1,051 ticks. The 2-cell: 23.4 s, 701 ticks.
  - The first-order figure, capacityMah ÷ (volts ÷ internalOhms), is a lower bound: 28.8 s and 19.2 s.
  - `test/electrical.test.ts` asserts both.
- **Drained.** At charge 0 a pack gives nothing. Its open terminals still read emptyVolts, behind the leak.

## Speed against voltage

- A DC motor turning freely draws noLoadMilliamps at any voltage. So each pack sags by 0.12 A × its internalOhms:
  - 2-cell: 2.952 V and 98.4 rpm;
  - 1-cell: 1.464 V and 48.8 rpm.
- The speed ratio is 1.464 ÷ 2.952, the ratio of the volts, as "speed ∝ voltage" says. The Rolling Start robot gives the same ratio with both motors sharing the sag.
- The same current for half the speed drains the 1-cell pack twice as much per revolution (D17).
- The 1-cell motor shows `low-voltage`, which no control fixes.

## Faults

The rule is the schema's: a fault is what the child's controls cannot fix ([parts.md](../../schema/docs/parts.md)).

- **Wiring.** `wiredNeeds(blueprint, catalogue, state)` decides power `open`, loop `open` and isolation `shorted`, with its explanations. It is cached per control state, so its control search runs once for each state (review N14).
- **Voltages.** A power need the wiring meets is judged on the solved volts across its supply:
  - `reversed` below −1 µV;
  - then `low` below minVolts, or `high` above maxVolts.
- **Explanations, in the schema's order (review N10).** A voltage-way need is explained by the first of these that holds:
  - **A short that starves it:** it would be met with the short's lines and closed switches taken away. Those are every one that shares a block with a shorted part's source or switch, so loops made only of sources count. The explanation names the shorted parts in its circuit.
  - **The controls:** `explainByControls`, each other setting solved with this tick's charges.
  - **A motor driver or regulator without power** that feeds it: the feeder.
  - If none holds, it is a fault. `faults` lists each part's own failure modes for the unexplained needs, in the record's order.
- **Kept until a control changes.** The search for a need's explanation runs once per need and way at a control state. Its answer goes into `state.explained`, and the next tick reuses it until a control changes, so the search never runs every tick (review N14).
  - Because the answer is in the state, a restored snapshot replays exactly.
  - The cost: an explanation found early stands even if the battery later drains past what it assumed.
- **Start-up.** At tick 0 nothing turns, so a motor draws its stall current. On a weak pack that can read `low` for the few ticks it takes to spin up.

## Cost

- A 25-part build takes about 0.1 ms a tick under plain Node, and 0.2 ms under Vitest on a busy machine (median of 15 batches; `test/electrical.test.ts` asserts under 1 ms). Measured on an M1 Max under Node 26.
- Per situation (control state), the solver keeps its branches, the switch forest and the wiring verdicts. Per model, it keeps the power-line forest and each need's ports.
- A new control state costs one `wiredNeeds` call. A voltage-way need costs one search, the first time it appears at that state.

## Decisions and open questions

- **Short drain time (question).** The source primitive says the open-circuit volts fall to emptyVolts as charge is used. So a short drains in 35.0 s and 23.4 s, not the first-order 28.8 s and 19.2 s. Keeping the current at volts ÷ internalOhms until empty would need the volts to stay up.
- **A drained pack gives nothing.** This is the conservative reading of capacity. Drain counts current either way.
- **The servo motor's draw** rises with its load, from idle to stall. This is not stated in the record; it is a question for the behaviour runtime.
- **Thresholds ramp.** A constant draw ramps up from 0 V below its threshold; a threshold of 0 V ramps over 10 mV (`KNEE_VOLTS`).
- **Outputs.** Drivers and regulators sit behind a 0.01 Ω output resistance. A regulator is linear: its supply carries the output current.
- **Fixture findings.** At rest, the schema's bumper robot shows `low-voltage` on its buzzer (3 V minimum) and servo motor (4.8 V) on a 2-cell pack. Its motor-off-pin build shows it on the microcontroller (3 V minimum, 2.95 V under load). For the content tasks to check.
