// What sync sends and what it takes (task 5.5): the store's waiting changes going out, each blueprint with the version
// it was made from, and the remote's changes coming in under the conflict rule. The latest blueprint wins its id, and
// the other version is kept as its own blueprint (`keptFrom`), the same rule and the same copy as two tabs' saves
// (docs/store.md, decision 15). Blueprints are never merged and never dropped. See README.md, "Offline and sync".
import { serializeBlueprint } from '@servo/schema';
import type { Blueprint, BlueprintId, Catalogue, ProfileId, RunRecord, Timestamp } from '@servo/schema';
import { openBlueprint } from '../store/blueprints.ts';
import { pendingChanges, recordChange } from '../store/changes.ts';
import { isName, isRecord, isTimestamp } from '../store/context.ts';
import type { StoreContext } from '../store/context.ts';
import type { BlueprintRow, ServoDatabase } from '../store/database.ts';
import type { CardGameResult, SyncChange, SyncCollection, SyncPull } from '../store/index.ts';
import { uuidV4 } from '../store/uuid.ts';

/** The sync table's key for the remote's cursor. */
export const CURSOR_KEY = 'cursor';

/** The sync table's key for the version of a blueprint last sent to or taken from the remote. */
export const syncedKey = (id: string): string => `blueprints/${id}`;

/**
 * The version of a blueprint last sent to or taken from the remote: its `meta.updatedAt`, and a hash of its content,
 * since two devices can save one build in the same millisecond. Stored as `<updatedAt>#<hash>`.
 */
interface Synced {
  readonly at: Timestamp;
  readonly hash: string;
}

const syncedOf = async (db: ServoDatabase, id: string): Promise<Synced | undefined> => {
  const value = (await db.sync.get(syncedKey(id)))?.value;
  const mark = value?.indexOf('#') ?? -1;
  return value === undefined || mark < 0 ? undefined : { at: value.slice(0, mark), hash: value.slice(mark + 1) };
};

const noteSynced = (db: ServoDatabase, id: string, at: Timestamp, content: string): Promise<string> =>
  db.sync.put({ key: syncedKey(id), value: `${at}#${hashOf(content)}` });

/** cyrb53: a 53-bit hash of the text, in hex. Only ever compared with another made here. */
const hashOf = (text: string): string => {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
};

/** The store's tables sync reads and writes, every one of them, in one transaction. */
const tablesOf = (db: ServoDatabase) => [db.profiles, db.blueprints, db.runs, db.cardGames, db.changes, db.sync, db.telemetry];

// ---- Going out ----

/** The changes one push sends, and the `seq` of each waiting change they were read from. */
export interface Outbox {
  readonly changes: readonly SyncChange[];
  readonly seqs: readonly number[];
}

/**
 * Every change waiting to be pushed, oldest first, as `pendingChanges` gives them. Each blueprint's carries `base`,
 * the version this device last synced (what the change was made from), and `keptFrom` when it is a kept copy.
 */
export const outbox = (db: ServoDatabase): Promise<Outbox> =>
  db.transaction('r', tablesOf(db), async () => {
    const rows = await db.changes.orderBy('seq').toArray();
    const changes: SyncChange[] = [];
    for (const change of await pendingChanges(db)) {
      if (change.collection !== 'blueprints') {
        changes.push(change);
        continue;
      }
      const base = (await syncedOf(db, change.id))?.at;
      const keptFrom = change.document === undefined ? undefined : (await db.blueprints.get(change.id))?.keptFrom;
      changes.push({ ...change, ...(base === undefined ? {} : { base }), ...(keptFrom === undefined ? {} : { keptFrom }) });
    }
    return { changes, seqs: rows.map((row) => row.seq) };
  });

/**
 * After the remote took a push: the changes it took stop waiting, and each blueprint's version is noted as the one
 * last synced. A change recorded again since it was read has a new `seq`, so it stays waiting for the next push.
 */
export const markPushed = ({ db, content }: StoreContext, sent: Outbox): Promise<void> =>
  db.transaction('rw', [db.changes, db.sync], async () => {
    await db.changes.bulkDelete([...sent.seqs]);
    for (const change of sent.changes) {
      if (change.collection !== 'blueprints') continue;
      if (change.document === undefined) await db.sync.delete(syncedKey(change.id));
      else await noteSynced(db, change.id, change.updatedAt, versionOf(change.document, content.catalogue).content);
    }
  });

// ---- Coming in ----

const COLLECTIONS: readonly SyncCollection[] = ['profiles', 'blueprints', 'runs', 'card-games'];

const isId = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

