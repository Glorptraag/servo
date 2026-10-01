// The app shell (brief Section 9, task 4.1): the canvas in the middle, the header along the top, the part tray on
// the left (along the bottom in portrait), the spec card sliding over the canvas's right side, the arena strip along
// the top of the canvas and the Run bar floating at its bottom centre. Every edge tucks away and stays tucked across
// a reload. The regions are slots: later tasks fill them (docs/shell.md, "Slots").
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { CanvasHandle, CanvasMode, CanvasPrefs } from '@servo/canvas';
import type { Content } from '@servo/content';
import type { Blueprint, Kit, Level, ValidationResult } from '@servo/schema';
import { ShellContext } from './context.ts';
import type { ShellApi } from './context.ts';
import { EdgeTab } from './edge-tab.tsx';
import { EDGE_NAMES, pageStorage, readTucked, writeTucked } from './edges.ts';
import type { Edge, Tucked } from './edges.ts';
import { HeaderContents } from './header.tsx';
import type { HeaderSlots } from './header.tsx';
import { solveLayout } from './layout.ts';
import type { Rect } from './layout.ts';
import { ZoomControl } from './zoom-control.tsx';
import './shell.css';

/** Until task 5.7 keeps the child's prefs, the canvas gets these. */
export const DEFAULT_PREFS: CanvasPrefs = { dragSensitivity: 1, leftHanded: false, highContrast: false, typeface: 'standard' };

/** What later tasks put in the shell. A slot left empty shows nothing. */
export interface ShellSlots extends HeaderSlots {
  /** Task 4.2: the kit's tiles by family, and the Library button. */
  readonly tray?: ReactNode;
  /** Task 4.3: the selected part's spec card. */
  readonly specCard?: ReactNode;
  /** The arena preset picker and the props to drag in (D36). */
  readonly arenaStrip?: ReactNode;
  /** Task 4.4: Run and Stop, the clock, Undo and Reset arena. */
  readonly runBar?: ReactNode;
}

/** What the canvas is mounted with, besides what the app gives it (the catalogue and the art). */
export interface CanvasSetup {
  readonly level: Level;
  readonly prefs: CanvasPrefs;
}

export interface ShellProps {
  readonly content: Content;
  readonly level: Level;
  readonly kit?: Kit | undefined;
  readonly slots?: ShellSlots;
  /** Draws the canvas into its host, the stage. Called once, after the first render has sized the stage. */
  readonly mountCanvas: (host: HTMLElement, setup: CanvasSetup) => CanvasHandle;
  /** Where the tuck states persist: the page's localStorage unless given. Null keeps them for this visit only. */
  readonly storage?: Storage | null;
  /** The prefs the canvas starts with. */
  readonly prefs?: CanvasPrefs;
  /** Called once the canvas is mounted. */
  readonly onReady?: () => void;
}

/** A panel's box: it slides by transform, so its content keeps its size while it moves. */
const slide = (rect: Rect): CSSProperties => ({ transform: `translate(${rect.x}px, ${rect.y}px)`, width: rect.width, height: rect.height });

/** The canvas's box and the layer floating on it: they resize, and the canvas follows its host's size. */
const place = (rect: Rect): CSSProperties => ({ left: rect.x, top: rect.y, width: rect.width, height: rect.height });

