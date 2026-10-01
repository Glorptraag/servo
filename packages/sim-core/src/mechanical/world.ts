import { ColliderDesc, ConvexPolygon, RigidBodyDesc, RigidBodyType, Segment, World, init } from '@dimforge/rapier2d-deterministic-compat';
import type { Collider, RigidBody, Shape } from '@dimforge/rapier2d-deterministic-compat';
import type { Vec2 } from '@servo/schema';
import { RADIANS_PER_DEGREE, clean, length, magnitude, wrapRadians } from './maths.ts';
import { GRAVITY, hullOf } from './stance.ts';
import type { Velocity } from './drive.ts';
import type { MechanicalModel, RobotModel, WorldLayout } from './types.ts';

/**
 * The physics engine's side of the solver: Rapier 2D's deterministic build (docs/stack.md). It holds the robot as one
 * rigid body made of its parts' footprints, the props, and the walls, floor edges and ledges, and stops the robot at
 * them and lets it push props. Its profiler stays off and its timing is never read. The world lives in the solver's
 * state as the engine's own snapshot, so every tick restores it, steps it and snapshots it again: the state stays plain
 * bytes, and a Run restored from a snapshot replays bit for bit.
 */

/** Millimetres per metre: the engine's length unit, so its tolerances suit a robot about 160 mm long. */
const LENGTH_UNIT = 1000;

/** A probe or a contact within this distance touches, mm. */
export const TOUCH_MM = 1;

let ready: Promise<void> | undefined;
let loaded = false;

/**
 * Loads the physics engine's WebAssembly. Await it once before the first world (D11: the app does so at the first
 * Run). Later calls return the same promise; a failed load can be tried again.
 */
export const initMechanics = (): Promise<void> => {
  ready ??= init().then(
    () => {
      loaded = true;
    },
    (error: unknown) => {
      ready = undefined;
      throw error;
    },
  );
  return ready;
};

/** Whether `initMechanics` has finished. */
export const mechanicsReady = (): boolean => loaded;

const needEngine = (): void => {
  if (!loaded) throw new Error('The physics engine is not loaded: await initMechanics() once before the first Run.');
};

const configure = (world: World, substep: number): void => {
  world.lengthUnit = LENGTH_UNIT;
  world.timestep = substep;
  world.profilerEnabled = false;
};

/** Builds the world for a model: the robot, then the props in id order, then one fixed body holding every solid. */
export const buildWorld = (model: MechanicalModel, substep: number): { readonly bytes: Uint8Array; readonly layout: WorldLayout } => {
  needEngine();
  const world = new World({ x: 0, y: 0 });
  try {
    configure(world, substep);
    let robotLayout: WorldLayout['robot'];
    const robot = model.robot;
    if (robot) {
      const body = world.createRigidBody(
        RigidBodyDesc.dynamic()
          .setTranslation(robot.start.x, robot.start.y)
          .setRotation(robot.start.heading * RADIANS_PER_DEGREE)
          .setCanSleep(false)
          .setAdditionalMassProperties(robot.kilograms, { x: robot.centreOfMass.x, y: robot.centreOfMass.y }, robot.inertia),
      );
      const colliders = robot.footprints
        .filter((print) => print.hx > 0 && print.hy > 0)
        .map((print) => world.createCollider(ColliderDesc.cuboid(print.hx, print.hy).setTranslation(print.x, print.y).setDensity(0).setFriction(0).setRestitution(0), body).handle);
      body.recomputeMassPropertiesFromColliders();
      robotLayout = { body: body.handle, colliders };
    }
    // Every prop starts at rest, so every prop starts fixed. A free one keeps its mass (from its collider's density) for
    // when a push beats its floor friction and it slides (`settleProps`).
    const props = model.arena.props.map((prop) => {
      const desc = RigidBodyDesc.fixed().setCanSleep(false).setTranslation(prop.at.x, prop.at.y).setRotation(prop.at.heading * RADIANS_PER_DEGREE);
      const body = world.createRigidBody(desc);
      const area = prop.shape === 'cylinder' ? Math.PI * prop.hx * prop.hx : 4 * prop.hx * prop.hy;
      const shape = prop.shape === 'cylinder' ? ColliderDesc.ball(prop.hx) : ColliderDesc.cuboid(prop.hx, prop.hy);
      const collider = world.createCollider(shape.setDensity(prop.fixed || !(area > 0) ? 0 : prop.kilograms / area).setFriction(0).setRestitution(0), body);
      body.recomputeMassPropertiesFromColliders();
      return { body: body.handle, collider: collider.handle };
    });
    const ground = world.createRigidBody(RigidBodyDesc.fixed());
    const solids = model.arena.solids.map((solid) => {
      const points = new Float32Array(solid.corners.flatMap((corner) => [corner.x, corner.y]));
      const desc = ColliderDesc.convexHull(points);
      if (!desc) throw new Error(`The ${solid.kind} '${solid.id}' has no area.`);
      return world.createCollider(desc.setFriction(0).setRestitution(0), ground).handle;
    });
    return { bytes: world.takeSnapshot(), layout: { ...(robotLayout ? { robot: robotLayout } : {}), props, solids } };
  } finally {
    world.free();
  }
};

