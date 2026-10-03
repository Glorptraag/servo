// Telemetry (task 6.2) in Node on fake-indexeddb, on a real store: what an event keeps (the registry's fields and
// nothing else, never free text), once-per-session starts, where it is kept (this device, this child, never sync's
// outbox), deletion with the child's profile, and the hooks: the Run bar's recorder, the hint log.
import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import type { CanvasHandle, CanvasMode } from '@servo/canvas';
import { loadContent } from '@servo/content';
import type { ContentLoad } from '@servo/content';
import { loadFixtures } from '@servo/content/fixtures';
import { validateChallenge } from '@servo/schema';
import type { Blueprint, Challenge } from '@servo/schema';
import { HintLog } from '../../src/hints/log.ts';
import { RunRecorder } from '../../src/run-bar/record.ts';
import { RunLoop, SPIN_UP_MS } from '../../src/run-bar/run-loop.ts';
import type { RunClock } from '../../src/run-bar/run-loop.ts';
import { openStoreWith } from '../../src/store/open.ts';
import type { ProfileStore } from '../../src/store/index.ts';
import { emitTelemetry, eventOf, telemetryOf } from '../../src/telemetry/index.ts';
import type { TelemetryFields } from '../../src/telemetry/index.ts';
import { clock, freshName, withDatabase } from '../store/support.ts';

const loaded = loadContent();
const roller = loadFixtures().fixtures.find((fixture) => fixture.name === 'level-1-roller')?.blueprint;
if (!roller) throw new Error('no level-1-roller fixture');

/** A challenge for the roller on the open floor: drive forward for `forTicks` ticks. */
const driveForward = (forTicks: number): Challenge => {
  const result = validateChallenge(
    {
      id: `drive-forward-${forTicks}`,
      kind: 'guided',
      level: 1,
      title: 'Drive forward',
      goalLine: 'Make the robot drive forward',
      goal: { kind: 'holds', when: { kind: 'forward-speed', target: { part: 'chassis' }, atLeast: 20 }, forTicks },
      arena: { preset: 'open-floor', props: [] },
      kit: 'rolling-start',
      hints: [],
    },
    loaded.content.catalogue,
  );
  if (!result.ok) throw new Error(result.issues.map((issue) => issue.message).join(' '));
  return result.value;
};

const short = driveForward(5);
const long = driveForward(60);
/** The content with the two test challenges in it, so their ids are ones the registry accepts. */
const content: ContentLoad = { ...loaded, content: { ...loaded.content, challenges: [...loaded.content.challenges, short, long] } };

const T0 = '2026-10-04T09:00:00.000Z';

const openChildren = async () => {
  const time = clock(T0);
  const name = freshName();
  const store = await openStoreWith(content, { name, now: time.now });
  const sam = await store.profiles.create('Sam');
  const ali = await store.profiles.create('Ali');
  return { store, name, time, sam: store.forProfile(sam.id), ali: store.forProfile(ali.id) };
};

describe('an event keeps the registry’s fields and nothing else', () => {
  const at = T0;
  it('keeps each kind with exactly its fields', () => {
    expect(eventOf('session-start', at, { mode: 'sandbox' }, content.content)).toEqual({ kind: 'session-start', at, mode: 'sandbox' });
    expect(eventOf('run', at, { challenge: short.id, runNumber: 2, goalMet: false }, content.content)).toEqual({
      kind: 'run',
      at,
      challenge: short.id,
      runNumber: 2,
      goalMet: false,
    });
    expect(eventOf('hint', at, { challenge: short.id, step: 'ghost-wire' }, content.content)).toEqual({ kind: 'hint', at, challenge: short.id, step: 'ghost-wire' });
    expect(eventOf('export', at, { what: 'parts-list' }, content.content)).toEqual({ kind: 'export', at, what: 'parts-list' });
  });

  it('refuses a kind not in the registry, a field more, a field missing, free text and a challenge the content does not have', () => {
    const anyEvent = eventOf as (kind: string, at: string, fields: unknown, c: typeof content.content) => unknown;
    expect(anyEvent('build-named', at, { name: 'My robot' }, content.content)).toBeUndefined();
    expect(anyEvent('export', at, { what: 'parts-list', name: 'My robot' }, content.content)).toBeUndefined();
    expect(anyEvent('run', at, { challenge: short.id, runNumber: 1 }, content.content)).toBeUndefined();
    expect(anyEvent('session-start', at, { mode: 'My robot' }, content.content)).toBeUndefined();
    expect(anyEvent('hint', at, { challenge: 'My robot', step: 'do-it' }, content.content)).toBeUndefined();
    expect(anyEvent('run', at, { challenge: short.id, runNumber: 1.5, goalMet: true }, content.content)).toBeUndefined();
    expect(anyEvent('toString', at, {}, content.content)).toBeUndefined();
  });
});

