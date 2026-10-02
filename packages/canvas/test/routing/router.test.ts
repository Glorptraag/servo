// The tidy-wires router (task 3.7): after tidying, no wire on the 25-part busy workbench crosses a part body, routes
// run socket to socket, and they come out the same every time. A body is the part as drawn, its footprint
// (`body.size`), not its touch tile: the tile's padding up to 96 px is a hit affordance a wire may pass over. The
// crossing check here samples each route against every body, independently of the router's own shape maths. It
// skips only the stretch a wire's own two sockets are drawn over (44 px across, above the wires), where a socket
// sitting over another part (the motor driver's sockets over the battery pack beside it) leaves no choice. A flood fill
// of the open workbench independently shows every busy-workbench wire has a clean way. Pure. See docs/routing.md.
import { describe, expect, it } from 'vitest';
import type { Blueprint, Catalogue, Vec2 } from '@servo/schema';
import { canvasToPart, distance } from '../../src/scene/geometry.ts';
import { buildScene } from '../../src/scene/scene.ts';
import type { Scene, ScenePart, SceneWire } from '../../src/scene/scene.ts';
import { PORT_MM } from '../../src/scene/units.ts';
import { CLEARANCE_MM, pathOf, routeWires } from '../../src/routing/router.ts';
import type { Route } from '../../src/routing/router.ts';
import { bodyShape, rayInside, segmentEnters, squareShape, tileShape } from '../../src/routing/shapes.ts';
import { benchCatalogue, busyWorkbench } from '../helpers/busy-workbench.ts';
import { catalogue, fixture, twentyFiveParts } from '../helpers/catalogue.ts';
import { crewCatalogue, crewRobot } from '../helpers/circuit-crew.ts';

/** Flood fills and full routings of 25-part builds: generous, for a busy machine. */
const SLOW_MS = 60_000;

/** Sample spacing along a route, mm: a fifth of a pixel at the default zoom. */
const STEP_MM = 0.08;
const HIDDEN_MM = PORT_MM / 2;

/** Strictly inside a part's body as drawn: its footprint (`body.size`) centred on its frame origin, not its touch tile. */
const insideBody = (part: ScenePart, point: Vec2): boolean => {
  const local = canvasToPart(part.pose, point);
  return Math.abs(local.x) < part.record.body.size.x / 2 - 1e-6 && Math.abs(local.y) < part.record.body.size.y / 2 - 1e-6;
};

/** The bodies a path passes through where it shows, by sampling it: outside the sockets at `hidden` (its two ends). */
const bodiesCrossed = (scene: Scene, path: readonly Vec2[], hidden: readonly Vec2[] = [path[0] as Vec2, path[path.length - 1] as Vec2]): string[] => {
  const crossed = new Set<string>();
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1] as Vec2;
    const b = path[i] as Vec2;
    const steps = Math.max(1, Math.ceil(distance(a, b) / STEP_MM));
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const at = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      if (hidden.some((end) => distance(end, at) <= HIDDEN_MM + 1e-6)) continue;
      for (const part of scene.parts) if (!part.frame && insideBody(part, at)) crossed.add(part.id);
    }
  }
  return [...crossed].sort();
};

/**
 * Whether open workbench joins a wire's two sockets: the scene's open space (outside every drawn part body) on a 0.25 mm
 * grid, split into connected regions once, and a wire's ends joined when one region touches the stretch under both
 * of its sockets (a wire may pass under its own socket). False means a socket is boxed in, so every way between them
 * crosses a part.
 */