/** A change as the contract shapes it. Anything else the remote sends is left alone. */
const isChange = (value: unknown): value is SyncChange =>
  isRecord(value) &&
  COLLECTIONS.includes(value.collection as SyncCollection) &&
  isId(value.id) &&
  isTimestamp(value.updatedAt) &&
  (value.profile === undefined || isId(value.profile)) &&
  (value.base === undefined || isTimestamp(value.base)) &&
  (value.keptFrom === undefined || isId(value.keptFrom));

/** One version of a blueprint: the bytes to store, what versions are compared by, and when it was saved. */
interface Version {
  readonly document: string;
  /** Its canonical bytes but for its id and its time, so a kept copy still matches the version it was. */
  readonly content: string;
  /** Its `meta.updatedAt`, or '' when it cannot be read, which makes it the older of any two. */
  readonly updatedAt: Timestamp | '';
}

const contentOf = (blueprint: Blueprint): string => serializeBlueprint({ ...blueprint, meta: { ...blueprint.meta, id: '', updatedAt: '' } });

/** The document with another `meta.id`, as JSON; a document with no meta stays as it is. */
const rawWithMeta = (value: unknown, meta: Readonly<Record<string, unknown>>): string =>
  isRecord(value) && isRecord(value.meta) ? JSON.stringify({ ...value, meta: { ...value.meta, ...meta } }) : JSON.stringify(value);

/**
 * A version from a document as sync carries it. One that loads is stored in canonical form, as the store writes it,
 * or as it came when it is from an older version of Servo, as the store keeps those until the child saves. One that
 * does not load (a newer version of Servo, a part this content lacks) is kept as it came. Text that was never JSON
 * arrives as that text.
 */
const versionOf = (value: unknown, catalogue: Catalogue, stored?: string): Version => {
  if (typeof value === 'string') return { document: stored ?? value, content: value, updatedAt: '' };
  const opened = openBlueprint(value, catalogue);
  if (opened.ok) {
    const document = stored ?? (opened.migratedFrom === undefined ? serializeBlueprint(opened.blueprint) : JSON.stringify(value));
    return { document, content: contentOf(opened.blueprint), updatedAt: opened.blueprint.meta.updatedAt };
  }
  const updatedAt = isRecord(value) && isRecord(value.meta) && isTimestamp(value.meta.updatedAt) ? value.meta.updatedAt : '';
  return { document: stored ?? JSON.stringify(value), content: rawWithMeta(value, { id: '', updatedAt: '' }), updatedAt };
};

const versionOfRow = (row: BlueprintRow, catalogue: Catalogue): Version => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.document) as unknown;
  } catch {
    return { document: row.document, content: row.document, updatedAt: '' };
  }
  return versionOf(parsed, catalogue, row.document);
};

/** The version's document under another `meta.id`: in canonical form when it loads, as the store's copies are. */
const withId = (version: Version, id: BlueprintId, catalogue: Catalogue): string => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(version.document) as unknown;
  } catch {
    return version.document;
  }
  const opened = openBlueprint(parsed, catalogue);
  return opened.ok ? serializeBlueprint({ ...opened.blueprint, meta: { ...opened.blueprint.meta, id } }) : rawWithMeta(parsed, { id });
};

/** A copy the conflict rule kept, as its own blueprint, of the version that lost the id `keptFrom`. */
export interface KeptCopy {
  readonly id: BlueprintId;
  readonly keptFrom: BlueprintId;
  readonly profile: ProfileId;
}

const isProfileDocument = (value: unknown): value is { readonly id: string; readonly name: string; readonly createdAt: Timestamp } =>
  isRecord(value) && isId(value.id) && isName(value.name) && isTimestamp(value.createdAt);

const isRunRecord = (value: unknown): value is RunRecord => isRecord(value) && isId(value.id) && isId(value.blueprintId);

const isCardGame = (value: unknown): value is CardGameResult =>
  isRecord(value) && isId(value.id) && isTimestamp(value.playedAt) && Array.isArray(value.cards);

/** Profile changes first, so the records that follow have their profile; a profile's removal last, after its records'. */
const rank = (change: SyncChange): number => (change.collection !== 'profiles' ? 1 : change.document === undefined ? 2 : 0);

/** A change as it is applied: with every version of its blueprint it was made from, in this pull or before it. */
type Incoming = SyncChange & {
  /** The `meta.updatedAt` of each earlier version this one replaces: its `base`, and the versions before it in the pull. */
  readonly supersedes: readonly Timestamp[];
};

