// Home (D68): the header's Home button, and the minimal Home it opens over the shell. From Home the child starts a
// sandbox build, opens a saved build (the store, task 4.9), or picks a challenge by level. A challenge is laid over the
// same canvas (brief Section 9): Home loads its build and the app shows its goal line, its kit and its arena; there is
// no lesson screen. A Run in progress stops first, and Save stores what waits before another build comes in. Native
// buttons throughout, so touch, pointer, keyboard and screen readers take one path (ground rule 8); Escape and "Back to
// the build" close it. Home leaves a named spot for the gated parent entry, which task 5.2 fills (D91). A build Home
// opens names the mode the child's session started in, if no Run has yet (telemetry, task 6.2).
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Content } from '@servo/content';
import { BLUEPRINT_VERSION, LEVELS } from '@servo/schema';
import type { ArenaRef, Blueprint, Challenge, ChallengeId, ChallengeKind, Level, RunRecord } from '@servo/schema';
import type { RunLoop } from '../run-bar/run-loop.ts';
import { useShell } from '../shell/context.ts';
import type { Autosaver } from '../shell/index.ts';
import type { BlueprintSummary, ProfileStore } from '../store/index.ts';
import { uuidV4 } from '../store/uuid.ts';
import { emitTelemetry } from '../telemetry/emit.ts';
import { CHALLENGE_TEXT, KIND_WORDS } from './text.ts';
import './challenges.css';

/** A new sandbox build is "Build n", one past the highest such name the child has. */
export const BUILD_NAME = /^Build (\d+)$/;

export const nextBuildName = (builds: readonly Pick<BlueprintSummary, 'name'>[]): string => {
  const taken = builds.map((build) => Number(BUILD_NAME.exec(build.name)?.[1] ?? 0));
  return `Build ${Math.max(0, ...taken) + 1}`;
};

/** The arena a sandbox build starts in: the plain floor, or else the content's first preset. */
export const sandboxArena = (content: Content): ArenaRef | undefined => {
  const preset = content.arenas.find((arena) => arena.id === 'open-floor') ?? content.arenas[0];
  return preset ? { preset: preset.id, props: [] } : undefined;
};

/**
 * The order the kinds of challenge come in on Home: the path brief Section 5 lays out for a level. The child meets each
 * new part first, then takes the guided jobs, finds the faults in the breakdowns, tries the what-ifs, and the unscripted
 * build, the level's assessment, comes last. Content gives no order of its own (challenges load in id order), so Home
 * would otherwise put "Cross the arena" above "Meet the battery pack".
 */
export const KIND_ORDER: readonly ChallengeKind[] = ['part-introduction', 'guided', 'breakdown', 'what-if', 'unscripted-build'];

/** Challenges grouped by level, levels in order, each level's challenges along the path (`KIND_ORDER`), then in content order. */
export const challengesByLevel = (challenges: readonly Challenge[]): readonly { readonly level: Level; readonly challenges: readonly Challenge[] }[] =>
  LEVELS.map(({ level }) => ({
    level,
    // Array.prototype.sort is stable, so challenges of one kind keep content's order.
    challenges: challenges.filter((challenge) => challenge.level === level).sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)),
  })).filter((group) => group.challenges.length > 0);

/**
 * The challenges one of the child's Runs has met the goal of, read from the run records (each challenge Run keeps its
 * verdict, README "Challenges", decision 2). Home marks them with the goal line's own check mark, a plain fact of where
 * the child has been: no score, no streak, nothing counted (ground rule 7).
 */
export const metChallenges = (runs: readonly Pick<RunRecord, 'challenge' | 'goal'>[]): ReadonlySet<ChallengeId> => {
  const met = new Set<ChallengeId>();
  for (const run of runs) if (run.challenge !== undefined && run.goal?.met === true) met.add(run.challenge);
  return met;
};

const NONE_MET: ReadonlySet<ChallengeId> = new Set();

/** A build kept only in this page, for a device that keeps no builds. */
const pageBuild = (init: { readonly name: string; readonly level: Level; readonly arena: ArenaRef }): Blueprint => {
  const at = new Date().toISOString();
  return {
    version: BLUEPRINT_VERSION,
    parts: [],
    wires: [],
    arena: init.arena,
    meta: { id: uuidV4(), name: init.name, level: init.level, createdAt: at, updatedAt: at, highWater: { parts: 0, wires: 0 } },
  };
};

