// The shared page's reading of prefers-reduced-motion (task 5.6), as the canvas reads it: a page without matchMedia
// is taken as not asking.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { prefersReducedMotion } from '../../src/sharing/view.tsx';

afterEach(() => vi.unstubAllGlobals());

describe('prefersReducedMotion', () => {
  it('follows the page’s prefers-reduced-motion', () => {
    const asked: string[] = [];
    let reduce = true;
    vi.stubGlobal('matchMedia', (query: string) => (asked.push(query), { matches: reduce }));
    expect(prefersReducedMotion()).toBe(true);
    reduce = false;
    expect(prefersReducedMotion()).toBe(false);
    expect(asked).toEqual(['(prefers-reduced-motion: reduce)', '(prefers-reduced-motion: reduce)']);
  });

  it('is false where the page has no matchMedia', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(prefersReducedMotion()).toBe(false);
  });
});
