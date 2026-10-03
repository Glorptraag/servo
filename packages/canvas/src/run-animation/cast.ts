// What Run mode can animate in a build, read from the scene and the part records alone (ground rule 1): a part's
// primitives, ports, body and failure modes, never its id, name, family or art. Pure. See docs/run-animation.md.
import type { Effect, FailureModeId, PlacedPartId, Vec2 } from '@servo/schema';
import type { Scene } from '../scene/scene.ts';

/** A part with a `wheel` primitive: its tread turns at the simulated rpm. */
export interface WheelCast {
  readonly radiusMm: number;
}

/** A part with a position actuator: an arm sweeps about its drive port, at the simulated angle. */
export interface ArmCast {
  /** The drive port, in the part's frame (mm). */
  readonly pivot: Vec2;
  /** Where the arm rests when a Run starts: the arm points along the part's +x at this angle. */
  readonly restDeg: number;
}

export interface RunCast {
  /** Every part's body: the root it rides on (itself for a root). Bodies are what `motion` events move. */
  readonly bodyOf: ReadonlyMap<PlacedPartId, PlacedPartId>;
  /** Each body's parts, in the scene's draw order, the body first. */
  readonly bodies: ReadonlyMap<PlacedPartId, readonly PlacedPartId[]>;
  /** The robot's root (schema `robotRoot`). */
  readonly robot?: PlacedPartId;
  readonly wheels: ReadonlyMap<PlacedPartId, WheelCast>;
  readonly arms: ReadonlyMap<PlacedPartId, ArmCast>;
  /** Parts whose load gives light, with its colour (`emits.colour`, as 0xrrggbb). */
  readonly lights: ReadonlyMap<PlacedPartId, number>;
  /** Parts with a `source` primitive: a charge gauge. */
  readonly sources: ReadonlySet<PlacedPartId>;
  /** Parts with a `switch` primitive, and whether the child flips it (manual) or a probe does (contact). */
  readonly switches: ReadonlyMap<PlacedPartId, 'manual' | 'contact'>;
  /** What each of a part's failure modes shows (`shows`): fault visuals follow these, never a failure's id. */
  readonly effects: ReadonlyMap<PlacedPartId, ReadonlyMap<FailureModeId, readonly Effect[]>>;
}

const colourOf = (hex: string): number => Number.parseInt(hex.replace(/^#/, ''), 16);

export const castOf = (scene: Scene): RunCast => {
  const bodyOf = new Map<PlacedPartId, PlacedPartId>();
  for (const part of scene.parts) {
    let at = part;
    for (let guard = 0; at.parent !== undefined && guard <= scene.parts.length; guard++) {
      const parent = scene.partById.get(at.parent);
      if (!parent) break;
      at = parent;
    }
    bodyOf.set(part.id, at.id);
  }
  const bodies = new Map<PlacedPartId, PlacedPartId[]>();
  for (const part of scene.parts) {
    const body = bodyOf.get(part.id) ?? part.id;
    const members = bodies.get(body) ?? [];
    if (body === part.id) members.unshift(part.id);
    else members.push(part.id);
    bodies.set(body, members);
  }
  const wheels = new Map<PlacedPartId, WheelCast>();
  const arms = new Map<PlacedPartId, ArmCast>();
  const lights = new Map<PlacedPartId, number>();
  const sources = new Set<PlacedPartId>();
  const switches = new Map<PlacedPartId, 'manual' | 'contact'>();
  const effects = new Map<PlacedPartId, ReadonlyMap<FailureModeId, readonly Effect[]>>();
  for (const part of scene.parts) {
    const { record } = part;
    for (const primitive of record.behaviour) {
      if (primitive.kind === 'wheel') wheels.set(part.id, { radiusMm: primitive.radiusMm });
      if (primitive.kind === 'actuator' && primitive.mode === 'position') {
        const port = part.ports.find((candidate) => candidate.ref.port === primitive.drive);
        if (port) arms.set(part.id, { pivot: port.local, restDeg: primitive.restDeg });
      }
      if (primitive.kind === 'load' && primitive.emits?.kind === 'light') lights.set(part.id, colourOf(primitive.emits.colour));
      if (primitive.kind === 'source') sources.add(part.id);
      if (primitive.kind === 'switch' && !switches.has(part.id)) switches.set(part.id, primitive.actuation.kind);
    }
    effects.set(part.id, new Map(record.failureModes.map((mode) => [mode.id, mode.shows])));
  }
  return {
    bodyOf,
    bodies,
    ...(scene.root !== undefined ? { robot: scene.root } : {}),
    wheels,
    arms,
    lights,
    sources,
    switches,
    effects,
  };
};
