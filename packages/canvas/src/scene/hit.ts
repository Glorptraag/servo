// What lies under a point of the canvas, topmost first in the brief's layer order: a socket, then a wire, then a
// part, then a frame. Task 3.1 uses it to tell empty canvas (which pans) from the build; the input paths of tasks
// 3.2–3.4 resolve their targets with it.
import type { Vec2, WireId } from '@servo/schema';
import { canvasToPart, distance, distanceToSegment } from './geometry.ts';
import type { Scene, ScenePart, ScenePort, SceneWire } from './scene.ts';
import { PORT_MM, WIRE_HIT_MM } from './units.ts';

export type Hit =
  | { readonly kind: 'port'; readonly port: ScenePort; readonly part: ScenePart }
  | { readonly kind: 'wire'; readonly wire: SceneWire }
  | { readonly kind: 'part'; readonly part: ScenePart };

const insideTile = (part: ScenePart, point: Vec2): boolean => {
  const local = canvasToPart(part.pose, point);
  return Math.abs(local.x) <= part.tile.w / 2 && Math.abs(local.y) <= part.tile.h / 2;
};

/** The topmost thing at `point` (canvas mm), or null for empty canvas. A tidied wire is hit along its route (task 3.7). */
export const hitTest = (scene: Scene, point: Vec2, routes?: ReadonlyMap<WireId, readonly Vec2[]>): Hit | null => {
  for (let i = scene.parts.length - 1; i >= 0; i--) {
    const part = scene.parts[i] as ScenePart;
    for (const port of part.ports) {
      if (port.layer === 'ports' && distance(point, port.at) <= PORT_MM / 2) return { kind: 'port', port, part };
    }
  }
  for (let i = scene.wires.length - 1; i >= 0; i--) {
    const wire = scene.wires[i] as SceneWire;
    const path = routes?.get(wire.id) ?? [wire.from.at, wire.to.at];
    for (let k = 1; k < path.length; k++) {
      if (distanceToSegment(point, path[k - 1] as Vec2, path[k] as Vec2) <= WIRE_HIT_MM / 2) return { kind: 'wire', wire };
    }
  }
  for (let i = scene.parts.length - 1; i >= 0; i--) {
    const part = scene.parts[i] as ScenePart;
    if (insideTile(part, point)) return { kind: 'part', part };
  }
  return null;
};
