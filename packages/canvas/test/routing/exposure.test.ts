// Every power and signal line has a point a press reaches (task 7.9): a straight line that lies wholly under sockets
// and the lines drawn over it is drawn with a bend out to a clear spot. Pure. See docs/routing.md.
import { describe, expect, it } from 'vitest';
import type { Vec2 } from '@servo/schema';
import { RoutingController } from '../../src/routing/controller.ts';
import { PRESS_SPARE_MM, exposeWires } from '../../src/routing/exposure.ts';
import { bodiesOf, crossingCount, routeWires } from '../../src/routing/router.ts';
import { containsPoint } from '../../src/routing/shapes.ts';
import type { WireRoutes } from '../../src/routing/router.ts';
import { distance } from '../../src/scene/geometry.ts';
import { hitTest } from '../../src/scene/hit.ts';
import { buildScene } from '../../src/scene/scene.ts';
import type { Scene } from '../../src/scene/scene.ts';
import { PORT_MM, WIRE_HIT_MM } from '../../src/scene/units.ts';
import { benchCatalogue, busyWorkbench } from '../helpers/busy-workbench.ts';
import { blueprintOf, catalogue, fixture } from '../helpers/catalogue.ts';
import { crewCatalogue, crewRobot } from '../helpers/circuit-crew.ts';
import { fixtureNames } from '../helpers/plans.ts';

/**
 * A battery pack with a DC motor beside it, as the list view's free spots put them, wired minus to minus: the line runs
 * past the battery pack's plus socket, so sockets cover all of it (review R-7.6, the 1-cell battery pack).
 */
const buried = blueprintOf({
  parts: [
    { id: 'p1', part: 'battery-pack-1-cell', position: { x: 0, y: 0 }, rotation: 0, settings: {} },
    { id: 'p2', part: 'dc-motor', position: { x: -6, y: -30 }, rotation: 0, settings: {} },
  ],
  wires: [{ id: 'w1', from: { part: 'p1', port: 'minus' }, to: { part: 'p2', port: 'minus' } }],
});

/** Points along a path, every 0.5 mm. */
const along = (path: readonly Vec2[]): Vec2[] => {
  const points: Vec2[] = [];
  for (let k = 1; k < path.length; k++) {
    const a = path[k - 1] as Vec2;
    const b = path[k] as Vec2;
    const steps = Math.max(1, Math.ceil(distance(a, b) / 0.5));
    for (let i = 0; i <= steps; i++) points.push({ x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps });
  }
  return points;
};

const RING = Array.from({ length: 16 }, (_, k) => ({ x: Math.cos((k * Math.PI) / 8), y: Math.sin((k * Math.PI) / 8) }));

/** Whether a press anywhere within `spare` of some point along the line reaches it, with the routes drawn. */
const reaches = (scene: Scene, routes: WireRoutes, id: string, spare: number): boolean => {
  const wire = scene.wires.find((each) => each.id === id);
  if (!wire) return false;
  return along(routes.get(id) ?? [wire.from.at, wire.to.at]).some((point) =>
    [{ x: 0, y: 0 }, ...RING].every((offset) => {
      const hit = hitTest(scene, { x: point.x + offset.x * spare, y: point.y + offset.y * spare }, routes);
      return hit?.kind === 'wire' && hit.wire.id === id;
    }),
  );
};

/** The power and signal lines no press reaches with PRESS_SPARE_MM to spare, with the routes drawn. */
const unpressable = (scene: Scene, routes: WireRoutes): string[] =>
  scene.wires.filter((wire) => !reaches(scene, routes, wire.id, PRESS_SPARE_MM)).map((wire) => wire.id);