export const Shell = ({ content, level, kit, slots = {}, mountCanvas, storage: givenStorage, prefs: startPrefs, onReady }: ShellProps) => {
  const storage = useMemo(() => (givenStorage === undefined ? pageStorage() : givenStorage), [givenStorage]);
  const rootRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  // Null until the host is measured: the regions render only then, so nothing animates in from a zero size.
  const [size, setSize] = useState<{ readonly width: number; readonly height: number } | null>(null);
  const [tucked, setTuckedState] = useState<Tucked>(() => readTucked(storage));
  const [mode, setModeState] = useState<CanvasMode>('build');
  const [prefs, setPrefs] = useState<CanvasPrefs>(startPrefs ?? DEFAULT_PREFS);
  const [canvas, setCanvas] = useState<CanvasHandle | null>(null);
  const [blueprint, setBlueprint] = useState<Blueprint | undefined>(undefined);
  const ids: Readonly<Record<Edge, string>> = {
    header: useId(),
    tray: useId(),
    specCard: useId(),
    arenaStrip: useId(),
    runBar: useId(),
  };

  // The shell fills its host and lays itself out for the host's size, so it works in a page or a test harness alike.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const measure = (): void => {
      const width = root.clientWidth;
      const height = root.clientHeight;
      if (width <= 0 || height <= 0) return;
      setSize((current) => (current?.width === width && current.height === height ? current : { width, height }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  // The canvas is mounted once, with the level and prefs of the moment; later changes reach it through its setters.
  const mountRef = useRef({ mountCanvas, onReady, level, prefs });
  mountRef.current = { mountCanvas, onReady, level, prefs };
  const applied = useRef<CanvasSetup | null>(null);
  const measured = size !== null;
  useEffect(() => {
    const host = hostRef.current;
    if (!measured || !host) return;
    const setup = mountRef.current;
    const handle = setup.mountCanvas(host, { level: setup.level, prefs: setup.prefs });
    applied.current = { level: setup.level, prefs: setup.prefs };
    const off = handle.on('edit', (event) => setBlueprint(event.blueprint));
    setCanvas(handle);
    setup.onReady?.();
    return () => {
      off();
      handle.destroy();
    };
  }, [measured]);

  useEffect(() => {
    const last = applied.current;
    if (!canvas || !last) return;
    if (last.level !== level) canvas.setLevel(level);
    if (last.prefs !== prefs) canvas.setPrefs(prefs);
    applied.current = { level, prefs };
  }, [canvas, level, prefs]);

  // The tuck states are written when the child changes them, never just for reading them.
  const unchanged = useRef(true);
  useEffect(() => {
    if (unchanged.current) {
      unchanged.current = false;
      return;
    }
    writeTucked(storage, tucked);
  }, [storage, tucked]);

  const setTucked = useCallback((edge: Edge, value: boolean) => {
    setTuckedState((current) => (current[edge] === value ? current : { ...current, [edge]: value }));
  }, []);

  const setMode = useCallback(
    (next: CanvasMode) => {
      if (!canvas) throw new Error('setMode: the canvas is not mounted yet.');
      canvas.setMode(next);
      setModeState(next);
    },
    [canvas],
  );

  const load = useCallback(
    (build: Blueprint): ValidationResult<Blueprint> => {
      if (!canvas) throw new Error('load: the canvas is not mounted yet.');
      const result = canvas.load(build);
      if (result.ok) setBlueprint(result.value);
      return result;
    },
    [canvas],
  );

  const layout = useMemo(
    () => solveLayout({ width: size?.width ?? 0, height: size?.height ?? 0, tucked, mode, hand: prefs.leftHanded ? 'left' : 'right' }),
    [size, tucked, mode, prefs.leftHanded],
  );

  const shell = useMemo<ShellApi>(
    () => ({ content, level, kit, canvas, mode, setMode, blueprint, load, tucked, setTucked, layout, prefs, setPrefs }),
    [content, level, kit, canvas, mode, setMode, blueprint, load, tucked, setTucked, layout, prefs],
  );

  const { shown } = layout;
  const regions = (
    <>
      <header id={ids.header} className="shell-header shell-panel" data-region="header" data-shown={shown.header} inert={!shown.header} style={slide(layout.header)}>
        <HeaderContents home={slots.home} goal={slots.goal} hints={slots.hints} sound={slots.sound} save={slots.save} />
      </header>
      <section
        id={ids.tray}
        className="shell-tray shell-panel"
        data-region="tray"
        aria-label={EDGE_NAMES.tray}
        data-shown={shown.tray}
        inert={!shown.tray}
        style={slide(layout.tray)}
      >
        {slots.tray}
      </section>
      <main className="shell-stage" data-region="stage" style={place(layout.stage)}>
        <div ref={hostRef} className="shell-canvas-host" />
      </main>
      <div className="shell-float" data-region="canvas" style={place(layout.canvas)}>
        <EdgeTab edge="header" controls={ids.header} />
        <section
          id={ids.arenaStrip}
          className="shell-arena-strip shell-slides"
          data-region="arenaStrip"
          aria-label={EDGE_NAMES.arenaStrip}
          data-shown={shown.arenaStrip}
          inert={!shown.arenaStrip}
        >
          {slots.arenaStrip}
        </section>
        <EdgeTab edge="arenaStrip" controls={ids.arenaStrip} />
        <EdgeTab edge="tray" controls={ids.tray} />
        <div className="shell-run-row">
          <section
            id={ids.runBar}
            className="shell-run-bar shell-slides"
            data-region="runBar"
            aria-label={EDGE_NAMES.runBar}
            data-shown={shown.runBar}
            inert={!shown.runBar}
          >
            {slots.runBar}
          </section>
          <EdgeTab edge="runBar" controls={ids.runBar} />
        </div>
        <ZoomControl />
        <EdgeTab edge="specCard" controls={ids.specCard} />
      </div>
      <aside
        id={ids.specCard}
        className="shell-spec-card shell-panel"
        data-region="specCard"
        aria-label={EDGE_NAMES.specCard}
        data-shown={shown.specCard}
        inert={!shown.specCard}
        style={slide(layout.specCard)}
      >
        {slots.specCard}
      </aside>
    </>
  );
  return (
    <ShellContext.Provider value={shell}>
      <div
        ref={rootRef}
        className="servo-shell"
        data-orientation={layout.orientation}
        data-hand={layout.hand}
        data-mode={mode}
        data-typeface={prefs.typeface}
      >
        {measured ? regions : null}
      </div>
    </ShellContext.Provider>
  );
};
