# @servo/schema

The v1 types, validators, wiring rules and canonical form that every other package builds on. Owned by task 0.2; migrations arrive with task 0.3 in `src/migrate/`. Depends on no other package and no library. Frozen at v1 when Phase 0 closes.

```ts
import { validateBlueprint, planWire, serializeBlueprint, makeCatalogue } from '@servo/schema';
import { exampleParts, validBlueprints } from '@servo/schema/fixtures'; // test data
```

## Versioning

- `SCHEMA_VERSION` is `'1.0'`. A **minor** bump is additive: a new part family, a new behaviour primitive, a new optional field. Data that was valid stays valid.
- A **major** bump changes `Blueprint.version` and needs a migration (task 0.3).
- **The eleventh part family** (decision D4) is a minor bump. Add one entry to `PART_FAMILIES` in `src/types/taxonomy.ts` and bump `SCHEMA_VERSION` to `'1.1'`. The `PartFamily` type and every validator read that list, so nothing else changes.

## Validation approach

- **Hand-written, dependency-free validators.** They are built on a small internal kit (`src/validate/reader.ts`, not exported). No library is involved, so the frozen contract carries no third-party version, and every refusal has a stable code.
- **They never throw.** Each returns `{ ok: true, value }` or `{ ok: false, issues }`.
- **Each issue is a named reason:**
  - a stable `code` (all codes are listed in `ISSUE_CODES`, each with its meaning);
  - a JSONPath `path`, for example `$.wires[3].from.port`;
  - a plain `message`.
- **Defences:**
  - Anything thrown while reading the data (a throwing getter, a Proxy) becomes `value.unreadable`.
  - Goals nest at most 8 deep (`value.too_deep`), so a goal that contains itself stops.
  - Unknown fields are refused everywhere (`value.unknown_key`), which catches misspellings in content.
- **All problems are reported, not just the first.** Reference checks run only on parts that are structurally sound, so one mistake does not cascade.

| Function | Checks |
| --- | --- |
| `validatePartRecord(value)` | Structure and text rules. Every port, primitive, need, setting and failure-mode reference inside the record. |
| `validateArenaPreset(value)` | Floor, start, walls, zones, lines, ramps and props, all on the floor. One id space per arena. |
| `validateKit(value, catalogue)` | Entries, and tray against entries. Parts exist, sit in their own family's group, and are introduced at or below the kit's level. |
| `validateBlueprint(value, catalogue)` | Structure, part types, settings, wire ends, wiring rules, stored orientation, mount loops and the arena. Legal-but-wrong wiring passes. |
| `validateBlueprintShape(value)` | Structure only, for when no content is loaded. |
| `validateChallenge(value, catalogue)` | Kind rules; the starting blueprint in full; the goal and hint ladders; every part, port, zone, wall, failure mode, setting, kit and arena they name. Hint wires obey the socket rule. |
| `validateRunRecord(value, catalogue)` | The blueprint that ran; tick order; every part, prop and failure mode named. |

`makeCatalogue({ parts, arenas?, kits? })` indexes validated records. Without `arenas` or `kits`, references to them are not checked.

**Text rules.** Every system-text field (names, labels, card lines, notes, hints) must be one trimmed line with no exclamation mark (ground rule 7). Terminology and banned words are checked by the content validator (task 0.5).

**Child text.** A blueprint's `meta.name` is child text: 1 to 60 characters on one line.

## Part records (brief Section 6)

| Brief field | Record field |
| --- | --- |
| Identity | `identity`: `name` (as it reads mid-sentence: `DC motor`), `family`, `domains`, `level`, `art` (swap-registry key), `colours` (for placeholder art) |
| (physical) | `body`: `grams`, `size` (mm; also the placeholder proportions), `centreOfMass`. Part frame: +x forward, +y left, +z up, origin at the centre of the base. |
| Ports | `ports`: `power` with a `polarity` mark; `signal` with `direction` in/out; `mechanical` with `role`: `drive-out`/`drive-in` (with `at` and `axis`) or `mount`/`mount-point` (with `at` and `yaw`). A port's rating is written once, in the need or primitive that uses it. |
| Needs | `needs`: what must be true for the part to work (table below). |
| Behaviour | `behaviour`: a list of primitives (table below). |
| Settings | `settings`: `number` (min, max, child-sized `step`, real `unit`) or `choice`, each with an `unlockLevel`. Each drives one primitive parameter via `binds`. The default must equal the primitive's own value, so the part behaves the same before and after the setting unlocks. |
| Failure modes | `failureModes`: a need, the way it goes unmet, `shows` (effects), `teachingNote`, `cardLine` and an optional `hint`. |
| Spec card | `card`: `does` (L1), `needs` and `gives` (L2), `popularMechanics` (L2), `specLine` (L4), `realWorldArt`, `safetyNote`. Name and picture come from identity, settings from `settings`, failure notes from `cardLine`. `SPEC_CARD_LAYERS` gives the level each layer shows from. |

