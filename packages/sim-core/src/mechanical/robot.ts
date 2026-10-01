import { arenaPoseOf, controlId, cosSin, placePoint, spin } from '@servo/schema';
import type { CanvasPose, DrivePort, PlacedPartId, Pose, Primitive, SpeedActuator, Vec2, Vec3 } from '@servo/schema';
import type { BehaviourModel, BehaviourPart } from '../behaviour/index.ts';
import type { GraphPart, SimGraph } from '../graph/index.ts';
import { clean, length } from './maths.ts';
import type { ArenaModel, BodyPoint, Footprint, LooseBody, ProbeModel, RobotModel, SupportModel, WheelDrive, WheelModel } from './types.ts';

/**
 * The robot as a rigid body, read from the schema's geometry (`placeParts` through the graph, `drivePushes`, `robotRoot`):
 * its mass and centre of mass from every part's body, the footprints it collides with, the wheels and supports it rides
 * on, the corners its frame can rest on, and where its contact switches' probes reach. Built once per Run.
 */

const swaps = (yaw: number): boolean => yaw === 90 || yaw === 270;

const speedActuatorOf = (part: BehaviourPart | undefined, primitive: string): SpeedActuator | undefined => {
  const spec = part?.primitives.find((each) => each.id === primitive);
  return spec?.kind === 'actuator' && spec.mode === 'speed' ? spec : undefined;
};

const driveOf = (behaviour: ReadonlyMap<PlacedPartId, BehaviourPart>, part: BehaviourPart, hub: string): WheelDrive | undefined => {
  const route = part.routes.get(hub);
  if (!route || !(route.speed > 0) || !(route.torque > 0)) return undefined;
  const spec = speedActuatorOf(behaviour.get(route.part), route.primitive);
  if (!spec) return undefined;
  return {
    part: route.part,
    primitive: route.primitive,
    speed: route.speed,
    torque: route.torque,
    ratedVolts: spec.ratedVolts,
    startVolts: spec.startVolts,
    noLoadRpm: spec.noLoadRpm,
    stallTorqueNmm: spec.stallTorqueNmm,
    throttle: spec.throttle,
    reverse: spec.reverse,
    whenReversed: spec.whenReversed,
  };
};

/** Where a wheel's tyre meets the floor, in its own frame: below its axle, across the middle of its tread. */
const tyreBottom = (hub: DrivePort, radius: number): Vec3 => {
  if (hub.axis === '+y' || hub.axis === '-y') return { x: hub.at.x, y: 0, z: hub.at.z - radius };
  if (hub.axis === '+x' || hub.axis === '-x') return { x: 0, y: hub.at.y, z: hub.at.z - radius };
  return { x: 0, y: 0, z: 0 };
};

const wheelsOf = (part: GraphPart, settled: BehaviourPart, behaviour: ReadonlyMap<PlacedPartId, BehaviourPart>, graph: SimGraph): WheelModel[] =>
  settled.primitives.flatMap((spec: Primitive): WheelModel[] => {
    if (spec.kind !== 'wheel') return [];
    const hub = part.ports.get(spec.hub)?.spec;
    if (!hub || hub.type !== 'mechanical' || (hub.role !== 'drive-in' && hub.role !== 'drive-out')) return [];
    const placement = part.placement.placement;
    const turning = spin(placement, hub.axis);
    const flat = length(turning.x, turning.y);
    // The hub's positive turning rolls the wheel along (spin.y, −spin.x): a wheel turning right-handed about an axle
    // pointing left rolls forward. An axle standing upright rolls nowhere.
    const upright = !(flat > 0.5);
    const roll: Vec2 = upright ? { x: 1, y: 0 } : { x: clean(turning.y / flat), y: clean(-turning.x / flat) };
    const axle: Vec2 = { x: clean(-roll.y), y: clean(roll.x) };
    const drive = driveOf(behaviour, settled, spec.hub);
    const pushed = graph.pushes.find((each) => each.wheel === part.id)?.push ?? 0;
    // drivePushes says which way along the robot's +x; across it, the drive route's own sense stands.
    const along = roll.y === 0 ? pushed * roll.x : drive ? 1 : 0;
    const push = upright || !drive ? 0 : along > 0 ? 1 : along < 0 ? -1 : 0;
    return [
      {
        part: part.id,
        primitive: spec.id,
        radiusMm: spec.radiusMm,
        grip: spec.grip,
        contact: placePoint(placement, tyreBottom(hub, spec.radiusMm)),
        roll,
        axle,
        rollSign: upright ? 0 : 1,
        push,
        ...(drive && push !== 0 ? { drive } : {}),
      },
    ];
  });