/**
 * A pull's changes, with each run of versions of one blueprint, each made from the one before, taken as its last
 * version, which supersedes them all. So a device that missed a dozen autosaves of a build takes the latest once,
 * and keeps at most one copy of it, never one of each version in between. Versions made from the same one stay apart.
 */
const collapse = (changes: readonly SyncChange[]): Incoming[] => {
  const out: (Incoming | undefined)[] = [];
  const latest = new Map<string, number>();
  for (const change of changes) {
    const incoming: Incoming = { ...change, supersedes: change.base === undefined ? [] : [change.base] };
    if (change.collection !== 'blueprints') {
      out.push(incoming);
      continue;
    }
    const at = latest.get(change.id);
    const before = at === undefined ? undefined : out[at];
    if (at !== undefined && before?.document !== undefined && change.base === before.updatedAt) {
      out[at] = undefined;
      out.push({ ...incoming, supersedes: [...before.supersedes, before.updatedAt] });
    } else out.push(incoming);
    latest.set(change.id, out.length - 1);
  }
  return out.filter((change) => change !== undefined);
};

/**
 * Applies a pull in one transaction, with the cursor it brought, so a pull is taken whole or not at all. Taking the
 * same pull twice changes nothing more. Returns the copies the conflict rule kept.
 *
 * A blueprint that arrives:
 * - new here: stored, with `keptFrom` when it is a kept copy. A removal here that was not pushed yet gives way to it;
 * - the version this device last synced, or the same as the one here but for its id and time: nothing new;
 * - made from the version here (or from it through versions earlier in the pull), which has not changed since it was
 *   synced: it replaces it;
 * - otherwise both changed since they last agreed. The later `meta.updatedAt` keeps the id; the other is kept as its
 *   own blueprint under a fresh id, `keptFrom` naming the id, and is pushed. A tie keeps the version here at the id.
 *
 * A removal takes a blueprint away only when it is the version the remover last synced and has not changed here
 * since. Otherwise the version here is kept, and sent back so the remote holds it again. Runs and card-game results
 * are only ever added; they go only when their profile was removed. A profile goes only when nothing of it is left here.
 * A record for a profile this device does not hold (removed here) is left on the remote and not taken.
 */
