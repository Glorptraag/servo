# Blueprints, arenas, kits, challenges and run records

Back to the [README](../README.md).

## Blueprint

`Blueprint = { version: 1, parts: PlacedPart[], wires: Wire[], arena: ArenaRef, meta }`.

- **`PlacedPart`** is `{ id, part, position, rotation, settings }`.
  - Position is in canvas millimetres, with y down; rotation is in degrees clockwise. See [geometry.md](geometry.md) for the canvas mapping and why a mounted part must sit where its mount puts it.
  - `settings` keeps only values that differ from the default.
- **`Wire`** is `{ id, from: PortRef, to: PortRef }` and joins two ports of the same type. A `Mount` is a wire from a mount to a mount point; snapping a part onto a mount point creates one.
- **`ArenaRef`** is `{ preset, props }`: the preset, plus the props the child dragged in.
- **`meta`** holds:
  - `id`: an opaque UUID v4, kept across edits and syncs. A duplicate gets a new one. Task 5.5's "latest blueprint wins, both kept" keys on it, and run records name it as `blueprintId`.
  - `name`, which is child text, and `level`.
  - `createdAt` and `updatedAt`, as UTC timestamps exactly as `toISOString` writes them.
  - `author`: the child's profile as a UUID v4 the app generates. Sharing (task 5.6) omits it.
  - `highWater`: the highest numbers ever given to `p<n>` part ids and `w<n>` wire ids.

**Ids are never reused.** `claimPartId` and `claimWireId` give one more than the high-water mark and return the raised mark, even after the highest id is deleted. So a fault's `partId` always means one part across Runs. An id above the mark is refused as `id.above_high_water`. Every input path claims through these, so the same steps give the same ids.

**Canonical form.** `serializeBlueprint(canonicalizeBlueprint(bp, catalogue))` gives the same bytes whichever input path made the build:

- keys in code-unit order, a two-space indent and a final newline;
- parts, wires and props in id order;
- power wires lower reference first, and directional wires source first;
- default-valued settings dropped.

Fixture metadata, such as a broken fixture's named fault (task 2.6), goes in a fixture wrapper, not in `meta`.

## Arena preset

The floor `size` is in mm, with the origin at the lower left and y up. A preset also holds:

- `friction`;
- the robot's `start` pose;
- `walls`, `zones`, `lines`, `ramps` and `props`, which share one id space.

Everything lies on the floor.

## Kit

`{ id, name, level, parts: { part, quantity }[], tray: { family, parts }[] }`.

- The tray groups parts by family, in tray order.
- Each kit part sits in exactly one tray group, and that group is its own family.
- No part is introduced above the kit's level.

## Challenge

Each challenge holds:

- its `kind`: part introduction, guided, breakdown, what-if or unscripted build;
- a `goal`, which is a predicate over the run record:
  - `holds` a condition for N ticks, combined with `all`, `any` and `sequence`, or `uses` a part;
  - conditions test `in-zone`, `near-wall`, `speed`, `forward-speed`, `turn-rate`, `state` (lit, turning, open…) or `fault`, and combine with `and`, `or` and `not`;
- an `arena` and a `kit`;
- `start`, the starting blueprint, which breakdowns and what-ifs require;
- `introduces`, for part introductions only;
- `hints`: ladders of `pulse-part` → `pulse-port` → `ghost-wire` → `do-it`. A ladder may skip a rung (a call queued for Drew from review finding 14), keeps the order and ends with `do-it`. Each ladder may have a trigger, and every step has a `line`.

**Measuring points:**

- `in-zone`, `speed`, `forward-speed` and `turn-rate` measure the target's frame origin, the centre of its footprint.
- `near-wall` measures from the nearest point of the target's footprint to the wall's face.
- `forward-speed` is signed along the target's own heading, so "drive forward with the LED lit" needs no zone, and reversing does not count.

**Goal and hint targets** are `{ placed }` (a part of the starting blueprint) or `{ part }` (any part of that type). A condition on a type holds when it holds for any part of that type, so `not` of a fault on a type means no part of that type shows it.

**Cross-and-stop** is Level 2 (D26). Its goal excludes a stall: near the wall, at most 5 mm/s, and no DC motor overloaded.

## Run record

A run record holds:

- `id`, and `blueprintId`, which equals the snapshot's `meta.id`;
- the `blueprint` snapshot, from which the parts used are read;
- `challenge`, and `goal`, which only a run inside a challenge has;
- `profile`;
- `runNumber`: this Run's place among the child's Runs of the challenge, or of the blueprint in the sandbox;
- `seed`, `tickRate: 30` and the start and end times;
- `inputs`: the switch presses made during the Run, kept for exact replay;
- `events`, which a stored summary may leave out;
- `faults`, and `fixed`, which records how each fault from the previous Run was fixed, as build changes;
- `hints`.

**Consistency rules:**

- A switch the child opens is an input, never a fault: it never appears in `faults` or `fixed`.
- When events are kept, each fault event that starts a fault has its `faults` entry, and each entry starts at its first event (`run.unrecorded_fault`).
- A goal requires a challenge (`run.goal_without_challenge`).

**RunEvent** is `{ tick, partId, kind: 'value' | 'motion' | 'sound' | 'fault', payload }`. An arena prop's events use `partId` `arena:<propId>`.

## The Section 14 measures

| Measure | Read from |
| --- | --- |
| Unscripted-build pass rate | Run records: `challenge`, `runNumber`, `goal` |
| Fault fixing (time to fix a breakdown) | Run records: `faults`, `fixed`, timestamps. Time-to-fix starts at the first Run that shows the fault |
| Sandbox return (session start mode) | Task 6.2 telemetry, not run records |
| Time in the sandbox (parent view) | Task 6.2 telemetry, not run records |
| Parts named | Task 5.4's card game |
| Transfer (parts-list exports) | Task 6.2 telemetry (export events) |