/** The robot: its root part and every part held under it. Undefined when no part holds another. */
const robotOf = (graph: SimGraph, behaviour: ReadonlyMap<PlacedPartId, BehaviourPart>, start: Pose): RobotModel | undefined => {
  const root = graph.root;
  if (root === undefined) return undefined;
  const parts = [...graph.parts.values()].filter((part) => part.placement.root === root);
  let kilograms = 0;
  let mx = 0;
  let my = 0;
  let mz = 0;
  const masses: { readonly kg: number; readonly at: Vec3; readonly spread: number }[] = [];
  const footprints: Footprint[] = [];
  const wheels: WheelModel[] = [];
  const supports: SupportModel[] = [];
  const bodyPoints: BodyPoint[] = [];
  for (const part of parts) {
    const { body } = part.record;
    const placement = part.placement.placement;
    const kg = body.grams / 1000;
    const at = placePoint(placement, body.centreOfMass);
    kilograms += kg;
    mx += kg * at.x;
    my += kg * at.y;
    mz += kg * at.z;
    masses.push({ kg, at, spread: (body.size.x * body.size.x + body.size.y * body.size.y) / 12 });
    const [hx, hy] = swaps(placement.yaw) ? [body.size.y / 2, body.size.x / 2] : [body.size.x / 2, body.size.y / 2];
    const centre = placePoint(placement, { x: 0, y: 0, z: 0 });
    footprints.push({ part: part.id, x: centre.x, y: centre.y, hx, hy });
    const settled = behaviour.get(part.id);
    const own = settled ? wheelsOf(part, settled, behaviour, graph) : [];
    wheels.push(...own);
    const fixedSupports = (settled?.primitives ?? []).flatMap((spec) =>
      spec.kind === 'support' && settled?.fixed.has(spec.mount) === true ? [spec] : [],
    );
    for (const spec of fixedSupports) {
      supports.push({ part: part.id, primitive: spec.id, contact: placePoint(placement, { x: 0, y: 0, z: 0 }), rollingFriction: spec.rollingFriction });
    }
    // A wheel's tyre and a support's foot are where those parts meet the floor; any other part can rest on its box's corners.
    if (own.length === 0 && fixedSupports.length === 0) {
      for (const [sx, sy] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ] as const) {
        const corner = placePoint(placement, { x: (sx * body.size.x) / 2, y: (sy * body.size.y) / 2, z: 0 });
        bodyPoints.push({ part: part.id, x: corner.x, y: corner.y, z: corner.z });
      }
    }
  }
  if (!(kilograms > 0)) return undefined;
  const centreOfMass = { x: mx / kilograms, y: my / kilograms, z: mz / kilograms };
  let inertia = 0;
  for (const mass of masses) {
    const dx = mass.at.x - centreOfMass.x;
    const dy = mass.at.y - centreOfMass.y;
    inertia += mass.kg * (mass.spread + dx * dx + dy * dy);
  }
  let bottom = Number.POSITIVE_INFINITY;
  for (const z of [...wheels.map((wheel) => wheel.contact.z), ...supports.map((support) => support.contact.z), ...bodyPoints.map((point) => point.z)]) {
    if (z < bottom) bottom = z;
  }
  return {
    root,
    parts: parts.map((part) => part.id),
    kilograms,
    centreOfMass,
    inertia,
    gyration: Math.sqrt(inertia / kilograms),
    footprints,
    wheels,
    supports,
    bodyPoints,
    bottom: Number.isFinite(bottom) ? bottom : 0,
    start,
  };
};