### Behaviour primitives: the closed vocabulary

sim-core implements each kind once and never branches on a part's id, name or family (ground rule 1). Units: V, mA, ohms, mAh, N·mm, rpm, degrees, mm. Rated values are measured at `ratedVolts`.

| Kind | Binds | Parameters | What it does each tick |
| --- | --- | --- | --- |
| `source` | `output` (+/−) | `volts`, `emptyVolts`, `internalOhms`, `capacityMah` | Gives `volts`, falling to `emptyVolts` as charge is used and sagging by current × `internalOhms`. A short draws volts ÷ internalOhms. Capacity is a teaching value. |
| `switch` | `terminals` | `actuation`: `manual` (`initially`) or `contact` (`normally`, `probe`) | Joins its terminals when closed. The child flips a manual switch during a Run. A contact switch flips while its probe touches a wall or prop. |
| `load` | `supply` | `whenReversed` (`blocks`/`works`), `onVolts`, `ratedVolts`, `ratedMilliamps`, `emits?` (light `colour` or sound `hz`) | Draws nothing below `onVolts`. Light or sound follows the current. `blocks` gives nothing when reversed. |
| `actuator` `speed` | `supply`, `drive` | `whenReversed` (`reverses`/`blocks`), `startVolts`, `noLoadRpm`, `stallTorqueNmm`, `noLoadMilliamps`, `stallMilliamps`, `throttle`, `reverse` | Speed ∝ voltage × throttle, reduced by load. At the stall limit it stops, draws stall current and hums. Reversed, it turns the other way. |
| `actuator` `position` | `supply`, `drive`, `command` (signal in) | `startVolts`, `minDeg`, `maxDeg`, `restDeg`, `target`, `degPerSecond`, `holdingTorqueNmm`, `idleMilliamps`, `stallMilliamps` | Sweeps to the commanded angle. With power and no signal it holds where it is and hums. |
| `driver` | `supply`, `output`, `signal?` | `command` (−1..1), `onVolts`, `dropVolts`, `maxMilliamps`, `idleMilliamps` | Output = supply × command − drop, up to the current limit. A driven signal sets the command; otherwise `command` (or its setting) does. |
| `regulator` | `supply`, `output` | `volts`, `dropoutVolts`, `maxMilliamps` | Holds the output at `volts` until the current limit, then the voltage falls (a microcontroller's 3V pin). |
| `program` | `supply`, `inputs`, `outputs` | `onVolts`, `milliamps` | A brain. In v1 it runs no rules and its outputs carry no signal. Below `onVolts` it is off. |
| `ratio` | `input` (drive-in), `output` (drive-out) | `ratio`, `efficiency` | Output turns 1/ratio as fast, with ratio × efficiency of the torque. |
| `wheel` | `hub` (drive-in) | `radiusMm`, `widthMm`, `grip` | Rolls the robot by radius × turning, up to its grip. |
| `support` | `mount` | `rollingFriction` | Carries weight with little drag while mounted. Loose, the frame rests on the floor. |

Every part also has a `body` (mass and centre of mass), and frames carry `mount-point` ports (where parts sit). Together these give the robot's balance.

Settings may drive `actuator.throttle`, `actuator.reverse`, `actuator.target`, `load.colour`, `load.hz`, `driver.command` and `ratio.ratio` (`BINDABLE_PARAMS`). A number setting's `binds.range` maps its range onto the parameter linearly.

### Needs, unmet ways and effects

| Need | True when | Unmet as |
| --- | --- | --- |
| `power` (`supply`, `minVolts`, `maxVolts`) | a complete circuit, the right way round, within the range | `open`, `low`, `high`, `reversed` |
| `signal` (`port`) | a signal source drives the signal in | `absent` |
| `mount` (`port`) | the mount is fixed to a mount point | `absent` |
| `drive` (`port`) | the drive-in is linked to a drive-out | `absent` |
| `torque` (`port`, an actuator's drive) | the load stays below what the actuator can turn | `exceeded` |
| `isolation` (`ports`) | no short-circuit loop runs through these ports | `shorted` |
| `balance` | the robot's centre of mass stays over its wheels and supports | `lost` |

`shows` lists effects from `EFFECTS`. Each is a claim the behaviour fixtures test, and each has a fixed subject:

- this part's output: `still`, `slow`, `reverse`, `stall`, `hold`;
- this part's sound: `hum`, `silent`, `quiet`;
- this part's light: `dark`, `dim`;
- the part as a whole: `off`;
- the battery pack feeding it: `drain`;
- the robot it is on: `tip`, `drag`.

`slow`, `quiet` and `dim` mean less than at the rated voltage.

### The Level 1–2 roster and the Level 3 slot on the vocabulary

The fixtures in `fixtures/parts/` are examples that prove the schema. Tasks 2.1 and 2.2 author the real records.

| Part | Family | Primitives | Needs | Failure modes (need · way → shows) |
| --- | --- | --- | --- | --- |
| battery pack, 2-cell and 1-cell | Power | `source` (3 V and 1.5 V) | isolation | short circuit: isolation · shorted → drain |
| switch | Power | `switch` (manual) | isolation | across the pack: isolation · shorted → drain |
| bumper switch | Sense | `switch` (contact, normally closed) | isolation | across the pack |
| DC motor | Actuators | `actuator` speed, `reverses` | power 3–6 V, torque | no circuit: power · open → still; low voltage: power · low → slow, drain; overload: torque · exceeded → stall, hum; reversed: power · reversed → reverse |
| wheel (large; the second size is another radius) | Drivetrain | `wheel` | drive | not driven: drive · absent → still |
| caster | Structure & Ride | `support` | mount | loose: mount · absent → drag |
| chassis (frame) | Structure & Ride | body + nine mount points | balance | top-heavy: balance · lost → tip |
| LED | Output | `load` blocks, light | power 2–6 V | reversed → dark; no circuit → dark; low → dim |
| buzzer | Output | `load` blocks, sound | power 3–6 V | reversed → silent; low → quiet |
| motor driver | Power | `driver` × 2 (channel settings) | power 2.5–10 V | no power → off; low → off |
| gearbox | Drivetrain | `ratio` | drive | not driven → still |
| servo motor (preview) | Actuators | `actuator` position | power 4.8–6 V, signal, torque | no signal: signal · absent → hold, hum; no circuit → still; low → slow; overload → stall, hum |
| microcontroller (Level 3 slot) | Brain | `program` (no-op), `regulator` (3V pin) | power 3–6 V | no power → off; low → off |

How the primitives produce each required failure:

| Failure | Recorded as | Produced by |
| --- | --- | --- |
| No complete circuit: the part stays still | DC motor power · open | No path from the source's + through the actuator to −, so it gets 0 V. |
| Low voltage: slow, battery drains faster | DC motor power · low | Speed ∝ voltage, while the current for the same load does not fall, so the pack drains more for each turn. |
| Overload: stall and hum | DC motor torque · exceeded | Load torque reaches stall torque: speed 0, stall current, hum. |
| Reversed polarity: motor backwards, LED dark | DC motor or LED power · reversed | `whenReversed: 'reverses'` gives negative speed. `'blocks'` gives no current, so no light. |
| Short circuit: rapid drain | battery pack isolation · shorted | A loop through the source with no load draws volts ÷ internalOhms, which empties `capacityMah` in seconds. |
| Servo with power, no signal: holds and hums | servo motor signal · absent | The position actuator has power and no command. |
| Top-heavy chassis: tips over | chassis balance · lost | Each body's mass, placed through mount points' `at`/`yaw`, sums to one centre of mass. It falls outside the wheels and supports, or a start or ramp pushes it out. |
| Loose caster: drags | caster mount · absent | A support carries weight only while mounted. Loose, the frame rests on the floor and slides with the floor's friction. |

## Wiring rules (`src/validate/wiring.ts`, ground rule 3)

One module for the canvas, the list view, sim-core and the validators:

- `checkPortPair(a, b)` is the socket rule (use it for the glow on approach).
- `planWire(blueprint, catalogue, a, b)` adds the rules that depend on the rest of the build, and returns the wire in stored orientation.
- `judgeWire`, `addWire` and `emptyWiring` let a caller check wires one at a time.

| | power | signal in | signal out | drive-in | drive-out | mount | mount point |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **power** | power | type | type | type | type | type | type |
| **signal in** | type | direction | signal | type | type | type | type |
| **signal out** | type | signal | direction | type | type | type | type |
| **drive-in** | type | type | type | mech. direction | drive | mismatch | mismatch |
| **drive-out** | type | type | type | drive | mech. direction | mismatch | mismatch |
| **mount** | type | type | type | mismatch | mismatch | mech. direction | mount |
| **mount point** | type | type | type | mismatch | mismatch | mount | mech. direction |

**Impossible drops** are refused with a code:

- `wire.type_mismatch`, `wire.signal_direction`, `wire.mechanical_mismatch` and `wire.mechanical_direction`, from the table above;
- `wire.same_port` and `wire.mechanical_same_part`;
- `wire.port_full`: a signal in, a shaft, a hub, a mount and a mount point each take one wire (`SOCKET_CAPACITY`).

`planWire` also refuses `wire.duplicate` and `mount.cycle`. A power wire into a signal port is `wire.type_mismatch`.

**Legal but wrong is always accepted:**

- a reversed motor;
- a short across the battery pack;
- a servo with no signal;
- a DC motor wired red-to-red to the microcontroller's 3V pin. That pin is a weak `regulator`, so the motor barely turns, which is the Level 3 lesson. A signal pin is yellow and can never take a motor.

**Stored orientation:** signal out → in, drive-out → drive-in, mount → mount point. Power has no direction; canonical form writes the lower port reference first. `validateBlueprint` refuses a directional wire written backwards (`wire.reversed`).

## Blueprint

`Blueprint = { version: 1, parts: PlacedPart[], wires: Wire[], arena: ArenaRef, meta }`.

- `PlacedPart` holds `{ id, part, position, rotation, settings }`. Position is in canvas units, y down, and rotation in degrees clockwise. `settings` keeps only values that differ from the default.
- `Wire` holds `{ id, from: PortRef, to: PortRef }`, and joins two ports of the same type. A `Mount` is a wire from a mount to a mount point. Snapping a part onto a mount point creates one.
- `ArenaRef` holds `{ preset, props }`: the preset, plus the props the child dragged in.
- `meta` holds:
  - `name`;
  - `level`;
  - `createdAt` and `updatedAt`, as UTC timestamps exactly as `toISOString` writes them;
  - `author`, an opaque profile id of 16–128 URL-safe characters, so it can hold no full name. Sharing (task 5.6) omits it.

**Canonical form.** `serializeBlueprint(canonicalizeBlueprint(bp, catalogue))` gives the same bytes whichever input path made the build:

- keys in code-unit order, a two-space indent and a final newline;
- parts, wires and props in id order;
- power wires lower reference first;
- default-valued settings dropped.

New ids come from `nextPlacedPartId` (`p1`, `p2`, …) and `nextWireId` (`w1`, …), so the canvas and the list view allocate alike.

Fixture metadata, such as a broken fixture's named fault (task 2.6), goes in a fixture wrapper, not in `meta`.

## Arena, kit, challenge and run record

- **ArenaPreset.** A floor `size` in mm, origin at the lower left, y up. It also holds `friction`, the robot's `start` pose, and its `walls`, `zones`, `lines`, `ramps` and `props`, which share one id space.
- **Kit.** `{ id, name, level, parts: { part, quantity }[], tray: { family, parts }[] }`. The tray groups by family, in tray order. Each kit part sits in exactly one group, and the group must be its own family.
- **Challenge.** Each challenge holds:
  - its `kind`: part introduction, guided, breakdown, what-if or unscripted build;
  - a `goal`, which is a predicate over the run record: `holds` a condition for N ticks, combined with `all`, `any` and `sequence`, or `uses` a part. Conditions can test `in-zone`, `near-wall`, `speed`, `turn-rate`, `state` (lit, turning, open…) or `fault`, and combine with `and`, `or` and `not`;
  - an `arena` and a `kit`;
  - `start`, the starting blueprint, which breakdowns and what-ifs require;
  - `introduces`, for part introductions only;
  - `hints`: ladders of `pulse-part` → `pulse-port` → `ghost-wire` → `do-it`. A ladder may skip a rung, keeps the order and ends with `do-it`. Each ladder may have a trigger, and each step has a `line`.
- **Goal and hint targets** are `{ placed }` (a part of the starting blueprint) or `{ part }` (any part of that type).
- **RunRecord.** It feeds the parent view and the Section 14 measures. It holds:
  - the `blueprint` snapshot, from which the parts used are read;
  - `runNumber` (the Runs count), `seed`, `tickRate: 30` and the start and end times;
  - `inputs`, the switch presses made during the Run, kept for exact replay;
  - `events`, which a stored summary may leave out;
  - `faults`, and `fixed`, which says how each fault from the previous Run was fixed, as build changes;
  - `goal` and `hints`.
- **RunEvent** is `{ tick, partId, kind: 'value' | 'motion' | 'sound' | 'fault', payload }`. An arena prop's events use `partId` `arena:<propId>`.

## Room for Level 3–5, the classroom and the hardware bridge

These are designed for, not built:

- **Sensors** (line sensor, ultrasonic sensor) become new primitive kinds that read the arena into a signal out: a minor bump.
- **Block rules** become an optional per-part program on a placed microcontroller, read by the `program` primitive: blueprint v2, with a migration.
- **The classroom** needs a class or assignment field in `meta`, added the same way. Run records already carry `profile` and `challenge`.
- **The hardware bridge** reads explicit port-to-port wires, real names and spec lines.

## Fixtures (`fixtures/`, exported as `@servo/schema/fixtures`)

| Fixtures | Count | Notes |
| --- | --- | --- |
| Example part records | 14 | |
| Arena presets | 3 | |
| Valid kit | 1 | |
| Invalid kit | 1 | |
| Valid blueprints | 6 | Some are legal but wrong on purpose. All are stored in canonical form. |
| Invalid blueprints | 20 | Each is refused for exactly one reason. The expected code and path are recorded in `fixtures/index.ts`. |
| Challenges | 3 | |
| Run record | 1 | |

`pnpm --filter schema test` runs them. Each fixture shows by name, and so does the reason each invalid one is refused.

## Decisions taken here, and open questions

**Decisions** (conservative readings, reviewable):

- Mounts and drive linkages are mechanical wires.
- Port ratings live in needs and primitives.
- Power wires have no direction.
- The microcontroller has a red 3V pin.
- Settings bind primitive parameters.
- Effects are testable claims.
- Fields are strict: unknown fields are refused.
- `meta.name` is in the blueprint.
- `@servo/schema/fixtures` is exported.

**Questions for Drew:**

1. How is the Level 2 motor driver commanded without a microcontroller? The example uses per-channel forward, stop and backward settings, unlocked at Level 2.
2. At Level 3, how does a servo's `target` setting relate to its signal? Does the no-op brain pass the setting through? This is for task 1.6 or the Level 3 design.
3. What is "drains faster" measured against, for a low-voltage motor? The behaviour-rules sub-draft (brief Section 15, item 4) should pin it down for the fixture generator.
4. A switch's own failure modes reach only the short circuit. If task 2.1 needs a second one, that needs a new need kind (a minor bump).
5. Do unmounted parts ride along in a Run, and what happens at a floor edge with no wall? These are for task 1.4; the schema allows either.
6. The socket shapes (round, square, hexagon) are matched to power, signal and mechanical from the order the brief lists them. Is that right?
7. The blueprint name travels with adult-to-adult sharing. Is that acceptable?
8. For task 2.5: "mount point" is a real term from the brief, so a banned-words entry for "points" should catch scoring only.
