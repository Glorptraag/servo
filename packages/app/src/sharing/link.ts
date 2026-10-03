// Shared links (task 5.6): one adult sends another a read-only link to a build. There is no backend (D10), so the link
// carries the build itself, compressed, in the URL fragment, which a browser never sends to a server. What it carries
// is a fresh blueprint made field by field from the build's parts, wires, arena, level and id marks: never the
// child's profile (meta.author), never the build's own id or dates, never a Run, and the build's name only when the
// adult leaves "include the build's name" ticked, which starts unticked (D21). Framework-free: no DOM beyond the
// web platform's CompressionStream, so Node's tests run it too. See the package README, "Shared links".

import { canonicalJson, canonicalizeBlueprint, migrateBlueprint, serializeBlueprint, validateBlueprint } from '@servo/schema';
import type { Blueprint, BlueprintMeta, Catalogue, Issue, Timestamp } from '@servo/schema';
import { uuidV4 } from '../store/uuid.ts';

/** The fragment's key: a shared link ends `#share=<format>.<payload>`. */
export const SHARE_KEY = 'share';

/** The link format. A newer one is refused as newer, never guessed at. */
export const LINK_FORMAT = 1;

/** The name a shared build carries when the adult leaves the build's own name out (D21, the default). */
export const SHARED_BUILD_NAME = 'Shared build';

/** The longest fragment read, in characters: far more than any Level 1–2 build needs, so a pasted wall of text is refused. */
export const MAX_FRAGMENT_LENGTH = 64 * 1024;

/** The most a payload may inflate to, in bytes, so a crafted link cannot fill the device's memory. */
export const MAX_DOCUMENT_BYTES = 1024 * 1024;

/** The only keys of `meta` a shared build carries. `author` is never among them (D21). */
export const SHARED_META_KEYS: readonly (keyof BlueprintMeta)[] = ['createdAt', 'highWater', 'id', 'level', 'name', 'updatedAt'];

export interface ShareOptions {
  /** D21: the build's own name travels only when this is true. Default false: the link says "Shared build". */
  readonly includeName?: boolean;
  /** The app's address the link opens: the page's origin and the app's base path. Default: this page's. */
  readonly base?: string;
  /** The clock for the shared copy's dates, as toISOString writes them. Tests pass a fixed one. */
  readonly now?: () => Timestamp;
  /** The shared copy's `meta.id`. Default a fresh UUID v4, so the link never names the child's build. */
  readonly newId?: () => string;
}

export type ShareResult =
  | { readonly ok: true; readonly url: string; readonly fragment: string; readonly blueprint: Blueprint }
  | { readonly ok: false; readonly issues: readonly Issue[] };

export type SharedRead =
  | {
      readonly ok: true;
      /** Migrated, validated and in canonical form. */
      readonly blueprint: Blueprint;
      /** Whether the adult who made the link included the build's name. */
      readonly named: boolean;
      /** The replay's seed: the same on every device that opens the link (seedOf). */
      readonly seed: number;
    }
  | {
      readonly ok: false;
      /** `newer`: made by a newer Servo. `refused`: incomplete, changed by hand, or not a build this content can run. */
      readonly reason: 'newer' | 'refused';
      readonly issues: readonly Issue[];
    };

/**
 * The blueprint a link carries: a new document with only the fields a build needs to be drawn and run. The parts,
 * wires and arena are the build's own; `meta` is rebuilt from nothing but the level and the id marks, with a fresh id
 * and the moment of sharing as both dates, and the build's name only when `includeName` is true. Whatever else the
 * object given holds (an author, a stored record's extras) is left behind.
 */
export const sharedCopyOf = (blueprint: Blueprint, options: ShareOptions = {}): Blueprint => {
  const at = (options.now ?? (() => new Date().toISOString()))();
  const meta: BlueprintMeta = {
    id: (options.newId ?? uuidV4)(),
    name: options.includeName === true ? blueprint.meta.name : SHARED_BUILD_NAME,
    level: blueprint.meta.level,
    createdAt: at,
    updatedAt: at,
    highWater: { parts: blueprint.meta.highWater.parts, wires: blueprint.meta.highWater.wires },
  };
  return { version: blueprint.version, parts: blueprint.parts, wires: blueprint.wires, arena: blueprint.arena, meta };
};

const issue = (path: string, message: string): Issue => ({ code: 'value.unreadable', path, message });

// ---------------------------------------------------------------------------------------------------------
// Bytes: deflate (zlib, with its Adler-32 check, so a changed or cut-off payload fails to inflate) and base64url.

const through = async (bytes: Uint8Array, stream: CompressionStream | DecompressionStream, limit: number): Promise<Uint8Array | undefined> => {
  const reader = new Blob([bytes as BlobPart]).stream().pipeThrough(stream).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        return undefined;
      }
      chunks.push(value);
    }
  } catch {
    return undefined;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
};

const toBase64Url = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromBase64Url = (text: string): Uint8Array | undefined => {
  if (!/^[A-Za-z0-9_-]+$/.test(text) || text.length % 4 === 1) return undefined;
  try {
    const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return undefined;
  }
};

// ---------------------------------------------------------------------------------------------------------
// Making a link