/** The build a challenge starts from: a copy of its `start` kept as the child's own, or a new one in its arena. */
const challengeBuild = async (challenge: Challenge, child: ProfileStore | null): Promise<Blueprint | undefined> => {
  if (!child) {
    if (!challenge.start) return pageBuild({ name: challenge.title, level: challenge.level, arena: challenge.arena });
    const at = new Date().toISOString();
    return { ...challenge.start, meta: { ...challenge.start.meta, id: uuidV4(), name: challenge.title, createdAt: at, updatedAt: at } };
  }
  if (challenge.start) {
    const kept = await child.blueprints.copy(challenge.start, challenge.title);
    return kept.ok ? kept.blueprint : undefined;
  }
  return child.blueprints.create({ name: challenge.title, level: challenge.level, arena: challenge.arena });
};

export interface HomeProps {
  /** The challenge on the canvas, or none in the sandbox. */
  readonly challenge: Challenge | null;
  /** Called as a build from Home comes onto the canvas: the challenge it belongs to, or null for the sandbox. */
  readonly onChallenge: (challenge: Challenge | null) => void;
  /** The level a new sandbox build is made at. */
  readonly sandboxLevel: Level;
  /** The run loop, stopped as Home opens. */
  readonly loop: RunLoop | null;
  /** The app's autosave: what waits is saved before another build comes in. */
  readonly saving?: Autosaver | undefined;
  /** The gated parent entry (D91), which task 5.2 puts here. Home builds nothing in its place. */
  readonly parentEntry?: ReactNode;
}

type Saved = { readonly kind: 'reading' } | { readonly kind: 'read'; readonly builds: readonly BlueprintSummary[] } | { readonly kind: 'none' };