/** A point of a part that lies where it was placed, in the arena: its frame turned by its arena heading, mirrored as drawn. */
const arenaPoint = (pose: Pose, mirrored: boolean, point: Vec2): Vec2 => {
  const [cos, sin] = cosSin(pose.heading);
  const y = mirrored ? -point.y : point.y;
  return { x: pose.x + cos * point.x - sin * y, y: pose.y + sin * point.x + cos * y };
};

/**
 * The mechanical solver's view of a Run: the robot, the parts lying loose where they were placed (D19), the contact
 * switches' probes and the arena. Pure: the same behaviour model and arena give the same model.
 */
export const robotParts = (
  behaviourModel: BehaviourModel,
  arena: ArenaModel,
): {
  readonly robot?: RobotModel;
  readonly loose: readonly LooseBody[];
  readonly probes: readonly ProbeModel[];
  readonly parts: readonly PlacedPartId[];
  readonly onRobot: ReadonlySet<PlacedPartId>;
  readonly looseSupports: readonly PlacedPartId[];
} => {
  const graph = behaviourModel.graph;
  const behaviour = new Map(behaviourModel.parts.map((part) => [part.id, part]));
  const robot = robotOf(graph, behaviour, arena.start);
  const onRobot = new Set(robot?.parts ?? []);
  const rootPart = robot ? graph.parts.get(robot.root) : undefined;
  // With no robot, the canvas origin stands in for its root (packages/schema/docs/geometry.md).
  const rootCanvas: CanvasPose = rootPart ? { x: rootPart.placed.position.x, y: rootPart.placed.position.y, rotation: rootPart.placed.rotation } : { x: 0, y: 0, rotation: 0 };
  const poseOf = (part: GraphPart): Pose => arenaPoseOf(arena.start, rootCanvas, { x: part.placed.position.x, y: part.placed.position.y, rotation: part.placed.rotation });

  const loose: LooseBody[] = [];
  const probes: ProbeModel[] = [];
  const looseSupports: PlacedPartId[] = [];
  for (const part of graph.parts.values()) {
    if (!onRobot.has(part.id) && part.placement.root === part.id) loose.push({ part: part.id, pose: poseOf(part) });
    const settled = behaviour.get(part.id);
    if ((settled?.primitives ?? []).some((spec) => spec.kind === 'support' && !settled?.fixed.has(spec.mount))) looseSupports.push(part.id);
    for (const spec of settled?.primitives ?? []) {
      if (spec.kind !== 'switch' || spec.actuation.kind !== 'contact') continue;
      const { from, to } = spec.actuation.probe;
      const placement = part.placement.placement;
      const base = {
        part: part.id,
        primitive: spec.id,
        control: controlId(part.id, spec.id),
        normally: spec.actuation.normally,
      };
      if (onRobot.has(part.id)) {
        const a = placePoint(placement, { x: from.x, y: from.y, z: 0 });
        const b = placePoint(placement, { x: to.x, y: to.y, z: 0 });
        probes.push({ ...base, onRobot: true, from: { x: a.x, y: a.y }, to: { x: b.x, y: b.y } });
      } else {
        const pose = poseOf(part);
        probes.push({ ...base, onRobot: false, from: arenaPoint(pose, placement.mirrored, from), to: arenaPoint(pose, placement.mirrored, to) });
      }
    }
  }
  return {
    ...(robot ? { robot } : {}),
    loose,
    probes,
    parts: [...graph.parts.keys()],
    onRobot,
    looseSupports,
  };
};