/** The fragment for a blueprint, as written: `#share=1.` and the canonical JSON, deflated, in base64url. */
export const fragmentOf = async (blueprint: Blueprint): Promise<string> => {
  const bytes = new TextEncoder().encode(serializeBlueprint(blueprint));
  const packed = await through(bytes, new CompressionStream('deflate'), Number.MAX_SAFE_INTEGER);
  if (!packed) throw new Error('The build could not be compressed.');
  return `#${SHARE_KEY}=${LINK_FORMAT}.${toBase64Url(packed)}`;
};

const pageBase = (): string => {
  const page = globalThis.location as Location | undefined;
  if (!page) throw new TypeError('shareLinkOf needs options.base outside a page.');
  return new URL(import.meta.env.BASE_URL, page.origin).href;
};

/**
 * The link an adult sends: the app's address with the shared copy of the build in its fragment. Checked against the
 * catalogue first, so a link always holds a build the app can run; a build that does not validate gives its issues
 * and no link. The parent view calls it behind the parental gate (D28); nothing in the child's view does.
 */
export const shareLinkOf = async (blueprint: Blueprint, catalogue: Catalogue, options: ShareOptions = {}): Promise<ShareResult> => {
  const checked = validateBlueprint(sharedCopyOf(blueprint, options), catalogue);
  if (!checked.ok) return { ok: false, issues: checked.issues };
  const shared = canonicalizeBlueprint(checked.value, catalogue);
  const fragment = await fragmentOf(shared);
  const base = new URL(options.base ?? pageBase());
  base.hash = '';
  return { ok: true, url: `${base.href}${fragment}`, fragment, blueprint: shared };
};

// ---------------------------------------------------------------------------------------------------------
// Opening a link

/** True when the page's fragment is a shared link (or looks like one), so the page opens the shared view, not the child's app. */
export const isShareFragment = (hash: string): boolean => hash.startsWith(`#${SHARE_KEY}=`);

const FRAGMENT = new RegExp(`^#${SHARE_KEY}=(\\d{1,6})\\.([A-Za-z0-9_-]+)$`);

const refused = (...issues: readonly Issue[]): SharedRead => ({ ok: false, reason: 'refused', issues });

/** FNV-1a over UTF-16 code units: unsigned 32-bit. */
const fnv1a = (text: string): number => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

/**
 * The replay's seed: a hash of the build's parts, wires and arena in canonical form, so everyone who opens a link to
 * the same build sees the same run, tick for tick (ground rule 2). The name, id and dates do not change it.
 */
export const seedOf = (blueprint: Blueprint): number => {
  const canonical = JSON.parse(serializeBlueprint(blueprint)) as Blueprint;
  return fnv1a(canonicalJson({ arena: canonical.arena, parts: canonical.parts, wires: canonical.wires }));
};

const hasOwn = (value: unknown, key: string): boolean =>
  typeof value === 'object' && value !== null && Object.prototype.hasOwnProperty.call(value, key);

/**
 * Reads a shared link's fragment (`location.hash`). Never throws. The payload must inflate within its checksum and
 * the size limit, parse as JSON, carry no `meta.author` and nothing but a blueprint's fields, migrate with
 * `migrateBlueprint` and validate against the catalogue; otherwise it is refused, and the page says so in one line.
 */
export const readShareFragment = async (hash: string, catalogue: Catalogue): Promise<SharedRead> => {
  if (hash.length > MAX_FRAGMENT_LENGTH) return refused(issue('$', 'The link is longer than any shared build.'));
  const match = FRAGMENT.exec(hash);
  if (!match) return refused(issue('$', 'The link is not a shared build.'));
  const format = Number(match[1]);
  if (format > LINK_FORMAT) {
    return { ok: false, reason: 'newer', issues: [{ code: 'blueprint.newer_version', path: '$', message: `Link format ${format} is newer than ${LINK_FORMAT}.` }] };
  }
  if (format !== LINK_FORMAT) return refused(issue('$', `No link format ${format}.`));
  const packed = fromBase64Url(match[2] ?? '');
  if (!packed) return refused(issue('$', 'The link is not base64url.'));
  const bytes = await through(packed, new DecompressionStream('deflate'), MAX_DOCUMENT_BYTES);
  if (!bytes) return refused(issue('$', 'The link is incomplete or has been changed: it does not inflate.'));
  let document: unknown;
  try {
    document = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return refused(issue('$', 'The link does not hold JSON.'));
  }
  // A link Servo made never names a child. One that does was made or changed by hand, and is not opened.
  if (hasOwn(document, 'meta') && hasOwn((document as { meta: unknown }).meta, 'author')) {
    return refused({ code: 'value.not_allowed', path: '$.meta.author', message: 'A shared build never carries an author.' });
  }
  const migrated = migrateBlueprint(document);
  if (!migrated.ok) {
    const newer = migrated.issues.some((found) => found.code === 'blueprint.newer_version');
    return { ok: false, reason: newer ? 'newer' : 'refused', issues: migrated.issues };
  }
  if (migrated.value.meta.author !== undefined) {
    return refused({ code: 'value.not_allowed', path: '$.meta.author', message: 'A shared build never carries an author.' });
  }
  const checked = validateBlueprint(migrated.value, catalogue);
  if (!checked.ok) return refused(...checked.issues);
  const blueprint = canonicalizeBlueprint(checked.value, catalogue);
  return { ok: true, blueprint, named: blueprint.meta.name !== SHARED_BUILD_NAME, seed: seedOf(blueprint) };
};
