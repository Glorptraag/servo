// Autosave (task 4.9): nothing is lost (brief Section 8, principle 5). Each edited build waits for a quiet second
// (`AUTOSAVE_MS`), then saves; `flush` saves every waiting build at once (Run, the Save slot going away), `leaving`
// does too when the page is hidden or left, and `saveNow` is Save. Saves run one after another, each from the version
// this tab last saw stored, so the store's conflict rule keeps another tab's version as a copy instead of losing it.
// A save that fails stays waiting and is tried again, later each time, until one succeeds. React-free, so the app can
// wait on it (`settled`) before closing the store.
//
// A page that is reloaded or closed is gone before an IndexedDB save it starts can finish, so as the page is hidden or
// left, the app's autosaver first notes each build still waiting or saving in a journal (localStorage, which writes at
// once), then saves. A note goes once its build is saved. A note the page left behind is saved by `recoverUnsaved` the
// next time the app opens, before it opens a build. That journal is the one place a build waits outside the store, and
// only between an edit and its save.
import { serializeBlueprint } from '@servo/schema';
import type { Blueprint, BlueprintId, ProfileId, Timestamp } from '@servo/schema';
import { keptCopyOf } from '../store/blueprints.ts';
import { isRecord, isTimestamp } from '../store/context.ts';
import type { BlueprintSummary, ProfileStore, ServoStore } from '../store/index.ts';
import { uuidV4 } from '../store/uuid.ts';

/** How long after the last edit a build saves itself, in milliseconds. */
export const AUTOSAVE_MS = 1000;

/** The longest wait between tries of a save that keeps failing, in milliseconds. */
export const RETRY_MAX_MS = 30_000;

/** The start of every journal item's key: then the database's name, the page and the build. */
export const UNSAVED_PREFIX = 'servo.unsaved:';

export type SaveOutcome =
  | {
      readonly kind: 'saved';
      readonly build: Blueprint;
      /** Save was pressed; otherwise the build saved itself. */
      readonly pressed: boolean;
      /** The other version, kept as its own blueprint because another tab had saved the build since. */
      readonly keptCopy?: BlueprintSummary;
    }
  | { readonly kind: 'failed'; readonly build: Blueprint; readonly pressed: boolean; readonly error: unknown };

/** Where the app notes builds that are still waiting as its page is hidden or left. */
export interface Journal {
  readonly storage: Storage;
  /** The store's database name: each database has its own notes. */
  readonly scope: string;
}

interface Job {
  readonly build: Blueprint;
  readonly child: ProfileStore;
  readonly pressed: boolean;
}

/** A journal note: the build, its profile, and the stored version it was edited from. */
interface Note {
  readonly profile: ProfileId;
  readonly base: Timestamp;
  readonly build: Blueprint;
}

const keyOf = (profile: ProfileId, id: BlueprintId): string => `${profile} ${id}`;

/** The later of two times, as toISOString writes them. */
const later = (a: Timestamp | undefined, b: Timestamp): Timestamp => (a !== undefined && a > b ? a : b);

export class Autosaver {
  /** At most one build waiting per profile and build: the newest edit holds every edit before it. */
  private readonly waiting = new Map<string, Job>();
  /** The build being saved now, if any: saves run one at a time. */
  private readonly saving = new Map<string, Job>();
  /** The version this tab last saw stored, per profile and build. */
  private readonly bases = new Map<string, Timestamp>();
  private readonly listeners = new Set<(outcome: SaveOutcome) => void>();
  private readonly journal: Journal | undefined;
  /** This page's mark on its journal notes, so two pages left at once never write over each other's. */
  private readonly page = uuidV4();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private retry = 0;
  private stopped = false;
  private chain: Promise<void> = Promise.resolve();

  /** With a journal, builds still waiting when the page is hidden or left are noted there first (`leaving`). */
  constructor(journal?: Journal) {
    this.journal = journal;
  }

