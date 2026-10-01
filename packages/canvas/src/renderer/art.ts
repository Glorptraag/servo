// Part pictures, only through the injected `resolveArt` (the swap registry, ground rule 12). A key the registry
// lacks, or a picture that fails to load, gets the neutral tile with the part's real name.
import { Assets } from 'pixi.js';
import type { Texture } from 'pixi.js';
import type { AssetKey } from '@servo/schema';
import type { ResolveArt } from '../interface.ts';

export type ArtState =
  | { readonly status: 'none' }
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly texture: Texture }
  | { readonly status: 'failed' };

/**
 * Vector pictures (the placeholders are SVG, 160 px on their longer side) are rasterised at this many pixels per
 * CSS pixel: sharp on a 2× screen up to about 200% zoom, and about 1.2 MB of texture per part type.
 */
export const ART_RESOLUTION = 4;

const NONE: ArtState = { status: 'none' };
const LOADING: ArtState = { status: 'loading' };
const FAILED: ArtState = { status: 'failed' };

export class ArtStore {
  private readonly states = new Map<AssetKey, ArtState>();
  private readonly resolveArt: ResolveArt;
  private readonly arrived: (key: AssetKey) => void;
  private closed = false;

  /** `arrived` is called when a picture finishes loading or fails, so the canvas can redraw that part. */
  constructor(resolveArt: ResolveArt, arrived: (key: AssetKey) => void) {
    this.resolveArt = resolveArt;
    this.arrived = arrived;
  }

  /** The picture for `key`, starting its load the first time it is asked for. */
  get(key: AssetKey): ArtState {
    const known = this.states.get(key);
    if (known) return known;
    let source;
    try {
      source = this.resolveArt(key);
    } catch {
      source = undefined;
    }
    if (!source) {
      this.states.set(key, NONE);
      return NONE;
    }
    this.states.set(key, LOADING);
    Assets.load<Texture>({ src: source.src, data: { resolution: ART_RESOLUTION } }).then(
      (texture) => this.settle(key, texture ? { status: 'ready', texture } : FAILED),
      () => this.settle(key, FAILED),
    );
    return LOADING;
  }

  /** How many pictures are still loading. */
  get pending(): number {
    let count = 0;
    for (const state of this.states.values()) if (state.status === 'loading') count++;
    return count;
  }

  close(): void {
    this.closed = true;
  }

  private settle(key: AssetKey, state: ArtState): void {
    if (this.closed) return;
    this.states.set(key, state);
    this.arrived(key);
  }
}
