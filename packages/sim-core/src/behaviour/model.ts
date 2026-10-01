import type { Blueprint, Catalogue, PlacedPartId, PortId, Primitive } from '@servo/schema';
import { buildGraph } from '../graph/index.ts';
import type { GraphPart, SimGraph } from '../graph/index.ts';
import { settledPrimitives } from './params.ts';
import type { BehaviourModel, BehaviourPart, DriveRoute, PrimitiveRef } from './types.ts';

/** A port as `<placed part> <port>`; ids are slugs, so the space never clashes. */
const keyOf = (part: PlacedPartId, port: PortId): string => `${part} ${port}`;

/** The ports of a part that are joined to another part's port (a drive linkage or a mount). */
const joinedPorts = (part: GraphPart, role: 'drive-in' | 'mount'): ReadonlySet<PortId> =>
  new Set(
    [...part.ports.values()]
      .filter((port) => port.spec.type === 'mechanical' && port.spec.role === role && port.joined.length > 0)
      .map((port) => port.spec.id),
  );

/**
 * Every drive port's route from the actuator that turns it. An actuator's drive starts a route; a linkage
 * carries it from a drive-out to a drive-in unchanged; a gearbox carries it from its input to its output at
 * 1/ratio the speed and ratio × efficiency the torque, or not at all while its mount is loose. A loop of
 * gearboxes with no actuator in it turns nothing.
 */
const routesOf = (graph: SimGraph, primitives: ReadonlyMap<PlacedPartId, readonly Primitive[]>, fixed: ReadonlyMap<PlacedPartId, ReadonlySet<PortId>>) => {
  const known = new Map<string, DriveRoute | undefined>();
  const visiting = new Set<string>();
  const routeOf = (part: PlacedPartId, port: PortId): DriveRoute | undefined => {
    const key = keyOf(part, port);
    if (known.has(key)) return known.get(key);
    if (visiting.has(key)) return undefined;
    visiting.add(key);
    let route: DriveRoute | undefined;
    for (const spec of primitives.get(part) ?? []) {
      if (spec.kind === 'actuator' && spec.drive === port) {
        route = { part, primitive: spec.id, speed: 1, torque: 1 };
      } else if (spec.kind === 'ratio' && spec.output === port) {
        const input = routeOf(part, spec.input);
        const turns = fixed.get(part)?.has(spec.mount) === true;
        if (input) route = { ...input, speed: turns ? input.speed / spec.ratio : 0, torque: turns ? input.torque * spec.ratio * spec.efficiency : 0 };
      } else if ((spec.kind === 'ratio' && spec.input === port) || (spec.kind === 'wheel' && spec.hub === port)) {
        const from = graph.parts.get(part)?.ports.get(port)?.joined[0];
        if (from) route = routeOf(from.part, from.port);
      }
    }
    visiting.delete(key);
    known.set(key, route);
    return route;
  };
  return routeOf;
};

/** The ports a primitive turns or is turned through. */
const drivePortsOf = (spec: Primitive): readonly PortId[] => {
  if (spec.kind === 'actuator') return [spec.drive];
  if (spec.kind === 'ratio') return [spec.input, spec.output];
  if (spec.kind === 'wheel') return [spec.hub];
  return [];
};

/**
 * The behaviour runtime's view of a graph: each part's primitives with its settings applied, which of its
 * mounts are fixed and drive-ins linked, and the route from an actuator to each drive port. A Run reads a
 * snapshot that never changes, so this is made once when the Run starts. Pure: the same graph gives the same model.
 */
export const behaviourModel = (graph: SimGraph): BehaviourModel => {
  const ids = [...graph.parts.keys()];
  const primitives = new Map(ids.map((id) => [id, settledPrimitives((graph.parts.get(id) as GraphPart).record, (graph.parts.get(id) as GraphPart).placed)]));
  const fixed = new Map(ids.map((id) => [id, joinedPorts(graph.parts.get(id) as GraphPart, 'mount')]));
  const routeOf = routesOf(graph, primitives, fixed);
  const parts: BehaviourPart[] = ids.map((id) => {
    const part = graph.parts.get(id) as GraphPart;
    const settled = primitives.get(id) ?? [];
    const routes = new Map<PortId, DriveRoute>();
    for (const port of settled.flatMap(drivePortsOf)) {
      const route = routeOf(id, port);
      if (route) routes.set(port, route);
    }
    return { id, record: part.record, primitives: settled, fixed: fixed.get(id) ?? new Set(), linked: joinedPorts(part, 'drive-in'), routes };
  });
  const arms: PrimitiveRef[] = parts.flatMap((part) =>
    part.primitives.flatMap((spec) => (spec.kind === 'actuator' && spec.mode === 'position' ? [{ part: part.id, primitive: spec.id }] : [])),
  );
  return { graph, parts, arms };
};

/**
 * The model of a blueprint, through the graph builder: for callers outside sim-core, such as the behaviour
 * fixtures in packages/tools, which cannot reach the graph. Throws the graph's GraphInputError for schema-invalid input.
 */
export const behaviourModelOf = (blueprint: Blueprint, catalogue: Catalogue): BehaviourModel => behaviourModel(buildGraph(blueprint, catalogue));
