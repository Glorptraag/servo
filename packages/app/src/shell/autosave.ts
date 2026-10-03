// Autosave (task 4.9): nothing is lost (brief Section 8, principle 5). Each edited build waits for a quiet second
// (`AUTOSAVE_MS`), then saves; `flush` saves every waiting build at once (Run, the Save slot going away), `leaving`
// does too when the page is hidden or left, and `saveNow` is Save. Saves run one after another, each from the version
// this tab last saw stored, so the store's conflict rule keeps another tab's version as a copy instead of losing it.
// A save that fails stays waiting and is tried again, later each time, until one succeeds. React-free, so the app can
// wait on it (`settled`) before closing the store.
//
// A page that is reloaded or closed is gone before an IndexedDB save it starts can finish, so as the page is hidden or
// left, the app's autosaver first notes each build still waiting or saving in a journal (localStorage, which writes at
// once): the build, the stored version it was edited from, when it was last edited and a hash of its content. Then it saves.
// A note goes once its build is saved. The next time the app opens, `recover` replays each note the page left behind
// through the store by the project's rule, the latest wins and both are kept (`replayUnsaved`), before the app opens a
// build. That journal is the one place a build waits outside the store, and only between an edit and its save.
import type { Blueprint, BlueprintId, ProfileId, Timestamp } from '@servo/schema';
import { contentHashOf, keptCopyOf } from '../store/blueprints.ts';
import type { UnsavedNote } from '../store/blueprints.ts';
import { isRecord, isTimestamp } from '../store/context.ts';
import { UNSAVED_PREFIX } from '../store/device.ts';
import type { BlueprintSummary, ProfileStore, ServoStore } from '../store/index.ts';
import { replayForOpening } from '../store/open.ts';
import { uuidV4 } from '../store/uuid.ts';

/** How long after the last edit a build saves itself, in milliseconds. */
export const AUTOSAVE_MS = 1000;

/** The longest wait between tries of a save that keeps failing, in milliseconds. */
export const RETRY_MAX_MS = 30_000;

/** The start of every journal item's key: then the database's name, the page and the build. */
export { UNSAVED_PREFIX };

export type SaveOutcome =
  | {
      readonly kind: 'saved';
      readonly build: Blueprint;
      /** Save was pressed; otherwise the build saved itself. */
      readonly pressed: boolean;
      /**
       * The other version, kept as its own blueprint: another tab's, which had saved the build since; or, replaying the
       * journal as the app opens, the version a page left unsaved, which the build had moved on from since.
       */
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
  /** When the build was last edited, by this autosaver's clock. */
  readonly editedAt: Timestamp;
}

/** A journal note: the build, its profile, the stored version it was edited from, when it was last edited and its hash. */
interface Note extends UnsavedNote {
  readonly profile: ProfileId;
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
  /** Outcomes from before anything listened, such as the journal's replay as the app opens, for the first listener. */
  private backlog: SaveOutcome[] = [];
  private readonly journal: Journal | undefined;
  private readonly now: () => Timestamp;
  /** This page's mark on its journal notes, so two pages left at once never write over each other's. */
  private readonly page = uuidV4();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private retry = 0;
  private stopped = false;
  private chain: Promise<void> = Promise.resolve();
  /** Profiles removed while this page was open (D38): nothing more is saved or noted for them. */
  private readonly dropped = new Set<ProfileId>();

  /**
   * With a journal, builds still waiting when the page is hidden or left are noted there first (`leaving`). `now` is
   * the clock each edit is timed by, as toISOString writes it; tests pass a fixed one, as they do the store's.
   */
  constructor(journal?: Journal, now: () => Timestamp = () => new Date().toISOString()) {
    this.journal = journal;
    this.now = now;
  }

