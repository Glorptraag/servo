import { BLUEPRINT_VERSION } from '../types/blueprint.ts';
import type { Blueprint } from '../types/blueprint.ts';
import { validateBlueprintShape } from '../validate/blueprint.ts';
import { runMigrations } from './runner.ts';
import type { MigrationResult, MigrationStep } from './runner.ts';
import { v0ToV1 } from './v0-to-v1.ts';

/**
 * Every blueprint migration, in order, one step per version: version 0 → 1 now, and 1 → 2 appended
 * after it when version 2 arrives. A shipped step is never edited. See docs/migrations.md.
 */
export const BLUEPRINT_MIGRATIONS: readonly MigrationStep[] = [v0ToV1];

// Fails to compile when BLUEPRINT_VERSION and the Blueprint type's version drift apart.
const CURRENT: Blueprint['version'] = BLUEPRINT_VERSION;

/**
 * Brings a stored blueprint of any earlier version up to the current one, then checks its structure with
 * validateBlueprintShape. Never throws: it returns the blueprint and the version it was stored at, or
 * every reason it could not.
 * - A version newer than this schema reads is refused as `blueprint.newer_version`, never guessed at:
 *   an older app can meet a newer blueprint after sync.
 * - A current blueprint runs no step and comes back as the object given, with `from` equal to
 *   BLUEPRINT_VERSION. The same stored document always migrates to the same blueprint.
 * - It needs no catalogue, so it checks structure only. Check content with validateBlueprint, and put
 *   the result in canonical form with canonicalizeBlueprint before saving it.
 */
export const migrateBlueprint = (value: unknown): MigrationResult<Blueprint> =>
  runMigrations(value, BLUEPRINT_MIGRATIONS, CURRENT, validateBlueprintShape);
