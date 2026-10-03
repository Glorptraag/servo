// The real placeholder pictures for the part records the canvas's tests use, from test/fixtures/placeholder-art.json:
// a copy of what `pnpm art` draws (packages/tools, placeholderSvg), because the canvas never imports tools. Tools
// checks the copy against the generator (packages/tools/test/canvas-fixture-copies.test.ts).
import type { AssetKey, Catalogue, PartRecord } from '@servo/schema';
import type { ArtSource, ResolveArt } from '../../src/interface.ts';
import { svgProportions } from '../../src/renderer/picture.ts';
import type { Proportions } from '../../src/renderer/picture.ts';
import type { ArtOf } from '../../src/routing/router.ts';
import data from '../fixtures/placeholder-art.json' with { type: 'json' };
import { benchCatalogue } from './busy-workbench.ts';
import { catalogue } from './catalogue.ts';
import { crewCatalogue } from './circuit-crew.ts';

type Pictures = Readonly<Record<string, string>>;

/** The schema's example parts draw from `schema`; content's records (busy workbench, Circuit Crew) from `content`. */
const setOf = (parts: Catalogue): Pictures => (parts === catalogue ? data.schema : data.content);

const byRecord = new Map<PartRecord, Proportions>();
for (const parts of [catalogue, benchCatalogue, crewCatalogue]) {
  for (const record of parts.parts.values()) {
    const svg = setOf(parts)[record.identity.art];
    const proportions = svg === undefined ? undefined : svgProportions(svg);
    if (proportions) byRecord.set(record, proportions);
  }
}

/** Each part's placeholder picture's proportions, as the renderer will have them once it loads. */
export const placeholderArtOf: ArtOf = (part) => byRecord.get(part.record);

/** No picture loaded: the router keeps clear of the whole room a picture may take. */
export const noArt: ArtOf = () => undefined;

/** A resolveArt serving the real placeholder pictures for a catalogue's records, as data URLs. */
export const placeholderResolver = (parts: Catalogue): ResolveArt => {
  const pictures = setOf(parts);
  return (key: AssetKey): ArtSource | undefined => {
    const svg = pictures[key];
    return svg === undefined ? undefined : { src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, isPlaceholder: true };
  };
};
