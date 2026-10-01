import type { ArenaFeatureId, ArenaPresetId, Pose, Text, Vec2, Vec3 } from './common.ts';

/**
 * Arena frame: the floor is a rectangle from (0, 0) to `size`, x to the right, y up (north), millimetres;
 * headings are degrees counter-clockwise from +x in [0, 360). Every feature lies on the floor.
 */

export interface Wall {
  readonly id: ArenaFeatureId;
  readonly from: Vec2;
  readonly to: Vec2;
  readonly thicknessMm: number;
}

/** An axis-aligned rectangle, `from` the lower-left corner and `to` the upper-right. Goals name zones. */
export interface Zone {
  readonly id: ArenaFeatureId;
  readonly from: Vec2;
  readonly to: Vec2;
}

/** A line drawn on the floor (for line sensors, Level 3). At least two points. */
export interface FloorLine {
  readonly id: ArenaFeatureId;
  readonly points: readonly Vec2[];
  readonly widthMm: number;
}

/** A rectangle of floor that rises by `riseMm` towards `uphill`. */
export interface Ramp {
  readonly id: ArenaFeatureId;
  readonly from: Vec2;
  readonly to: Vec2;
  readonly riseMm: number;
  readonly uphill: '+x' | '-x' | '+y' | '-y';
}

/**
 * Something to push or bump. A box's `size` is its length, width and height; a cylinder's is its
 * diameter twice (x and y equal) and height. A `fixed` prop does not move when pushed.
 */
export interface Prop {
  readonly id: ArenaFeatureId;
  readonly shape: 'box' | 'cylinder';
  readonly size: Vec3;
  readonly grams: number;
  readonly at: Pose;
  readonly fixed: boolean;
}

/** An arena preset, authored as content (open floor, wall stop, ramp, bump props). */
export interface ArenaPreset {
  readonly id: ArenaPresetId;
  readonly name: Text;
  readonly size: Vec2;
  /** Floor friction against wheels, bodies and props. */
  readonly friction: number;
  /** Where the robot's frame starts. */
  readonly start: Pose;
  readonly walls: readonly Wall[];
  readonly zones: readonly Zone[];
  readonly lines: readonly FloorLine[];
  readonly ramps: readonly Ramp[];
  readonly props: readonly Prop[];
}

/** The arena a blueprint or challenge runs in: a preset plus the props the child dragged in. */
export interface ArenaRef {
  readonly preset: ArenaPresetId;
  readonly props: readonly Prop[];
}
