# Decisions taken in the schema, and open questions

Back to the [README](../README.md). Conservative readings, reviewable. Orchestrator rulings are marked with their decision numbers.

## Decisions

- **Validation:** hand-written validators, with no library ([validation.md](validation.md)).
- **Mechanical wires:** mounts and drive linkages are mechanical wires, and the mount is authoritative for a mounted part's place (`mount.misplaced`).
- **Ratings:** a port's rating lives in the need or primitive that uses it, so each number is written once.
- **Power has no direction:** polarity is a port mark, and reversed wiring is legal.
- **Turning:** positive speed is right-handed about the drive's axis. Mirrored mount points flip the sense, so two motors wired alike on the chassis drive forward (D23).
- **Drive layouts:** direct drive uses the chassis's outer motor mounts, and a gearbox drive its inner motor mounts, so the wheels clear the plate either way.
- **Judged as wired:** power, loop and isolation needs are judged with every switch closed and every motor-driver channel at full forward command (`wiredNeeds`).
  - A switch's state or a driver's command is control, never a fault. A part behind a driver or regulator without power, or starved by a short elsewhere, shows that part's fault or the short's, not its own (review N1).
  - `loop · open` means no closed path at all. A closed path with nothing that uses power is `isolation · shorted` (review N2).
- **Second failure modes:** `loop`, `floor`, `balance · grounded` and the `slip` effect give every Level 1–2 part an honest second failure mode. A gearbox drives only while it is mounted.
- **Settings:** each setting shows from its own unlock level, and settings bind primitive parameters.
- **Ids:**
  - Opaque ids (blueprint, author, run and profile) are UUID v4s the app generates.
  - Part and wire ids are never reused: `meta.highWater`, a whole number up to `Number.MAX_SAFE_INTEGER`.
  - Run records name their blueprint by `blueprintId`.
- **Goals:**
  - Goals measure the target's footprint centre, or for `near-wall` its nearest footprint point.
  - `forward-speed` is signed along the heading.
  - Cross-and-stop is Level 2 (D26), and its goal needs every DC motor unpowered at the wall.
- **Canvas:** canvas units are millimetres. The robot's root part starts at the arena's start pose, and loose parts keep their place relative to it (D19). A part on a mirrored mount point is drawn as its mirror image.
- **Trigonometry:** `cosSin`, fixed polynomials in plain arithmetic, for every angle that feeds a Run, so a Run replays bit for bit on any device.
- **The 3V pin and ladder rungs:** the microcontroller's red 3V pin carries the "motor straight off a brain's pin" lesson, and hint ladders may skip a rung. Both are queued for Drew from review finding 14.
- **Fixtures:** they are exported from `src/fixtures.ts`, with the JSON in `fixtures/`.

## Open questions

1. How is the Level 2 motor driver commanded without a microcontroller? The example uses per-channel forward, stop and backward settings, unlocked at Level 2.
2. At Level 3, how does a servo's `target` setting relate to its signal?
3. What is "drains faster" measured against, for a low-voltage motor? The behaviour-rules sub-draft (brief Section 15) should pin it down for the fixture generator.
4. With mirrored mounts, the app's wiring differs from a real kit's: the hardware bridge (task 5.3's wiring summary) must cross one real motor's leads. Is that acceptable?
5. Do the canvas's socket cues show refusals between ports of the same colour (signal out to signal out, shaft to shaft)? This is for the canvas interaction spec.
6. For task 2.5: "mount point" is a real term from the brief, so a banned-words entry for "points" should catch scoring only.
7. Two equal battery packs side by side (+ to +, − to −) count as `isolation · shorted`, though real equal packs would share the load. No Level 1–2 kit has two equal packs, and circuit-crew's 3 V and 1.5 V packs side by side do drain each other. Should sources that cancel out be exempt?