describe('exposeWires', () => {
  it('bends a line that sockets cover end to end out to a spot whose whole hit area reaches it', () => {
    const scene = buildScene(buried, catalogue);
    expect(unpressable(scene, new Map())).toEqual(['w1']);
    const bends = exposeWires(scene, new Map());
    const route = bends.get('w1');
    expect(route).toHaveLength(4);
    expect(route?.[0]).toEqual(scene.wires[0]?.from.at);
    expect(route?.[3]).toEqual(scene.wires[0]?.to.at);
    expect(unpressable(scene, bends)).toEqual([]);
    expect(reaches(scene, bends, 'w1', WIRE_HIT_MM / 2)).toBe(true);
  });

  it('leaves straight every line a press reaches already, so most builds draw as before', () => {
    const bent = fixtureNames.flatMap((name) => {
      const scene = buildScene(fixture(name), catalogue);
      const bends = exposeWires(scene, new Map());
      for (const id of bends.keys()) expect(unpressable(scene, new Map()), `${name} ${id}`).toContain(id);
      return [...bends.keys()].map((id) => `${name} ${id}`);
    });
    expect(bent).toEqual(['short-circuit w1', 'bumper-robot w23', 'bumper-robot w20']);
  });

  it('gives every line of every schema fixture, the Circuit Crew kit robot and the busy workbench a point a press reaches', () => {
    const builds: [string, Scene][] = [
      ...fixtureNames.map((name) => [name, buildScene(fixture(name), catalogue)] as [string, Scene]),
      ['circuit-crew', buildScene(crewRobot, crewCatalogue)],
      ['busy-workbench', buildScene(busyWorkbench, benchCatalogue)],
    ];
    for (const [name, scene] of builds) expect(unpressable(scene, exposeWires(scene, new Map())), name).toEqual([]);
  });

  it('bends a tidied route no press reaches in one stretch, and keeps every other route as tidying drew it', () => {
    const scene = buildScene(busyWorkbench, benchCatalogue);
    const tidied = routeWires(scene);
    const bends = exposeWires(scene, tidied);
    for (const [id, route] of bends) {
      const before = tidied.get(id) ?? [];
      if (before.length === 0) continue;
      expect(route.length, id).toBe(before.length + 2);
      expect(route.filter((point) => before.includes(point)), id).toEqual(before);
    }
    expect(unpressable(scene, new Map([...tidied, ...bends]))).toEqual([]);
  }, 60_000);

  it('keeps its middle clear of every socket by half a socket and half a hit area', () => {
    const scene = buildScene(buried, catalogue);
    const route = exposeWires(scene, new Map()).get('w1') ?? [];
    const middle = { x: ((route[1]?.x ?? 0) + (route[2]?.x ?? 0)) / 2, y: ((route[1]?.y ?? 0) + (route[2]?.y ?? 0)) / 2 };
    for (const part of scene.parts) {
      for (const port of part.ports) if (port.layer === 'ports') expect(distance(middle, port.at)).toBeGreaterThanOrEqual(PORT_MM / 2 + WIRE_HIT_MM / 2 - 1e-9);
    }
  });

  /** The middle of a bend's flat stretch. */
  const topOf = (route: readonly Vec2[] | undefined): Vec2 => {
    const [, a, b] = route ?? [];
    if (!a || !b) throw new Error('no bend');
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };

  it('keeps its bend off every part body: where the nearest clear spot lies in one, it goes on to the next (R-7.9)', () => {
    const first = topOf(exposeWires(buildScene(buried, catalogue), new Map()).get('w1'));
    // A caster, which has no socket, set down over that spot: its body takes the spot, not its sockets.
    const covered = blueprintOf({
      parts: [...buried.parts, { id: 'p3', part: 'caster', position: first, rotation: 0, settings: {} }],
      wires: buried.wires,
    });
    const scene = buildScene(covered, catalogue);
    const bodies = bodiesOf(scene);
    const caster = bodies[scene.parts.filter((part) => !part.frame).findIndex((part) => part.id === 'p3')];
    if (!caster) throw new Error('no caster body');
    expect(containsPoint(caster, first)).toBe(true);
    const route = exposeWires(scene, new Map()).get('w1');
    const top = topOf(route);
    expect(bodies.some((body) => containsPoint(body, top))).toBe(false);
    expect(crossingCount(route ?? [], bodies)).toBeLessThanOrEqual(crossingCount([scene.wires[0]?.from.at as Vec2, scene.wires[0]?.to.at as Vec2], bodies));
    expect(unpressable(scene, new Map([['w1', route ?? []]]))).toEqual([]);
  });

  it('never makes a tidied route cross a body it kept off', () => {
    const scene = buildScene(busyWorkbench, benchCatalogue);
    const bodies = bodiesOf(scene);
    const tidied = routeWires(scene);
    for (const [id, route] of exposeWires(scene, tidied)) {
      const before = tidied.get(id) ?? [scene.wires.find((wire) => wire.id === id)?.from.at as Vec2, scene.wires.find((wire) => wire.id === id)?.to.at as Vec2];
      expect(crossingCount(route, bodies), id).toBeLessThanOrEqual(crossingCount(before, bodies));
    }
  }, 60_000);

  it('leans away from the build’s middle, and a small move of a part keeps it on that side', () => {
    const at = (x: number): typeof buried =>
      blueprintOf({ parts: buried.parts.map((part) => (part.id === 'p2' ? { ...part, position: { x, y: -30 } } : part)), wires: buried.wires });
    /** +1 when the bend lies on the far side of the line from the build's middle, −1 on the near side. */
    const outward = (build: typeof buried): number => {
      const scene = buildScene(build, catalogue);
      const wire = scene.wires[0];
      if (!wire) throw new Error('no wire');
      const top = topOf(exposeWires(scene, new Map()).get('w1'));
      const xs = scene.parts.flatMap((part) => part.corners.map((corner) => corner.x));
      const ys = scene.parts.flatMap((part) => part.corners.map((corner) => corner.y));
      const middle = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
      const n = { x: wire.to.at.y - wire.from.at.y, y: wire.from.at.x - wire.to.at.x };
      const sideOf = (p: Vec2): number => Math.sign(n.x * (p.x - wire.from.at.x) + n.y * (p.y - wire.from.at.y));
      return sideOf(top) === sideOf(middle) ? -1 : 1;
    };
    expect(outward(buried)).toBe(1);
    for (const x of [-6.4, -6.2, -5.8, -5.6]) expect(outward(at(x)), `DC motor at x ${x}`).toBe(1);
  });

  it('is deterministic', () => {
    const scene = buildScene(busyWorkbench, benchCatalogue);
    expect(JSON.stringify([...exposeWires(scene, new Map())])).toBe(JSON.stringify([...exposeWires(buildScene(busyWorkbench, benchCatalogue), new Map())]));
  });
});

describe('the routes the canvas draws', () => {
  it('bend a covered line before any tidy, and keep the bend through a change that moves nothing', () => {
    const routing = new RoutingController();
    const scene = buildScene(buried, catalogue);
    routing.refresh(scene);
    expect(routing.tidied.size).toBe(0);
    expect([...routing.routes]).toEqual([...exposeWires(scene, new Map())]);
    const before = routing.routes;
    routing.refresh(buildScene(buried, catalogue));
    expect(routing.routes).toBe(before);
  });
});
