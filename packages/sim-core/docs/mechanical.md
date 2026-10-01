# The mechanical solver

Back to the [README](../README.md). Task 1.4. `src/mechanical/` moves the robot in a 2.5D top-down arena. Each tick it takes the behaviour runtime's answer and gives back:
- the poses of the robot, the loose parts and the props;
- each wheel's actual speed and slip;
- what the robot touches;
- each actuator's load for the next tick;
- the contact switches' states;
- the floor and balance verdicts, with their faults, effects and sounds.

Like the graph and the behaviour runtime, it is internal to sim-core. The tick loop (task 1.5) imports it by relative path:

```ts
// In packages/sim-core/src (the tick loop, task 1.5):
import { initMechanics, mechanicalModel, mechanicalSnapshot, mechanicalTick, restoreMechanics, startMechanics } from '../mechanical/index.ts';

await initMechanics(); // once, before the first world: loads Rapier's WebAssembly (D11)
const model = mechanicalModel(behaviourModel, arenaPreset); // once per Run: pure, no physics engine
let state = startMechanics(model); // the world as built, everything at rest
const tick = mechanicalTick(model, state, { behaviour: behaviourTick }); // seconds: 0 at tick 0
state = tick.state;
// next tick: behaviour reads tick.loads; controls read tick.switches; the electrical solver reads tick.actuators
const bytes = mechanicalSnapshot(state); // and restoreMechanics(model, bytes) gives it back, bit for bit
```

`initMechanics` is the only asynchronous call. Everything else is synchronous and pure: the state is plain data, with the physics world held as Rapier's own snapshot bytes. Each tick restores the world from those bytes, steps it, snapshots it again and frees it. So an old state stays valid, and a snapshot is just the state's bytes.

## One tick

**In** (`MechanicalInputs`):
- `behaviour`: 1.3's `BehaviourTick`, as it is. The solver reads each speed actuator's volts, each wheel's hub rpm while it is in the air, and each actuator's rpm.
- `seconds`: `1/TICK_RATE` unless given. Tick 0 passes 0: nothing moves, no motor is loaded, and the probes are checked where the robot starts.

**Out** (`MechanicalTick`):

| Field | What |
| --- | --- |
| `robot` | The root part's `pose` (a `MotionPayload`) and its `stance` (`upright`, `grounded` or `fallen`), with its forward speed and turn rate. Undefined when no part holds another |
| `bodies` | Every body's pose by event subject: the robot's root part, loose parts (D19) and props (`arena:<id>`) |
| `wheels` | Each wheel on the robot: hub `rpm` (signed like the behaviour runtime's), `groundMmPerSecond`, `slipMmPerSecond`, `onFloor`, `slipping` and `loadNewtons` |
| `contacts` | What the robot touches now: `{ kind: 'wall' \| 'prop' \| 'edge' \| 'ledge', id }`, walls and edges before props |
| `actuators` | Every actuator: actual `rpm`, the `torqueNmm` its drive gives, and `held`. For the electrical solver's `ActuatorState` |
| `loads` | The next tick's `BehaviourInputs.loads`: `torqueNmm`, or `Infinity` where held |
| `switches` | Every contact switch's state from its probe, true when closed: the next tick's `ControlState.switches` for them |
| `parts` | Every placed part: its floor and balance `needs`, the `faults` they make active, `effects` (`slip`, `tip`, `drag`) and `sounds` (`squeal`, `knock`) |
| `state` | The state for the next tick |

**Pose conventions:**
- `x` and `y` are the root part's frame origin, in the arena's millimetres.
- `heading` is in degrees counter-clockwise, 0–360.
- `pitch` is positive when the front is higher, and `roll` when the left side is higher, in degrees.
- A fallen robot reads `pitch` ∓90 (on its front or back) or `roll` ∓90 (on its left or right side).

## The model

`mechanicalModel` is built once per Run from the behaviour model, which gives the graph, the settled primitives and the drive routes. It reads the schema's geometry and nothing else:
- `robotRoot` names the robot.
- `placeParts` places every part on it, mounted or carried, mirrored on mirrored mount points.
- `drivePushes` says which way each wheel pushes. Across the robot, the drive route's own sense stands in.
- `arenaPoseOf` places every part that lies loose. With no robot, the canvas origin stands in for the root.

| Part of the model | From |
| --- | --- |
| Mass, centre of mass and inertia | Every part on the robot: its `body` placed through its mount or shaft |
| Footprints | Each part's box, as a rectangle on the floor: the robot's colliders |
| Wheels | Tyre contact below the axle at the middle of the tread; rolling direction from the hub's turning; `radiusMm`, `grip`; the speed actuator, through any gearboxes (the behaviour route's gains) |
| Supports | Mounted supports only (a loose caster carries nothing): contact at the base, `rollingFriction` |
| Body points | The bottom corners of every other part's box: where the frame can rest on the floor |
| Probes | Each contact switch's probe segment: in the robot's frame, or in the arena for a loose part |
| Arena | Walls (rectangles from segment and thickness); the floor's four edges; ledges; props (box or cylinder, fixed or free); ramps |

