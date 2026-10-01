import { QUARTER_TURNS } from '../types/common.ts';
import type { Pose, QuarterTurn, Vec3 } from '../types/common.ts';
import type { Axis, DrivePort, MountPointPort, MountPort } from '../types/port.ts';
import { cosSin } from './trig.ts';

/**
 * Frames, pure and exact. Part frames: +x forward, +y left, +z up, millimetres. Every turn between part
 * frames is a quarter turn about +z, and a mirror flips y, so no trigonometry is needed and the results
 * are the same on every engine. See docs/geometry.md.
 */

/**
 * Where a child frame sits in its parent frame: a point p in the child is
 * (x, y, z) + R(yaw) · M · p in the parent, where M flips y when `mirrored` and R turns counter-clockwise
 * about +z.
 */
export interface Placement {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: QuarterTurn;
  readonly mirrored: boolean;
}

export const IDENTITY_PLACEMENT: Placement = { x: 0, y: 0, z: 0, yaw: 0, mirrored: false };

const COS: Readonly<Record<QuarterTurn, number>> = { 0: 1, 90: 0, 180: -1, 270: 0 };
const SIN: Readonly<Record<QuarterTurn, number>> = { 0: 0, 90: 1, 180: 0, 270: -1 };

/** Any whole number of quarter turns, brought into 0, 90, 180 or 270. */
const quarter = (degrees: number): QuarterTurn => ((((Math.round(degrees / 90) % 4) + 4) % 4) * 90) as QuarterTurn;

/** Adds zero, so a −0 never reaches stored data. */
const clean = (value: number): number => value + 0;

/** Turns a direction from the child frame into the parent frame (no translation). */
export const turnVector = (placement: Placement, v: Vec3): Vec3 => {
  const y = placement.mirrored ? -v.y : v.y;
  const c = COS[placement.yaw];
  const s = SIN[placement.yaw];
  return { x: clean(c * v.x - s * y), y: clean(s * v.x + c * y), z: clean(v.z) };
};

/** A point in the child frame, in the parent frame. */
export const placePoint = (placement: Placement, p: Vec3): Vec3 => {
  const turned = turnVector(placement, p);
  return { x: placement.x + turned.x, y: placement.y + turned.y, z: placement.z + turned.z };
};

/** The child's frame in the grandparent's frame, given the parent's frame in the grandparent's (`outer`). */
export const composePlacements = (outer: Placement, inner: Placement): Placement => {
  const at = placePoint(outer, { x: inner.x, y: inner.y, z: inner.z });
  return {
    ...at,
    // A mirror turns later quarter turns the other way: M · R(a) = R(−a) · M.
    yaw: quarter(outer.yaw + (outer.mirrored ? -inner.yaw : inner.yaw)),
    mirrored: outer.mirrored !== inner.mirrored,
  };
};

const AXIS_VECTORS: Readonly<Record<Axis, Vec3>> = {
  '+x': { x: 1, y: 0, z: 0 },
  '-x': { x: -1, y: 0, z: 0 },
  '+y': { x: 0, y: 1, z: 0 },
  '-y': { x: 0, y: -1, z: 0 },
  '+z': { x: 0, y: 0, z: 1 },
  '-z': { x: 0, y: 0, z: -1 },
};

export const axisVector = (axis: Axis): Vec3 => AXIS_VECTORS[axis];

const sameVector = (a: Vec3, b: Vec3): boolean => a.x === b.x && a.y === b.y && a.z === b.z;

/** An axis in the child frame, as an axis in the parent frame. */
export const placeAxis = (placement: Placement, axis: Axis): Axis => {
  const turned = turnVector(placement, axisVector(axis));
  return (Object.keys(AXIS_VECTORS) as Axis[]).find((candidate) => sameVector(AXIS_VECTORS[candidate], turned)) ?? axis;
};

/**
 * The turning, in the parent frame, of a drive turning at positive speed about its own `axis`: the
 * right-hand rule about the placed axis, flipped when the placement is mirrored. A unit vector.
 */
export const spin = (placement: Placement, axis: Axis): Vec3 => {
  const turned = turnVector(placement, axisVector(axis));
  const sense = placement.mirrored ? -1 : 1;
  return { x: clean(sense * turned.x), y: clean(sense * turned.y), z: clean(sense * turned.z) };
};