const openSpace = (scene: Scene): ((wire: SceneWire) => boolean) => {
  const cell = 0.25;
  const solid = scene.parts.filter((part) => !part.frame);
  const minX = Math.min(...solid.map((part) => part.bounds.minX)) - 40;
  const minY = Math.min(...solid.map((part) => part.bounds.minY)) - 40;
  const maxX = Math.max(...solid.map((part) => part.bounds.maxX)) + 40;
  const maxY = Math.max(...solid.map((part) => part.bounds.maxY)) + 40;
  const columns = Math.ceil((maxX - minX) / cell);
  const rows = Math.ceil((maxY - minY) / cell);
  const centre = (i: number, j: number): Vec2 => ({ x: minX + (i + 0.5) * cell, y: minY + (j + 0.5) * cell });
  const blocked = new Uint8Array(columns * rows);
  for (const part of solid) {
    const i0 = Math.max(0, Math.floor((part.bounds.minX - minX) / cell));
    const i1 = Math.min(columns - 1, Math.ceil((part.bounds.maxX - minX) / cell));
    const j0 = Math.max(0, Math.floor((part.bounds.minY - minY) / cell));
    const j1 = Math.min(rows - 1, Math.ceil((part.bounds.maxY - minY) / cell));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (insideBody(part, centre(i, j))) blocked[j * columns + i] = 1;
  }
  const region = new Int32Array(columns * rows).fill(-1);
  let regions = 0;
  const queue = new Int32Array(columns * rows);
  for (let start = 0; start < columns * rows; start++) {
    if (blocked[start] || (region[start] as number) >= 0) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    region[start] = regions;
    const visit = (next: number): void => {
      if (next < 0 || next >= columns * rows || blocked[next] || (region[next] as number) >= 0) return;
      region[next] = regions;
      queue[tail++] = next;
    };
    while (head < tail) {
      const index = queue[head++] as number;
      const i = index % columns;
      if (i + 1 < columns) visit(index + 1);
      if (i > 0) visit(index - 1);
      visit(index + columns);
      visit(index - columns);
    }
    regions++;
  }
  /** The open regions that touch the stretch under a socket: open cells within it or one cell beyond. */
  const touching = (socket: Vec2): Set<number> => {
    const found = new Set<number>();
    const reach = HIDDEN_MM + 2 * cell;
    const i0 = Math.max(0, Math.floor((socket.x - reach - minX) / cell));
    const i1 = Math.min(columns - 1, Math.ceil((socket.x + reach - minX) / cell));
    const j0 = Math.max(0, Math.floor((socket.y - reach - minY) / cell));
    const j1 = Math.min(rows - 1, Math.ceil((socket.y + reach - minY) / cell));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const label = region[j * columns + i] as number;
        if (label >= 0 && distance(centre(i, j), socket) <= HIDDEN_MM + cell) found.add(label);
      }
    }
    return found;
  };
  return (wire) => {
    if (distance(wire.from.at, wire.to.at) <= 2 * HIDDEN_MM) return true;
    const to = touching(wire.to.at);
    return [...touching(wire.from.at)].some((label) => to.has(label));
  };
};

const builds: readonly [string, Blueprint, Catalogue][] = [
  ['the busy workbench (25 parts)', busyWorkbench, benchCatalogue],
  ['the 25-part performance fixture', twentyFiveParts, catalogue],
  ['the bumper robot', fixture('bumper-robot'), catalogue],
  ['the Circuit Crew kit robot', crewRobot, crewCatalogue],
  ['Rolling Start', fixture('rolling-start'), catalogue],
];

describe('the busy workbench', () => {
  const scene = buildScene(busyWorkbench, benchCatalogue);
  const routes = routeWires(scene);

  /** All 43: power and signal lines, which tidying routes, and drive linkages and mounts, drawn straight under the parts. */
  const everyWire = [...scene.wires, ...scene.linkages];

  it('is the 25-part fixture with 43 wires, and many of its straight wires cross part bodies before tidying', () => {
    expect(scene.parts).toHaveLength(25);
    expect(everyWire).toHaveLength(43);
    const before = scene.wires.filter((wire) => bodiesCrossed(scene, [wire.from.at, wire.to.at]).length > 0);
    expect(before.length).toBeGreaterThan(5);
  }, SLOW_MS);

  it('after tidying, none of its 43 wires crosses a part body', () => {
    for (const wire of everyWire) expect(bodiesCrossed(scene, pathOf(wire, routes)), wire.id).toEqual([]);
  }, SLOW_MS);

  it('has open workbench between the two sockets of every wire: no socket is boxed in by drawn parts', () => {
    const joined = openSpace(scene);
    for (const wire of everyWire) expect(joined(wire), wire.id).toBe(true);
  }, SLOW_MS);
});