## Driving (drive.ts)

The robot's own drive is worked by hand, deterministically. Rapier only stops it at walls and lets it push props. Each substep:

- **Motor and wheel.** A motor driven at throttle × volts, at least its `startVolts`, pushes its tyre along the rolling direction with its torque–speed line:
  - at a standstill it pushes its stall torque × gearing ÷ radius;
  - the push falls in a straight line to nothing at its free speed, noLoadRpm × drive ÷ ratedVolts.

  This is the behaviour runtime's own rule (speed ∝ volts, reduced by load). An unpowered motor still drags its wheel, like a motor at 0 V: its back-EMF line with no drive. That holds the wheel when power is cut, so a robot stops within a few centimetres.
- **Grip.** A wheel holds across its axle. Its push is limited to grip × the floor's friction × the weight on it. Past that it slips: it pushes that much, spins faster than the ground and squeals.
- **Supports and frame.** A caster rolls any way, dragging rollingFriction × its weight. A frame on the floor slides with the floor's friction × its weight.
- **Slope.** Gravity along the floor pulls the robot.
- **Solving.** The new velocity of the centre of mass (forward, sideways, turning) is solved implicitly from these, so stiff gearing never overshoots. A wheel past its grip is fixed at its limit and the rest solved again.
- **Contacts.** The velocity goes to Rapier, which steps the world and stops the robot at whatever it meets. The robot's next velocity is read from how far it actually moved. Rapier's own velocity record is not physical in a stack of contacts, such as a robot pushing a box into a wall.

**Time.** A tick is 4 substeps of 1/120 s. The Level 1–2 robot moves under 3 mm between collision checks.

**Two motors.** Two motors at one speed drive straight. One reversed turns the robot on the spot about the middle of its axle. One unpowered pivots it about that wheel.

**At the end of a tick**, for each motor turning a wheel on the floor:
- *Gripping:* it turns at the ground's speed, and gives the torque its line gives there.
- *Held:* driven but turning the way it drives at under 1% of its free speed (`HELD_SHARE`). A wall, or more load than it can turn. Its load reads `Infinity`, so the behaviour runtime stalls it.
- *Slipping:* it gives the grip's drag, grip × friction × weight × radius ÷ gearing, and turns at the speed its line allows for that.
- *In the air, or on a fallen robot:* it turns freely, with no load.

Whether a wall stalls the motor or makes the wheel slip is down to the numbers:
- A direct-drive DC motor at 2.8 V pushes 0.56 N, under its tyre's grip of about 0.69 N. It stalls and hums.
- Through a 3:1 gearbox it pushes 1.2 N, over its grip of about 0.86 N. Its wheels slip and squeal.

**Props.** Props are Rapier bodies:
- free ones have their gram mass;
- fixed ones never move.

The floor slows each free prop by μ g per second. Its velocity, too, is read from how far it moved. A robot pushes a light box along at a little under its own speed, and stops at a fixed one as at a wall.

## Balance (stance.ts)