export const applyPull = (ctx: StoreContext, pull: SyncPull): Promise<readonly KeptCopy[]> => {
  const { db, content } = ctx;
  const { catalogue } = content;
  return db.transaction('rw', tablesOf(db), async () => {
    const kept: KeptCopy[] = [];
    const pendingOf = (collection: SyncCollection, id: string) => db.changes.where('[collection+id]').equals([collection, id]).first();
    const dropPending = (collection: SyncCollection, id: string) => db.changes.where('[collection+id]').equals([collection, id]).delete();
    const holds = async (profile: ProfileId | undefined): Promise<boolean> => profile !== undefined && (await db.profiles.get({ id: profile })) !== undefined;

    const profileChange = async (change: SyncChange): Promise<void> => {
      const local = await db.profiles.get({ id: change.id });
      const pending = await pendingOf('profiles', change.id);
      if (change.document === undefined) {
        if (!local || pending) return;
        const left =
          (await db.blueprints.where('profile').equals(change.id).count()) +
          (await db.runs.where('profile').equals(change.id).count()) +
          (await db.cardGames.where('profile').equals(change.id).count());
        if (left === 0) {
          await db.telemetry.where('profile').equals(change.id).delete();
          await db.profiles.delete(local.seq);
        }
        return;
      }
      const document = change.document;
      if (!isProfileDocument(document) || document.id !== change.id) return;
      if (!local) {
        // Removed here by the adult (D38) and not pushed yet: the removal stands, and goes to the remote.
        if (pending?.removed) return;
        await db.profiles.add({ id: document.id, name: document.name, createdAt: document.createdAt });
        return;
      }
      if (pending && pending.updatedAt >= change.updatedAt) return;
      if (local.name !== document.name) await db.profiles.update(local.seq, { name: document.name });
      if (pending) await dropPending('profiles', change.id);
    };

    const runChange = async (change: SyncChange): Promise<void> => {
      const row = await db.runs.get({ id: change.id });
      if (change.document === undefined) {
        if (row) await db.runs.delete(row.seq);
        return;
      }
      const record = change.document;
      if (row || !isRunRecord(record) || record.id !== change.id) return;
      const profile = change.profile ?? record.profile;
      if (!(await holds(profile)) || profile === undefined) return;
      const found = typeof record.challenge === 'string' ? { challenge: record.challenge } : {};
      await db.runs.add({ id: record.id, profile, blueprintId: record.blueprintId, ...found, record });
    };

    const cardGameChange = async (change: SyncChange): Promise<void> => {
      const row = await db.cardGames.get({ id: change.id });
      if (change.document === undefined) {
        if (row) await db.cardGames.delete(row.seq);
        return;
      }
      const result = change.document;
      if (row || !isCardGame(result) || result.id !== change.id) return;
      const profile = change.profile ?? result.profile;
      if (!(await holds(profile)) || profile === undefined) return;
      await db.cardGames.add({ id: result.id, profile, result: { ...result, profile } });
    };

    /** Keeps `version` as its own blueprint under a fresh id, `keptFrom` naming `id`, unless such a copy is kept already. */
    const keepCopy = async (version: Version, id: BlueprintId, profile: ProfileId): Promise<void> => {
      for (const other of await db.blueprints.where('profile').equals(profile).toArray()) {
        if (other.keptFrom === id && versionOfRow(other, catalogue).content === version.content) return;
      }
      const copy = uuidV4();
      await db.blueprints.put({ id: copy, profile, document: withId(version, copy, catalogue), keptFrom: id });
      await recordChange(db, { collection: 'blueprints', id: copy, profile, updatedAt: version.updatedAt || ctx.now(), removed: false });
      kept.push({ id: copy, keptFrom: id, profile });
    };

    const blueprintChange = async (change: Incoming): Promise<void> => {
      const { id } = change;
      const row = await db.blueprints.get(id);
      const pending = await pendingOf('blueprints', id);
      const synced = await syncedOf(db, id);

      if (change.document === undefined) {
        if (!row) return;
        const local = versionOfRow(row, catalogue);
        if (!pending && local.updatedAt !== '' && change.supersedes.includes(local.updatedAt)) {
          await db.blueprints.delete(id);
          await db.sync.delete(syncedKey(id));
          return;
        }
        // Changed here since, or a version the remover never saw: kept, and sent back to the remote, which no longer
        // holds any version of it.
        await db.sync.delete(syncedKey(id));
        if (!pending) await recordChange(db, { collection: 'blueprints', id, profile: row.profile, updatedAt: local.updatedAt || ctx.now(), removed: false });
        return;
      }

      const profile = change.profile;
      if (profile === undefined || !(await holds(profile))) return;
      if (row && row.profile !== profile) return;
      const remote = versionOf(change.document, catalogue);
      const store = (keptFrom: BlueprintId | undefined) =>
        db.blueprints.put({ id, profile, document: remote.document, ...(keptFrom === undefined ? {} : { keptFrom }) });

      const noted = () => noteSynced(db, id, change.updatedAt, remote.content);
      // The version this device last synced, coming round again (its own push, or a pull taken twice): nothing new.
      const seen = synced?.at === change.updatedAt && synced.hash === hashOf(remote.content);

      if (!row) {
        if (pending && seen) return;
        await store(change.keptFrom);
        if (pending) await dropPending('blueprints', id);
        await noted();
        return;
      }
      if (seen) return;
      const local = versionOfRow(row, catalogue);
      if (local.content === remote.content) {
        if (!pending && change.updatedAt > local.updatedAt) await store(change.keptFrom ?? row.keptFrom);
        await noted();
        return;
      }
      if (!pending && local.updatedAt !== '' && change.supersedes.includes(local.updatedAt)) {
        await store(change.keptFrom ?? row.keptFrom);
        await noted();
        return;
      }
      if (change.updatedAt > local.updatedAt) {
        await keepCopy(local, id, profile);
        await store(change.keptFrom ?? row.keptFrom);
        if (pending) await dropPending('blueprints', id);
      } else {
        await keepCopy(remote, id, profile);
        if (!pending) await recordChange(db, { collection: 'blueprints', id, profile, updatedAt: local.updatedAt || ctx.now(), removed: false });
      }
      await noted();
    };

    const incoming = collapse(pull.changes.filter(isChange));
    const ordered = incoming.map((change, index) => ({ change, index })).sort((a, b) => rank(a.change) - rank(b.change) || a.index - b.index);
    for (const { change } of ordered) {
      switch (change.collection) {
        case 'profiles':
          await profileChange(change);
          break;
        case 'blueprints':
          await blueprintChange(change);
          break;
        case 'runs':
          await runChange(change);
          break;
        case 'card-games':
          await cardGameChange(change);
          break;
      }
    }
    await db.sync.put({ key: CURSOR_KEY, value: pull.cursor });
    return kept;
  });
};

/** The cursor the last pull left, or undefined before the first. */
export const cursorOf = async (db: ServoDatabase): Promise<string | undefined> => (await db.sync.get(CURSOR_KEY))?.value;
