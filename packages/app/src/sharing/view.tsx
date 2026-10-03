// A shared build's page (task 5.6): what a shared link opens. It needs no gate, opens no store and no profile, and
// writes nothing: not to IndexedDB, not to page storage, not to the address. The build is shown on a read-only canvas
// (D43) and replayed at once, with Stop and Run again; with prefers-reduced-motion it waits at tick 0 for Run instead
// of starting by itself, while the canvas shows each frame at once (task 3.5). The canvas's own list view reads the
// build out and offers inspection only. A link that is incomplete, changed or from a newer Servo is one plain line, never a dialog
// (ground rule 9). "Keep a copy" (D43) is not offered: it would write into a child's store (README, "Shared links").

import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { mountCanvas as mountRealCanvas } from '@servo/canvas';
import type { CanvasHandle, CanvasOptions } from '@servo/canvas';
import { loadContent } from '@servo/content';
import type { Content } from '@servo/content';
import type { Blueprint } from '@servo/schema';
import { DEFAULT_PREFS } from '../shell/shell.tsx';
import { SHARED_BUILD_NAME, readShareFragment } from './link.ts';
import type { SharedRead } from './link.ts';
import { Replay, pageClock } from './replay.ts';
import type { ReplayClock, ReplayPhase } from './replay.ts';
import './sharing.css';

/** Every line the page shows, for the copy pass: plain words, no exclamation marks, no praise. */
export const SHARE_TEXT = {
  title: SHARED_BUILD_NAME,
  readOnly: 'A shared build. It runs here, and cannot be changed.',
  run: 'Run',
  runAgain: 'Run again',
  ready: 'Ready to run.',
  stop: 'Stop',
  loading: 'Getting the run ready.',
  spinUp: 'Starting.',
  running: 'Running.',
  stopped: 'Stopped.',
  failed: 'The run cannot be shown on this device.',
  refused: 'This link does not hold a build that can be opened. It may be incomplete. Ask for the link again.',
  newer: 'This build was made with a newer version of Servo. Open the link again once Servo has updated.',
} as const;

const PHASE_LINE: Readonly<Record<ReplayPhase, string>> = {
  loading: SHARE_TEXT.loading,
  'spin-up': SHARE_TEXT.spinUp,
  running: SHARE_TEXT.running,
  stopped: SHARE_TEXT.stopped,
  failed: SHARE_TEXT.failed,
};

export interface SharedPageOptions {
  /** Default `loadContent()`: the content baked into the build. */
  readonly content?: Content;
  /** Default the real canvas. Tests wrap it. */
  readonly mountCanvas?: (host: HTMLElement, options: CanvasOptions) => CanvasHandle;
  /** Default the page's `performance.now` and `requestAnimationFrame`. */
  readonly clock?: ReplayClock;
  /** Default the page's `prefers-reduced-motion`, read as the page opens: true keeps the replay from starting by itself. */
  readonly reducedMotion?: () => boolean;
}

/** `prefers-reduced-motion`, read as the canvas reads it (packages/canvas/docs/run-animation.md). */
export const prefersReducedMotion = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export interface SharedPageHandle {
  /** What the link held: the build, or why it was refused. */
  readonly read: SharedRead;
  /** The replay, once the canvas is mounted; undefined for a refused link. */
  readonly replay: () => Replay | undefined;
  readonly canvas: () => CanvasHandle | undefined;
  destroy(): void;
}

interface ViewProps {
  readonly blueprint: Blueprint;
  readonly seed: number;
  readonly content: Content;
  readonly mountCanvas: (host: HTMLElement, options: CanvasOptions) => CanvasHandle;
  readonly clock: ReplayClock;
  readonly reducedMotion: () => boolean;
  readonly onMounted: (canvas: CanvasHandle, replay: Replay) => void;
}

