// The child's app: the shell round the canvas, with the content's catalogue and art injected into the canvas
// (README, "How the packages meet"). Each slot holds its placeholder until the task that owns it lands; swap a
// placeholder for the real part here. A challenge chosen on Home lays its goal line, kit, level and arena over the
// same canvas (task 4.5), with the hint button beside the goal (task 4.6).
import { useEffect, useMemo, useRef, useState } from 'react';
import { mountCanvas } from '@servo/canvas';
import type { CanvasHandle, ResolveArt } from '@servo/canvas';
import type { Content } from '@servo/content';
import type { Blueprint, Challenge, Level } from '@servo/schema';
import { ArenaStrip, CHALLENGE_TEXT, GoalLine, Home, PARENT_PAGE } from './challenges/index.ts';
import { deviceFlags } from './flags/index.ts';
import type { Flags } from './flags/index.ts';
import { HintButton, HintLog } from './hints/index.ts';
import { ProgramView, programFor, slotSetting } from './program-view/index.ts';
import { RunBar } from './run-bar/index.ts';
import type { RunLoop } from './run-bar/index.ts';
import { PLACEHOLDER_SLOTS, SaveControl, Shell, pageStorage } from './shell/index.ts';
import type { Autosaver, CanvasSetup, ShellSlots } from './shell/index.ts';
import { SoundControl, SoundLayer, WebAudioSink } from './sound/index.ts';
import { SpecCard, createRunFrames, followRun } from './spec-card/index.ts';
import type { ProfileStore } from './store/index.ts';
import { emitTelemetry } from './telemetry/emit.ts';
import { Tray, kitForLevel } from './tray/index.ts';

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
  // The sandbox tray holds the kit at the child's level; a challenge brings its own kit (D68, task 4.5).
  const kit = useMemo(() => kitForLevel(content.kits, START_LEVEL), [content]);
  // The run loop (task 4.4) gives Run frames to the spec card's live readouts (followRun, task 6.1: every tick in slow
  // motion, every third tick and any tick a switch or a fault changes from 15 a second, the last one held back handed
  // over at any change without a frame), which clear whenever no Run plays:
  // on Stop, on a failed Run, and while the next one loads.
  // The goal line judges the same loop's frames (task 4.5).
  const runFrames = useMemo(createRunFrames, []);
  const [loop, setLoop] = useState<RunLoop | null>(null);
  // The sound layer (task 4.10) hears the same loop, and the canvas's edits through its control in the header.
  const [sound] = useState(() => new SoundLayer({ sink: new WebAudioSink(), storage: pageStorage() }));
  useEffect(() => () => sound.dispose(), [sound]);
  const joinRunLoop = useMemo(() => {
    let off: (() => void) | undefined;
    return (joined: RunLoop | null): void => {
      off?.();
      runFrames.clear();
      setLoop(joined);
      sound.follow(joined);
      off = joined?.subscribe(followRun(runFrames));
    };
  }, [runFrames, sound]);
  // A challenge chosen on Home lays its goal line, kit, level and arena over the same canvas (task 4.5); none is the sandbox.
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  // The hint steps used (task 4.6): the hint button adds them, and the Run bar keeps them in the next Run's record.
  // Each step used is also a `hint` event (telemetry, task 6.2), about the challenge on the canvas as it is used.
  const onCanvas = useRef({ child, challenge });
  onCanvas.current = { child, challenge };
  const [hints] = useState(
    () =>
      new HintLog((use) => {
        const { child: user, challenge: on } = onCanvas.current;
        if (on) emitTelemetry(user, 'hint', { challenge: on.id, step: use.step });
      }),
  );
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
      tray: <Tray />,
      home: (
        <Home
          challenge={challenge}
          onChallenge={setChallenge}
          sandboxLevel={START_LEVEL}
          loop={loop}
          saving={saving}
          parentEntry={
            <a className="shell-button home-parent-link" href={`${import.meta.env.BASE_URL}${PARENT_PAGE}`}>
              {CHALLENGE_TEXT.forAdults}
            </a>
          }
        />
      ),
      goal: <GoalLine challenge={challenge} loop={loop} />,
      hints: <HintButton challenge={challenge} loop={loop} log={hints} />,
      arenaStrip: <ArenaStrip challenge={challenge} />,
      specCard: (
        <>
          <SpecCard frames={runFrames} {...(slot ? { unlocked: slotSetting } : {})} />
          {slot && <ProgramView />}
        </>
      ),
      sound: <SoundControl layer={sound} />,
      save: <SaveControl saving={saving} />,
      runBar: <RunBar onLoop={joinRunLoop} challenge={challenge} hints={hints} {...(program ? { program } : {})} />,
    }),
    [saving, runFrames, joinRunLoop, sound, slot, program, challenge, loop, hints],
  );
  // The swap registry: a key with no picture gives undefined, and the canvas draws a neutral tile.
  const resolveArt: ResolveArt = (key) => content.art.get(key);
  const drawCanvas = (host: HTMLElement, setup: CanvasSetup): CanvasHandle =>
    mountCanvas(host, { catalogue: content.catalogue, resolveArt, level: setup.level, prefs: setup.prefs, ...(slot ? { unlockSettings: slotSetting } : {}) });
  // The canvas fits and zooms in the part of it the panels leave uncovered (D70, task 3.7).
  return (
    <Shell
      content={content}
      level={challenge?.level ?? START_LEVEL}
      kit={challenge ? content.catalogue.kits?.get(challenge.kit) : kit}
      slots={slots}
      mountCanvas={drawCanvas}
      child={child}
      start={start}
      onReady={onReady}
      onSafeArea={(safeArea, canvas) => canvas.setSafeArea(safeArea)}
    />
  );
};
