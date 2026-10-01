// The flows the parent's README documents, written against @servo/app/store and this package's interface only.
// They are type-checked with the package, so an interface change that breaks them fails `pnpm typecheck`.
import { describe, expect, it } from 'vitest';
import type { ProfileId } from '@servo/schema';
import { openStore } from '@servo/app/store';
import type { ServoStore } from '@servo/app/store';
import { drawCards, mountParent, partsListOf, progressOf } from '../src/index.ts';
import type { Progress } from '../src/index.ts';

const progressFor = async (store: ServoStore, profile: ProfileId): Promise<Progress> => {
  const child = store.forProfile(profile);
  return progressOf({ runs: await child.runs.list(), content: store.content, cardGames: await child.cardGames.list() });
};

/** One round of the card game: the adult's marks, kept for the child. */
const playRound = async (store: ServoStore, profile: ProfileId, named: (part: string) => boolean) =>
  store.forProfile(profile).cardGames.add(drawCards(store.content, 7).map((part) => ({ part, named: named(part) })));

describe('the contracts the parent view builds against', () => {
  it('has typed stubs that refuse until their tasks land', async () => {
    await expect(openStore()).rejects.toThrow(/task 4\.9/);
    expect(() => progressOf({ runs: [], content: {} as ServoStore['content'], cardGames: [] })).toThrow(/task 5\.2/);
    expect(() => partsListOf({} as Parameters<typeof partsListOf>[0], {} as Parameters<typeof partsListOf>[1])).toThrow(/task 5\.3/);
    expect(() => drawCards({} as ServoStore['content'], 1)).toThrow(/task 5\.4/);
    expect(() => mountParent({} as HTMLElement, {} as ServoStore)).toThrow(/task 5\.1/);
    expect([progressFor, playRound].every((flow) => typeof flow === 'function')).toBe(true);
  });
});
