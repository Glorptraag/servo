// Fixtures for the schema tests and for other packages' tests (exported as @servo/schema/fixtures).
// The JSON files are the source. Valid documents are stored in canonical form; check them against a
// catalogue built from exampleParts, exampleArenas and validKits.
import type { IssueCode } from '../src/index.ts';
import partBatteryPack2Cell from './parts/battery-pack-2-cell.json' with { type: 'json' };
import partBatteryPack1Cell from './parts/battery-pack-1-cell.json' with { type: 'json' };
import partSwitch from './parts/switch.json' with { type: 'json' };
import partBumperSwitch from './parts/bumper-switch.json' with { type: 'json' };
import partDcMotor from './parts/dc-motor.json' with { type: 'json' };
import partWheelLarge from './parts/wheel-large.json' with { type: 'json' };
import partCaster from './parts/caster.json' with { type: 'json' };
import partChassis from './parts/chassis.json' with { type: 'json' };
import partLed from './parts/led.json' with { type: 'json' };
import partBuzzer from './parts/buzzer.json' with { type: 'json' };
import partServoMotor from './parts/servo-motor.json' with { type: 'json' };
import partMotorDriver from './parts/motor-driver.json' with { type: 'json' };
import partGearbox from './parts/gearbox.json' with { type: 'json' };
import partMicrocontroller from './parts/microcontroller.json' with { type: 'json' };
import arenaOpenFloor from './arenas/open-floor.json' with { type: 'json' };
import arenaWallStop from './arenas/wall-stop.json' with { type: 'json' };
import arenaRamp from './arenas/ramp.json' with { type: 'json' };
import kitRollingStart from './kits/valid/rolling-start.json' with { type: 'json' };
import invalidKitCasterInDrivetrain from './kits/invalid/caster-in-drivetrain.json' with { type: 'json' };
import blueprintRollingStart from './blueprints/valid/rolling-start.json' with { type: 'json' };
import blueprintLedCircuit from './blueprints/valid/led-circuit.json' with { type: 'json' };
import blueprintReversedMotor from './blueprints/valid/reversed-motor.json' with { type: 'json' };
import blueprintShortCircuit from './blueprints/valid/short-circuit.json' with { type: 'json' };
import blueprintBumperRobot from './blueprints/valid/bumper-robot.json' with { type: 'json' };
import blueprintMotorOffPin from './blueprints/valid/motor-off-pin.json' with { type: 'json' };
import invalidBlueprintVersion2 from './blueprints/invalid/version-2.json' with { type: 'json' };
import invalidBlueprintDuplicatePartId from './blueprints/invalid/duplicate-part-id.json' with { type: 'json' };
import invalidBlueprintUnknownPartType from './blueprints/invalid/unknown-part-type.json' with { type: 'json' };
import invalidBlueprintUnknownPort from './blueprints/invalid/unknown-port.json' with { type: 'json' };
import invalidBlueprintUnknownPlacedPart from './blueprints/invalid/unknown-placed-part.json' with { type: 'json' };
import invalidBlueprintPowerIntoSignal from './blueprints/invalid/power-into-signal.json' with { type: 'json' };
import invalidBlueprintSignalOutToOut from './blueprints/invalid/signal-out-to-out.json' with { type: 'json' };
import invalidBlueprintShaftIntoMountPoint from './blueprints/invalid/shaft-into-mount-point.json' with { type: 'json' };
import invalidBlueprintShaftToShaft from './blueprints/invalid/shaft-to-shaft.json' with { type: 'json' };
import invalidBlueprintGearboxIntoItself from './blueprints/invalid/gearbox-into-itself.json' with { type: 'json' };
import invalidBlueprintTwoShaftsOneHub from './blueprints/invalid/two-shafts-one-hub.json' with { type: 'json' };
import invalidBlueprintDuplicateWire from './blueprints/invalid/duplicate-wire.json' with { type: 'json' };
import invalidBlueprintSignalWrittenBackwards from './blueprints/invalid/signal-written-backwards.json' with { type: 'json' };
import invalidBlueprintAngleOutOfRange from './blueprints/invalid/angle-out-of-range.json' with { type: 'json' };
import invalidBlueprintUnknownSetting from './blueprints/invalid/unknown-setting.json' with { type: 'json' };
import invalidBlueprintAuthorIsAName from './blueprints/invalid/author-is-a-name.json' with { type: 'json' };
import invalidBlueprintMissingLevel from './blueprints/invalid/missing-level.json' with { type: 'json' };
import invalidBlueprintMisspeltField from './blueprints/invalid/misspelt-field.json' with { type: 'json' };
import invalidBlueprintRotationOutOfRange from './blueprints/invalid/rotation-out-of-range.json' with { type: 'json' };
import invalidBlueprintUnknownArena from './blueprints/invalid/unknown-arena.json' with { type: 'json' };
import challengeCrossAndStop from './challenges/cross-and-stop.json' with { type: 'json' };
import challengeOneMotorBackwards from './challenges/one-motor-backwards.json' with { type: 'json' };
import challengeMeetTheSwitch from './challenges/meet-the-switch.json' with { type: 'json' };
import runRollingStartRun from './run-records/rolling-start-run.json' with { type: 'json' };