/** The world a state holds, ready to step. The caller frees it. */
export const openWorld = (bytes: Uint8Array, substep: number): World => {
  needEngine();
  const world = World.restoreSnapshot(bytes);
  configure(world, substep);
  return world;
};

/** A body the layout names. */
export const bodyOf = (world: World, handle: number): RigidBody => {
  const body = world.getRigidBody(handle);
  if (!body) throw new Error('The physics world does not match its layout.');
  return body;
};

const colliderOf = (world: World, handle: number): Collider => {
  const collider = world.getCollider(handle);
  if (!collider) throw new Error('The physics world does not match its layout.');
  return collider;
};

/**
 * A sliding prop moving slower than this, mm/s (its turning counted at its radius of gyration), has come to rest and is
 * held by its floor friction again.
 */
const PROP_REST_MM_S = 0.5;

/** A free prop's floor friction, μ m g, in the engine's units (kg·mm/s²). */
const floorGrip = (model: MechanicalModel, kilograms: number): number => LENGTH_UNIT * model.arena.friction * GRAVITY * kilograms;

/** A free prop's pose before a substep, so its velocity can be read from how far it moved. */
export interface PropMark {
  readonly x: number;
  readonly y: number;
  readonly angle: number;
}

/** A free prop the robot touches or can reach within a substep, by its index, in the arena frame. */
export interface PropTouch {
  readonly index: number;
  /** Unit normal from the robot into it. */
  readonly normal: Vec2;
  /** How far apart they are, mm: 0 when touching. */
  readonly gap: number;
  /** Its own speed along the normal, mm/s, and whether it slides (false: at rest, held by its friction). */
  readonly speed: number;
  readonly sliding: boolean;
  /** μ × its weight, N. */
  readonly limit: number;
  readonly kilograms: number;
}

/** How far the robot reaches from its centre of mass, mm. */
const reachOf = (robot: RobotModel): number =>
  robot.footprints.reduce(
    (most, print) => Math.max(most, length(magnitude(print.x - robot.centreOfMass.x) + print.hx, magnitude(print.y - robot.centreOfMass.y) + print.hy)),
    0,
  );

/**
 * The free props the robot touches as a substep begins, or can reach in it at the speeds they both have: within TOUCH_MM
 * plus that travel. The nearest of the robot's colliders gives each its gap and normal. In prop order.
 */
export const propTouches = (world: World, model: MechanicalModel, layout: WorldLayout, velocity: Velocity, seconds: number): readonly PropTouch[] => {
  const robot = model.robot;
  const entry = layout.robot;
  if (!robot || !entry) return [];
  const com = bodyOf(world, entry.body).worldCom();
  const reach = reachOf(robot);
  const robotSpeed = length(velocity.forward, velocity.left) + magnitude(velocity.turn) * reach;
  const touches: PropTouch[] = [];
  model.arena.props.forEach((prop, index) => {
    const handles = layout.props[index];
    if (prop.fixed || !handles) return;
    const body = bodyOf(world, handles.body);
    const sliding = body.isDynamic();
    const own = sliding ? body.linvel() : { x: 0, y: 0 };
    const margin = TOUCH_MM + (robotSpeed + length(own.x, own.y)) * seconds;
    const at = body.translation();
    if (length(at.x - com.x, at.y - com.y) > reach + prop.reach + margin) return;
    const other = colliderOf(world, handles.collider);
    let gap = Number.POSITIVE_INFINITY;
    let normal: Vec2 = { x: 0, y: 0 };
    for (const handle of entry.colliders) {
      const contact = colliderOf(world, handle).contactCollider(other, margin);
      if (contact && contact.distance <= margin && contact.distance < gap) {
        gap = contact.distance;
        normal = { x: contact.normal1.x, y: contact.normal1.y };
      }
    }
    if (gap === Number.POSITIVE_INFINITY) return;
    touches.push({
      index,
      normal,
      gap: Math.max(0, gap),
      speed: clean(own.x * normal.x + own.y * normal.y),
      sliding,
      limit: floorGrip(model, prop.kilograms) / LENGTH_UNIT,
      kilograms: prop.kilograms,
    });
  });
  return touches;
};

