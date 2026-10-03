// The Parts Library's model (src/library/catalogue.ts): the whole catalogue on one shelf per family, and the family
// and domain filters, from the part records alone.
import { describe, expect, it } from 'vitest';
import { loadContent } from '@servo/content';
import { DOMAINS, PART_FAMILIES } from '@servo/schema';
import { ALL, NO_FILTER, domainOptions, familyOptions, libraryShelves } from '../../src/library/catalogue.ts';

const { content } = loadContent();
const parts = content.parts;
const ids = (shelves: ReturnType<typeof libraryShelves>): string[] => shelves.flatMap((shelf) => shelf.cards.map((card) => card.part)).sort();

describe('libraryShelves', () => {
  it('shows the whole catalogue with no filter, each part once, on its family shelf in the taxonomy order', () => {
    const shelves = libraryShelves(parts, NO_FILTER, content.art);
    expect(ids(shelves)).toEqual(parts.map((part) => part.id).sort());
    const order = PART_FAMILIES.map((family) => family.id);
    expect(shelves.map((shelf) => order.indexOf(shelf.family))).toEqual([...shelves.map((shelf) => order.indexOf(shelf.family))].sort((a, b) => a - b));
    for (const shelf of shelves) {
      expect(shelf.cards.length).toBeGreaterThan(0);
      for (const card of shelf.cards) expect(card.family).toBe(shelf.family);
    }
  });

  it('orders each shelf by the level a part is introduced at, then by name', () => {
    for (const shelf of libraryShelves(parts, NO_FILTER)) {
      const keys = shelf.cards.map((card) => [card.level, card.name] as const);
      expect(keys).toEqual([...keys].sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1], 'en')));
    }
  });

  it('filters by family', () => {
    for (const family of familyOptions(parts)) {
      const shelves = libraryShelves(parts, { family: family.id, domain: ALL });
      expect(shelves.map((shelf) => shelf.family)).toEqual([family.id]);
      expect(ids(shelves)).toEqual(parts.filter((part) => part.identity.family === family.id).map((part) => part.id).sort());
    }
  });

  it('filters by domain', () => {
    for (const domain of domainOptions(parts)) {
      const shelves = libraryShelves(parts, { family: ALL, domain: domain.id });
      expect(ids(shelves)).toEqual(parts.filter((part) => part.identity.domains.includes(domain.id)).map((part) => part.id).sort());
    }
  });

  it('filters by family and domain together, and may find nothing', () => {
    let empty = 0;
    for (const family of familyOptions(parts)) {
      for (const domain of domainOptions(parts)) {
        const shelves = libraryShelves(parts, { family: family.id, domain: domain.id });
        const expected = parts.filter((part) => part.identity.family === family.id && part.identity.domains.includes(domain.id));
        expect(ids(shelves)).toEqual(expected.map((part) => part.id).sort());
        if (expected.length === 0) {
          expect(shelves).toEqual([]);
          empty++;
        }
      }
    }
    expect(empty).toBeGreaterThan(0);
  });
});

describe('the filter options', () => {
  it('offers only families and domains that hold a part, in the taxonomy order', () => {
    const families = familyOptions(parts).map((option) => option.id);
    expect(families).toEqual(PART_FAMILIES.map((family) => family.id).filter((id) => parts.some((part) => part.identity.family === id)));
    const domains = domainOptions(parts).map((option) => option.id);
    expect(domains).toEqual(DOMAINS.map((domain) => domain.id).filter((id) => parts.some((part) => part.identity.domains.includes(id))));
    for (const option of [...familyOptions(parts), ...domainOptions(parts)]) expect(option.label).not.toMatch(/!/);
  });
});