The rule from review 2.6:
1. The robot's weight falls at its centre of mass, moved by the force the floor gave it. With the centre of mass h above the floor, a push F moves it h × F ÷ weight the other way:
   - a fast start leans it back;
   - a hard stop leans it forward;
   - a robot held on a slope has its weight fall downhill, so a slope counts. A robot rolling freely down a slope feels no shift, as a real one would.
2. It stands level on its lowest points. If those are only a line or a point (no caster), it rocks towards its weight until more of it meets the floor.
3. Standing on a polygon with its weight inside: `upright` on wheels and supports, or `grounded` with its frame down.
4. Its weight outside: it rocks once about the edge the weight crossed, until its frame (or anything else) meets the floor.
   - At that angle, its weight inside the new polygon: `grounded`. It rests on its frame and still drives, scraping.
   - Otherwise: `fallen`. It falls over and stays down for the Run.

**A rock** is an exact rotation about its axis: cos and sin come from the slope that brings the next point down, with one square root. So a tall robot's centre of mass swings out as it rocks.

**Load sharing.** The weight is shared among what touches by the least-squares split that balances it, dropping any point that would have to pull. That gives each wheel its grip.

**Pitch and roll** come from a plane fitted to the floor under the robot's level points, plus its own rock.

**Verdicts and effects:**

| Stance | Balance | Faults | Effects |
| --- | --- | --- | --- |
| upright | met | — | — |
| grounded, a support loose or out of reach | `grounded`, `explainedBy` that support | the support's own: `mount · absent` (behaviour runtime) or `floor · lifted` | `drag` on the frame and on that support |
| grounded, otherwise (no caster at all, a frame hanging low) | `grounded` | the chassis's `scraping` | `drag` on the frame |
| fallen | `lost` | the chassis's `top-heavy` | `tip` on the frame; `slip` on wheels spinning in the air |

The frame is the part whose balance need is judged (the chassis). The effects follow each record's claims exactly:
- chassis `top-heavy → tip`, `scraping → drag`;
- caster `loose → drag`, `lifted → drag`;
- wheel `lifted → slip`, `slipping → slip`.

Parts with no active mechanical failure show none of them.

**Floor needs** are judged on a robot that has not fallen. A tip stands for what it lifts.
- A wheel is `lifted` when it does not meet the floor, and `slipping` when it slips at the end of the tick.
- A fixed support is `lifted` only when it leaves the frame down. Held clear by other wheels, it is not needed.

## Walls, ramps and contact switches