/** What the robot's drive decided for the props it reaches this substep, by index (drive.ts `PushOutcome`). */
export interface PropPushes {
  /** Held still by their friction against its push. */
  readonly held: ReadonlySet<number>;
  /** Pushed along with it: each one's velocity, mm/s, arena frame. */
  readonly pushed: ReadonlyMap<number, Vec2>;
}

/**
 * Before a substep, each free prop's kind for the step (review R-1.4 finding 2):
 * - held by its floor friction against the robot's push: fixed, so the robot cannot move it;
 * - pushed along by the robot: sliding at the speed the robot's solve gave them both, its friction already in that solve;
 * - otherwise a sliding prop has the floor's friction as a force and a torque the step's solver sees: μ m g against its
 *   motion, and that at its radius of gyration against its turning, never more than stops it within the substep;
 * - a prop at rest stays fixed.
 * Gives each free prop's pose, to read its velocity from after the step.
 */
export const brakeProps = (world: World, model: MechanicalModel, layout: WorldLayout, seconds: number, pushes: PropPushes): readonly (PropMark | undefined)[] =>
  model.arena.props.map((prop, index) => {
    const entry = layout.props[index];
    if (prop.fixed || !entry) return undefined;
    const body = bodyOf(world, entry.body);
    const at = body.translation();
    const mark = { x: at.x, y: at.y, angle: body.rotation() };
    body.resetForces(true);
    body.resetTorques(true);
    if (pushes.held.has(index)) {
      if (body.isDynamic()) body.setBodyType(RigidBodyType.Fixed, true);
      return mark;
    }
    const pushed = pushes.pushed.get(index);
    if (pushed) {
      if (!body.isDynamic()) {
        body.setBodyType(RigidBodyType.Dynamic, true);
        body.setAngvel(0, true);
      }
      body.setLinvel({ x: clean(pushed.x), y: clean(pushed.y) }, true);
    }
    if (!body.isDynamic()) return mark;
    const grip = floorGrip(model, prop.kilograms);
    const velocity = body.linvel();
    const speed = length(velocity.x, velocity.y);
    if (speed > 0 && !pushed) {
      const force = Math.min(grip, (prop.kilograms * speed) / seconds);
      body.addForce({ x: clean((-force * velocity.x) / speed), y: clean((-force * velocity.y) / speed) }, true);
    }
    const spin = body.angvel();
    if (spin !== 0) {
      const torque = Math.min(grip * prop.gyration, (prop.kilograms * prop.gyration * prop.gyration * magnitude(spin)) / seconds);
      body.addTorque(clean(-Math.sign(spin) * torque), true);
    }
    return mark;
  });

/** The force the bodies touching a collider pushed it with in the last step, from the solver's contact impulses. */
const pushOn = (world: World, handle: number, seconds: number): Vec2 => {
  const collider = colliderOf(world, handle);
  const near: Collider[] = [];
  world.contactPairsWith(collider, (other) => {
    near.push(other);
  });
  let x = 0;
  let y = 0;
  for (const other of near) {
    world.contactPair(collider, other, (manifold, flipped) => {
      // The normal points from the pair's first collider to its second: away from the prop unless the pair is flipped.
      const normal = manifold.normal();
      const sign = flipped ? 1 : -1;
      for (let i = 0; i < manifold.numContacts(); i += 1) {
        const impulse = manifold.contactImpulse(i);
        x += sign * normal.x * impulse;
        y += sign * normal.y * impulse;
      }
    });
  }
  return { x: x / seconds, y: y / seconds };
};

/**
 * After a substep: a free prop at rest is a fixed body, held by its floor friction (static friction is μ too). If another
 * prop pushed it harder than μ m g, it breaks away and slides from the next substep; the robot's own push was settled in
 * its solve. A sliding prop takes the velocity it actually moved at (the engine's own record is not physical in a stack
 * of contacts), and once slower than PROP_REST_MM_S, with the robot not pushing it, it is at rest and fixed again. The
 * engine keeps each prop's kind in its snapshot.
 */
