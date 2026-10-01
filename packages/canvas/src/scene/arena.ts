// Where the arena lies on the canvas. A Run starts the robot's root part at the preset's start pose, and every
// other part keeps its place relative to the root (geometry.md, D19), so the arena floor is drawn in the same
// plane, laid so that the start pose falls on the root's canvas pose. This is the inverse of the schema's
// `arenaPoseOf`, with the same deterministic trigonometry.
import { cosSin } from '@servo/schema';
import type { ArenaPreset, Blueprint, Catalogue, Prop, Vec2 } from '@servo/schema';
import { compareIds, rectOfPoints } from './geometry.ts';
import type { Rect } from './geometry.ts';
import type { Scene } from './scene.ts';

/** An affine map from arena millimetres (y up) to canvas millimetres (y down): (a·x + c·y + tx, b·x + d·y + ty). */
export interface ArenaMatrix {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly tx: number;
  readonly ty: number;
}

export interface SceneArena {
  readonly preset: ArenaPreset;
  /** The preset's props, then the child's (D36), by id. */
  readonly props: readonly Prop[];
  readonly matrix: ArenaMatrix;
  /** The floor's corners on the canvas. */
  readonly corners: readonly Vec2[];
  readonly bounds: Rect;
}

export const arenaToCanvas = (m: ArenaMatrix, p: Vec2): Vec2 => ({ x: m.a * p.x + m.c * p.y + m.tx, y: m.b * p.x + m.d * p.y + m.ty });

/**
 * The arena a blueprint names, laid on the canvas. Undefined when the catalogue has no arena presets or not this one.
 */
export const layArena = (blueprint: Blueprint | undefined, catalogue: Catalogue, scene: Scene): SceneArena | undefined => {
  if (!blueprint) return undefined;
  const preset = catalogue.arenas?.get(blueprint.arena.preset);
  if (!preset) return undefined;
  const rootPart = scene.root !== undefined ? scene.partById.get(scene.root) : undefined;
  const root = rootPart ? { x: rootPart.placed.position.x, y: rootPart.placed.position.y, rotation: rootPart.placed.rotation } : { x: 0, y: 0, rotation: 0 };
  const [c, s] = cosSin(root.rotation);
  const [ch, sh] = cosSin(preset.start.heading);
  // arenaPoseOf: forward = c·dx + s·dy, left = s·dx − c·dy; arena = start + R(heading)·(forward, left).
  // Inverted: (forward, left) = R(−heading)·(arena − start), then (dx, dy) = [[c, s], [s, −c]]·(forward, left).
  const a = c * ch - s * sh;
  const cc = c * sh + s * ch;
  const b = s * ch + c * sh;
  const d = s * sh - c * ch;
  const matrix: ArenaMatrix = {
    a,
    b,
    c: cc,
    d,
    tx: root.x - a * preset.start.x - cc * preset.start.y,
    ty: root.y - b * preset.start.x - d * preset.start.y,
  };
  const corners = [
    { x: 0, y: 0 },
    { x: preset.size.x, y: 0 },
    { x: preset.size.x, y: preset.size.y },
    { x: 0, y: preset.size.y },
  ].map((corner) => arenaToCanvas(matrix, corner));
  const props = [...preset.props, ...blueprint.arena.props].sort((p, q) => compareIds(p.id, q.id));
  return { preset, props, matrix, corners, bounds: rectOfPoints(corners) as Rect };
};
