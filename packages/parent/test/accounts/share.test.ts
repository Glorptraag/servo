// The parent view's shared links (task 5.6), in Node on fake-indexeddb: a link to one of the child in use's builds
// holds nothing of any child, the build's name only when asked (D21), and no link is made for another child's build.
// Each link made is an export event (task 6.2); a refused one is none.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SHARED_BUILD_NAME, telemetryOf } from '@servo/app/store';
import { ShareRefused, addChild, shareLinkFor } from '../../src/accounts/index.ts';
import { memoryStorage, open, plainFloor } from './support.ts';

const BASE = 'https://servo.example/';

beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()));
afterEach(() => vi.unstubAllGlobals());

/** The text a link's fragment carries, inflated by hand. */
const payloadOf = async (url: string): Promise<string> => {
  const packed = Buffer.from(url.slice(url.indexOf('.', url.indexOf('#')) + 1), 'base64url');
  const stream = new Blob([new Uint8Array(packed)]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new TextDecoder().decode(await new Response(stream).arrayBuffer());
};

describe('a shared link from the parent view', () => {
  it('holds the child in use’s build and nothing of any child; the name only when asked', async () => {
    const store = await open();
    try {
      const robin = await addChild(store, 'Robin Achebe');
      const sam = await addChild(store, 'Sam');
      const rocket = await store.forProfile(robin.id).blueprints.create(plainFloor('Robin rocket'));
      const url = await shareLinkFor(store, rocket.meta.id, false, BASE);
      expect(url.startsWith(`${BASE}#share=1.`)).toBe(true);
      const text = await payloadOf(url);
      const payload = JSON.parse(text) as { meta: Record<string, unknown> };
      expect(payload.meta.name).toBe(SHARED_BUILD_NAME);
      for (const absent of [robin.id, robin.name, 'Robin', 'Achebe', sam.id, rocket.meta.id, 'author']) expect(text).not.toContain(absent);
      const named = await payloadOf(await shareLinkFor(store, rocket.meta.id, true, BASE));
      expect((JSON.parse(named) as { meta: Record<string, unknown> }).meta.name).toBe('Robin rocket');
      expect(named).not.toContain(robin.id);
      expect(named).not.toContain('author');
      // Each link made is one export event for the child whose build it is (task 6.2), and keeps nothing else.
      const events = await telemetryOf(store.forProfile(robin.id));
      expect(events.map((event) => ({ ...event, at: undefined }))).toEqual([
        { kind: 'export', what: 'share-link' },
        { kind: 'export', what: 'share-link' },
      ]);
      expect(await telemetryOf(store.forProfile(sam.id))).toEqual([]);
    } finally {
      store.close();
    }
  });

  it('makes no link for a build that is not the child in use’s', async () => {
    const store = await open();
    try {
      const robin = await addChild(store, 'Robin');
      const sam = await addChild(store, 'Sam');
      await store.profiles.use(robin.id);
      const sorter = await store.forProfile(sam.id).blueprints.create(plainFloor('Sam sorter'));
      await expect(shareLinkFor(store, sorter.meta.id, true, BASE)).rejects.toBeInstanceOf(ShareRefused);
      await expect(shareLinkFor(store, crypto.randomUUID(), false, BASE)).rejects.toBeInstanceOf(ShareRefused);
      expect(await telemetryOf(store.forProfile(robin.id))).toEqual([]);
    } finally {
      store.close();
    }
  });
});
