// The child's app: the shell round the canvas, with the content's catalogue and art injected into the canvas
// (README, "How the packages meet"). Each slot holds its placeholder until the task that owns it lands; swap a
// placeholder for the real part here.
import { useMemo } from 'react';
import { mountCanvas } from '@servo/canvas';
import type { CanvasHandle, ResolveArt } from '@servo/canvas';
import type { Content } from '@servo/content';
import type { Blueprint, Level } from '@servo/schema';
import { deviceFlags, settingsLevel } from './flags/index.ts';
import type { Flags } from './flags/index.ts';
import { ProgramView } from './program-view/index.ts';
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
  /** The feature flags (task 6.6). Default this device's, read once as the app mounts. */
  readonly flags?: Flags;
}

export const App = ({ content, child = null, start, saving, onReady, flags: givenFlags }: AppProps) => {
  const flags = useMemo(() => givenFlags ?? deviceFlags(), [givenFlags]);
  // The run loop (task 4.4) pushes each Run frame here for the spec card's live readouts.
  const runFrames = useMemo(createRunFrames, []);
  // With the Level 3 slot on, Level 3 settings unlock on the card and in the canvas's list view, and a brain's card
  // shows its program. The shell's level stays START_LEVEL, so it never calls canvas.setLevel, which would set the
  // canvas back to the child's level; task 5.2 must map that through settingsLevel too (README, "Feature flags").
  const unlockLevel = settingsLevel(START_LEVEL, flags);
  const slots = useMemo<ShellSlots>(
    () => ({
      ...PLACEHOLDER_SLOTS,
      specCard: (
        <>
          <SpecCard frames={runFrames} unlockLevel={unlockLevel} />
          {flags['level-3-slot'] && <ProgramView />}
        </>
      ),
      save: <SaveControl saving={saving} />,
    }),
    [saving, runFrames, unlockLevel, flags],
  );
  // The swap registry: a key with no picture gives undefined, and the canvas draws a neutral tile.
  const resolveArt: ResolveArt = (key) => content.art.get(key);
  const drawCanvas = (host: HTMLElement, setup: CanvasSetup): CanvasHandle =>
    mountCanvas(host, { catalogue: content.catalogue, resolveArt, level: settingsLevel(setup.level, flags), prefs: setup.prefs });
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