  /** Hears each save's outcome, starting with any from before anything listened. Returns the unsubscribe function. */
  subscribe(listener: (outcome: SaveOutcome) => void): () => void {
    this.listeners.add(listener);
    const backlog = this.backlog;
    this.backlog = [];
    for (const outcome of backlog) listener(outcome);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** An edit: the build waits for a quiet second. An edit to another build first saves the one waiting. */
  edited(build: Blueprint, child: ProfileStore): void {
    if (this.dropped.has(child.profile)) return;
    const key = keyOf(child.profile, build.meta.id);
    if ([...this.waiting.keys()].some((other) => other !== key)) this.flush();
    this.waiting.set(key, { build, child, pressed: false, editedAt: this.now() });
    this.retry = 0;
    this.wait(AUTOSAVE_MS);
  }

  /** Save: this build now, as its latest edit left it, and anything else waiting. */
  saveNow(build: Blueprint, child: ProfileStore): void {
    if (this.dropped.has(child.profile)) return;
    const key = keyOf(child.profile, build.meta.id);
    const waiting = this.waiting.get(key);
    this.waiting.delete(key);
    this.flush();
    this.enqueue({ build: waiting?.build ?? build, child, pressed: true, editedAt: waiting?.editedAt ?? this.now() });
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
    for (const [key, job] of [...this.saving, ...this.waiting]) if (!this.dropped.has(job.child.profile)) this.note(key, job);
    this.flush();
  }

  /**
   * The profile was removed while this page was open (D38): forgets every build waiting for it, and its notes, and
   * saves nothing more for it. A save already started is refused by the store, and is not tried again.
   */
  drop(profile: ProfileId): void {
    this.dropped.add(profile);
    for (const [key, job] of [...this.waiting]) {
      if (job.child.profile !== profile) continue;
      this.waiting.delete(key);
      this.forget(key);
    }
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
    if (this.dropped.has(job.child.profile)) {
      this.forget(key);
      return;
    }
    this.saving.set(key, job);
    try {
      const saved = await job.child.blueprints.save({ ...job.build, meta: { ...job.build.meta, updatedAt: this.baseOf(key, job.build) } });
      this.bases.set(key, saved.meta.updatedAt);
      // A newer edit of the same build may be noted already; its note stays until it is saved too.
      if (!this.waiting.has(key)) this.forget(key);
      const keptCopy = keptCopyOf(saved);
      this.emit({ kind: 'saved', build: job.build, pressed: job.pressed, ...(keptCopy ? { keptCopy } : {}) });
    } catch (error) {
      if (this.dropped.has(job.child.profile)) {
        this.forget(key);
        return;
      }
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
    const note: Note = {
      profile: job.child.profile,
      base: this.baseOf(key, job.build),
      editedAt: job.editedAt,
      hash: contentHashOf(job.build),
      build: job.build,
    };
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
    if (this.listeners.size === 0) this.backlog.push(outcome);
    for (const listener of this.listeners) listener(outcome);
  }

  /**
   * Replays each build a page of the app noted in this journal and left before saving it, and forgets the note. The app
   * runs it as it opens, before it opens a build. Each goes through `replayUnsaved`, by the project's rule: the latest
   * wins and both are kept. A note already stored, at its build or as a copy kept from it, is only forgotten; a note
   * edited from the version stored now saves to its build; when another tab saved the build since, the later of the
   * note's last edit and that save keeps the id, the other is kept as a copy, and the line says so (an outcome with
   * `keptCopy`) when the note is the profile in use's; a note whose build was removed is kept as a build of its own. A note whose profile is gone goes with the profile (D38). A note that cannot be replayed
   * now stays for next time. Notes of other databases are left alone.
   */
  async recover(store: ServoStore): Promise<void> {
    if (!this.journal) return;
    const { storage, scope } = this.journal;
    const prefix = `${UNSAVED_PREFIX}${scope}:`;
    const items: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const item = storage.key(index);
      if (item?.startsWith(prefix)) items.push(item);
    }
    if (items.length === 0) return;
    const profiles = new Set((await store.profiles.list()).map((profile) => profile.id));
    // Only the child the app opens for is told a copy was kept: another child's note is that child's business (R-5.1).
    const opening = (await store.profiles.inUse())?.id;
    for (const item of items) {
      const note = noteOf(storage.getItem(item));
      if (!note || !profiles.has(note.profile)) {
        storage.removeItem(item);
        continue;
      }
      const replay = await replayForOpening(store, note.profile, note).catch((error: unknown) => {
        console.warn('A build left unsaved could not be replayed; it stays noted for next time.', error);
        return undefined;
      });
      if (!replay) continue;
      storage.removeItem(item);
      if (replay.outcome === 'kept-copy' && note.profile === opening) this.emit({ kind: 'saved', build: note.build, pressed: false, keptCopy: replay.copy });
    }
  }
}

const noteOf = (text: string | null): Note | undefined => {
  try {
    const value: unknown = JSON.parse(text ?? 'null');
    if (!isRecord(value) || typeof value.profile !== 'string' || !isTimestamp(value.base) || !isRecord(value.build)) return undefined;
    return value as unknown as Note;
  } catch {
    return undefined;
  }
};