describe('keeping events on this device', { timeout: 60_000 }, () => {
  it('keeps each child’s events apart, in order, with one session start per opening, and never in sync’s outbox', async () => {
    const { store, name, time, sam, ali } = await openChildren();
    emitTelemetry(sam, 'session-start', { mode: 'challenge' });
    emitTelemetry(sam, 'session-start', { mode: 'sandbox' });
    time.set('2026-10-04T09:01:00.000Z');
    emitTelemetry(sam, 'hint', { challenge: short.id, step: 'pulse-part' });
    emitTelemetry(ali, 'export', { what: 'share-link' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    emitTelemetry(sam, 'export', { what: 'screenshot' } as unknown as TelemetryFields['export']);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
    expect(await telemetryOf(sam)).toEqual([
      { kind: 'session-start', at: T0, mode: 'challenge' },
      { kind: 'hint', at: '2026-10-04T09:01:00.000Z', challenge: short.id, step: 'pulse-part' },
    ]);
    expect(await telemetryOf(ali)).toEqual([{ kind: 'export', at: '2026-10-04T09:01:00.000Z', what: 'share-link' }]);
    // The app opening again for Sam is a new scope, so a new session.
    const again = store.forProfile(sam.profile);
    emitTelemetry(again, 'session-start', { mode: 'sandbox' });
    expect((await telemetryOf(again)).filter((event) => event.kind === 'session-start')).toHaveLength(2);
    // Sync never sees an event: nothing is waiting to go out but the two profiles.
    const outbox = await withDatabase(name, (db) => db.changes.toArray());
    expect(outbox.map((change) => change.collection)).toEqual(['profiles', 'profiles']);
    store.close();
  });

  it('keeps nothing for no child, for a scope the store did not open, or for a removed child', async () => {
    const { store, name, sam } = await openChildren();
    emitTelemetry(null, 'export', { what: 'parts-list' });
    const standIn = { ...sam } as ProfileStore;
    emitTelemetry(standIn, 'export', { what: 'parts-list' });
    expect(await telemetryOf(standIn)).toEqual([]);
    await store.profiles.remove(sam.profile);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    emitTelemetry(sam, 'export', { what: 'parts-list' });
    expect(await telemetryOf(sam)).toEqual([]);
    warn.mockRestore();
    expect(await withDatabase(name, (db) => db.telemetry.count())).toBe(0);
    store.close();
  });

  it('deletes a child’s events with their profile, and no one else’s', async () => {
    const { store, name, sam, ali } = await openChildren();
    emitTelemetry(sam, 'session-start', { mode: 'sandbox' });
    emitTelemetry(sam, 'export', { what: 'parts-list' });
    emitTelemetry(ali, 'session-start', { mode: 'challenge' });
    await telemetryOf(sam);
    await telemetryOf(ali);
    await store.profiles.remove(sam.profile);
    const rows = await withDatabase(name, (db) => db.telemetry.toArray());
    expect(rows.map((row) => [row.profile, row.event.kind])).toEqual([[ali.profile, 'session-start']]);
    store.close();
  });
});

class StandIn {
  mode: CanvasMode = 'build';
  blueprint: Blueprint | undefined = roller;
  setMode(mode: CanvasMode): void {
    this.mode = mode;
  }
  applyRunFrame(): void {}
  on(): () => void {
    return () => undefined;
  }
}

class TestClock implements RunClock {
  time = 0;
  private waiting: (() => void) | undefined;
  now(): number {
    return this.time;
  }
  frame(callback: () => void): () => void {
    this.waiting = callback;
    return () => {
      if (this.waiting === callback) this.waiting = undefined;
    };
  }
  advance(ms: number): void {
    this.time += ms;
    const callback = this.waiting;
    this.waiting = undefined;
    callback?.();
  }
}

const runner = async (child: ProfileStore, challenge: () => Challenge | null) => {
  const recorder = new RunRecorder({ child: () => child, challenge, catalogue: content.content.catalogue });
  const time = new TestClock();
  const loop = new RunLoop({
    canvas: new StandIn() as unknown as CanvasHandle,
    catalogue: content.content.catalogue,
    clock: time,
    seed: () => 11,
    onStart: (build) => recorder.start(build),
    onEnd: (simulation) => recorder.end(simulation),
  });
  recorder.prepare(roller);
  await recorder.settled();
  const runFor = async (ticks: number): Promise<void> => {
    // As the Run bar does when a challenge's build comes onto the canvas.
    recorder.prepare(roller);
    await recorder.settled();
    await loop.run();
    time.advance(SPIN_UP_MS);
    for (let tick = 1; tick < ticks; tick += 1) time.advance(1000 / 30);
    loop.stop();
    await recorder.settled();
  };
  return { loop, runFor };
};

describe('the hooks', { timeout: 60_000 }, () => {
  it('a challenge Run, once kept, is a run event; the first Run starts the session; a sandbox Run is no event', async () => {
    const { store, sam } = await openChildren();
    let challenge: Challenge | null = null;
    const { loop, runFor } = await runner(sam, () => challenge);
    await runFor(8);
    challenge = short;
    await runFor(8);
    challenge = long;
    await runFor(8);
    const events = await telemetryOf(sam);
    expect(events.map((event) => ({ ...event, at: undefined }))).toEqual([
      { kind: 'session-start', mode: 'sandbox' },
      { kind: 'run', challenge: short.id, runNumber: 1, goalMet: true },
      { kind: 'run', challenge: long.id, runNumber: 1, goalMet: false },
    ]);
    loop.dispose();
    store.close();
  });

  it('a session whose first Run is a challenge’s starts in the challenge', async () => {
    const { store, sam } = await openChildren();
    const { loop, runFor } = await runner(sam, () => short);
    await runFor(8);
    expect((await telemetryOf(sam))[0]).toMatchObject({ kind: 'session-start', mode: 'challenge' });
    loop.dispose();
    store.close();
  });

  it('the hint log tells its listener each step as it is used', () => {
    const heard: string[] = [];
    const log = new HintLog((use) => heard.push(use.step));
    log.add({ at: T0, step: 'pulse-part', trigger: 'asked' });
    log.add({ at: T0, step: 'do-it', trigger: 'asked' });
    expect(heard).toEqual(['pulse-part', 'do-it']);
    expect(log.pending(roller)).toHaveLength(2);
  });
});
