// The card game's deck and its rounds (task 5.4, D40), on the live content: ten Level 1–2 part types, no repeats,
// the same seed giving the same deck; a part of a later level never drawn; and each round kept for one child only,
// gone when that child is removed. In Node on fake-indexeddb.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadContent } from '@servo/content';
import type { Content } from '@servo/app/store';
import type { PartRecord } from '@servo/schema';
import { DECK_SIZE, drawCards, progressOf } from '../../src/index.ts';
import { DECK_LEVEL, deckParts } from '../../src/card-game/index.ts';
import { addChild, removeChild } from '../../src/accounts/index.ts';
import { memoryStorage, open } from '../accounts/support.ts';

const content = loadContent().content;
const levelOf = new Map(content.parts.map((record) => [record.id, record.identity.level]));

/** The live content with its parts replaced. */
const withParts = (parts: readonly PartRecord[]): Content => ({ ...content, parts });
const atLevel = (record: PartRecord, level: PartRecord['identity']['level'], id = record.id): PartRecord => ({
  ...record,
  id,
  identity: { ...record.identity, level },
});

describe('the deck', () => {
  it('is ten distinct Level 1–2 part types from the content', () => {
    expect(deckParts(content).length).toBeGreaterThanOrEqual(DECK_SIZE);
    for (let seed = 0; seed < 50; seed += 1) {
      const deck = drawCards(content, seed);
      expect(deck).toHaveLength(DECK_SIZE);
      expect(new Set(deck).size).toBe(DECK_SIZE);
      for (const part of deck) expect(levelOf.get(part)).toBeLessThanOrEqual(DECK_LEVEL);
    }
  });

  it('is the same for the same seed, and shuffled by the seed', () => {
    expect(drawCards(content, 7)).toEqual(drawCards(content, 7));
    const decks = new Set(Array.from({ length: 20 }, (_, seed) => drawCards(content, seed).join(' ')));
    expect(decks.size).toBeGreaterThan(15);
    // Over many rounds every Level 1–2 part comes up.
    const drawn = new Set(Array.from({ length: 200 }, (_, seed) => drawCards(content, seed)).flat());
    expect([...drawn].sort()).toEqual(deckParts(content).map((record) => record.id));
  });

  it('never draws a part introduced after Level 2', () => {
    const later = content.parts.map((record, index) => atLevel(record, 3, `later-${index}`));
    const mixed = withParts([...content.parts, ...later]);
    for (let seed = 0; seed < 50; seed += 1) {
      for (const part of drawCards(mixed, seed)) expect(part.startsWith('later-')).toBe(false);
    }
  });

  it('holds every Level 1–2 part when there are fewer than ten, and none when there are none', () => {
    const few = content.parts.slice(0, 4).map((record) => atLevel(record, 1));
    const rest = content.parts.slice(4).map((record) => atLevel(record, 3));
    expect([...drawCards(withParts([...few, ...rest]), 3)].sort()).toEqual(few.map((record) => record.id).sort());
    expect(drawCards(withParts(rest), 3)).toEqual([]);
  });

  it('takes any number as a seed', () => {
    for (const seed of [-1, 0.5, 2 ** 40, Number.NaN, Number.POSITIVE_INFINITY]) expect(drawCards(content, seed)).toHaveLength(DECK_SIZE);
  });
});

describe('a round kept for a child', () => {
  beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()));
  afterEach(() => vi.unstubAllGlobals());

  it('is kept for that child alone, the latest counts, and it goes when the child is removed', async () => {
    const store = await open();
    try {
      const robin = await addChild(store, 'Robin');
      const sam = await addChild(store, 'Sam');
      const robins = store.forProfile(robin.id);
      const deck = drawCards(store.content, 11);
      await robins.cardGames.add(deck.map((part) => ({ part, named: false })));
      const latest = await robins.cardGames.add(deck.map((part, index) => ({ part, named: index < 8 })));

      expect(await store.forProfile(sam.id).cardGames.list()).toEqual([]);
      expect((await robins.cardGames.latest())?.id).toBe(latest.id);
      const progress = progressOf({ runs: [], content: store.content, cardGames: await robins.cardGames.list() });
      expect(progress.partsNamed).toEqual({ named: 8, of: DECK_SIZE, playedAt: latest.playedAt });

      await removeChild(store, robin.id);
      expect(await store.forProfile(robin.id).cardGames.list()).toEqual([]);
    } finally {
      store.close();
    }
  });
});
