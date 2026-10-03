// What the hint tests share: content fixtures by name, and the schema's example challenges validated against the real
// content. Content has no challenges yet (tasks 4.7 and 4.8), as in test/browser/challenges.test.tsx.
import { loadContent } from '@servo/content';
import { loadFixtures } from '@servo/content/fixtures';
import type { ContentFixture } from '@servo/content/fixtures';
import { validateChallenge } from '@servo/schema';
import type { Blueprint, Challenge } from '@servo/schema';
import { exampleChallenges } from '@servo/schema/fixtures';

const { catalogue } = loadContent().content;
const fixtures = loadFixtures().fixtures;

export const contentFixture = (name: string): ContentFixture => {
  const found = fixtures.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`no ${name} fixture`);
  return found;
};

export const fixture = (name: string): Blueprint => contentFixture(name).blueprint;

/** An example challenge, optionally starting from `start`, as content would give it. */
export const example = (name: string, start?: Blueprint): Challenge => {
  const data = exampleChallenges.find((candidate) => candidate.name === name)?.data as Challenge;
  const result = validateChallenge(start ? { ...data, start } : data, catalogue);
  if (!result.ok) throw new Error(`${name}: ${result.issues.map((issue) => issue.message).join(' ')}`);
  return result.value;
};
