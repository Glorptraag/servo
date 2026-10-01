import type { KitId, Level, PartTypeId, Text } from './common.ts';
import type { PartFamily } from './taxonomy.ts';

export interface KitEntry {
  readonly part: PartTypeId;
  /** Whole number, at least 1. */
  readonly quantity: number;
}

/** One group of tiles in the part tray. */
export interface TrayGroup {
  readonly family: PartFamily;
  /** In tray order; each part belongs to `family`. */
  readonly parts: readonly PartTypeId[];
}

/**
 * A curated bag of parts for a level or a job, like the box a real kit comes in (brief Section 4).
 * Every entry appears in exactly one tray group, and every tray part is an entry.
 */
export interface Kit {
  readonly id: KitId;
  /** A real-word name, for example `Rolling Start`. */
  readonly name: Text;
  readonly level: Level;
  /** No part listed twice. */
  readonly parts: readonly KitEntry[];
  /** Tray grouping by family, in tray order; no family twice. */
  readonly tray: readonly TrayGroup[];
}