/** The mounted part's frame in the host's frame: the part's `mount` laid on the host's `mount-point`. */
export const mountPlacement = (point: MountPointPort, mount: MountPort): Placement => {
  const onPoint: Placement = { ...point.at, yaw: point.yaw, mirrored: point.mirrored };
  const unturn: Placement = { x: 0, y: 0, z: 0, yaw: quarter(-mount.yaw), mirrored: false };
  const unshift: Placement = { x: -mount.at.x, y: -mount.at.y, z: -mount.at.z, yaw: 0, mirrored: false };
  return composePlacements(onPoint, composePlacements(unturn, unshift));
};

/**
 * The frame of a part carried on a shaft, in the driving part's frame: its drive-in sits at the shaft's
 * `at` with the axes agreeing, turned about +z only. Undefined when no quarter turn lines the axes up.
 */
export const carriedPlacement = (shaft: DrivePort, hub: DrivePort): Placement | undefined => {
  const wanted = axisVector(shaft.axis);
  for (const yaw of QUARTER_TURNS) {
    const turnOnly: Placement = { ...IDENTITY_PLACEMENT, yaw };
    if (!sameVector(turnVector(turnOnly, axisVector(hub.axis)), wanted)) continue;
    const hubAt = turnVector(turnOnly, hub.at);
    return { x: shaft.at.x - hubAt.x, y: shaft.at.y - hubAt.y, z: shaft.at.z - hubAt.z, yaw, mirrored: false };
  }
  return undefined;
};

// ---------------------------------------------------------------------------------------------
// The canvas and the arena

/**
 * Canvas (workbench) units per millimetre. The canvas plane is millimetres: x to the right, y down,
 * rotations clockwise. A part at rotation 0 faces the canvas's right, with its left towards the top.
 */
export const CANVAS_SCALE = 1;

/**
 * A part's place on the canvas: its frame origin (mm), its rotation (degrees clockwise), and whether it
 * is drawn as its mirror image (a part fixed on a mirrored mount point, directly or through its host).
 */
export interface CanvasPose {
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
  readonly mirrored?: boolean;
}

/** Degrees brought into [0, 360), with no −0. */
export const normalizeDegrees = (degrees: number): number => {
  const turned = ((degrees % 360) + 360) % 360;
  return turned === 0 ? 0 : turned;
};

/**
 * Where a part sits on the canvas, given its parent's canvas pose and its frame in the parent's frame.
 * A mounted part must sit here (`mount.misplaced` otherwise); the canvas and list view place it with
 * this, and draw it as its mirror image when `mirrored` is true. The trigonometry is deterministic.
 */
export const canvasPoseOf = (parent: CanvasPose, placement: Placement): CanvasPose & { readonly mirrored: boolean } => {
  const [c, s] = cosSin(parent.rotation);
  // A mirrored parent's left points the other way on the canvas.
  const flip = parent.mirrored ? -1 : 1;
  const x = placement.x * CANVAS_SCALE;
  const y = flip * placement.y * CANVAS_SCALE;
  return {
    x: clean(parent.x + c * x + s * y),
    y: clean(parent.y + s * x - c * y),
    rotation: normalizeDegrees(parent.rotation - flip * placement.yaw),
    mirrored: (parent.mirrored ?? false) !== placement.mirrored,
  };
};

/**
 * Where a part on the canvas starts in the arena. The robot's root part (see robotRoot) starts at the
 * preset's `start` pose, and every other part keeps its place relative to the root, as it lies on the
 * canvas. With no root, the canvas origin stands in for it. The trigonometry is deterministic, so a Run
 * starts the same on every device.
 */
export const arenaPoseOf = (start: Pose, root: CanvasPose, part: CanvasPose): Pose => {
  const [c, s] = cosSin(root.rotation);
  const dx = (part.x - root.x) / CANVAS_SCALE;
  const dy = (part.y - root.y) / CANVAS_SCALE;
  // Canvas offset into the root's frame; this mapping is its own inverse.
  const forward = c * dx + s * dy;
  const left = s * dx - c * dy;
  const [ch, sh] = cosSin(start.heading);
  return {
    x: clean(start.x + ch * forward - sh * left),
    y: clean(start.y + sh * forward + ch * left),
    heading: normalizeDegrees(start.heading + root.rotation - part.rotation),
  };
};
