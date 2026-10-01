# Geometry

Back to the [README](../README.md). `src/geometry/` holds the pure helpers that sim-core and the canvas share, so a part's place and a wheel's push mean the same everywhere.

## Frames

- **Part frame:** +x forward, +y left, +z up, millimetres. The origin is the centre of the part's footprint on its base.
- **Placement:** where a child frame sits in its parent's: p ↦ (x, y, z) + R(yaw) · M · p, where M flips y when `mirrored` and R turns counter-clockwise about +z.
- **Quarter turns only.** Every turn between part frames, and every mount `yaw`, is 0, 90, 180 or 270, so no trigonometry is involved and the results are the same on every engine.

## The turning rule

- **Positive speed is right-handed.** A drive port turning at positive speed turns right-handed about its `axis` (thumb along the axis, fingers curling the way it turns), in the part's frame.
- **Axes:** a drive-out's axis is the way its shaft points out of the part; a drive-in's axis is the way a shaft enters it. Mated, the two agree.
- **A speed actuator turns at positive speed** when its supply is the right way round and `reverse` is false.
- **A drive linkage** turns the drive-in exactly as the drive-out turns.
- **A gearbox** turns its output the same way about its axis as its input turns about its axis, 1/ratio as fast, and only while it is mounted.
- **A wheel** turning right-handed about an axle pointing to the robot's left rolls the robot forward.

## Mounts and mirrored mount points

- **The mount transform.** A mounted part's frame is its `mount` laid on the host's `mount-point` (`mountPlacement`).
- **Mirrored mount points.** A mirrored mount point fixes a part as its mirror image, with its y flipped. A mirror turns a right-handed turn into a left-handed one, so the part's turning sense flips (`spin`).
- **The chassis's right-hand motor and gearbox mounts are mirrored (D23).** Two DC motors wired red-to-red on the left and right motor mounts therefore both push the robot forward. Level 1 never hinges on polarity, which the brief introduces at Level 2.
- **Drive layouts.** Direct drive uses the outer motor mounts (`motor-left`, `motor-right`). With gearboxes, the motors sit on the inner motor mounts and the gearboxes on the gearbox mounts. Either way the axles are coaxial at x = 40, z = 16, and the wheels clear the chassis plate.
- **Polarity is still taught.** A motor with swapped wires turns backwards, so a robot with one swapped motor spins on the spot. That is the Level 2 breakdown.
- **Exported wiring.** The parts list and wiring diagram for a real kit (the hardware bridge) must cross one real motor's leads to match.

## Placing a robot

`placeParts(blueprint, catalogue)` gives every part's frame in its root's frame:

- a mounted part hangs from its host;
- a part that is not mounted, but whose drive-in rides on another part's shaft, is carried by it (a wheel on a motor);
- any other part is a root.

Mount links come first, then carried links, each in id order. A link that would close a loop is dropped, so the result does not depend on wire order.

`robotRoot(placements)` is the root with the most parts under it, with ties going to the lowest id.

`drivePushes(blueprint, catalogue)` says which way each drive wheel pushes the robot along its root's +x (1 forward, −1 backward, 0 neither) when its actuator turns at positive speed. Multiply by the actuator's actual turning sign (its wiring, `reverse`, a driver's command) to get the push in a Run. The fixture tests derive every valid fixture's motion this way: rolling-start drives forward and reversed-motor spins.

## The canvas

- **Units and axes.** The canvas (workbench) plane is in millimetres (`CANVAS_SCALE` is 1 canvas unit per mm). x is to the right and y down, and rotations are clockwise. A part at rotation 0 faces the canvas's right, with its left towards the top.
- **The mount is authoritative.** A mounted part's place comes from its mount: its position and rotation must match `canvasPoseOf(host's canvas pose, mount placement)` to within `PLACEMENT_TOLERANCE` (0.01 mm, 0.01°). `validateBlueprint` refuses a disagreement as `mount.misplaced`, and the canvas and list view place parts with the same helper.
- **Carried parts.** A carried part's physical place comes from its shaft. The canvas may draw it there with `canvasPoseOf`.
- **Mirror images.** `canvasPoseOf` also returns `mirrored`, and takes it on the parent's pose. The canvas draws a part on a mirrored mount point (directly, or through its host) as its mirror image, flipped across its own x axis.
- **Determinism.** `canvasPoseOf` and `arenaPoseOf` use the deterministic trigonometry below, so a pose is the same on every device.

## From the canvas to the arena

When a Run starts:

- the robot's root part starts at the arena preset's `start` pose;
- every part fixed to the robot rides with it, as placed by `placeParts`;
- every other part keeps its place relative to the root as it lies on the canvas (D19: unmounted parts stay where they were placed).

`arenaPoseOf(start, rootCanvasPose, partCanvasPose)` maps a canvas pose into the arena. The canvas offset from the root becomes forward and left in the root's frame, then turns by the start heading. With no root, the canvas origin stands in for it.

## Deterministic trigonometry

`cosSin(degrees)`, `sinDegrees` and `cosDegrees` reduce the angle exactly to 0–45°, then evaluate fixed polynomials (the Taylor series to x^15 and x^16) in plain arithmetic:

- Every step is an IEEE 754 double +, −, ×, ÷ or %, which every JavaScript engine rounds the same way, so the results are bit-identical on every device.
- Quarter turns are exact, and elsewhere the error is below 1e-15.

This is the maths sim-core must use for every angle on a path that feeds a Run. No `Math.sin`, `Math.cos`, `Math.tan`, `Math.atan2`, `Math.exp`, `Math.log` or `Math.pow` may sit on such a path, because engines approximate them differently in the last bit. Plain arithmetic, `Math.sqrt` (correctly rounded) and the exact helpers (`abs`, `min`, `max`, `floor`, `ceil`, `round`, `trunc`, `sign`) are safe. A test keeps every other `Math` function out of the schema's `src/`.