describe.each(builds)('routing %s', (_name, blueprint, parts) => {
  const scene = buildScene(blueprint, parts);
  const routes = routeWires(scene);

  it('leaves no power or signal line crossing a part body, unless open workbench cannot join its sockets', () => {
    const joined = openSpace(scene);
    for (const wire of scene.wires) {
      if (bodiesCrossed(scene, pathOf(wire, routes)).length === 0) continue;
      expect(joined(wire), wire.id).toBe(false);
    }
  }, SLOW_MS);

  it('routes the wires that crossed a body, from socket to socket, and leaves the rest straight', () => {
    for (const wire of scene.wires) {
      const route = routes.get(wire.id);
      // The router's own check is exact; sampling every 0.08 mm can miss a graze, so it only finds crossings.
      if (bodiesCrossed(scene, [wire.from.at, wire.to.at]).length > 0) expect(route, wire.id).toBeDefined();
      if (!route) continue;
      expect(route[0]).toEqual(wire.from.at);
      expect(route[route.length - 1]).toEqual(wire.to.at);
    }
    for (const id of routes.keys()) expect(scene.wires.some((wire) => wire.id === id)).toBe(true);
  }, SLOW_MS);

  it('gives the same routes every time, whatever order the blueprint lists things in', () => {
    const again = routeWires(buildScene(blueprint, parts));
    const shuffled = routeWires(buildScene({ ...blueprint, parts: [...blueprint.parts].reverse(), wires: [...blueprint.wires].reverse() }, parts));
    const plain = (map: ReadonlyMap<string, Route>) => JSON.stringify([...map].sort(([a], [b]) => (a < b ? -1 : 1)));
    expect(plain(again)).toBe(plain(routes));
    expect(plain(shuffled)).toBe(plain(routes));
  }, SLOW_MS);
});

describe('the shapes', () => {
  const square = squareShape({ x: 0, y: 0 }, 10);

  it('counts entering the inside, not running along the outline or touching a corner', () => {
    expect(segmentEnters({ x: -20, y: 0 }, { x: 20, y: 0 }, square)).toBe(true);
    expect(segmentEnters({ x: -20, y: 10 }, { x: 20, y: 10 }, square)).toBe(false);
    expect(segmentEnters({ x: -20, y: 0 }, { x: 0, y: 20 }, square)).toBe(false);
    expect(segmentEnters({ x: -20, y: -0.5 }, { x: 0.5, y: 20 }, square)).toBe(true);
    expect(segmentEnters({ x: 1, y: 1 }, { x: 2, y: 2 }, square)).toBe(true);
    expect(segmentEnters({ x: 10, y: 0 }, { x: 30, y: 0 }, square)).toBe(false);
  });

  it('finds where a ray is inside a shape, from outside or from within', () => {
    const [enter, leave] = rayInside(square, { x: -30, y: 0 }, { x: 1, y: 0 }) ?? [Number.NaN, Number.NaN];
    expect(enter).toBeCloseTo(20, 9);
    expect(leave).toBeCloseTo(40, 9);
    const [from, to] = rayInside(square, { x: 0, y: 5 }, { x: 0, y: 1 }) ?? [Number.NaN, Number.NaN];
    expect(from).toBeCloseTo(-15, 9);
    expect(to).toBeCloseTo(5, 9);
    expect(rayInside(square, { x: -30, y: 10 }, { x: 1, y: 0 })).toBeUndefined();
    expect(rayInside(square, { x: 30, y: 0 }, { x: 1, y: 0 })).toBeUndefined();
  });

  it('turns a tile with its part, and draws the body inside it at its true size', () => {
    const scene = buildScene(fixture('bumper-robot'), catalogue);
    for (const part of scene.parts) {
      const shape = tileShape(part);
      for (const [index, corner] of shape.corners.entries()) {
        const expected = part.corners[index] as Vec2;
        expect(corner.x).toBeCloseTo(expected.x, 9);
        expect(corner.y).toBeCloseTo(expected.y, 9);
      }
      const body = bodyShape(part);
      const [a, b, c] = body.corners as [Vec2, Vec2, Vec2];
      expect(distance(a, b)).toBeCloseTo(Math.min(part.record.body.size.x, part.tile.w), 9);
      expect(distance(b, c)).toBeCloseTo(Math.min(part.record.body.size.y, part.tile.h), 9);
      expect(body.box.minX).toBeGreaterThanOrEqual(shape.box.minX - 1e-9);
      expect(body.box.maxX).toBeLessThanOrEqual(shape.box.maxX + 1e-9);
      expect(bodyShape(part, CLEARANCE_MM).box.maxX - body.box.maxX).toBeGreaterThan(0);
    }
  });
});
