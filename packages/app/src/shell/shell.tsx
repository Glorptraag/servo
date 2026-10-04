// The app shell (brief Section 9, task 4.1). The canvas fills the screen. Over it lie the header along the top, the
// part tray on the left (along the bottom in portrait), the spec card at the right edge while a part is selected,
// the arena strip along the top of the canvas, the Run bar at its bottom centre and the zoom control, never covering
// more than 30% of it. The header, tray, spec card and arena strip tuck away and stay tucked across a reload; the
// Run bar is always there and never moves. The regions are slots: later tasks fill them (docs/shell.md, "Slots").
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { CanvasHandle, CanvasMode, CanvasPrefs, Selection } from '@servo/canvas';
import type { Content } from '@servo/content';
import type { Blueprint, Kit, Level, ValidationResult } from '@servo/schema';
import type { ProfileStore } from '../store/index.ts';
import { themeAttributes } from '../theme/index.ts';
import { ShellContext } from './context.ts';
import type { ShellApi } from './context.ts';
import { EdgeTab } from './edge-tab.tsx';
import { EDGE_NAMES, RUN_BAR_NAME, pageStorage, readTucked, writeTucked } from './edges.ts';
import type { Edge, Tucked } from './edges.ts';
import { HeaderContents } from './header.tsx';
import type { HeaderSlots } from './header.tsx';
import { solveLayout } from './layout.ts';
import type { SafeArea } from './layout.ts';
import { box } from './place.ts';
import { ZoomControl } from './zoom-control.tsx';
import './shell.css';

/** The canvas's prefs with every access option off; the app lays this device's options over them (src/a11y/, task 5.7). */
export const DEFAULT_PREFS: CanvasPrefs = { dragSensitivity: 1, leftHanded: false, highContrast: false, typeface: 'standard' };

/**
 * How far a press moves before it counts as a drag, in CSS pixels at a drag sensitivity of 1: the canvas's own
 * threshold (packages/canvas/docs/renderer.md, "Input").
 */
export const DRAG_PX = 8;

/** What later tasks put in the shell. A slot left empty shows nothing. */
export interface ShellSlots extends HeaderSlots {
  /** Task 4.2: the kit's tiles by family, and the Library button. */
  readonly tray?: ReactNode;
  /** Task 4.3: the selected part's spec card. */
  readonly specCard?: ReactNode;
  /** The arena preset picker and the props to drag in (D36). */
  readonly arenaStrip?: ReactNode;
  /** Task 4.4: Run and Stop, the clock, Undo and Reset arena, within RUN_BAR_PX. */
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
  /** Draws the canvas into its host, which fills the shell. Called once, after the first render has measured the shell. */
  readonly mountCanvas: (host: HTMLElement, setup: CanvasSetup) => CanvasHandle;
  /** Where the tuck states persist: the page's localStorage unless given. Null keeps them for this visit only. */
  readonly storage?: Storage | null;
  /** The prefs the canvas starts with. A new object later replaces them: the access options changed (task 5.7). */
  readonly prefs?: CanvasPrefs;
  /** The child's records in the store (task 4.9), shared with the slots as `useShell().child`. None without a store or a profile. */
  readonly child?: ProfileStore | null;
  /** A build to load onto the canvas as soon as it is mounted. */
  readonly start?: Blueprint | undefined;
  /** Called once the canvas is mounted. */
  readonly onReady?: () => void;
  /**
   * The hook for safe-area insets (task 3.7): called once the canvas is mounted and whenever the canvas a child can
   * see changes, with how far in from each side it begins, so the canvas's load and Fit can centre the build there.
   * The app passes them on once the canvas takes them; until then nothing is called with them.
   */
  readonly onSafeArea?: (safeArea: SafeArea, canvas: CanvasHandle) => void;
}

