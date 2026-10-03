// Plane transforms for Run mode: a body moved from where the build put it to where the frame puts it, turned, and
// foreshortened by its tilt as seen from above. Canvas millimetres, x right, y down, turns clockwise. Pure. The
// drawing only: the simulation's maths stays in sim-core and the schema.
import type { Vec2 } from '@servo/schema';
import type { PartPose } from '../scene/geometry.ts';
import type { BodyPose } from './state.ts';
import { MIN_FORESHORTEN } from './look.ts';

/** (x, y) ↦ (a·x + c·y + tx, b·x + d·y + ty), as Pixi's Matrix. */
export interface Affine {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly tx: number;
  readonly ty: number;
}

export const IDENTITY: Affine = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };

const radians = (degrees: number): number => (degrees * Math.PI) / 180;

/** `outer` after `inner`. */
export const compose = (outer: Affine, inner: Affine): Affine => ({
  a: outer.a * inner.a + outer.c * inner.b,
  b: outer.b * inner.a + outer.d * inner.b,
  c: outer.a * inner.c + outer.c * inner.d,
  d: outer.b * inner.c + outer.d * inner.d,
  tx: outer.a * inner.tx + outer.c * inner.ty + outer.tx,
  ty: outer.b * inner.tx + outer.d * inner.ty + outer.ty,
});

export const apply = (m: Affine, p: Vec2): Vec2 => ({ x: m.a * p.x + m.c * p.y + m.tx, y: m.b * p.x + m.d * p.y + m.ty });

export const invert = (m: Affine): Affine => {
  const det = m.a * m.d - m.b * m.c;
  if (det === 0) return IDENTITY;
  return {
    a: m.d / det,
    b: -m.b / det,
    c: -m.c / det,
    d: m.a / det,
    tx: (m.c * m.ty - m.d * m.tx) / det,
    ty: (m.b * m.tx - m.a * m.ty) / det,
  };
};

export const translation = (x: number, y: number): Affine => ({ a: 1, b: 0, c: 0, d: 1, tx: x, ty: y });

/** A clockwise turn on the canvas (y down). */
export const rotation = (degrees: number): Affine => {
  const c = Math.cos(radians(degrees));
  const s = Math.sin(radians(degrees));
  return { a: c, b: s, c: -s, d: c, tx: 0, ty: 0 };
};

/** A part node's transform for a pose, as PartView.setPose sets it: placed, turned, and flipped when mirrored. */
export const nodeMatrix = (pose: PartPose): Affine =>
  compose(translation(pose.x, pose.y), compose(rotation(pose.rotation), { ...IDENTITY, d: pose.mirrored ? -1 : 1 }));

/** How much a tilt shortens a body's footprint seen from above, never below MIN_FORESHORTEN. */
export const foreshorten = (degrees: number): number => Math.max(MIN_FORESHORTEN, Math.abs(Math.cos(radians(degrees))));

/**
 * Moves what the build drew for a body to where the frame puts it: the body's build pose `from` (its root part's
 * canvas pose) onto `to`, foreshortened by its pitch along its own forward axis and by its roll along its left axis.
 * Every part on the body takes the same transform, so the robot moves as one.
 */
export const bodyMatrix = (from: PartPose, to: BodyPose): Affine => {
  const squash: Affine = { a: foreshorten(to.pitch), b: 0, c: 0, d: foreshorten(to.roll), tx: 0, ty: 0 };
  const linear = compose(rotation(to.rotation), compose(squash, rotation(-from.rotation)));
  return compose(translation(to.x, to.y), compose(linear, translation(-from.x, -from.y)));
};
