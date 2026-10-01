// One profile's blueprints, keyed by `meta.id` (docs/store.md, "Blueprints"). The blueprint is the only persisted build
// format (ground rule 5): each is stored in canonical form, the bytes `serializeBlueprint` writes, and every read
// migrates it with the schema's `migrateBlueprint` before checking it against the content. A stored document that does
// not load comes back as issues and stays as it is: nothing is lost.
import { BLUEPRINT_VERSION, canonicalizeBlueprint, migrateBlueprint, serializeBlueprint, validateBlueprint } from '@servo/schema';
import type { Blueprint, BlueprintId, BlueprintMeta, Catalogue, Issue, ProfileId, Timestamp } from '@servo/schema';
import { recordChange } from './changes.ts';
import { compareText, isLevel, isName, isRecord, isTimestamp, refusal, requireProfile } from './context.ts';
import type { StoreContext } from './context.ts';
import type { BlueprintRow } from './database.ts';
import type { BlueprintLoad, BlueprintSummary, Blueprints } from './index.ts';
import { uuidV4 } from './uuid.ts';

/**
 * Loads a blueprint of any stored version: migrates it to the current one, validates it against the content and puts
 * it in canonical form. `migratedFrom` is set when it was stored at an older version. Never throws.
 */
export const openBlueprint = (value: unknown, catalogue: Catalogue): BlueprintLoad => {
  const migrated = migrateBlueprint(value);
  if (!migrated.ok) return { ok: false, issues: migrated.issues };
  const checked = validateBlueprint(migrated.value, catalogue);
  if (!checked.ok) return { ok: false, issues: checked.issues };
  const blueprint = canonicalizeBlueprint(checked.value, catalogue);
  return migrated.from < BLUEPRINT_VERSION ? { ok: true, blueprint, migratedFrom: migrated.from } : { ok: true, blueprint };
};

const UNREADABLE: Issue = { code: 'value.unreadable', path: '$', message: 'The stored document is not JSON.' };

type Parsed = { readonly ok: true; readonly value: unknown } | { readonly ok: false };

const parse = (document: string): Parsed => {
  try {
    return { ok: true, value: JSON.parse(document) as unknown };
  } catch {
    return { ok: false };
  }
};

const openRow = (row: BlueprintRow, catalogue: Catalogue): BlueprintLoad => {
  const parsed = parse(row.document);
  return parsed.ok ? openBlueprint(parsed.value, catalogue) : { ok: false, issues: [UNREADABLE] };
};

/** What a document no migration reads, such as one from a newer version of Servo, says of itself, when it reads as this version's does. */
const metaOf = (document: unknown): Pick<BlueprintMeta, 'name' | 'level' | 'updatedAt'> | undefined => {
  const meta = isRecord(document) ? document.meta : undefined;
  if (!isRecord(meta)) return undefined;
  const { name, level, updatedAt } = meta;
  return isName(name) && isLevel(level) && isTimestamp(updatedAt) ? { name, level, updatedAt } : undefined;
};

/**
 * A row's summary, read from its document. One that does not load is still listed when its name, level and time can be
 * read, so the child can see it is kept; one that cannot be read at all is left out of the list, and still stored.
 */
const summaryOf = (row: BlueprintRow): BlueprintSummary | undefined => {
  const parsed = parse(row.document);
  if (!parsed.ok) return undefined;
  const migrated = migrateBlueprint(parsed.value);
  const meta = migrated.ok ? migrated.value.meta : metaOf(parsed.value);
  if (!meta) return undefined;
  const { name, level, updatedAt } = meta;
  return { id: row.id, name, level, updatedAt, ...(row.keptFrom === undefined ? {} : { keptFrom: row.keptFrom }) };
};

const newestFirst = (a: BlueprintSummary, b: BlueprintSummary): number => compareText(b.updatedAt, a.updatedAt) || compareText(a.id, b.id);

/** A build as it will be stored: valid against the content, in canonical form. Throws the issues when it is not valid. */
const checked = (value: unknown, catalogue: Catalogue, what: string): Blueprint => {
  const result = validateBlueprint(value, catalogue);
  if (!result.ok) throw refusal(`${what} does not validate: ${result.issues[0]?.message ?? 'no reason given'}`, result.issues);
  return canonicalizeBlueprint(result.value, catalogue);
};

/** The build with `meta.updatedAt` stamped. Anything that is not a blueprint is passed on for the validator to refuse. */
const stamped = (blueprint: unknown, at: Timestamp): unknown =>
  isRecord(blueprint) && isRecord(blueprint.meta) ? { ...blueprint, meta: { ...blueprint.meta, updatedAt: at } } : blueprint;