  /** Hears each save's outcome. Returns the unsubscribe function. */
  subscribe(listener: (outcome: SaveOutcome) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** An edit: the build waits for a quiet second. An edit to another build first saves the one waiting. */
  edited(build: Blueprint, child: ProfileStore): void {
    const key = keyOf(child.profile, build.meta.id);
    if ([...this.waiting.keys()].some((other) => other !== key)) this.flush();
    this.waiting.set(key, { build, child, pressed: false });
    this.retry = 0;
    this.wait(AUTOSAVE_MS);
  }

  /** Save: this build now, as its latest edit left it, and anything else waiting. */
  saveNow(build: Blueprint, child: ProfileStore): void {
    const key = keyOf(child.profile, build.meta.id);
    const latest = this.waiting.get(key)?.build ?? build;
    this.waiting.delete(key);
    this.flush();
    this.enqueue({ build: latest, child, pressed: true });
  }

  /** Saves every waiting build now. */
  flush(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    const jobs = [...this.waiting.values()];
    this.waiting.clear();
    for (const job of jobs) this.enqueue(job);
  }

  /** The page is being hidden or left: notes every build still waiting or saving in the journal, then saves them. */
  leaving(): void {
    for (const [key, job] of [...this.saving, ...this.waiting]) this.note(key, job);
    this.flush();
  }

  /** Whether any build is waiting to be saved. */
  get pending(): boolean {
    return this.waiting.size > 0;
  }

  /** Resolves once every save started so far has settled. */
  settled(): Promise<void> {
    return this.chain;
  }

  /** Stops waiting and trying again; saves already started still finish. Call `flush` first to save what waits. */
  dispose(): void {
    this.stopped = true;
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  private wait(ms: number): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), ms);
  }

  private enqueue(job: Job): void {
    this.chain = this.chain.then(() => this.run(job));
  }

  private baseOf(key: string, build: Blueprint): Timestamp {
    return later(this.bases.get(key), build.meta.updatedAt);
  }

  private async run(job: Job): Promise<void> {
    const key = keyOf(job.child.profile, job.build.meta.id);
    this.saving.set(key, job);
    try {
      const saved = await job.child.blueprints.save({ ...job.build, meta: { ...job.build.meta, updatedAt: this.baseOf(key, job.build) } });
      this.bases.set(key, saved.meta.updatedAt);
      // A newer edit of the same build may be noted already; its note stays until it is saved too.
      if (!this.waiting.has(key)) this.forget(key);
      const keptCopy = keptCopyOf(saved);
      this.emit({ kind: 'saved', build: job.build, pressed: job.pressed, ...(keptCopy ? { keptCopy } : {}) });
    } catch (error) {
      if (this.retry === 0) console.warn('Save failed. It will be tried again.', error);
      // A newer edit of the same build holds this one too; otherwise this one waits and is tried again, later each time.
      if (!this.waiting.has(key)) this.waiting.set(key, { ...job, pressed: false });
      this.retry = Math.min(Math.max(this.retry * 2, AUTOSAVE_MS * 2), RETRY_MAX_MS);
      if (!this.stopped) this.wait(this.retry);
      this.emit({ kind: 'failed', build: job.build, pressed: job.pressed, error });
    } finally {
      this.saving.delete(key);
    }
  }

  private itemOf(key: string): string {
    return `${UNSAVED_PREFIX}${this.journal?.scope ?? ''}:${this.page}:${key}`;
  }

  private note(key: string, job: Job): void {
    if (!this.journal) return;
    const note: Note = { profile: job.child.profile, base: this.baseOf(key, job.build), build: job.build };
    try {
      this.journal.storage.setItem(this.itemOf(key), JSON.stringify(note));
    } catch (error) {
      console.warn('The build could not be noted before the page went.', error);
    }
  }

  private forget(key: string): void {
    try {
      this.journal?.storage.removeItem(this.itemOf(key));
    } catch {
      // Storage that refuses to forget leaves a note that saves the same build again, which keeps no copy.
    }
  }

  private emit(outcome: SaveOutcome): void {
    for (const listener of this.listeners) listener(outcome);
  }
}

/** The build's bytes but for when it was saved. */
const contentOf = (build: Blueprint): string => serializeBlueprint({ ...build, meta: { ...build.meta, updatedAt: '' } });

const noteOf = (text: string | null): Note | undefined => {
  try {
    const value: unknown = JSON.parse(text ?? 'null');
    if (!isRecord(value) || typeof value.profile !== 'string' || !isTimestamp(value.base) || !isRecord(value.build)) return undefined;
    return value as unknown as Note;
  } catch {
    return undefined;
  }
};

/**
 * Saves each build a page of the app noted in `journal` and left before saving it, and forgets the note. The app runs
 * it as it opens, before it opens a build. Each goes through the store's save, from the version it was edited from, so
 * the conflict rule keeps any other version as a copy; one the same as the stored build is only forgotten. A build that
 * can no longer be saved under its id (removed meanwhile, or stored by a newer version of Servo) is kept as its own
 * build. A note whose profile is gone goes with the profile (D38). A note that cannot be saved now stays for next time.
 */
export const recoverUnsaved = async (store: ServoStore, journal: Journal): Promise<void> => {
  const { storage, scope } = journal;
  const prefix = `${UNSAVED_PREFIX}${scope}:`;
  const items: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const item = storage.key(index);
    if (item?.startsWith(prefix)) items.push(item);
  }
  if (items.length === 0) return;
  const profiles = new Set((await store.profiles.list()).map((profile) => profile.id));
  for (const item of items) {
    const note = noteOf(storage.getItem(item));
    if (!note || !profiles.has(note.profile)) {
      storage.removeItem(item);
      continue;
    }
    const child = store.forProfile(note.profile);
    const stored = await child.blueprints.load(note.build.meta.id).catch(() => undefined);
    if (stored?.ok && contentOf(stored.blueprint) === contentOf(note.build)) {
      storage.removeItem(item);
      continue;
    }
    try {
      await child.blueprints.save({ ...note.build, meta: { ...note.build.meta, updatedAt: note.base } });
      storage.removeItem(item);
    } catch {
      const kept = await child.blueprints.copy(note.build).catch(() => undefined);
      if (kept?.ok) storage.removeItem(item);
    }
  }
};