export const settleProps = (world: World, model: MechanicalModel, layout: WorldLayout, marks: readonly (PropMark | undefined)[], seconds: number, pushes: PropPushes): void => {
  model.arena.props.forEach((prop, index) => {
    const mark = marks[index];
    const entry = layout.props[index];
    if (!mark || !entry) return;
    const body = bodyOf(world, entry.body);
    if (!body.isDynamic()) {
      if (pushes.held.has(index)) return;
      const push = pushOn(world, entry.collider, seconds);
      if (length(push.x, push.y) > floorGrip(model, prop.kilograms)) {
        body.setBodyType(RigidBodyType.Dynamic, true);
        body.setLinvel({ x: 0, y: 0 }, true);
        body.setAngvel(0, true);
      }
      return;
    }
    const at = body.translation();
    const vx = (at.x - mark.x) / seconds;
    const vy = (at.y - mark.y) / seconds;
    const turn = wrapRadians(body.rotation() - mark.angle) / seconds;
    if (!pushes.pushed.has(index) && length(vx, vy) + magnitude(turn) * prop.gyration < PROP_REST_MM_S) {
      body.setBodyType(RigidBodyType.Fixed, true);
      return;
    }
    body.setLinvel({ x: clean(vx), y: clean(vy) }, true);
    body.setAngvel(clean(turn), true);
  });
};

/** Each obstacle's collider handle, by its index: the solids, then the props. */
const obstacleHandles = (layout: WorldLayout): readonly number[] => [...layout.solids, ...layout.props.map((prop) => prop.collider)];

interface Box {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

const boxOf = (points: readonly Vec2[], margin: number): Box => {
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    x0 = Math.min(x0, point.x);
    y0 = Math.min(y0, point.y);
    x1 = Math.max(x1, point.x);
    y1 = Math.max(y1, point.y);
  }
  return { x0: x0 - margin, y0: y0 - margin, x1: x1 + margin, y1: y1 + margin };
};

const overlap = (a: Box, b: Box): boolean => a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;

/** Each obstacle's box now: the solids' from their corners, the props' from where they are and how far they reach. */
export const obstacleBoxes = (world: World, model: MechanicalModel, layout: WorldLayout): readonly Box[] => [
  ...model.arena.solids.map((solid) => boxOf(solid.corners, 0)),
  ...model.arena.props.map((prop, index) => {
    const entry = layout.props[index];
    const at = entry ? bodyOf(world, entry.body).translation() : { x: prop.at.x, y: prop.at.y };
    return boxOf([at], prop.reach);
  }),
];

/**
 * Whether a probe touches a wall or prop anywhere along its travel in a substep: the region it swept from `before` to
 * `after` (two segments' hull), tested against every obstacle within reach. A probe that did not move is its segment.
 */
export const probeTouches = (world: World, layout: WorldLayout, boxes: readonly Box[], before: readonly [Vec2, Vec2], after: readonly [Vec2, Vec2]): boolean => {
  const corners = [before[0], before[1], after[0], after[1]];
  const hull = hullOf(corners);
  let swept = 0;
  for (let i = 0; i < hull.length; i += 1) {
    const a = hull[i] as Vec2;
    const b = hull[(i + 1) % hull.length] as Vec2;
    swept += a.x * b.y - b.x * a.y;
  }
  const shape: Shape =
    hull.length >= 3 && swept / 2 > 0.01
      ? new ConvexPolygon(new Float32Array(hull.flatMap((point) => [point.x, point.y])), true)
      : new Segment({ x: after[0].x, y: after[0].y }, { x: after[1].x, y: after[1].y });
  const reach = boxOf(corners, TOUCH_MM);
  const handles = obstacleHandles(layout);
  for (let index = 0; index < handles.length; index += 1) {
    const box = boxes[index];
    if (!box || !overlap(box, reach)) continue;
    const contact = colliderOf(world, handles[index] as number).contactShape(shape, { x: 0, y: 0 }, 0, TOUCH_MM);
    if (contact && contact.distance <= TOUCH_MM) return true;
  }
  return false;
};

/**
 * The obstacles the robot touches now, by index (solids, then props), ascending. The engine's broad phase names the
 * pairs near enough to check; each is then measured where the bodies are now, since a contact manifold's distances
 * date from before the last substep moved them.
 */
export const robotTouching = (world: World, layout: WorldLayout): readonly number[] => {
  const robot = layout.robot;
  if (!robot) return [];
  const indexOf = new Map(obstacleHandles(layout).map((handle, index) => [handle, index]));
  const touching = new Set<number>();
  for (const handle of robot.colliders) {
    const collider = colliderOf(world, handle);
    const near: Collider[] = [];
    world.contactPairsWith(collider, (other) => {
      near.push(other);
    });
    for (const other of near) {
      const index = indexOf.get(other.handle);
      if (index === undefined || touching.has(index)) continue;
      const contact = collider.contactCollider(other, TOUCH_MM);
      if (contact && contact.distance <= TOUCH_MM) touching.add(index);
    }
  }
  return [...touching].sort((a, b) => a - b);
};
