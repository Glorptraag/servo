// The child's app: the shell round the canvas, with the content's catalogue and art injected into the canvas
// (README, "How the packages meet"). Each slot holds its placeholder until the task that owns it lands; swap a
// placeholder for the real part here.
import { useMemo } from 'react';
import { mountCanvas } from '@servo/canvas';
import type { CanvasHandle, ResolveArt } from '@servo/canvas';
import type { Content } from '@servo/content';
import type { Blueprint, Level } from '@servo/schema';
import { PLACEHOLDER_SLOTS, SaveControl, Shell } from './shell/index.ts';
import type { Autosaver, CanvasSetup, ShellSlots } from './shell/index.ts';
import { SpecCard, createRunFrames } from './spec-card/index.ts';
import type { ProfileStore } from './store/index.ts';

/** A child starts at Level 1 (brief Section 2); the level comes from progress once task 5.2 records it. */
export const START_LEVEL: Level = 1;

export interface AppProps {
  readonly content: Content;
  /** The records of the child using the app (task 4.9), when there is one. */
  readonly child?: ProfileStore | null;
  /** The build the canvas opens with. */
  readonly start?: Blueprint | undefined;
  /** The autosave the app waits on before it closes the store. */
  readonly saving?: Autosaver;
  /** Called once the canvas is mounted. */
  readonly onReady?: () => void;
}

export const App = ({ content, child = null, start, saving, onReady }: AppProps) => {
  // The run loop (task 4.4) pushes each Run frame here for the spec card's live readouts.
  const runFrames = useMemo(createRunFrames, []);
  const slots = useMemo<ShellSlots>(
    () => ({ ...PLACEHOLDER_SLOTS, specCard: <SpecCard frames={runFrames} />, save: <SaveControl saving={saving} /> }),
    [saving, runFrames],
  );
  // The swap registry: a key with no picture gives undefined, and the canvas draws a neutral tile.
  const resolveArt: ResolveArt = (key) => content.art.get(key);
  const drawCanvas = (host: HTMLElement, setup: CanvasSetup): CanvasHandle =>
    mountCanvas(host, { catalogue: content.catalogue, resolveArt, level: setup.level, prefs: setup.prefs });
  // The canvas fits and zooms in the part of it the panels leave uncovered (D70, task 3.7).
  return (
    <Shell
      content={content}
      level={START_LEVEL}
      slots={slots}
      mountCanvas={drawCanvas}
      child={child}
      start={start}
      onReady={onReady}
      onSafeArea={(safeArea, canvas) => canvas.setSafeArea(safeArea)}
    />
  );
};
