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
| `state.explained` | Answers found under the current key: the control state and which motor drivers brown out (below). Plain data in a fixed order: keep it in the snapshot |
| `inputs.controls` | The schema's `ControlState`. A control left out sits at rest; a channel's command is clamped to −1..1, and NaN reads as stop |
| `inputs.actuators` | Per use, as last tick left it: `rpm` (a drive's shaft speed) and `loadNmm`. The solver order is electrical, program, mechanical, so a motor's back-EMF and load come from last tick |

| Out (`solution`) | What |
| --- | --- |
| `netVolts` | Per net. Each separate circuit reads from its reference net at 0 V: the − of its first source in graph order, else its first net. A net nothing drives reads 0 |
| `sources` | Per source: `emfVolts` (open-circuit; an output's the way it drives, never below 0), `volts` (terminals), `milliamps` (out of +), `sagVolts` (`emf − volts`, current × internalOhms for a battery), `charge`, `giving`, and `duty` (a motor driver channel's share of the time on: below 1 while it browns out) |
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
| `driver` | Its supply draws idleMilliamps (ramping to onVolts). Each channel at command n: an ideal transformer of ratio \|n\| from the supply, less dropVolts, behind 0.01 Ω, one way (by the sign of n), up to maxMilliamps; the supply carries \|n\| × the output current. A driver whose supply would sag below onVolts browns out: its channels run at a duty below 1 (below) |
| `regulator` | Its output holds `volts` while the supply is above volts + dropoutVolts and follows the supply less dropoutVolts below that, behind 0.01 Ω, up to maxMilliamps; its supply carries the output current |

`steadyRpm(spec, volts, loadNmm, throttle, reverse)` gives the speed a DC motor settles at: noLoadRpm × (throttle × volts ÷ ratedVolts − load ÷ stallTorqueNmm), still below startVolts, stalled past its torque. With that speed fed back, the winding carries exactly what the load needs: the solver's steady state. The behaviour runtime and the mechanical solver (tasks 1.3 and 1.4) own the motion; this is the curve they can use.

## Solving

- Nodes are nets joined by closed switches (`liveAt`). Every unknown node volt goes into one symmetric positive definite matrix, eliminated in net order with no pivoting.
- An output's transformer adds one outer product to that matrix, so it stays symmetric.
- Every primitive's curve is non-decreasing, so the operating point minimises a convex, piecewise-quadratic function.
  - Damped Newton finds it: solve with each branch on its current segment, then walk towards that answer only while the function falls.
  - It always ends.
  - In 27,000 random circuit states of up to 12 parts, every one settled: 98% in 1 to 3 solves, the rest in a handful, and a few dozen while a motor driver browns out and its duty is searched for: 36 is the most seen (review R-1.2, round 2). (The reviewer once saw 9 without a driver.) The bound is 2,048.
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

## A motor driver browning out

A driver's supply can be above its onVolts at rest and sag below it under load: two stalled DC motors on a 2-cell pack below about 86% charge. A real driver then stutters, cutting out and coming back faster than a tick.

- **The lumped stutter.** Every tick starts with each driver fully on. If that would sag its supply below onVolts, its channels run at a duty d below 1:
  - each channel gives d × what it gives fully on: its ratio, its drop and its current limit all scale by d;
  - d holds the supply between onVolts and onVolts + 2 µV, found by regula falsi with the Illinois step;
  - d is 0 when even the supply with its outputs off is below onVolts, as on a 1-cell pack.
- **No latch.** The motors still get the duty's share, so they spin up, the sag eases, and the driver is fully on again the first tick its supply allows.
  - Review R-1.2 found that the earlier model left a restarted kit robot dead for good, because it switched a browned-out channel off for the whole tick.
- **The child sees why.** While a driver browns out, its own power need is `low`, and only a short or a feeder explains that, never the controls. This is the orchestrator's ruling on R-1.2; the record says "the fault is the driver's".
  - A part a browned-out driver starves is `low` and put down to that driver, straight after the short step.
  - A supply wired the wrong way round reads `reversed`, and one above maxVolts `high`, whatever the channels do. The brown-out makes only an in-range or `low` reading `low` (review R-1.2, round 2, finding 1).
- **Measured.**
  - With the schema's records, the Level 2 kit robot (pack, switch, driver, two DC motors, LED) reaches 85% after 84 s of driving.
  - Switched off and on again, it browns out for 2 ticks (duty 0.865, then 0.985), with the driver's `low-voltage` showing, then runs.
  - With main's content records it reaches 86% after 71 s and behaves the same.
  - Held against a wall, it stays browned out, with the fault showing, for as long as it is held.

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
  - **A browned-out motor driver** that starves it of volts (`low` only): the feeder.
  - **The controls:** `explainByControls`, each other setting solved with this tick's charges.
  - **A motor driver or regulator without power** that feeds it: the feeder.
  - If none holds, it is a fault. `faults` lists each part's own failure modes for the unexplained needs, in the record's order.
  - A browned-out driver's own `low` takes the short step and the feeder step only (above).
- **Kept answers (review N14).** A need's answer goes into `state.explained` under a key: the control state, and which motor drivers brown out. A new key starts afresh, so when a brown-out starts or ends every need is searched again in the rule's order (review R-1.2, round 2, finding 2).
  - Under one key, a kept explanation is checked again every tick: one solve at the setting the controls step found, one of the healed circuit, or a look at the feeder.
  - When it no longer holds, the need is searched again, so a draining pack cannot hide a fault (review R-1.2, finding 2).
  - A kept fault (nothing explained it) stands while each battery's charge stays in its band, 5% wide (`CHARGE_BAND`), and no motor driver or regulator that feeds it loses power. Then it is searched again. So a need that flickers in and out does not search each time.
  - Because the answers are in the state, a restored snapshot replays exactly.
- **Start-up.** At tick 0 nothing turns, so a motor draws its stall current. On a weak pack that can read `low` for the few ticks it takes to spin up.

## Cost

- A 25-part build takes about 0.1 ms a tick under plain Node, measured on an M1 Max under Node 26.
  - `test/electrical.test.ts` asserts that the fastest of 15 batches is under 1 ms.
  - Under Vitest on a busy machine, the median is 0.2–0.3 ms.
- Per situation (control state), the solver keeps its branches, the switch forest and the wiring verdicts. Per model, it keeps the power-line forest and each need's ports.
- What costs more:
  - A new control state costs one `wiredNeeds` call (580–630 ms on review N14's pathological build).
  - A voltage-way need costs one search the first time it appears under a key, and one solve a tick while a kept explanation is checked. A kept fault costs a search again when a pack enters another band; kept explanations outlast the bands (review R-1.2, round 2, finding 3).
  - A tick in which a driver browns out costs up to a few dozen solves.
- **Not done here (review R-1.2, finding 4):**
  - Searches still run inside the tick on the first visit to a control state. Task 1.5 can warm a kit's 64 or fewer control states at Run start.
  - They also run inside the tick when a kept explanation stops holding, and for a kept fault in a new band. Ten DC motors, each stalled behind its own switch on a 2-cell pack, are the worst case seen: a search there tries all 1,023 other settings, about 0.2 s, at 12 ticks over a full drain (26 before kept explanations outlasted the bands). Kit builds take a few ms.
  - Level 3 channel commands would grow the caches with every new value.

## Decisions and open questions

Questions for Drew, for the orchestrator to queue (rule 13; review R-1.2, finding 3):

1. **Short drain time.**
   - The source primitive says the open-circuit volts fall to emptyVolts as charge is used. Here they fall in a straight line, with the cut-off at empty.
   - So a short drains in 35.0 s and 23.4 s (23.4 s for both content packs), not the first-order 28.8 s and 19.2 s.
   - Keeping the current at volts ÷ internalOhms until empty would need the volts to stay up.
2. **Battery.** A drained pack gives nothing, and current either way drains a pack. Both are the conservative readings.
3. **Motor-driver brown-out.** It is built as the lumped stutter above, with the driver's own `low-voltage` showing while it lasts (the orchestrator's ruling). Should a browned-out driver's motors turn slowly, as here, or should it cut out?
4. **The servo motor's draw.** It rises with its load, from idleMilliamps to stallMilliamps at holdingTorqueNmm. The record does not say so, and task 1.3 stalls the arm earlier, at holdingTorqueNmm × volts ÷ ratedVolts.
5. **Outputs.** Drivers and regulators sit behind a 0.01 Ω output resistance. A regulator is linear: its supply carries the output current.

Decisions taken here:

- **Thresholds ramp.** A constant draw ramps up from 0 V below its threshold. A threshold of 0 V ramps over 10 mV (`KNEE_VOLTS`).
- **Fixture findings.** These are the schema's records only; the content records differ.
  - At rest, the bumper robot shows `low-voltage` on a 2-cell pack, on its buzzer (3 V minimum) and its servo motor (4.8 V).
  - The motor-off-pin build shows it on the microcontroller: 3 V minimum, 2.95 V under load.
  - In content, the buzzer's minimum is 2.5 V, and the servo motor is low on one pack by design (D50).