export interface Fixture {
  readonly name: string;
  readonly description: string;
  readonly data: unknown;
}

export interface InvalidFixture extends Fixture {
  /** The one named reason the validator gives. */
  readonly expect: { readonly code: IssueCode; readonly path: string };
}

/** Example part records: enough to prove the part schema. Task 2.1/2.2 authors the real catalogue in packages/content. */
export const exampleParts: readonly unknown[] = [
  partBatteryPack2Cell,
  partBatteryPack1Cell,
  partSwitch,
  partBumperSwitch,
  partDcMotor,
  partWheelLarge,
  partCaster,
  partChassis,
  partLed,
  partBuzzer,
  partServoMotor,
  partMotorDriver,
  partGearbox,
  partMicrocontroller,
];

/** Example arena presets. Task 2.4 authors the real ones. */
export const exampleArenas: readonly unknown[] = [
  arenaOpenFloor,
  arenaWallStop,
  arenaRamp,
];

export const validKits: readonly Fixture[] = [
  { name: 'rolling-start', description: 'Rolling Start (Level 1): six part types, tray grouped by family.', data: kitRollingStart },
];

/** Each refused for exactly one reason. */
export const invalidKits: readonly InvalidFixture[] = [
  { name: 'caster-in-drivetrain', description: 'The caster sits in the Drivetrain tray group, but it belongs to Structure & Ride.', expect: { code: 'kit.wrong_family', path: '$.tray[2].parts[1]' }, data: invalidKitCasterInDrivetrain },
];

/** Valid blueprints, in canonical form. Some are legal but wrong on purpose: their failure on Run is the lesson. */
export const validBlueprints: readonly Fixture[] = [
  { name: 'rolling-start', description: 'A Rolling Start robot: battery pack, switch, two DC motors on wheels, caster, all mounted on the chassis.', data: blueprintRollingStart },
  { name: 'led-circuit', description: 'An LED and a switch on a battery pack, with no chassis: a circuit on the workbench.', data: blueprintLedCircuit },
  { name: 'reversed-motor', description: 'Legal but wrong: the right motor is wired the other way round, so on Run the robot spins on the spot.', data: blueprintReversedMotor },
  { name: 'short-circuit', description: "Legal but wrong: a wire joins the 1-cell pack's plus straight to its minus, so on Run it drains fast.", data: blueprintShortCircuit },
  { name: 'bumper-robot', description: 'A Level 2 robot: motor driver (motor B set backward), gearboxes, bumper switch, buzzer, and a servo motor with power but no signal.', data: blueprintBumperRobot },
  { name: 'motor-off-pin', description: "Legal but wrong (Level 3 slot): a DC motor on the microcontroller's 3V pin, and a servo motor on a no-op brain's output.", data: blueprintMotorOffPin },
];

