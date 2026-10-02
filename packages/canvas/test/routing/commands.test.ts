// Tidy wires through the command layer (ground rule 8), the routes the canvas keeps as the build changes, and hit
// testing along a route (task 3.7). Pure. See docs/routing.md.
import { describe, expect, it } from 'vitest';
import { serializeBlueprint } from '@servo/schema';
import type { Vec2 } from '@servo/schema';
import { applyEdit } from '../../src/placement/apply.ts';
import { TIDY_WIRES_ACTION } from '../../src/routing/commands.ts';
import { RoutingController, tidies } from '../../src/routing/controller.ts';
import { routeWires } from '../../src/routing/router.ts';
import { distance, distanceToSegment } from '../../src/scene/geometry.ts';
import { hitTest } from '../../src/scene/hit.ts';
import { buildScene } from '../../src/scene/scene.ts';
import { WIRE_HIT_MM } from '../../src/scene/units.ts';
import { benchCatalogue, busyWorkbench } from '../helpers/busy-workbench.ts';
import { catalogue, fixture } from '../helpers/catalogue.ts';

describe('the tidy-wires command', () => {
  it('gives the build back unchanged, alone and in a batch, so the canvas fires no edit and adds no undo step', () => {
    const robot = fixture('rolling-start');
    const alone = applyEdit(robot, { kind: 'tidy-wires' }, catalogue);
    expect(alone.ok && serializeBlueprint(alone.blueprint)).toBe(serializeBlueprint(robot));
    const batch = applyEdit(robot, { kind: 'batch', commands: [{ kind: 'rename', name: 'Tidy' }, { kind: 'tidy-wires' }] }, catalogue);
    expect(batch.ok && batch.blueprint.meta.name).toBe('Tidy');
  });

  it('is what the list view performs, and what the handle looks for', () => {
    expect(TIDY_WIRES_ACTION.does).toEqual({ kind: 'edit', command: { kind: 'tidy-wires' } });
    expect(TIDY_WIRES_ACTION.label).not.toMatch(/!/);
    expect(tidies({ kind: 'tidy-wires' })).toBe(true);
    expect(tidies({ kind: 'batch', commands: [{ kind: 'rename', name: 'A' }, { kind: 'tidy-wires' }] })).toBe(true);
    expect(tidies({ kind: 'rename', name: 'A' })).toBe(false);
  });
});

describe('the routes the canvas keeps', () => {
  const scene = buildScene(busyWorkbench, benchCatalogue);

  it('are the router’s once tidied, and stay through a change that moves nothing', () => {
    const routing = new RoutingController();
    expect(routing.routes.size).toBe(0);
    routing.tidy(scene);
    expect([...routing.routes]).toEqual([...routeWires(scene)]);
    const renamed = applyEdit(busyWorkbench, { kind: 'rename', name: 'Still busy' }, benchCatalogue);
    if (!renamed.ok) throw new Error(renamed.refusal.message);
    routing.refresh(buildScene(renamed.blueprint, benchCatalogue));
    expect([...routing.routes]).toEqual([...routeWires(scene)]);
  }, 60_000);

  it('let a wire go back to a straight line when a socket at its end moves, or a part lands on its route', () => {
    const routing = new RoutingController();
    routing.tidy(scene);
    const wire = scene.wires.find((each) => routing.routeOf(each.id) && each.from.ref.part === 'bench-battery');
    if (!wire) throw new Error('no routed wire from the bench battery pack');
    const moved = applyEdit(busyWorkbench, { kind: 'move-part', partId: 'bench-battery', position: { x: -200, y: 260 } }, benchCatalogue);
    if (!moved.ok) throw new Error(moved.refusal.message);
    const after = buildScene(moved.blueprint, benchCatalogue);
    routing.refresh(after);
    for (const each of after.wires) {
      const touches = each.from.ref.part === 'bench-battery' || each.to.ref.part === 'bench-battery';
      if (touches) expect(routing.routeOf(each.id), each.id).toBeUndefined();
    }
    expect(routing.pathOf(after.wires.find((each) => each.id === wire.id) ?? wire)).toHaveLength(2);

    // A new part dropped on a route sends that wire back to straight; routes it does not touch stay.
    routing.tidy(scene);
    // A bend well clear of both sockets, where nothing hides the wire.
    const clearBend = (points: readonly Vec2[]): Vec2 | undefined =>
      points.slice(1, -1).find((point) => distance(point, points[0] as Vec2) > 30 && distance(point, points[points.length - 1] as Vec2) > 30);
    const [id, route] = [...routing.routes].find(([, points]) => clearBend(points)) ?? [];
    if (!id || !route) throw new Error('no bent route');
    const bend = clearBend(route) as Vec2;
    const placed = applyEdit(busyWorkbench, { kind: 'place-part', part: 'led', position: bend }, benchCatalogue);
    if (!placed.ok) throw new Error(placed.refusal.message);
    const kept = new Map(routing.routes);
    routing.refresh(buildScene(placed.blueprint, benchCatalogue));
    expect(routing.routeOf(id)).toBeUndefined();
    for (const [other, points] of routing.routes) expect(points).toEqual(kept.get(other));
  }, 60_000);
});

describe('hitting a tidied wire', () => {
  it('follows its route, not the straight line between its sockets', () => {
    const scene = buildScene(busyWorkbench, benchCatalogue);
    const routes = routeWires(scene);
    let checked = 0;
    for (const [id, route] of routes) {
      const wire = scene.wires.find((each) => each.id === id);
      if (!wire) continue;
      for (let k = 1; k < route.length; k++) {
        const a = route[k - 1] as Vec2;
        const b = route[k] as Vec2;
        const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        if (distanceToSegment(middle, wire.from.at, wire.to.at) <= WIRE_HIT_MM) continue;
        const along = hitTest(scene, middle, routes);
        const straight = hitTest(scene, middle);
        if (along?.kind !== 'wire' || along.wire.id !== id) continue;
        expect(straight?.kind === 'wire' && straight.wire.id === id).toBe(false);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(10);
  }, 60_000);
});