export const Shell = ({
  content,
  level,
  kit,
  slots = {},
  mountCanvas,
  storage: givenStorage,
  prefs: startPrefs,
  child = null,
  start,
  onReady,
  onSafeArea,
}: ShellProps) => {
  const storage = useMemo(() => (givenStorage === undefined ? pageStorage() : givenStorage), [givenStorage]);
  const rootRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const trayRef = useRef<HTMLElement>(null);
  const arenaStripRef = useRef<HTMLElement>(null);
  // Null until the shell is measured: the regions render only then, so nothing animates in from a zero size.
  const [size, setSize] = useState<{ readonly width: number; readonly height: number } | null>(null);
  const [tucked, setTuckedState] = useState<Tucked>(() => readTucked(storage));
  const [mode, setModeState] = useState<CanvasMode>('build');
  const [prefs, setPrefs] = useState<CanvasPrefs>(startPrefs ?? DEFAULT_PREFS);
  const [givenPrefs, setGivenPrefs] = useState(startPrefs);
  if (startPrefs !== givenPrefs) {
    setGivenPrefs(startPrefs);
    if (startPrefs) setPrefs(startPrefs);
  }
  const [canvas, setCanvas] = useState<CanvasHandle | null>(null);
  const [blueprint, setBlueprint] = useState<Blueprint | undefined>(undefined);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [dragging, setDragging] = useState(false);
  const [asideAsked, setSpecCardAside] = useState(false);
  const ids: Readonly<Record<Edge | 'runBar', string>> = {
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
  const latest = useRef({ mountCanvas, onReady, onSafeArea, level, prefs, start });
  latest.current = { mountCanvas, onReady, onSafeArea, level, prefs, start };
  const applied = useRef<CanvasSetup | null>(null);
  const measured = size !== null;
  useEffect(() => {
    const host = hostRef.current;
    if (!measured || !host) return;
    const setup = latest.current;
    const handle = setup.mountCanvas(host, { level: setup.level, prefs: setup.prefs });
    applied.current = { level: setup.level, prefs: setup.prefs };
    const offEdit = handle.on('edit', (event) => setBlueprint(event.blueprint));
    // The spec card follows the selection: it slides in when a part is selected and out when none is (brief Section 9).
    const offSelect = handle.on('select', (event) => setSelection(event.selection));
    setSelection(handle.selection);
    const first = setup.start ? handle.load(setup.start) : undefined;
    if (first?.ok) setBlueprint(first.value);
    setCanvas(handle);
    setup.onReady?.();
    return () => {
      offEdit();
      offSelect();
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

  // A drag on the canvas (moving a part, drawing a wire, panning, pinching) steps the spec card aside until every
  // finger lifts, so the card never covers a port the child is wiring. A tap does not. Listening only, in the
  // capture phase, so the canvas's own input sees every event as before.
  useEffect(() => {
    const host = hostRef.current;
    const view = host?.ownerDocument.defaultView;
    if (!measured || !host || !view) return;
    const pressed = new Map<number, { readonly x: number; readonly y: number }>();
    const onDown = (event: PointerEvent): void => {
      pressed.set(event.pointerId, { x: event.clientX, y: event.clientY });
    };
    const onMove = (event: PointerEvent): void => {
      if (event.buttons === 0) return;
      const start = pressed.get(event.pointerId);
      if (!start) {
        // A drag that began elsewhere, a part from the tray, counts from where it first crosses the canvas.
        pressed.set(event.pointerId, { x: event.clientX, y: event.clientY });
        return;
      }
      const threshold = DRAG_PX / Math.max(latest.current.prefs.dragSensitivity, 0.05);
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) >= threshold) setDragging(true);
    };
    const onUp = (event: PointerEvent): void => {
      pressed.delete(event.pointerId);
      if (pressed.size === 0) setDragging(false);
    };
    host.addEventListener('pointerdown', onDown, { capture: true, passive: true });
    host.addEventListener('pointermove', onMove, { capture: true, passive: true });
    view.addEventListener('pointerup', onUp, { capture: true, passive: true });
    view.addEventListener('pointercancel', onUp, { capture: true, passive: true });
    return () => {
      host.removeEventListener('pointerdown', onDown, { capture: true });
      host.removeEventListener('pointermove', onMove, { capture: true });
      view.removeEventListener('pointerup', onUp, { capture: true });
      view.removeEventListener('pointercancel', onUp, { capture: true });
    };
  }, [measured]);

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

  // The first build the canvas shows is framed in the canvas the panels leave uncovered (D70): the canvas's own load
  // keeps the view, so Undo never moves it.
  const framed = useRef<CanvasHandle | null>(null);
  const load = useCallback(
    (build: Blueprint): ValidationResult<Blueprint> => {
      if (!canvas) throw new Error('load: the canvas is not mounted yet.');
      const result = canvas.load(build);
      if (result.ok) {
        setBlueprint(result.value);
        if (framed.current !== canvas) {
          framed.current = canvas;
          canvas.fit();
        }
      }
      return result;
    },
    [canvas],
  );

  const specCardAside = dragging || asideAsked;
  const specCardWanted = selection?.kind === 'part';
  const layout = useMemo(
    () =>
      solveLayout({
        width: size?.width ?? 0,
        height: size?.height ?? 0,
        tucked,
        mode,
        hand: prefs.leftHanded ? 'left' : 'right',
        specCardWanted,
        specCardAside,
      }),
    [size, tucked, mode, prefs.leftHanded, specCardWanted, specCardAside],
  );

  // The tray and the arena strip are where a part, wire or prop dragged off the canvas goes back to, as the bin
  // (brief Section 10, D36). `setRemoveTargets` replaces the whole list, so the shell, which holds both regions, is its
  // one caller (review R-4.2). Only a region that shows counts: the canvas tests the box alone, and a tucked arena
  // strip lies behind the header, where a drop would otherwise remove a part.
  const trayShown = layout.shown.tray;
  const arenaStripShown = layout.shown.arenaStrip;
  useEffect(() => {
    const targets = [trayShown && trayRef.current, arenaStripShown && arenaStripRef.current].filter((each): each is HTMLElement => !!each);
    canvas?.setRemoveTargets(targets);
  }, [canvas, trayShown, arenaStripShown]);

  // The safe area goes out whenever it changes, compared by value, so a re-render alone never repeats it.
  const { top, right, bottom, left } = layout.safeArea;
  useEffect(() => {
    if (canvas) latest.current.onSafeArea?.({ top, right, bottom, left }, canvas);
  }, [canvas, top, right, bottom, left]);

  const shell = useMemo<ShellApi>(
    () => ({
      content,
      level,
      kit,
      canvas,
      mode,
      setMode,
      blueprint,
      load,
      child,
      selection,
      tucked,
      setTucked,
      specCardAside,
      setSpecCardAside,
      layout,
      prefs,
      setPrefs,
    }),
    [content, level, kit, canvas, mode, setMode, blueprint, load, child, selection, tucked, setTucked, specCardAside, layout, prefs],
  );

  const { shown } = layout;
  const regions = (
    <>
      <header id={ids.header} className="shell-header shell-panel" data-region="header" data-shown={shown.header} inert={!shown.header} style={box(layout.header)}>
        <HeaderContents home={slots.home} goal={slots.goal} hints={slots.hints} sound={slots.sound} save={slots.save} />
      </header>
      <EdgeTab edge="header" controls={ids.header} />
      <section
        ref={trayRef}
        id={ids.tray}
        className="shell-tray shell-panel"
        data-region="tray"
        aria-label={EDGE_NAMES.tray}
        data-shown={shown.tray}
        inert={!shown.tray}
        style={box(layout.tray)}
      >
        {slots.tray}
      </section>
      <EdgeTab edge="tray" controls={ids.tray} />
      <main className="shell-stage" data-region="stage">
        <div ref={hostRef} className="shell-canvas-host" />
      </main>
      <section
        ref={arenaStripRef}
        id={ids.arenaStrip}
        className="shell-arena-strip shell-panel"
        data-region="arenaStrip"
        aria-label={EDGE_NAMES.arenaStrip}
        data-shown={shown.arenaStrip}
        inert={!shown.arenaStrip}
        style={box(layout.arenaStrip)}
      >
        {slots.arenaStrip}
      </section>
      <EdgeTab edge="arenaStrip" controls={ids.arenaStrip} />
      <section id={ids.runBar} className="shell-run-bar shell-moves" data-region="runBar" aria-label={RUN_BAR_NAME} style={box(layout.runBar)}>
        <div className="shell-run-pill" data-region="runBarPill">
          {slots.runBar}
        </div>
      </section>
      <ZoomControl />
      <EdgeTab edge="specCard" controls={ids.specCard} />
      <aside
        id={ids.specCard}
        className="shell-spec-card shell-panel"
        data-region="specCard"
        aria-label={EDGE_NAMES.specCard}
        data-shown={shown.specCard}
        inert={!shown.specCard}
        style={box(layout.specCard)}
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
        {...themeAttributes(prefs)}
      >
        {measured ? regions : null}
      </div>
    </ShellContext.Provider>
  );
};
