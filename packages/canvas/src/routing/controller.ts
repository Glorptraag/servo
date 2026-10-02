// The routes the canvas draws (task 3.7): set by a `tidy-wires` command, kept while they still fit the build. Routes
// are view state, never written to the blueprint. After any change to the build a route is kept only while both its
// sockets stay where they were and it crosses no more parts than when it was tidied; otherwise its wire goes back to
// a straight line, like any new wire, until the child tidies again. See docs/routing.md.
import type { Vec2, WireId } from '@servo/schema';
import type { EditCommand } from '../interface.ts';
import type { Scene, SceneWire } from '../scene/scene.ts';
import { bodiesOf, crossingCount, pathOf, routeWires } from './router.ts';
import type { Route, WireRoutes } from './router.ts';

interface Kept {
  readonly route: Route;
  readonly from: Vec2;
  readonly to: Vec2;
  /** The parts it crossed when tidied: none, but for a wire boxed in by other parts. */
  readonly crossings: number;
}

const samePoint = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;

/** Whether a command, alone or in a batch, tidies the wires. */
export const tidies = (command: EditCommand): boolean =>
  command.kind === 'tidy-wires' || (command.kind === 'batch' && Array.isArray(command.commands) && command.commands.some((each) => each.kind === 'tidy-wires'));

export class RoutingController {
  private kept = new Map<WireId, Kept>();
  private view: Map<WireId, Route> = new Map();

  /** The routes to draw and hit-test, by wire id. */
  get routes(): WireRoutes {
    return this.view;
  }

  routeOf(id: WireId): Route | undefined {
    return this.view.get(id);
  }

  /** A wire's path as drawn: its route, or the straight line between its sockets. */
  pathOf(wire: SceneWire): Route {
    return pathOf(wire, this.view);
  }

  /** Routes every wire of the scene afresh. */
  tidy(scene: Scene): void {
    const bodies = bodiesOf(scene);
    const routes = routeWires(scene);
    this.kept = new Map();
    for (const wire of scene.wires) {
      const route = routes.get(wire.id);
      if (route) this.kept.set(wire.id, { route, from: wire.from.at, to: wire.to.at, crossings: crossingCount(route, bodies) });
    }
    this.publish();
  }

  /** After the build changed: keeps the routes that still fit it. */
  refresh(scene: Scene): void {
    if (this.kept.size === 0) return;
    const bodies = bodiesOf(scene);
    const next = new Map<WireId, Kept>();
    for (const wire of scene.wires) {
      const kept = this.kept.get(wire.id);
      if (!kept || !samePoint(kept.from, wire.from.at) || !samePoint(kept.to, wire.to.at)) continue;
      if (crossingCount(kept.route, bodies) > kept.crossings) continue;
      next.set(wire.id, kept);
    }
    this.kept = next;
    this.publish();
  }

  private publish(): void {
    this.view = new Map([...this.kept].map(([id, kept]) => [id, kept.route]));
  }
}