export const Home = ({ challenge, onChallenge, sandboxLevel, loop, saving, parentEntry }: HomeProps) => {
  const { content, child, load } = useShell();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const layerRef = useRef<HTMLElement>(null);
  const titleId = useId();
  const [shellRoot, setShellRoot] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<Saved>({ kind: 'none' });
  const [met, setMet] = useState<ReadonlySet<ChallengeId>>(NONE_MET);
  const [line, setLine] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useLayoutEffect(() => {
    setShellRoot(buttonRef.current?.closest<HTMLElement>('.servo-shell') ?? null);
  }, []);

  const show = (): void => {
    loop?.stop();
    setLine(null);
    setOpen(true);
    if (!child) {
      setSaved({ kind: 'none' });
      setMet(NONE_MET);
      return;
    }
    setSaved({ kind: 'reading' });
    child.blueprints
      .list()
      .then((builds) => setSaved({ kind: 'read', builds }))
      .catch((error: unknown) => {
        console.warn('The saved builds could not be read.', error);
        setSaved({ kind: 'read', builds: [] });
      });
    // The check marks come in as the records are read; the list itself never waits on them.
    child.runs
      .list()
      .then((runs) => setMet(metChallenges(runs)))
      .catch((error: unknown) => {
        console.warn('The Runs could not be read.', error);
        setMet(NONE_MET);
      });
  };

  /** Set as Home closes, so focus goes back to the Home button once the shell is awake again. */
  const refocus = useRef(false);
  const close = useCallback((): void => {
    refocus.current = true;
    setOpen(false);
  }, []);

  // While Home is open the shell behind it rests: nothing there takes a tap, a key or a screen reader's focus.
  useEffect(() => {
    const layer = layerRef.current;
    if (!open || !shellRoot || !layer) return undefined;
    const rested = [...shellRoot.children].filter((element): element is HTMLElement => element !== layer && element instanceof HTMLElement && !element.inert);
    for (const element of rested) element.inert = true;
    layer.querySelector<HTMLElement>('h2')?.focus();
    return () => {
      for (const element of rested) element.inert = false;
      if (refocus.current) buttonRef.current?.focus();
      refocus.current = false;
    };
  }, [open, shellRoot]);

  /** Puts a build on the canvas and closes Home, or says in one line that it could not. */
  const openBuild = async (make: () => Promise<Blueprint | undefined>, next: Challenge | null): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setLine(null);
    saving?.flush();
    try {
      const build = await make();
      loop?.stop();
      const result = build ? load(build) : undefined;
      if (!result?.ok) {
        setLine(CHALLENGE_TEXT.cannotOpen);
        return;
      }
      onChallenge(next);
      emitTelemetry(child, 'session-start', { mode: next ? 'challenge' : 'sandbox' });
      close();
    } catch (error) {
      console.warn('A build could not be opened from Home.', error);
      setLine(CHALLENGE_TEXT.cannotOpen);
    } finally {
      setBusy(false);
    }
  };

  const newBuild = (): void => {
    const arena = sandboxArena(content);
    if (!arena) return;
    const builds = saved.kind === 'read' ? saved.builds : [];
    const init = { name: nextBuildName(builds), level: sandboxLevel, arena };
    void openBuild(async () => (child ? child.blueprints.create(init) : pageBuild(init)), null);
  };

  const openSaved = (id: string): void => {
    void openBuild(async () => {
      const loaded = await child?.blueprints.load(id);
      return loaded?.ok ? loaded.blueprint : undefined;
    }, null);
  };

  const openChallenge = (picked: Challenge): void => {
    void openBuild(() => challengeBuild(picked, child), picked);
  };

  const groups = challengesByLevel(content.challenges);
  const layer = (
    <section
      ref={layerRef}
      className="servo-home"
      aria-labelledby={titleId}
      onKeyDown={(event) => {
        // Space is Run and Stop elsewhere (D42); here it only presses Home's own buttons.
        if (event.key === ' ') event.stopPropagation();
        if (event.key === 'Escape') close();
      }}
    >
      <div className="home-top">
        <h2 id={titleId} className="home-title" tabIndex={-1}>
          {CHALLENGE_TEXT.home}
        </h2>
        <button type="button" className="shell-button" onClick={close}>
          {CHALLENGE_TEXT.back}
        </button>
      </div>
      {line ? (
        <p className="home-line" role="status">
          {line}
        </p>
      ) : null}
      <div className="home-columns" aria-busy={busy}>
        <section className="home-column" aria-labelledby={`${titleId}-build`}>
          <h3 id={`${titleId}-build`}>{CHALLENGE_TEXT.build}</h3>
          {/* Off while the saved builds are read, so a new build's name never repeats one (review R-4.5 nit 7). */}
          <button type="button" className="shell-button home-choice" disabled={busy || saved.kind === 'reading'} onClick={newBuild}>
            {CHALLENGE_TEXT.newBuild}
          </button>
          <h3 id={`${titleId}-saved`}>{CHALLENGE_TEXT.savedBuilds}</h3>
          {saved.kind === 'none' ? (
            <p className="home-note">{CHALLENGE_TEXT.notKept}</p>
          ) : saved.kind === 'reading' ? (
            <p className="home-note">{CHALLENGE_TEXT.reading}</p>
          ) : saved.builds.length === 0 ? (
            <p className="home-note">{CHALLENGE_TEXT.noSavedBuilds}</p>
          ) : (
            <ul className="home-list" aria-labelledby={`${titleId}-saved`}>
              {saved.builds.map((build) => (
                <li key={build.id}>
                  <button type="button" className="shell-button home-choice" disabled={busy} onClick={() => openSaved(build.id)}>
                    <span className="home-choice-name">{build.name}</span>
                    <span className="home-choice-detail">Level {build.level}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="home-column" aria-labelledby={`${titleId}-challenges`}>
          <h3 id={`${titleId}-challenges`}>{CHALLENGE_TEXT.challenges}</h3>
          {groups.length === 0 ? <p className="home-note">{CHALLENGE_TEXT.noChallenges}</p> : null}
          {groups.map((group) => {
            const label = LEVELS.find((info) => info.level === group.level)?.label;
            const headingId = `${titleId}-level-${group.level}`;
            return (
              <div key={group.level} className="home-level">
                <h4 id={headingId}>{label ? `Level ${group.level} · ${label}` : `Level ${group.level}`}</h4>
                <ul className="home-list" aria-labelledby={headingId}>
                  {group.challenges.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        className="shell-button home-choice"
                        aria-current={challenge?.id === item.id ? 'true' : undefined}
                        data-met={met.has(item.id) ? 'true' : undefined}
                        disabled={busy}
                        onClick={() => openChallenge(item)}
                      >
                        <span className="home-choice-name">{item.title}</span>
                        <span className="home-choice-detail">
                          {met.has(item.id) ? (
                            <>
                              <svg className="home-choice-tick" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                                <path d="M4 10.5 L8.5 15 L16 5.5" />
                              </svg>
                              <span className="home-choice-spoken">{CHALLENGE_TEXT.met}. </span>
                            </>
                          ) : null}
                          {KIND_WORDS[item.kind]}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </section>
      </div>
      {/* The gated parent entry (D91, task 5.2). */}
      <div className="home-parent-entry" data-slot="parent-entry">
        {parentEntry}
      </div>
    </section>
  );
  return (
    <>
      <button ref={buttonRef} type="button" className="shell-button" aria-expanded={open} onClick={show}>
        {CHALLENGE_TEXT.home}
      </button>
      {open && shellRoot ? createPortal(layer, shellRoot) : null}
    </>
  );
};