export const blueprintsOf = (ctx: StoreContext, profile: ProfileId): Blueprints => {
  const { db, content, now } = ctx;
  const { catalogue } = content;

  /** The row under `id` when this profile holds it. Another profile's build is treated exactly as a missing one. */
  const held = async (id: BlueprintId): Promise<BlueprintRow | undefined> => {
    const row = typeof id === 'string' ? await db.blueprints.get(id) : undefined;
    return row?.profile === profile ? row : undefined;
  };

  const notHeld = (id: BlueprintId, more = ''): Error => refusal(`This profile holds no blueprint '${String(id)}'.${more}`);

  /** Runs `work` in one transaction once the profile is known to be there. */
  const write = <T>(work: () => Promise<T>): Promise<T> =>
    db.transaction('rw', [db.profiles, db.blueprints, db.changes], async () => {
      await requireProfile(ctx, profile);
      return work();
    });

  /** Stores a checked build under its `meta.id` and records the change. Inside a transaction. */
  const put = async (blueprint: Blueprint, keptFrom?: BlueprintId): Promise<void> => {
    const { id, updatedAt } = blueprint.meta;
    await db.blueprints.put({ id, profile, document: serializeBlueprint(blueprint), ...(keptFrom === undefined ? {} : { keptFrom }) });
    await recordChange(db, { collection: 'blueprints', id, profile, updatedAt, removed: false });
  };

  /** The build as one of this profile's own: a fresh `meta.id`, this profile as author, made and changed now. */
  const asNew = (blueprint: Blueprint, name: string | undefined): Blueprint => {
    const at = now();
    const meta = { ...blueprint.meta, id: uuidV4(), author: profile, createdAt: at, updatedAt: at };
    return { ...blueprint, meta: name === undefined ? meta : { ...meta, name } };
  };

  return {
    list: async () => {
      const rows = await db.blueprints.where('profile').equals(profile).toArray();
      return rows
        .map(summaryOf)
        .filter((summary) => summary !== undefined)
        .sort(newestFirst);
    },

    create: async ({ name, level, arena }) => {
      const at = now();
      const meta: BlueprintMeta = { id: uuidV4(), name, level, createdAt: at, updatedAt: at, author: profile, highWater: { parts: 0, wires: 0 } };
      const blueprint = checked({ version: BLUEPRINT_VERSION, parts: [], wires: [], arena, meta }, catalogue, 'The new build');
      await write(() => put(blueprint));
      return blueprint;
    },

    copy: async (source, name) => {
      const opened = openBlueprint(source, catalogue);
      if (!opened.ok) return opened;
      const kept = validateBlueprint(asNew(opened.blueprint, name), catalogue);
      if (!kept.ok) return { ok: false, issues: kept.issues };
      const blueprint = canonicalizeBlueprint(kept.value, catalogue);
      await write(() => put(blueprint));
      return opened.migratedFrom === undefined ? { ok: true, blueprint } : { ok: true, blueprint, migratedFrom: opened.migratedFrom };
    },

    load: async (id) => {
      const row = await held(id);
      if (!row) throw notHeld(id);
      return openRow(row, catalogue);
    },

    save: async (blueprint) => {
      const build = checked(stamped(blueprint, now()), catalogue, 'The build');
      const { id, author } = build.meta;
      if (author !== undefined && author !== profile) throw refusal(`The build '${id}' names another profile as its author.`);
      return write(async () => {
        const row = await held(id);
        if (!row) throw notHeld(id, ' A new build comes from create, copy or duplicate.');
        const stored = openRow(row, catalogue);
        if (!stored.ok) throw refusal(`The stored blueprint '${id}' does not load, so it is kept as it is.`, stored.issues);
        await put(build, row.keptFrom);
        return build;
      });
    },

    duplicate: (id, name) =>
      write(async () => {
        const row = await held(id);
        if (!row) throw notHeld(id);
        const source = openRow(row, catalogue);
        if (!source.ok) throw refusal(`The blueprint '${id}' does not load, so it cannot be duplicated.`, source.issues);
        const blueprint = checked(asNew(source.blueprint, name), catalogue, 'The duplicate');
        await put(blueprint);
        return blueprint;
      }),

    remove: async (id) => {
      await db.transaction('rw', [db.blueprints, db.changes], async () => {
        const row = await held(id);
        if (!row) return;
        await db.blueprints.delete(row.id);
        await recordChange(db, { collection: 'blueprints', id: row.id, profile, updatedAt: now(), removed: true });
      });
    },
  };
};
