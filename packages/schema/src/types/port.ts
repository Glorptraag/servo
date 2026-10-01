import type { PlacedPartId, PortId, QuarterTurn, Text, Vec3 } from './common.ts';

/** The three connection types. A wire joins two ports of the same type (ground rule 3). */
export type PortType = 'power' | 'signal' | 'mechanical';

export const PORT_TYPES: readonly PortType[] = ['power', 'signal', 'mechanical'];

/**
 * How each type is drawn, so one colour keeps one meaning across the app (brief Sections 3, 11 and 13).
 * The line style and socket shape are the colour-blind twins, paired in the order the brief lists them.
 */
export const PORT_TYPE_STYLE = {
  power: { colour: 'red', line: 'solid', socket: 'round', name: 'power line' },
  signal: { colour: 'yellow', line: 'dashed', socket: 'square', name: 'signal line' },
  mechanical: { colour: 'grey', line: 'thick', socket: 'hexagon', name: 'mechanical linkage' },
} as const satisfies Record<PortType, { colour: string; line: string; socket: string; name: string }>;

/** The terminal marking on a power port. Power wires have no direction; polarity matters to the part. */
export type Polarity = 'positive' | 'negative' | 'none';

/**
 * Mechanical ports come in two pairs:
 * - a drive linkage carries turning from a `drive-out` (a shaft, an arm) to a `drive-in` (a hub, a gearbox input);
 * - a mount fixes a part, by its `mount`, to a `mount-point` on another part (a frame).
 */
export type MechanicalRole = 'drive-out' | 'drive-in' | 'mount' | 'mount-point';

/** An axle direction in the part's own frame (+x forward, +y left, +z up). */
export type Axis = '+x' | '-x' | '+y' | '-y' | '+z' | '-z';

export const AXES: readonly Axis[] = ['+x', '-x', '+y', '-y', '+z', '-z'];

interface PortBase {
  readonly id: PortId;
  /** Plain name read out in the list view and on the spec card, for example `plus (+)` or `shaft`. */
  readonly label: Text;
}

export interface PowerPort extends PortBase {
  readonly type: 'power';
  readonly polarity: Polarity;
}

export interface SignalPort extends PortBase {
  readonly type: 'signal';
  readonly direction: 'in' | 'out';
}

/**
 * A shaft or hub. The turning rule: a drive port turning at positive speed turns right-handed about its
 * `axis` (thumb along the axis, fingers curling the way it turns), in the part's frame. A drive linkage
 * turns the drive-in exactly as the drive-out turns.
 */
export interface DrivePort extends PortBase {
  readonly type: 'mechanical';
  readonly role: 'drive-out' | 'drive-in';
  /** Where the axle meets the part, in the part's frame (mm). */
  readonly at: Vec3;
  /** A drive-out's shaft points out of the part this way; a shaft enters a drive-in this way. Mated, the two agree. */
  readonly axis: Axis;
}

/** Where a part is fixed: the part side of a mount. */
export interface MountPort extends PortBase {
  readonly type: 'mechanical';
  readonly role: 'mount';
  /** Where the mount sits, in the part's frame (mm). */
  readonly at: Vec3;
  /** The part's heading relative to the mount point it is fixed to (usually 0). */
  readonly yaw: QuarterTurn;
}

/** Where another part is fixed: the frame side of a mount. */
export interface MountPointPort extends PortBase {
  readonly type: 'mechanical';
  readonly role: 'mount-point';
  /** Where the mount point sits, in this part's frame (mm). */
  readonly at: Vec3;
  /** The heading a part fixed here takes, counter-clockwise about +z. */
  readonly yaw: QuarterTurn;
  /**
   * A mirrored mount point fixes a part as its mirror image (its y axis flipped), so its turning sense
   * flips. A chassis's right motor mount is mirrored: two DC motors wired alike both drive forward.
   */
  readonly mirrored: boolean;
}

export type MechanicalPort = DrivePort | MountPort | MountPointPort;

/** One named, typed socket on a part record. */
export type PortSpec = PowerPort | SignalPort | MechanicalPort;

/** A port on a placed part in a blueprint. */
export interface PortRef {
  readonly part: PlacedPartId;
  readonly port: PortId;
}

/** The two power ports a primitive or need uses as a pair: `pos` is the + side, `neg` the − side. */
export interface PowerPair {
  readonly pos: PortId;
  readonly neg: PortId;
}
