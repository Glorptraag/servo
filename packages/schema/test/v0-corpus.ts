import { sha256, utf8 } from '../src/migrate/digest.ts';
import { v0ToV1 } from '../src/migrate/v0-to-v1.ts';

// A seeded corpus of version 0 documents that pins what the frozen v0 → v1 step writes. The step reads
// through the live reader kit and version 1's `idNumber` and `canonicalJson`. A drift in any of them
// changes a recorded hash (docs/migrations.md). Most documents migrate; one in four carries one defect,
// so the refusals are pinned too.

export const CORPUS_SIZE = 200;

/** mulberry32: a small fixed generator, so the same seed gives the same document on every engine. */
const generator = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
};

const PART_TYPES = ['battery-pack-2-cell', 'switch', 'led', 'dc-motor', 'chassis', 'wheel', 'caster', 'buzzer', 'motor-driver', 'gearbox'];
const PORTS = ['plus', 'minus', 'a', 'b', 'shaft', 'mount', 'm1', 'in', 'out'];
const ARENAS = ['open-floor', 'wall-stop', 'line-loop'];
const TITLES = [
  'Rolling start',
  'Light and motor',
  'Über build',
  'Two motors 🔋 one pack',
  'x',
  'A build with a name exactly sixty characters long, padded...',
  'Ünïcödé 名前',
];
const OPTION_VALUES = ['forward', 'backward', 'stop', 'green', 'red', 'on'];
// Ids that are slugs but not plain p<n> or w<n> numbers, and the edges of a safe whole number.
const ODD_NUMBERS = ['0', '007', '9007199254740991', '9007199254740992', 'a', '3x'];
const ODD_IDS = ['motor-left', 'front'];
const AUTHORS = ['0f8fad5b-d9cb-469f-a165-70867728950e', '7c9e6679-7425-40de-944b-e07fc1f90ae7'];

type Doc = Record<string, unknown>;
const meta = (doc: Doc): Doc => doc.meta as Doc;
const firstPart = (doc: Doc): Doc => (doc.parts as Doc[])[0] as Doc;

const DEFECTS: readonly ((doc: Doc) => void)[] = [
  (doc) => (firstPart(doc).turns = 4),
  (doc) => (meta(doc).title = ' Rolling start'),
  (doc) => (meta(doc).level = 0),
  (doc) => (meta(doc).created = -1),
  (doc) => (meta(doc).modified = 253_402_300_800_000),
  (doc) => (meta(doc).author = '0F8FAD5B-D9CB-469F-A165-70867728950E'),
  (doc) => (firstPart(doc).id = 'P1'),
  (doc) => (firstPart(doc).colour = 'green'),
  (doc) => (doc.arena = { preset: 'open-floor', props: [] }),
  (doc) => (doc.version = 1),
  (doc) => (firstPart(doc).position = { x: 1, y: Number.POSITIVE_INFINITY }),
  (doc) => (firstPart(doc).settings = { Speed: 50 }),
  (doc) => (meta(doc).title = 'x'.repeat(61)),
  (doc) => (doc.parts as Doc[]).push({ ...firstPart(doc) }),
  (doc) => (firstPart(doc).type = 'a'.repeat(65)),
  (doc) => delete meta(doc).created,
];

/** Version 0 document number `seed`, from 1 to CORPUS_SIZE. Every fourth one has one defect. */
export const v0Document = (seed: number): Doc => {
  const random = generator(seed);
  const int = (n: number): number => Math.floor(random() * n);
  const pick = <T>(list: readonly T[]): T => list[int(list.length)] as T;
  const ids = (prefix: 'p' | 'w', count: number): string[] => {
    const out: string[] = [];
    let n = int(3);
    while (out.length < count) {
      n += 1 + int(4);
      const roll = random();
      const id = roll < 0.08 ? `${prefix}${pick(ODD_NUMBERS)}` : roll < 0.12 ? pick(ODD_IDS) : `${prefix}${n}`;
      if (!out.includes(id)) out.push(id);
    }
    return out;
  };
  const coordinate = (): number => (random() < 0.7 ? int(801) - 400 : Math.round((random() * 800 - 400) * 1000) / 1000);
  const partIds = ids('p', 1 + int(7));
  const parts = partIds.map((id) => {
    const settings: Record<string, number | string> = {};
    for (let s = int(3); s > 0; s -= 1) {
      settings[pick(['speed', 'direction', 'colour', 'channel-a'])] = random() < 0.5 ? int(201) - 100 : pick(OPTION_VALUES);
    }
    return { id, type: pick(PART_TYPES), position: { x: coordinate(), y: coordinate() }, turns: int(4), settings };
  });
  const wires = ids('w', int(7)).map((id) => ({
    id,
    from: { part: pick(partIds), port: pick(PORTS) },
    to: { part: pick(partIds), port: pick(PORTS) },
  }));
  const created = int(2_000_000_000) * 1000 + int(1000);
  const metaRecord: Doc = {
    title: pick(TITLES),
    level: 1 + int(5),
    created,
    modified: created + int(10_000_000),
    ...(random() < 0.5 ? { author: pick(AUTHORS) } : {}),
  };
  const arena = pick(ARENAS);
  // Key order varies, so the derived id is shown to hash canonical form and not the order stored.
  const doc: Doc =
    random() < 0.5 ? { version: 0, parts, wires, arena, meta: metaRecord } : { meta: metaRecord, arena, wires, parts, version: 0 };
  if (seed % 4 === 0) DEFECTS[(seed / 4) % DEFECTS.length]?.(doc);
  return doc;
};

const hex = (bytes: Uint8Array): string => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

/**
 * What the step did with document `seed`: the migrated blueprint, or the code and path of every refusal
 * (messages are wording, not behaviour), hashed as the SHA-256 of its JSON.
 */
export const outcomeOf = (seed: number): { readonly ok: boolean; readonly hash: string } => {
  const result = v0ToV1.migrate(v0Document(seed));
  const outcome = result.ok ? { ok: true, value: result.value } : { ok: false, issues: result.issues.map(({ code, path }) => ({ code, path })) };
  return { ok: result.ok, hash: hex(sha256(utf8(JSON.stringify(outcome)))) };
};
