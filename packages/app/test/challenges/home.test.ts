// Home's pure helpers (task 4.5): the name of a new sandbox build, the arena it starts in, and challenges by level.
import { describe, expect, it } from 'vitest';
import { loadContent } from '@servo/content';
import type { Challenge } from '@servo/schema';
import { KIND_ORDER, challengesByLevel, metChallenges, nextBuildName, sandboxArena } from '../../src/challenges/home.tsx';

const { content } = loadContent();

describe('Home', () => {
  it('names a new build one past the highest "Build n" the child has', () => {
    expect(nextBuildName([])).toBe('Build 1');
    expect(nextBuildName([{ name: 'Build 1' }, { name: 'Build 4' }, { name: 'Rolling robot' }, { name: 'Build 2 copy' }])).toBe('Build 5');
  });

  it('starts a sandbox build on the open floor, with no props', () => {
    expect(sandboxArena(content)).toEqual({ preset: 'open-floor', props: [] });
    expect(sandboxArena({ ...content, arenas: [] })).toBeUndefined();
  });

  it('groups challenges by level in level order, keeping content order within a kind, and leaves out empty levels', () => {
    const of = (id: string, level: 1 | 2): Challenge => ({ id, level, kind: 'guided' }) as Challenge;
    const groups = challengesByLevel([of('b', 2), of('a', 1), of('c', 2)]);
    expect(groups.map((group) => [group.level, group.challenges.map((challenge) => challenge.id)])).toEqual([
      [1, ['a']],
      [2, ['b', 'c']],
    ]);
  });

  it('orders a level along the path: part introductions, guided, breakdowns, what-ifs, then the unscripted build', () => {
    const of = (id: string, kind: Challenge['kind']): Challenge => ({ id, level: 1, kind }) as Challenge;
    const groups = challengesByLevel([of('cross', 'unscripted-build'), of('drive', 'guided'), of('meet-b', 'part-introduction'), of('no-way', 'breakdown'), of('meet-a', 'part-introduction'), of('what-if', 'what-if')]);
    // Within a kind the order given (content's) is kept: meet-b stays before meet-a.
    expect(groups[0]?.challenges.map((challenge) => challenge.id)).toEqual(['meet-b', 'meet-a', 'drive', 'no-way', 'what-if', 'cross']);
    // Every kind of challenge has its place on the path.
    expect([...KIND_ORDER].sort()).toEqual([...new Set(content.challenges.map((challenge) => challenge.kind))].sort());
  });

  it('orders a level by its authored order when it has one, with the path as the fallback', () => {
    const of = (id: string, kind: Challenge['kind'], order?: number): Challenge => ({ id, level: 1, kind, ...(order === undefined ? {} : { order }) }) as Challenge;
    const ordered = challengesByLevel([of('cross', 'unscripted-build', 2), of('meet', 'part-introduction', 3), of('drive', 'guided', 1)]);
    expect(ordered[0]?.challenges.map((challenge) => challenge.id)).toEqual(['drive', 'cross', 'meet']);
    // A level where only some have an order (which the content validator refuses) still lists along the path.
    const mixed = challengesByLevel([of('cross', 'unscripted-build', 1), of('meet', 'part-introduction'), of('drive', 'guided', 2)]);
    expect(mixed[0]?.challenges.map((challenge) => challenge.id)).toEqual(['meet', 'drive', 'cross']);
  });

  it("lists every real level in its authored order: a part introduction first and the unscripted build last", () => {
    for (const group of challengesByLevel(content.challenges)) {
      const orders = group.challenges.map((challenge) => challenge.order);
      expect(orders).toEqual([...orders].sort((a, b) => (a ?? 0) - (b ?? 0)));
      expect(group.challenges[0]?.kind).toBe('part-introduction');
      expect(group.challenges.at(-1)?.kind).toBe('unscripted-build');
    }
  });

  it('reads the challenges met from the run records: a challenge Run whose goal was met, once however many times', () => {
    const met = metChallenges([
      { challenge: 'drive-forward', goal: { met: true, tick: 40 } },
      { challenge: 'drive-forward', goal: { met: false } },
      { challenge: 'push-the-box', goal: { met: false } },
      { goal: { met: true, tick: 1 } },
      {},
      { challenge: 'drive-forward', goal: { met: true, tick: 12 } },
    ]);
    expect([...met]).toEqual(['drive-forward']);
    expect(metChallenges([]).size).toBe(0);
  });
});