- **The floor's edges are walls**, 200 mm thick just outside the floor. The robot bumps and stops rather than leaving.
- **Ramps.** A ramp's height rises inside its rectangle, and the floor elsewhere is flat at 0 (review 2.4). The schema says nothing about the floor past a ramp's high edge or beside it. The conservative reading makes every drop of more than 1 mm along a ramp's edges, except its low edge, a **ledge**: a 4 mm wall on the edge. The robot bumps and stops there rather than driving off.
  - Ramps that meet at one height (the content ramp's ridge) make no ledge.
  - Neither do edges on the floor's boundary.
  - On a ramp the robot pitches with the slope, is pulled back by it, and carries less weight on its wheels.
- **Contact switches.** A contact switch flips while its probe touches a wall, an edge, a ledge or a prop, within 1 mm (`TOUCH_MM`).
  - The probe is checked over the region it swept in every substep. A thin wall passed between two checks still counts, so detection never waits for the end of a tick.
  - A switch touched at any point in a tick reads flipped for the next tick's controls.
  - Loose switches are checked where they lie.
  - The bumper switch's probe lies on the front face of its own box, which is solid. So the bumper meets a wall in the substep the probe registers, with the chassis front 10 mm short, as review 2.4 expects. The motor driver loses power the next tick, before any motor can stall.
- **Knock.** A new contact this tick knocks on the robot's root part, louder the faster it was going.
- **Squeal.** A slipping wheel squeals, louder the more it slips.

## Snapshots and determinism

- **Snapshot bytes.** `mechanicalSnapshot` writes a header of little-endian doubles, then Rapier's world snapshot. The header holds:
  - the velocity and the floor's last push;
  - the fall;
  - the world's handles;
  - what the robot touches.

  Every −0 is written as 0, so equal states give equal bytes. A restored world steps bit-identically to the original, and the tests resume a Run from mid-way and compare every frame. `restoreMechanics` refuses bytes from another model.
- **Order.** Parts, wheels, props and solids are visited in a fixed order.
- **Maths.** Plain arithmetic and `Math.sqrt` only, with angles through the schema's `cosSin` and slopes into degrees through `atanDegrees` (a fixed series). No clock and no randomness. Rapier's profiler stays off and its timing is never read.
- **Speed.** A tick of the bumper robot takes about 1.7 ms on an M-series Mac, behaviour runtime included. Most of it is restoring and snapshotting the world.

## Tests

**`test/mechanical.test.ts`** uses the schema's example parts, blueprints and arenas only. It also uses four test variants:
- a whisker switch;
- a tall, heavy battery pack;
- a strong motor;
- a grippy wheel.

Each Run steps the behaviour runtime with an ideal 2.8 V pack standing in for the electrical solver. Every Run happens twice and must give the same frames and bytes.

It covers:
- straight drive, and the loads fed back;
- turning on the spot (`reversed-motor`), and pivoting;
- rule 1, with a renamed wheel;
- a wall: the direct-drive stall and the geared slip, per the numbers;
- pushing and fixed props;
- the loose caster: grounded, explained, exactly one fault;
- a caster fixed out of reach of the floor: grounded, explained by its own `lifted` fault, the only one;
- no caster: grounded, scraping, still driving;
- the top-heavy build: the tall pack on the bumper mount falls over at once and stays down, its wheels spinning;
- a fast-start fall;
- the stance rule on its own;
- a ramp and the ridge;
- the bumper switch flipping at the wall;
- a whisker that flips before the body arrives;
- the probe's sweep;
- loose parts with no robot;
- tick 0;
- mid-Run snapshot and restore.

## Decisions and open questions

1. **Ramp edges.** The floor past a ramp's high edge, or beside it, is a ledge the robot cannot cross. Should driving off an edge be a fall instead (review 2.4, question 1)?
2. **Grip** is the wheel's `grip` × the arena's `friction` × the weight on the wheel. The schema gives both coefficients and does not say how they combine.
3. **An unpowered motor** drags its wheel like a motor at 0 V. It is treated as the gear train's drag, though an open circuit would let a bare motor spin free.
4. **Loose parts (D19)** lie where they were placed and do not collide, so a part drawn under the chassis cannot trap the robot at the start. Should they be obstacles?
5. **Props** block the robot and the probes in 2D, whatever their height. Props ignore slopes.
6. **Wall impacts do not tip a robot.** Only the floor's push (starting, braking, holding on a slope) moves its weight. A tall robot hitting a wall may need impact tipping later.
7. **A tip stands for what it lifts.** On a fallen robot the wheels show no `lifted` fault, though review 2.1 mentioned the wheel's lifted mode after a tip. So a tip records the chassis's `top-heavy` alone.
8. **No part from the example catalogue can make a robot really fall over.** Their centres of mass lie over their footprints, and the floor's push is limited by grip at a centre of mass about 27 mm up. So the top-heavy acceptance uses a test variant: a 600 g pack with its centre of mass 250 mm up. Task 2.6's fixture will need a tall or heavy content part to tip under this rule.
9. **Wheels and robot-level effects.** Wheels on a fallen robot show `slip`, not `tip`. Other parts on a grounded robot show no `drag`, so a part's effects are exactly its own claims. Is that the reading the effect fixtures want?
10. **Brief slips.** A slip that ends within a tick (a geared robot's first moment) shows nothing: verdicts are taken at the end of the tick.
11. **Sound levels.** Squeal (300 mm/s of slip is full) and knock (400 mm/s is full, 0.1 at least) are this solver's choices.
12. **Servo arms** are read but move nothing in v1. Nothing can ride an upright arm.
13. **No `./mechanical` export.** The optional tools test over the content robot needs a `./mechanical` entry in sim-core's package.json, which is outside this task's files. The README's public surface does not mention this file either. Task 1.5, or the orchestrator, should link it.