/** Each refused for exactly one reason, recorded in `expect`. */
export const invalidBlueprints: readonly InvalidFixture[] = [
  { name: 'version-2', description: 'A version 2 blueprint: this schema reads version 1 only.', expect: { code: 'blueprint.unsupported_version', path: '$.version' }, data: invalidBlueprintVersion2 },
  { name: 'duplicate-part-id', description: 'Two placed parts share the id "led".', expect: { code: 'id.duplicate', path: '$.parts[3].id' }, data: invalidBlueprintDuplicatePartId },
  { name: 'unknown-part-type', description: 'A placed part names a part record the catalogue does not have.', expect: { code: 'ref.unknown_part_type', path: '$.parts[3].part' }, data: invalidBlueprintUnknownPartType },
  { name: 'unknown-port', description: 'A wire ends on a port the LED does not have.', expect: { code: 'ref.unknown_port', path: '$.wires[1].to.port' }, data: invalidBlueprintUnknownPort },
  { name: 'unknown-placed-part', description: 'A wire ends on a part that is not on the canvas.', expect: { code: 'ref.unknown_placed_part', path: '$.wires[2].to.part' }, data: invalidBlueprintUnknownPlacedPart },
  { name: 'power-into-signal', description: "A power wire from the battery pack's plus into the servo motor's signal port.", expect: { code: 'wire.type_mismatch', path: '$.wires[0]' }, data: invalidBlueprintPowerIntoSignal },
  { name: 'signal-out-to-out', description: "A signal wire between two of the microcontroller's outputs.", expect: { code: 'wire.signal_direction', path: '$.wires[0]' }, data: invalidBlueprintSignalOutToOut },
  { name: 'shaft-into-mount-point', description: "A motor's drive shaft wired to the chassis's motor mount point.", expect: { code: 'wire.mechanical_mismatch', path: '$.wires[0]' }, data: invalidBlueprintShaftIntoMountPoint },
  { name: 'shaft-to-shaft', description: "A motor's shaft wired to a gearbox's output shaft: two drive-outs.", expect: { code: 'wire.mechanical_direction', path: '$.wires[0]' }, data: invalidBlueprintShaftToShaft },
  { name: 'gearbox-into-itself', description: "A gearbox's output shaft wired back to its own input.", expect: { code: 'wire.mechanical_same_part', path: '$.wires[0]' }, data: invalidBlueprintGearboxIntoItself },
  { name: 'two-shafts-one-hub', description: 'Two motor shafts wired to one wheel hub; a hub takes one shaft.', expect: { code: 'wire.port_full', path: '$.wires[1]' }, data: invalidBlueprintTwoShaftsOneHub },
  { name: 'duplicate-wire', description: 'The same two ports joined twice.', expect: { code: 'wire.duplicate', path: '$.wires[3]' }, data: invalidBlueprintDuplicateWire },
  { name: 'signal-written-backwards', description: "A signal wire written from the servo motor's input to the microcontroller's output.", expect: { code: 'wire.reversed', path: '$.wires[0]' }, data: invalidBlueprintSignalWrittenBackwards },
  { name: 'angle-out-of-range', description: 'A servo motor angle of 200 degrees; the setting runs from 0 to 180.', expect: { code: 'setting.out_of_range', path: '$.parts[0].settings.angle' }, data: invalidBlueprintAngleOutOfRange },
  { name: 'unknown-setting', description: 'A setting the LED does not have.', expect: { code: 'ref.unknown_setting', path: '$.parts[1].settings.brightness' }, data: invalidBlueprintUnknownSetting },
  { name: 'author-is-a-name', description: "The author is a child's name, not an opaque profile id.", expect: { code: 'value.bad_format', path: '$.meta.author' }, data: invalidBlueprintAuthorIsAName },
  { name: 'missing-level', description: 'The metadata has no level.', expect: { code: 'value.missing', path: '$.meta.level' }, data: invalidBlueprintMissingLevel },
  { name: 'misspelt-field', description: 'A placed part carries a field the schema does not define.', expect: { code: 'value.unknown_key', path: '$.parts[1].colour' }, data: invalidBlueprintMisspeltField },
  { name: 'rotation-out-of-range', description: 'A rotation of 400 degrees; rotations run from 0 up to 360.', expect: { code: 'value.out_of_range', path: '$.parts[0].rotation' }, data: invalidBlueprintRotationOutOfRange },
  { name: 'unknown-arena', description: 'The arena names a preset that does not exist.', expect: { code: 'ref.unknown_arena', path: '$.arena.preset' }, data: invalidBlueprintUnknownArena },
];

export const exampleChallenges: readonly Fixture[] = [
  { name: 'cross-and-stop', description: 'Unscripted build (Level 1): cross the arena and stop at the wall. No steps, no hints.', data: challengeCrossAndStop },
  { name: 'one-motor-backwards', description: 'Breakdown (Level 2): the right motor is reversed; the ladder walks from the motor to swapping its wires.', data: challengeOneMotorBackwards },
  { name: 'meet-the-switch', description: 'Part introduction (Level 1): wire the switch into the power line, then press it to stop and start the motor.', data: challengeMeetTheSwitch },
];

export const exampleRunRecords: readonly Fixture[] = [
  { name: 'rolling-start-run', description: 'A second Run of a Rolling Start robot in the wall-stop arena: the switch is pressed at tick 60, the box is bumped, the goal is not met.', data: runRollingStartRun },
];
