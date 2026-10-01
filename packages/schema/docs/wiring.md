# Wiring rules

Back to the [README](../README.md). `src/validate/wiring.ts` is the one module the canvas, the list view, sim-core and the validators share (ground rule 3).

- `checkPortPair(a, b)` is the socket rule: use it for the glow on approach.
- `planWire(blueprint, catalogue, a, b)` adds the rules that depend on the rest of the build, and returns the wire in stored orientation. The canvas calls it on drop and the list view on its wire action, so both produce the same wire.
- `judgeWire`, `addWire` and `emptyWiring` check wires one at a time, the way `validateBlueprint` does.

## The socket rule

| | power | signal in | signal out | drive-in | drive-out | mount | mount point |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **power** | power | type | type | type | type | type | type |
| **signal in** | type | direction | signal | type | type | type | type |
| **signal out** | type | signal | direction | type | type | type | type |
| **drive-in** | type | type | type | mech. direction | drive | mismatch | mismatch |
| **drive-out** | type | type | type | drive | mech. direction | mismatch | mismatch |
| **mount** | type | type | type | mismatch | mismatch | mech. direction | mount |
| **mount point** | type | type | type | mismatch | mismatch | mount | mech. direction |

## Impossible drops and legal-but-wrong wiring

**Impossible drops** are refused with a code, at the socket:

- `wire.type_mismatch`, `wire.signal_direction`, `wire.mechanical_mismatch` and `wire.mechanical_direction`, from the table above;
- `wire.same_port` and `wire.mechanical_same_part`;
- `wire.port_full`: a signal in, a shaft, a hub, a mount and a mount point each take one wire (`SOCKET_CAPACITY`). Power ports join nets, and a signal out may feed several inputs.

`planWire` also refuses `wire.duplicate` and `mount.cycle`. A power wire into a signal port is `wire.type_mismatch`.

**Legal but wrong is always accepted,** because its failure on Run is the lesson:

- a reversed motor;
- a short across the battery pack;
- a servo motor with no signal;
- a DC motor wired red-to-red to the microcontroller's 3V pin. That pin is a weak `regulator`, so the motor barely turns, which is the Level 3 lesson. A signal pin is yellow and can never take a motor.

## Stored orientation

Signal out → in, drive-out → drive-in, mount → mount point. Power has no direction; canonical form writes the lower port reference first. `validateBlueprint` refuses a directional wire written backwards (`wire.reversed`), and `canonicalizeBlueprint` turns it round.
