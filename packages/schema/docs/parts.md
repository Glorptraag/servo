# Part records

Back to the [README](../README.md). One record per part type, authored as content (packages/content), checked by `validatePartRecord`. The example records in `fixtures/parts/` prove the schema; tasks 2.1 and 2.2 author the real ones.

## Fields (brief Section 6)

| Brief field | Record field |
| --- | --- |
| Identity | `identity`: `name` (as it reads mid-sentence: `DC motor`), `family`, `domains`, `level`, `art` (swap-registry key), `colours` (for placeholder art) |
| (physical) | `body`: `grams`, `size` (mm; also the placeholder proportions), `centreOfMass`. Frames are in [geometry.md](geometry.md). |
| Ports | `ports`: `power` with a `polarity` mark; `signal` with `direction` in or out; `mechanical` with `role`: `drive-out` or `drive-in` (with `at` and `axis`), `mount` (with `at` and `yaw`) or `mount-point` (with `at`, `yaw` and `mirrored`). A port's rating is written once, in the need or primitive that uses it. |
| Needs | `needs`: what must be true for the part to work (below). |
| Behaviour | `behaviour`: a list of primitives (below). |
| Settings | `settings`: `number` (min, max, child-sized `step`, real `unit`) or `choice`, each with an `unlockLevel`. Each drives one primitive parameter through `binds`. The default must equal the primitive's own value, so the part behaves the same before and after the setting unlocks. |
| Failure modes | `failureModes`: a need, the way it goes unmet, `shows` (effects), `teachingNote`, `cardLine` and an optional `hint`. |
| Spec card | `card`: `does` (L1), `needs` and `gives` (L2), `popularMechanics` (L2), `specLine` (L4), `realWorldArt`, `safetyNote`. Name and picture come from identity, settings from `settings`, failure notes from `cardLine`. |

**Spec card layers** (`SPEC_CARD_LAYERS`): name, picture and what it does from Level 1; needs, gives and the popular-mechanics line from Level 2; the spec line from Level 4. The settings layer has no level of its own: each setting shows from its own `unlockLevel`, so a DC motor's direction shows from Level 2 and its speed from Level 3. Failure notes show when the failure happens.

## Behaviour primitives: the closed vocabulary

sim-core implements each kind once and never branches on a part's id, name or family (ground rule 1). Units: V, mA, ohms, mAh, N·mm, rpm, degrees, mm. Rated values are measured at `ratedVolts`. Turning follows the rule in [geometry.md](geometry.md): positive speed is right-handed about the drive's axis.

