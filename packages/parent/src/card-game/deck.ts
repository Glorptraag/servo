// The card game's deck (task 5.4, D40): ten part types drawn from the Level 1–2 part records, in the order to show
// them. Which parts qualify comes from each record's `identity.level` (ground rule 1); nothing here knows a part by
// its id. Pure: the same content and seed give the same deck.
import type { Content } from '@servo/app/store';
import type { PartRecord, PartTypeId } from '@servo/schema';

/** Cards in a round (D40). */
export const DECK_SIZE = 10;

/** The highest level a card's part may be introduced at: the check is for the end of Level 2 (brief Section 14). */
export const DECK_LEVEL = 2;

/** The parts a deck may hold: each Level 1–2 part record once, in id order. */
export const deckParts = (content: Content): readonly PartRecord[] => {
  const byId = new Map(content.parts.filter((record) => record.identity.level <= DECK_LEVEL).map((record) => [record.id, record]));
  return [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
};

/** Mulberry32: a small seeded generator, so a seed always gives the same order. */
const generator = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/**
 * Ten part types, no repeats, shuffled by `seed`. With fewer than ten Level 1–2 parts in the content, every one of
 * them, shuffled; with none, an empty deck.
 */
export const drawCardsFrom = (content: Content, seed: number): readonly PartTypeId[] => {
  const ids = deckParts(content).map((record) => record.id);
  const next = generator(Number.isFinite(seed) ? Math.trunc(seed) : 0);
  for (let i = ids.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [ids[i], ids[j]] = [ids[j] as PartTypeId, ids[i] as PartTypeId];
  }
  return ids.slice(0, DECK_SIZE);
};
