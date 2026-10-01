import { clean } from './maths.ts';
import type { MechanicalModel, MechanicalState, WorldLayout } from './types.ts';

/**
 * The solver's state as bytes for the Run's snapshot (ground rule 4): a header of little-endian doubles, then the
 * physics engine's own snapshot of the world. Every number is written exactly, with −0 written as 0, so equal states
 * give equal bytes and a restored state is the one that was snapshotted, bit for bit.
 */

/** Marks the format; a change to it is a new number. */
const FORMAT = 1_404_002;

/**
 * A fingerprint of everything a model builds its world from and steps it with: the robot, the arena, the probes and the
 * loose parts, as JSON (whose numbers every engine writes alike), hashed with 32-bit FNV-1a. A snapshot carries it, so a
 * snapshot from another build is refused even when it has as many props and walls (review R-1.4 finding 5).
 */
export const modelPrint = (model: MechanicalModel): number => {
  const text = JSON.stringify([model.robot ?? null, model.arena, model.probes, model.loose, model.looseSupports, model.parts]);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193) >>> 0;
  }
  return hash;
};

export const encodeState = (state: MechanicalState): Uint8Array => {
  const { layout } = state;
  const numbers = [
    FORMAT,
    state.print,
    state.world.length,
    state.velocity.forward,
    state.velocity.left,
    state.velocity.turn,
    state.floorForce.x,
    state.floorForce.y,
    state.fallen ? 1 : 0,
    state.fallen?.pitch ?? 0,
    state.fallen?.roll ?? 0,
    layout.robot ? 1 : 0,
    layout.robot?.body ?? 0,
    layout.robot?.colliders.length ?? 0,
    ...(layout.robot?.colliders ?? []),
    layout.props.length,
    ...layout.props.flatMap((prop) => [prop.body, prop.collider]),
    layout.solids.length,
    ...layout.solids,
    state.touching.length,
    ...state.touching,
  ];
  const head = numbers.length * 8;
  const bytes = new Uint8Array(head + state.world.length);
  const view = new DataView(bytes.buffer);
  numbers.forEach((value, index) => view.setFloat64(index * 8, clean(value), true));
  bytes.set(state.world, head);
  return bytes;
};

/** Reads bytes `encodeState` wrote. Throws when they are not a mechanical state for this model. */
export const decodeState = (model: MechanicalModel, bytes: Uint8Array): MechanicalState => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 0;
  const next = (): number => {
    if (at + 8 > bytes.byteLength) throw new Error('The mechanical snapshot is cut short.');
    const value = view.getFloat64(at, true);
    at += 8;
    return value;
  };
  const count = (): number => {
    const value = next();
    if (!Number.isInteger(value) || value < 0) throw new Error('The mechanical snapshot is not well formed.');
    return value;
  };
  if (next() !== FORMAT) throw new Error('These bytes are not a mechanical snapshot.');
  const print = modelPrint(model);
  if (next() !== print) throw new Error('The mechanical snapshot came from another Run.');
  const worldLength = count();
  const velocity = { forward: next(), left: next(), turn: next() };
  const floorForce = { x: next(), y: next() };
  const fell = next() === 1;
  const fallen = { pitch: next(), roll: next() };
  const hasRobot = next() === 1;
  const robotBody = next();
  const colliders = Array.from({ length: count() }, next);
  const props = Array.from({ length: count() }, () => ({ body: next(), collider: next() }));
  const solids = Array.from({ length: count() }, next);
  const touching = Array.from({ length: count() }, count);
  if (hasRobot !== (model.robot !== undefined) || props.length !== model.arena.props.length || solids.length !== model.arena.solids.length) {
    throw new Error('The mechanical snapshot came from another Run.');
  }
  if (at + worldLength !== bytes.byteLength) throw new Error('The mechanical snapshot is not well formed.');
  const layout: WorldLayout = { ...(hasRobot ? { robot: { body: robotBody, colliders } } : {}), props, solids };
  return {
    print,
    world: bytes.slice(at, at + worldLength),
    layout,
    velocity,
    floorForce,
    ...(fell ? { fallen } : {}),
    touching,
  };
};
