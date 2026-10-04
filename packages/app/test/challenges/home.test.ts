// Home's pure helpers (task 4.5): the name of a new sandbox build, the arena it starts in, and challenges by level.
import { describe, expect, it } from 'vitest';
import { loadContent } from '@servo/content';
import type { Challenge } from '@servo/schema';
import { challengesByLevel, nextBuildName, sandboxArena } from '../../src/challenges/home.tsx';

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

  it('lists a level by kind: part introductions, guided, breakdowns, what-ifs, then the unscripted build', () => {
    const of = (id: string, kind: Challenge['kind']): Challenge => ({ id, level: 1, kind }) as Challenge;
    const groups = challengesByLevel([
      of('cross-the-arena', 'unscripted-build'),
      of('drive-forward', 'guided'),
      of('meet-the-battery-pack', 'part-introduction'),
      of('meet-the-switch', 'part-introduction'),
      of('no-way-out', 'breakdown'),
      of('over-the-hill', 'guided'),
      of('what-if-one-wheel', 'what-if'),
    ]);
    expect(groups[0]?.challenges.map((challenge) => challenge.id)).toEqual([
      'meet-the-battery-pack',
      'meet-the-switch',
      'drive-forward',
      'over-the-hill',
      'no-way-out',
      'what-if-one-wheel',
      'cross-the-arena',
    ]);
  });

  it('puts the real Level 1 content in that order, so a child meets the battery pack first', () => {
    const level1 = challengesByLevel(content.challenges).find((group) => group.level === 1);
    const kinds = level1?.challenges.map((challenge) => challenge.kind) ?? [];
    expect(kinds[0]).toBe('part-introduction');
    expect(kinds.at(-1)).toBe('unscripted-build');
    const ranks = kinds.map((kind) => ['part-introduction', 'guided', 'breakdown', 'what-if', 'unscripted-build'].indexOf(kind));
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
  });
});
