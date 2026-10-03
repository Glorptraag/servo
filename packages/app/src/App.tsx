// The child's app: the shell round the canvas, with the content's catalogue and art injected into the canvas
// (README, "How the packages meet"). Each slot holds its placeholder until the task that owns it lands; swap a
// placeholder for the real part here.
import { useMemo } from 'react';
import { mountCanvas } from '@servo/canvas';
import type { CanvasHandle, ResolveArt } from '@servo/canvas';
import type { Content } from '@servo/content';
import type { Blueprint, Level } from '@servo/schema';
import { deviceFlags } from './flags/index.ts';
import type { Flags } from './flags/index.ts';
import { ProgramView, programFor, slotSetting } from './program-view/index.ts';
import { RunBar } from './run-bar/index.ts';
import type { RunLoop } from './run-bar/index.ts';
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
  // The run loop (task 4.4) gives each Run frame to the spec card's live readouts, which clear whenever no Run plays:
  // on Stop, on a failed Run, and while the next one loads.
  const runFrames = useMemo(createRunFrames, []);
  const joinRunLoop = useMemo(() => {
    let off: (() => void) | undefined;
    return (loop: RunLoop | null): void => {
      off?.();
      runFrames.clear();
      off = loop?.subscribe((state, frame) => {
        if (frame) runFrames.push(frame);
        else if (state.phase !== 'spin-up' && state.phase !== 'running') runFrames.clear();
      });
    };
  }, [runFrames]);
  // The Level 3 slot (task 6.6, README "Feature flags"): with the flag on, the servo motor's angle unlocks on its card,
  // a brain's card shows its program, and each Run drives the brains by it.
  const slot = flags['level-3-slot'];
  const program = useMemo(
    () => (slot ? (blueprint: Blueprint) => programFor(flags, blueprint, content.catalogue) : undefined),
    [slot, flags, content],
  );
  const slots = useMemo<ShellSlots>(
    () => ({
      ...PLACEHOLDER_SLOTS,
      specCard: (
        <>
          <SpecCard frames={runFrames} {...(slot ? { unlocked: slotSetting } : {})} />
          {slot && <ProgramView />}
        </>
      ),
      save: <SaveControl saving={saving} />,
      runBar: <RunBar onLoop={joinRunLoop} {...(program ? { program } : {})} />,
    }),
    [saving, runFrames, joinRunLoop, slot, program],
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
