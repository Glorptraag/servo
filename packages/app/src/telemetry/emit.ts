// Emitting telemetry (task 6.2). `emitTelemetry` is the one emitter: every call names its kind as a string literal,
// which is how test/telemetry/emitters.test.ts finds them all. It never throws and is never on a Run's or a tap's path:
// the event is checked against the registry (events.ts), then kept in the background through the child's sink.
// The only sink is this device's store (the `telemetry` table), and only for a scope `openStore` made, so nothing
// leaves the device: there is no backend (D10, D13), and a sink that sends anywhere waits for a host and an adult's
// consent. Each scope is one session: the app opens a new scope for its child each time it opens for them.
import type { ProfileId } from '@servo/schema';
import { requireProfile } from '../store/context.ts';
import type { StoreContext } from '../store/context.ts';
import type { ProfileStore } from '../store/index.ts';
import { TELEMETRY_EVENTS, eventOf } from './events.ts';
import type { TelemetryEvent, TelemetryFields, TelemetryKind } from './events.ts';

/** Where a child's events go. Adds one event for one profile; rejects when it cannot. */
export interface TelemetrySink {
  add(profile: ProfileId, event: TelemetryEvent): Promise<void>;
  /** The profile's events, oldest first. */
  list(profile: ProfileId): Promise<readonly TelemetryEvent[]>;
}

/** The store's own table on this device. Only for a profile on the device; never synced, removed with the profile. */
export const localSink = (ctx: StoreContext): TelemetrySink => ({
  add: async (profile, event) => {
    const { db } = ctx;
    await db.transaction('rw', [db.profiles, db.telemetry], async () => {
      await requireProfile(ctx, profile);
      await db.telemetry.add({ profile, event });
    });
  },
  list: async (profile) => (await ctx.db.telemetry.where('profile').equals(profile).sortBy('seq')).map((row) => row.event),
});

interface Session {
  readonly ctx: StoreContext;
  readonly sink: TelemetrySink;
  readonly emitted: Set<TelemetryKind>;
  keeping: Promise<void>;
}

const sessions = new WeakMap<ProfileStore, Session>();

/** Gives a scope the store opened its telemetry: the store's `forProfile` calls it. Returns the scope. */
export const withTelemetry = <T extends ProfileStore>(ctx: StoreContext, scope: T, sink: TelemetrySink = localSink(ctx)): T => {
  sessions.set(scope, { ctx, sink, emitted: new Set(), keeping: Promise.resolve() });
  return scope;
};

/**
 * Emits one event for `child`, stamped now. Nothing happens with no child, or a scope the store did not open (a test's
 * stand-in). An event outside the registry is dropped with a console warning; a once-per-session kind already emitted
 * in this session is dropped silently. A sink that refuses is a console warning, never a dialog.
 */
export const emitTelemetry = <K extends TelemetryKind>(child: ProfileStore | null | undefined, kind: K, fields: TelemetryFields[K]): void => {
  const session = child ? sessions.get(child) : undefined;
  if (!child || !session) return;
  const event = eventOf(kind, session.ctx.now(), fields, session.ctx.content);
  if (!event) {
    console.warn(`A '${String(kind)}' telemetry event outside the registry was not kept.`);
    return;
  }
  if (TELEMETRY_EVENTS[kind].once) {
    if (session.emitted.has(kind)) return;
    session.emitted.add(kind);
  }
  session.keeping = session.keeping
    .then(() => session.sink.add(child.profile, event))
    .catch((error: unknown) => {
      console.warn('A telemetry event could not be kept on this device.', error);
    });
};

/** The child's events kept on this device, oldest first, once every event emitted so far is kept or has failed to be. */
export const telemetryOf = async (child: ProfileStore): Promise<readonly TelemetryEvent[]> => {
  const session = sessions.get(child);
  if (!session) return [];
  await session.keeping;
  return session.sink.list(child.profile);
};
