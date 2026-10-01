// The child's app: the shell round the canvas, with the content's catalogue and art injected into the canvas
// (README, "How the packages meet"). Each slot holds its placeholder until the task that owns it lands; swap a
// placeholder for the real part here.
import { mountCanvas } from '@servo/canvas';
import type { CanvasHandle, ResolveArt } from '@servo/canvas';
import type { Content } from '@servo/content';
import type { Blueprint, Level } from '@servo/schema';
import { PLACEHOLDER_SLOTS, SaveControl, Shell } from './shell/index.ts';
import type { CanvasSetup, ShellSlots } from './shell/index.ts';
import type { ProfileStore } from './store/index.ts';

/** A child starts at Level 1 (brief Section 2); the level comes from progress once task 5.2 records it. */
export const START_LEVEL: Level = 1;

const SLOTS: ShellSlots = { ...PLACEHOLDER_SLOTS, save: <SaveControl /> };

export interface AppProps {
  readonly content: Content;
  /** The records of the child using the app (task 4.9), when there is one. */
  readonly child?: ProfileStore | null;
  /** The build the canvas opens with. */
  readonly start?: Blueprint | undefined;
  /** Called once the canvas is mounted. */
  readonly onReady?: () => void;
}

export const App = ({ content, child = null, start, onReady }: AppProps) => {
  // The swap registry: a key with no picture gives undefined, and the canvas draws a neutral tile.
  const resolveArt: ResolveArt = (key) => content.art.get(key);
  const drawCanvas = (host: HTMLElement, setup: CanvasSetup): CanvasHandle =>
    mountCanvas(host, { catalogue: content.catalogue, resolveArt, level: setup.level, prefs: setup.prefs });
  return <Shell content={content} level={START_LEVEL} slots={SLOTS} mountCanvas={drawCanvas} child={child} start={start} onReady={onReady} />;
};
