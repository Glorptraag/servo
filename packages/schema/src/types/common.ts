/**
 * The schema's own version. A minor bump is additive: a new part family, a new behaviour primitive,
 * a new optional field. Data that was valid stays valid. A major bump changes `Blueprint.version`
 * and needs a migration (packages/schema/src/migrate, task 0.3).
 */
export const SCHEMA_VERSION = '1.0';

/** The five levels of the knowledge ladder (brief Section 2). */
export type Level = 1 | 2 | 3 | 4 | 5;

/** The skill each level teaches. */
export type Skill = 'name' | 'connect' | 'configure' | 'diagnose' | 'design';

export interface LevelInfo {
  readonly level: Level;
  readonly label: string;
  readonly skill: Skill;
  readonly skillLabel: string;
}

/** Levels 1–5 in order, each mapped to its skill. Levels 1–2 are launch scope (ground rule 10). */
export const LEVELS: readonly LevelInfo[] = [
  { level: 1, label: 'Parts', skill: 'name', skillLabel: 'Name' },
  { level: 2, label: 'Circuits', skill: 'connect', skillLabel: 'Connect' },
  { level: 3, label: 'Control', skill: 'configure', skillLabel: 'Configure' },
  { level: 4, label: 'Systems', skill: 'diagnose', skillLabel: 'Diagnose' },
  { level: 5, label: 'Design', skill: 'design', skillLabel: 'Design' },
];

/** A point in a plane, in millimetres unless a field says otherwise. */
export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

/** A point in space, in millimetres. */
export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** A place and heading on the arena floor: millimetres, and degrees counter-clockwise from +x in [0, 360). */
export interface Pose {
  readonly x: number;
  readonly y: number;
  readonly heading: number;
}

/**
 * Identifier formats. Slugs match `^[a-z][a-z0-9]*(-[a-z0-9]+)*$` (at most 64 characters).
 * Opaque ids match `^[A-Za-z0-9_-]{16,128}$` and never carry a name.
 */
export type PartTypeId = string;
export type PlacedPartId = string;
export type WireId = string;
export type PortId = string;
export type PrimitiveId = string;
export type NeedId = string;
export type SettingId = string;
export type FailureModeId = string;
export type ArenaPresetId = string;
/** A wall, zone, floor line, ramp or prop: one id space per arena. */
export type ArenaFeatureId = string;
export type KitId = string;
export type ChallengeId = string;
/** Opaque. */
export type RunId = string;
/** Opaque. A profile id never carries a child's name. */
export type ProfileId = string;

/** A swap-registry key, slug segments joined by '/', for example `part/dc-motor`. Art is never embedded. */
export type AssetKey = string;

/** `#rrggbb`, lower case. */
export type HexColour = string;

/** UTC, exactly as `Date.prototype.toISOString` writes it: `2026-10-01T09:30:00.000Z`. */
export type Timestamp = string;

/**
 * System text: one line, no leading or trailing space, no exclamation mark (ground rule 7).
 * Written in the voice of brief Section 12.
 */
export type Text = string;