const SharedBuildView = ({ blueprint, seed, content, mountCanvas, clock, reducedMotion, onMounted }: ViewProps) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const [replay, setReplay] = useState<Replay | null>(null);
  // Read once, as the page opens: under reduced motion the page opens ready, waiting for Run.
  const [waits] = useState(reducedMotion);
  const [phase, setPhase] = useState<ReplayPhase | 'ready'>(waits ? 'ready' : 'loading');
  const [played, setPlayed] = useState(false);
  const latest = useRef({ mountCanvas, clock, waits, onMounted });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const { mountCanvas: mount, clock: wallClock, waits: wait, onMounted: mounted } = latest.current;
    const canvas = mount(host, {
      catalogue: content.catalogue,
      resolveArt: (key) => content.art.get(key),
      level: blueprint.meta.level,
      prefs: DEFAULT_PREFS,
      readOnly: true,
    });
    const loaded = canvas.load(blueprint);
    if (!loaded.ok) console.warn('The shared build could not be drawn.', loaded.issues);
    const player = new Replay({
      canvas,
      blueprint,
      catalogue: content.catalogue,
      seed,
      clock: wallClock,
      onChange: (next) => {
        setPhase(next);
        if (next === 'spin-up') setPlayed(true);
      },
    });
    setReplay(player);
    mounted(canvas, player);
    // Moving content that starts by itself is what reduced motion asks to avoid: the replay waits for Run.
    if (!wait) void player.play();
    return () => {
      player.dispose();
      canvas.destroy();
    };
  }, [blueprint, seed, content]);

  const playing = phase === 'spin-up' || phase === 'running';
  return (
    <main className="share-page" aria-labelledby="share-title">
      <header className="share-header">
        <h1 id="share-title">{blueprint.meta.name}</h1>
        <p>{SHARE_TEXT.readOnly}</p>
      </header>
      <div className="share-stage">
        <div className="share-canvas-host" ref={hostRef} />
        <div className="share-bar" role="group" aria-label="Replay">
          <p role="status" aria-live="polite">
            {phase === 'ready' ? SHARE_TEXT.ready : PHASE_LINE[phase]}
          </p>
          <button
            type="button"
            className="share-button"
            disabled={!replay || phase === 'loading'}
            onClick={() => (playing ? replay?.stop() : void replay?.play())}
          >
            {playing ? SHARE_TEXT.stop : played ? SHARE_TEXT.runAgain : SHARE_TEXT.run}
          </button>
        </div>
      </div>
    </main>
  );
};

const RefusedView = ({ line }: { readonly line: string }) => (
  <main className="share-page share-refused">
    <section className="share-panel" aria-labelledby="share-title">
      <h1 id="share-title">{SHARE_TEXT.title}</h1>
      <p role="status">{line}</p>
    </section>
  </main>
);

/**
 * Opens a shared link's fragment in `host`, which needs a definite size: the page fills it. Resolves once the page is
 * drawn (and, for a build, the canvas is mounted and the replay has started). Never rejects for a bad link.
 */
export const mountSharedPage = async (host: HTMLElement, hash: string, options: SharedPageOptions = {}): Promise<SharedPageHandle> => {
  const content = options.content ?? loadContent().content;
  const read = await readShareFragment(hash, content.catalogue);
  const view = host.ownerDocument.defaultView;
  if (!view && !options.clock) throw new TypeError('mountSharedPage needs a host in a window, or options.clock.');
  const clock = options.clock ?? pageClock(view as Window);
  const mountCanvas = options.mountCanvas ?? mountRealCanvas;
  // Never the build's name: the title lands in the browser's history.
  host.ownerDocument.title = 'Servo shared build';
  const root = createRoot(host);
  let mounted: { canvas: CanvasHandle; replay: Replay } | undefined;
  const handle: SharedPageHandle = {
    read,
    replay: () => mounted?.replay,
    canvas: () => mounted?.canvas,
    destroy: () => root.unmount(),
  };
  if (!read.ok) {
    root.render(<RefusedView line={read.reason === 'newer' ? SHARE_TEXT.newer : SHARE_TEXT.refused} />);
    return handle;
  }
  await new Promise<void>((resolve) => {
    const onMounted = (canvas: CanvasHandle, replay: Replay): void => {
      mounted = { canvas, replay };
      resolve();
    };
    root.render(
      <SharedBuildView
        blueprint={read.blueprint}
        seed={read.seed}
        content={content}
        mountCanvas={mountCanvas}
        clock={clock}
        reducedMotion={options.reducedMotion ?? prefersReducedMotion}
        onMounted={onMounted}
      />,
    );
  });
  return handle;
};