| Kind | Binds | Parameters | What it does each tick |
| --- | --- | --- | --- |
| `source` | `output` (+/−) | `volts`, `emptyVolts`, `internalOhms`, `capacityMah` | Gives `volts`, falling to `emptyVolts` as charge is used and sagging by current × `internalOhms`. A short draws volts ÷ internalOhms. Capacity is a teaching value. |
| `switch` | `terminals` | `actuation`: `manual` (`initially`) or `contact` (`normally`, `probe`) | Joins its terminals when closed. The child flips a manual switch during a Run (a run input, never a fault). A contact switch flips while its probe touches a wall or prop. |
| `load` | `supply` | `whenReversed` (`blocks` or `works`), `onVolts`, `ratedVolts`, `ratedMilliamps`, `emits?` (light `colour` or sound `hz`) | Draws nothing below `onVolts`. Light or sound follows the current. `blocks` gives nothing when reversed. |
| `actuator` `speed` | `supply`, `drive` | `whenReversed` (`reverses` or `blocks`), `startVolts`, `noLoadRpm`, `stallTorqueNmm`, `noLoadMilliamps`, `stallMilliamps`, `throttle`, `reverse` | Speed ∝ voltage × throttle, reduced by load. At the stall limit it stops, draws stall current and hums. Positive with the supply the right way round and `reverse` false; reversed, it turns the other way. |
| `actuator` `position` | `supply`, `drive`, `command` (signal in) | `startVolts`, `minDeg`, `maxDeg`, `restDeg`, `target`, `degPerSecond`, `holdingTorqueNmm`, `idleMilliamps`, `stallMilliamps` | Sweeps to the commanded angle. With power and no signal it holds where it is and hums. |
| `driver` | `supply`, `output`, `signal?` | `command` (−1..1), `onVolts`, `dropVolts`, `maxMilliamps`, `idleMilliamps` | Output = supply × command − drop, up to the current limit. A driven signal sets the command; otherwise `command` (or its setting) does. |
| `regulator` | `supply`, `output` | `volts`, `dropoutVolts`, `maxMilliamps` | Holds the output at `volts` until the current limit, then the voltage falls (a microcontroller's 3V pin). |
| `program` | `supply`, `inputs`, `outputs` | `onVolts`, `milliamps` | A brain. In v1 it runs no rules and its outputs carry no signal. Below `onVolts` it is off. |
| `ratio` | `input` (drive-in), `output` (drive-out), `mount` | `ratio`, `efficiency` | Output turns 1/ratio as fast, with ratio × efficiency of the torque, the same way about its axis as the input about its axis. It drives only while `mount` is fixed; loose, the housing turns instead. |
| `wheel` | `hub` (drive-in) | `radiusMm`, `widthMm`, `grip` | Rolls the robot by radius × turning, up to its grip; past it, it slips. |
| `support` | `mount` | `rollingFriction` | Carries weight with little drag while mounted and on the floor. Loose or lifted, the frame rests on the floor. |

Every part also has a `body` (mass and centre of mass), and frames carry `mount-point` ports. Together these give the robot's balance.

Settings may drive `actuator.throttle`, `actuator.reverse`, `actuator.target`, `load.colour`, `load.hz`, `driver.command` and `ratio.ratio` (`BINDABLE_PARAMS`). A number setting's `binds.range` maps its range onto the parameter linearly (`mapSettingValue`).

## Needs, unmet ways and effects

**Judged as wired.** Power, loop and isolation needs are judged on the circuit the child built, with every switch counted closed and every motor-driver channel at full forward command.

- A switch's state and a driver's command are control, never faults. When one of them cuts or reverses a part's supply, the part shows that behaviour (it stops, or turns the other way) with no fault.
- A part fed through a motor-driver channel or a regulator whose own power need is unmet, or starved by a short circuit elsewhere in its circuit, shows no power fault of its own: that part's fault, or the short's, stands for it. A motor beside a switch wired across the pack runs while the switch is open, so only the switch and the pack show faults.
- `wiredNeeds(blueprint, catalogue)` gives the verdicts the wiring alone decides: power `open`, loop `open` and isolation `shorted`, plus `explainedBy` for a part behind a driver or regulator without power. sim-core judges `low`, `high` and `reversed` on the voltages of the same as-wired circuit.

| Need | True when | Unmet as |
| --- | --- | --- |
| `power` (`supply`, `minVolts`, `maxVolts`) | a complete circuit, the right way round, within the range | `open` (no closed path through a source joins the supply's ports outside the part), `low`, `high`, `reversed` |
| `loop` (`ports`) | a closed path joins the two ports outside the part, through a source unless this part is the source | `open`, only when there is no closed path at all. A closed path with nothing that uses power is isolation's `shorted`, never `open` |
| `signal` (`port`) | a signal source drives the signal in | `absent` |
| `mount` (`port`) | the mount is fixed to a mount point | `absent` |
| `drive` (`port`) | the drive-in is linked to a drive-out | `absent` |
| `torque` (`port`, an actuator's drive) | the load stays below what the actuator can turn | `exceeded` |
| `isolation` (`ports`) | no closed path of wires, closed switches and sources with power (nothing that uses power) joins the two ports through a source | `shorted` |
| `floor` (a part with a `wheel` or `support`) | it rests on the floor | `lifted`, and for a wheel `slipping` (pushing past its grip) |
| `balance` | the robot rides upright on its wheels and supports | `lost` (it falls over), `grounded` (its frame rests on the floor and drags) |

`shows` lists effects from `EFFECTS`. Each is a claim the behaviour fixtures test, about a fixed subject:

- this part's output: `still`, `slow`, `reverse`, `stall`, `hold`, `slip` (it turns but does not move the robot);
- this part's sound: `hum`, `silent`, `quiet`;
- this part's light: `dark`, `dim`;
- the part as a whole: `off`;
- the battery pack feeding it: `drain`;
- the robot it is on: `tip`, `drag`.

`slow`, `quiet` and `dim` mean less than at the rated voltage.

**One fault for each wiring mistake** (test/circuit.test.ts):

- The short-circuit fixture: the battery pack's loop is closed by the wire, so it shows `short-circuit` only.
- `switch-across-pack`: the switch shows `across-the-pack` and the pack `short-circuit`, one each.
- A switch wired off to one side of the loop, or bypassed by a wire, shows `outside-loop`.
- A motor-driver channel set to stop or backward: no fault. The motor stops or turns backward.
- A motor driver with no power shows `no-power`, and its motors show nothing of their own.

## The Level 1–2 roster and the Level 3 slot

Every Level 1–2 example part has at least two failure modes (a test checks it).

| Part | Family | Primitives | Needs | Failure modes (need · way → shows) |
| --- | --- | --- | --- | --- |
| battery pack, 2-cell and 1-cell | Power | `source` (3 V and 1.5 V) | isolation, loop | short circuit: isolation · shorted → drain; no loop: loop · open → off |
| switch | Power | `switch` (manual) | isolation, loop | across the pack: isolation · shorted → drain; outside the loop: loop · open → off |
| bumper switch | Sense | `switch` (contact, normally closed) | isolation, loop | across the pack; outside the loop |
| DC motor | Actuators | `actuator` speed, `reverses` | power 2.2–6 V, torque | no circuit: power · open → still; low voltage: power · low → slow, drain; overload: torque · exceeded → stall, hum; reversed: power · reversed → reverse |
| wheel (large; the second size is another radius) | Drivetrain | `wheel` | drive, floor | not driven: drive · absent → still; slipping: floor · slipping → slip |
| caster | Structure & Ride | `support` | mount, floor | loose: mount · absent → drag; off the floor: floor · lifted → drag |
| chassis (frame) | Structure & Ride | body + eleven mount points (the right-hand ones mirrored) | balance | top-heavy: balance · lost → tip; frame on the floor: balance · grounded → drag |
| LED | Output | `load` blocks, light | power 2–6 V | reversed → dark; no circuit → dark; low → dim |
| buzzer | Output | `load` blocks, sound | power 3–6 V | reversed → silent; low → quiet |
| motor driver | Power | `driver` × 2 (channel settings) | power 2.5–10 V | no power → off; low → off (its motors show no fault of their own) |
| gearbox | Drivetrain | `ratio` | drive, mount | not driven → still; loose: mount · absent → still |
| servo motor (preview) | Actuators | `actuator` position | power 4.8–6 V, signal, torque | no signal: signal · absent → hold, hum; no circuit → still; low → slow; overload → stall, hum |
| microcontroller (Level 3 slot) | Brain | `program` (no-op), `regulator` (3V pin) | power 3–6 V | no power → off; low → off |

The DC motor's range starts at 2.2 V, so a fresh 2-cell pack under normal load (about 2.8 V) is in range and the 1-cell pack (1.5 V) shows `low`.

## How the primitives produce each required failure

| Failure | Recorded as | Produced by |
| --- | --- | --- |
| No complete circuit: the part stays still | DC motor power · open | No closed path through a source joins the motor's supply, judged as wired (every switch closed, every driver channel at full forward), so it gets 0 V. |
| Low voltage: slow, battery drains faster | DC motor power · low | Speed ∝ voltage, while the current for the same load does not fall, so the pack drains more for each turn. |
| Overload: stall and hum | DC motor torque · exceeded | Load torque reaches stall torque: speed 0, stall current, hum. |
| Reversed polarity: motor backwards, LED dark | DC motor or LED power · reversed | `whenReversed: 'reverses'` gives negative speed; `'blocks'` gives no current, so no light. |
| Short circuit: rapid drain | battery pack isolation · shorted | A loop through the source with no load draws volts ÷ internalOhms, which empties `capacityMah` in seconds. |
| Servo with power, no signal: holds and hums | servo motor signal · absent | The position actuator has power and no command. |
| Top-heavy chassis: tips over | chassis balance · lost | Each body's mass, placed through the mounts, sums to one centre of mass. It falls outside the wheels and supports, or a start or a ramp pushes it out. |
| Loose caster: drags | caster mount · absent | A support carries weight only while mounted. Loose, the frame rests on the floor and slides with the floor's friction. |
