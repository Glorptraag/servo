// Props from the arena strip (D36): the next prop id, the way between the canvas and the arena floor, and the free spot
// on the floor. Arena millimetres have y up and headings counter-clockwise (packages/schema/docs/geometry.md). Pure.
// See docs/placement.md.
import { cosSin } from '@servo/schema';
import type { ArenaFeatureId, ArenaPreset, Blueprint, Catalogue, Pose, Prop, Vec2, Wall } from '@servo/schema';
import type { PropTemplate } from '../interface.ts';
import { layArena } from '../scene/arena.ts';
import type { ArenaMatrix } from '../scene/arena.ts';
import { buildScene } from '../scene/scene.ts';
import { freeSpot, roundPoint } from './free-spot.ts';
import type { Outline } from './free-spot.ts';

const PROP_ID = /^prop-(\d+)$/;

/** `prop-<n>`: one more than the highest such id among the preset's features and the arena's props. */
export const nextPropId = (preset: ArenaPreset | undefined, props: readonly Prop[]): ArenaFeatureId => {
  const features = preset ? [...preset.walls, ...preset.zones, ...preset.lines, ...preset.ramps, ...preset.props] : [];
  let highest = 0;
  for (const { id } of [...features, ...props]) {
    const match = PROP_ID.exec(id);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return `prop-${highest + 1}`;
};

/** A canvas point on the arena floor: the inverse of `arenaToCanvas`. */
export const canvasToArena = (m: ArenaMatrix, point: Vec2): Vec2 => {
  const det = m.a * m.d - m.b * m.c;
  const x = point.x - m.tx;
  const y = point.y - m.ty;
  return { x: (m.d * x - m.c * y) / det + 0, y: (m.a * y - m.b * x) / det + 0 };
};

/** A prop's footprint on the floor: a box turned by its heading, a cylinder as the square round it. */
export const propOutline = (prop: Pick<Prop, 'shape' | 'size'>, at: Pose): Outline => {
  const [c, s] = prop.shape === 'box' ? cosSin(at.heading) : [1, 0];
  const hx = prop.size.x / 2;
  const hy = prop.size.y / 2;
  return [
    { x: -hx, y: -hy },
    { x: hx, y: -hy },
    { x: hx, y: hy },
    { x: -hx, y: hy },
  ].map((corner) => ({ x: at.x + c * corner.x - s * corner.y, y: at.y + s * corner.x + c * corner.y }));
};

const wallOutline = (wall: Wall): Outline => {
  const dx = wall.to.x - wall.from.x;
  const dy = wall.to.y - wall.from.y;
  const length = Math.sqrt(dx * dx + dy * dy) || 1;
  const nx = (-dy / length) * (wall.thicknessMm / 2);
  const ny = (dx / length) * (wall.thicknessMm / 2);
  return [
    { x: wall.from.x + nx, y: wall.from.y + ny },
    { x: wall.to.x + nx, y: wall.to.y + ny },
    { x: wall.to.x - nx, y: wall.to.y - ny },
    { x: wall.from.x - nx, y: wall.from.y - ny },
  ];
};

/** The arena a build names, laid on the canvas, when the catalogue has its preset. */
export const arenaOf = (blueprint: Blueprint, catalogue: Catalogue): { preset: ArenaPreset; matrix: ArenaMatrix } | undefined => {
  const arena = layArena(blueprint, catalogue, buildScene(blueprint, catalogue));
  return arena && { preset: arena.preset, matrix: arena.matrix };
};

/**
 * Where a prop lands on the floor: the free spot nearest `from` (arena mm), or nearest the middle of the floor when
 * none is given (the list view). Free means wholly on the floor and clear of the walls, of every other prop (but the
 * one `moving`) and of the build as it starts a Run. Undefined when the catalogue lacks the preset or the floor has
 * no room.
 */
export const propSpot = (
  blueprint: Blueprint,
  catalogue: Catalogue,
  prop: Pick<PropTemplate, 'shape' | 'size'>,
  from?: Vec2,
  moving?: ArenaFeatureId,
  heading = 0,
): Pose | undefined => {
  const scene = buildScene(blueprint, catalogue);
  const arena = layArena(blueprint, catalogue, scene);
  if (!arena) return undefined;
  const { preset, matrix } = arena;
  const obstacles: Outline[] = [
    ...preset.walls.map(wallOutline),
    ...[...preset.props, ...blueprint.arena.props].filter((other) => other.id !== moving).map((other) => propOutline(other, other.at)),
    ...scene.parts.map((part) => part.corners.map((corner) => canvasToArena(matrix, corner))),
  ];
  const shape = propOutline(prop, { x: 0, y: 0, heading });
  const onFloor = (at: Vec2): boolean =>
    shape.every((corner) => {
      const x = at.x + corner.x;
      const y = at.y + corner.y;
      return x >= 0 && y >= 0 && x <= preset.size.x && y <= preset.size.y;
    });
  const spot = freeSpot({ from: roundPoint(from ?? { x: preset.size.x / 2, y: preset.size.y / 2 }), shape: [shape], obstacles, allows: onFloor });
  return spot && { x: spot.x, y: spot.y, heading };
};

/** Whether an arena point lies on a prop: inside a box's footprint, or a cylinder's circle. */
export const onProp = (prop: Prop, point: Vec2): boolean => {
  const dx = point.x - prop.at.x;
  const dy = point.y - prop.at.y;
  if (prop.shape === 'cylinder') return dx * dx + dy * dy <= (prop.size.x / 2) * (prop.size.x / 2);
  const [c, s] = cosSin(prop.at.heading);
  return Math.abs(c * dx + s * dy) <= prop.size.x / 2 && Math.abs(-s * dx + c * dy) <= prop.size.y / 2;
};
