import { describe, expect, it } from 'vitest';
import { v0ToV1 } from '../src/migrate/v0-to-v1.ts';
import { CORPUS_SIZE, outcomeOf, v0Document } from './v0-corpus.ts';
import hashesText from './v0-to-v1-hashes.json?raw';

// The v0 → v1 step is frozen, but it reads through live helpers: the reader kit, `idNumber` and
// `canonicalJson`. This pins its output over a seeded corpus, so an edit to any of them that changes what
// the step accepts, the ids it derives or the high-water marks it writes fails here, naming the documents.
// A failure is never fixed by rewriting the hashes: freeze a copy of the old helper in src/migrate instead
// (docs/migrations.md).

const pinned = JSON.parse(hashesText) as Record<string, string>;
const seeds = Array.from({ length: CORPUS_SIZE }, (_, index) => index + 1);

describe('the v0 → v1 step over a pinned corpus', () => {
  it('records a hash for each of the 200 seeded documents', () => {
    expect(CORPUS_SIZE).toBeGreaterThanOrEqual(200);
    expect(Object.keys(pinned)).toEqual(seeds.map(String));
  });

  it('writes exactly the pinned result for every document', () => {
    const changed = seeds.filter((seed) => outcomeOf(seed).hash !== pinned[String(seed)]);
    expect(changed).toEqual([]);
  });

  it('migrates three in four and refuses the rest, one defect each', () => {
    const refused = seeds.filter((seed) => !outcomeOf(seed).ok);
    expect(refused).toEqual(seeds.filter((seed) => seed % 4 === 0));
    for (const seed of refused) {
      const result = v0ToV1.migrate(v0Document(seed));
      expect(result.ok ? [] : result.issues).toHaveLength(1);
    }
  });

  it('covers the id forms idNumber reads differently', () => {
    const ids = new Set(seeds.flatMap((seed) => (v0Document(seed).parts as { id: string }[]).map((part) => part.id)));
    for (const id of ['p0', 'p007', 'p9007199254740991', 'p9007199254740992', 'pa', 'p3x', 'motor-left']) {
      expect(ids, id).toContain(id);
    }
  });

  it('builds the same corpus on every call', () => {
    expect(JSON.stringify(v0Document(17))).toBe(JSON.stringify(v0Document(17)));
  });
});
