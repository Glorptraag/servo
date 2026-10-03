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

  it('groups challenges by level in level order, keeping content order, and leaves out empty levels', () => {
    const of = (id: string, level: 1 | 2): Challenge => ({ id, level }) as Challenge;
    const groups = challengesByLevel([of('b', 2), of('a', 1), of('c', 2)]);
    expect(groups.map((group) => [group.level, group.challenges.map((challenge) => challenge.id)])).toEqual([
      [1, ['a']],
      [2, ['b', 'c']],
    ]);
  });
});
