// Emitting telemetry (task 6.2). `emitTelemetry` is the one emitter and the only way an event reaches the store: every
// call names its kind as a string literal, which is how test/telemetry/emitters.test.ts finds them all, and that test
// fails on any other reach of the table. It never throws and is never on a Run's or a tap's path: the event is checked
// against the registry (events.ts), then kept in the background.
// Where it goes is fixed: the store's `telemetry` table on this device, and only for a scope `openStore` made. Nothing
// leaves the device. There is no backend (D10, D13), and no sink can be passed in or swapped at runtime: a path off the
// device waits for a host and an adult's consent, and is its own task.
// Each scope is one session: the app opens a new scope for its child each time it opens for them.
import type { ProfileId } from '@servo/schema';
import { requireProfile } from '../store/context.ts';
import type { StoreContext } from '../store/context.ts';
import type { ProfileStore } from '../store/index.ts';
import { TELEMETRY_EVENTS, eventOf } from './events.ts';
import type { TelemetryEvent, TelemetryFields, TelemetryKind } from './events.ts';

/** Checks the event against the registry again, whoever built it, and keeps it for a profile on the device. */
const keep = async (ctx: StoreContext, profile: ProfileId, event: TelemetryEvent): Promise<number> => {
  const { kind, at, ...fields } = event;
  const checked = eventOf(kind, at, fields as TelemetryFields[typeof kind], ctx.content);
  if (!checked) throw new Error(`A '${String(kind)}' telemetry event outside the registry was not kept.`);
  const { db } = ctx;
  return db.transaction('rw', [db.profiles, db.telemetry], async () => {
    await requireProfile(ctx, profile);
    return db.telemetry.add({ profile, event: checked });
  });
};

/** Puts `event` in place of the one kept under `seq`, when that row is still this profile's. */
const revise = async (ctx: StoreContext, profile: ProfileId, seq: number, event: TelemetryEvent): Promise<void> => {
  const { kind, at, ...fields } = event;
  const checked = eventOf(kind, at, fields as TelemetryFields[typeof kind], ctx.content);
  if (!checked) throw new Error(`A '${String(kind)}' telemetry event outside the registry was not kept.`);
  const { db } = ctx;
  await db.transaction('rw', [db.profiles, db.telemetry], async () => {
    await requireProfile(ctx, profile);
    const row = await db.telemetry.get(seq);
    if (row?.profile === profile && row.event.kind === checked.kind) await db.telemetry.put({ seq, profile, event: checked });
  });
};

/** A once-per-session kind in this session: its row, and whether a provisional emit left it open to one revision. */
interface Once {
  readonly row: Promise<number | undefined>;
  readonly at: TelemetryEvent['at'];
  open: boolean;
}

interface Session {
  readonly ctx: StoreContext;
  readonly once: Map<TelemetryKind, Once>;
  keeping: Promise<unknown>;
}

const sessions = new WeakMap<ProfileStore, Session>();

/** Gives a scope the store opened its telemetry: the store's `forProfile` calls it. Returns the scope. */
export const withTelemetry = <T extends ProfileStore>(ctx: StoreContext, scope: T): T => {
  sessions.set(scope, { ctx, once: new Map(), keeping: Promise.resolve() });
  return scope;
};

export interface EmitOptions {
  /**
   * For a once-per-session kind: the event is kept now, but the session's next emit of the kind replaces its fields
   * (keeping its time) instead of being dropped. The app's opening uses it, so a session that never reaches a Run is
   * still counted, and a challenge chosen on Home before any Run still names the session's start.
   */
  readonly provisional?: true;
}

/**
 * Emits one event for `child`, stamped now. Nothing happens with no child, or a scope the store did not open (a test's
 * stand-in). An event outside the registry is dropped with a console warning. A once-per-session kind already emitted
 * in this session is dropped silently, unless that emit was provisional. A refusal is a console warning, never a dialog.
 */
export const emitTelemetry = <K extends TelemetryKind>(
  child: ProfileStore | null | undefined,
  kind: K,
  fields: TelemetryFields[K],
  options: EmitOptions = {},
): void => {
  const session = child ? sessions.get(child) : undefined;
  if (!child || !session) return;
  const { ctx } = session;
  const event = eventOf(kind, ctx.now(), fields, ctx.content);
  if (!event) {
    console.warn(`A '${String(kind)}' telemetry event outside the registry was not kept.`);
    return;
  }
  const warn = (error: unknown) => {
    console.warn('A telemetry event could not be kept on this device.', error);
    return undefined;
  };
  if (TELEMETRY_EVENTS[kind].once) {
    const before = session.once.get(kind);
    if (before) {
      if (!before.open) return;
      before.open = false;
      const revised = { ...event, at: before.at };
      session.keeping = session.keeping
        .then(() => before.row)
        .then((seq) => (seq === undefined ? undefined : revise(ctx, child.profile, seq, revised)))
        .catch(warn);
      return;
    }
    const row = session.keeping.then(() => keep(ctx, child.profile, event)).catch(warn);
    session.once.set(kind, { row, at: event.at, open: options.provisional === true });
    session.keeping = row;
    return;
  }
  session.keeping = session.keeping.then(() => keep(ctx, child.profile, event)).catch(warn);
};

/** The child's events kept on this device, oldest first, once every event emitted so far is kept or has failed to be. */
export const telemetryOf = async (child: ProfileStore): Promise<readonly TelemetryEvent[]> => {
  const session = sessions.get(child);
  if (!session) return [];
  let seen: Promise<unknown>;
  do {
    seen = session.keeping;
    await seen;
  } while (seen !== session.keeping);
  return (await session.ctx.db.telemetry.where('profile').equals(child.profile).sortBy('seq')).map((row) => row.event);
};
