import type { ArenaRef } from './arena.ts';
import type {
  BlueprintId,
  Level,
  PartTypeId,
  PlacedPartId,
  ProfileId,
  SettingId,
  Timestamp,
  Vec2,
  WireId,
} from './common.ts';
import type { PortRef } from './port.ts';

/** The blueprint format version this schema reads and writes. */
export const BLUEPRINT_VERSION = 1;

/** A number setting's value, or a choice setting's option id. */
export type SettingValue = number | string;

/**
 * One part on the canvas. The canvas (workbench) plane is in millimetres, x to the right, y down, with
 * its origin at the canvas centre (see docs/geometry.md). A mounted part's place comes from its mount:
 * its position and rotation must match where the mount puts it (`mount.misplaced` otherwise).
 */
export interface PlacedPart {
  readonly id: PlacedPartId;
  /** The part record's id. */
  readonly part: PartTypeId;
  /** Where the part's frame origin (the centre of its footprint) sits on the canvas, in mm. */
  readonly position: Vec2;
  /** Degrees clockwise on the canvas, in [0, 360). At 0 the part's front points to the canvas's right. */
  readonly rotation: number;
  /** Only values that differ from the record's default; canonical form drops the rest. */
  readonly settings: Readonly<Record<SettingId, SettingValue>>;
}

/**
 * Joins two ports of the same type. Directional wires are written source first: signal out → signal in,
 * drive-out → drive-in, mount → mount point. A power wire has no direction; canonical form writes the
 * lower port reference first (see canonicalizeBlueprint).
 */
export interface Wire {
  readonly id: WireId;
  readonly from: PortRef;
  readonly to: PortRef;
}

/**
 * A mount is a wire from a part's `mount` port to a `mount-point` port on another part (a frame).
 * Snapping a part onto a mount point creates one; it fixes where the part rides on the robot.
 * A drive linkage (drive-out → drive-in) is the other mechanical wire: it carries turning.
 */
export type Mount = Wire;

/**
 * The highest numbers ever given to `p<n>` part ids and `w<n>` wire ids in this blueprint. Ids are never
 * reused: claimPartId and claimWireId give one more and raise the mark, even after the highest is deleted.
 */
export interface HighWater {
  readonly parts: number;
  readonly wires: number;
}

export interface BlueprintMeta {
  /** Opaque UUID v4, kept across edits and syncs. A duplicate gets a new one. Sync's "both kept" keys on it. */
  readonly id: BlueprintId;
  /** The build's name as the child or app gave it: one line, 1–60 characters. Child text, so voice rules do not apply. */
  readonly name: string;
  /** The level the build was made at. */
  readonly level: Level;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
  /** The child's profile, as an opaque UUID v4 the app generates. Omitted when a blueprint is shared (task 5.6). */
  readonly author?: ProfileId;
  readonly highWater: HighWater;
}

/**
 * A saved build: the only persisted build format (ground rule 5). Build mode edits it; Run mode reads a
 * snapshot of it and never writes back (ground rule 4). Serialise with serializeBlueprint.
 */
export interface Blueprint {
  readonly version: 1;
  readonly parts: readonly PlacedPart[];
  readonly wires: readonly Wire[];
  readonly arena: ArenaRef;
  readonly meta: BlueprintMeta;
}
