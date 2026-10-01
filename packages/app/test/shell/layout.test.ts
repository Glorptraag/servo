// The layout maths (src/shell/layout.ts): where each region goes, and the brief's floor of 70% of the screen for the
// canvas in every state (Section 9). The browser tests check that the page draws these boxes.
import { describe, expect, it } from 'vitest';
import type { CanvasMode } from '@servo/canvas';
import { ALL_OPEN, EDGES } from '../../src/shell/edges.ts';
import type { Edge, Tucked } from '../../src/shell/edges.ts';
import { HEADER_PX, MIN_CANVAS_SHARE, SPEC_CARD_PX, TRAY_PX, area, solveLayout, specCardWidth } from '../../src/shell/layout.ts';
import type { Hand, Rect, ShellLayout } from '../../src/shell/layout.ts';

/** The screens task 4.1 names: a 10-inch tablet in landscape, a 13-inch screen, and a tablet in portrait. */
const SCREENS = [
  { name: '10-inch landscape', width: 1180, height: 820 },
  { name: '13-inch', width: 1366, height: 1024 },
  { name: 'tablet portrait', width: 820, height: 1180 },
] as const;

const MODES: readonly CanvasMode[] = ['build', 'run'];
const HANDS: readonly Hand[] = ['right', 'left'];

/** Every combination of tucked edges: 32 of them. */
const TUCK_STATES: readonly Tucked[] = Array.from({ length: 2 ** EDGES.length }, (_, bits) =>
  Object.fromEntries(EDGES.map((edge, index) => [edge, (bits & (1 << index)) !== 0])) as Record<Edge, boolean>,
);

const right = (rect: Rect): number => rect.x + rect.width;
const bottom = (rect: Rect): number => rect.y + rect.height;

const layoutOf = (
  screen: { readonly width: number; readonly height: number },
  options: { readonly tucked?: Partial<Tucked>; readonly mode?: CanvasMode; readonly hand?: Hand } = {},
): ShellLayout =>
  solveLayout({
    width: screen.width,
    height: screen.height,
    tucked: { ...ALL_OPEN, ...options.tucked },
    mode: options.mode ?? 'build',
    hand: options.hand ?? 'right',
  });

describe('the canvas never takes less than 70% of the screen', () => {
  for (const screen of SCREENS) {
    it(`${screen.name}: in all ${TUCK_STATES.length * MODES.length * HANDS.length} states`, () => {
      for (const tucked of TUCK_STATES) {
        for (const mode of MODES) {
          for (const hand of HANDS) {
            const layout = solveLayout({ ...screen, tucked, mode, hand });
            const state = JSON.stringify({ tucked, mode, hand });
            expect(layout.canvasShare, state).toBeGreaterThanOrEqual(MIN_CANVAS_SHARE);
            expect(area(layout.canvas) / (screen.width * screen.height), state).toBeCloseTo(layout.canvasShare, 12);
          }
        }
      }
    });
  }

  it('with every edge open, on any screen from a small tablet up to a large monitor', () => {
    for (let short = 744; short <= 1440; short += 16) {
      for (let long = Math.max(short, 1024); long <= 2560; long += 32) {
        for (const screen of [
          { width: long, height: short },
          { width: short, height: long },
        ]) {
          const layout = layoutOf(screen);
          expect(layout.canvasShare, JSON.stringify(screen)).toBeGreaterThanOrEqual(MIN_CANVAS_SHARE);
          expect(layout.specCard.width, JSON.stringify(screen)).toBeGreaterThan(0);
        }
      }
    }
  });

  it('gives the canvas the whole screen with every edge tucked away', () => {
    const tucked = Object.fromEntries(EDGES.map((edge) => [edge, true])) as Record<Edge, boolean>;
    for (const screen of SCREENS) {
      const layout = layoutOf(screen, { tucked });
      expect(layout.canvas).toEqual({ x: 0, y: 0, width: screen.width, height: screen.height });
      expect(layout.canvasShare).toBe(1);
    }
  });

  it('only gains room when an edge is tucked', () => {
    for (const screen of SCREENS) {
      const open = layoutOf(screen).canvasShare;
      for (const edge of EDGES) {
        expect(layoutOf(screen, { tucked: { [edge]: true } }).canvasShare, `${screen.name}, ${edge}`).toBeGreaterThanOrEqual(open);
      }
    }
  });
});

describe('the spec card', () => {
  it('is as wide as the 70% floor allows, up to its full width', () => {
    expect(specCardWidth(1180, 820)).toBe(186);
    expect(specCardWidth(1366, 1024)).toBe(246);
    expect(specCardWidth(820, 1180)).toBe(153);
    expect(specCardWidth(1920, 1080)).toBe(SPEC_CARD_PX);
    expect(specCardWidth(100, 80)).toBe(0);
  });

  it('keeps its width whatever else is tucked, so it never jumps', () => {
    for (const screen of SCREENS) {
      const width = layoutOf(screen).specCard.width;
      for (const tucked of TUCK_STATES) {
        for (const mode of MODES) expect(solveLayout({ ...screen, tucked, mode, hand: 'right' }).specCard.width).toBe(width);
      }
    }
  });

  it('slides over the canvas without resizing it (brief Section 10)', () => {
    for (const screen of SCREENS) {
      const open = layoutOf(screen);
      const tucked = layoutOf(screen, { tucked: { specCard: true } });
      expect(tucked.stage).toEqual(open.stage);
      expect(open.canvas.width).toBe(open.stage.width - open.specCard.width);
      expect(tucked.canvas).toEqual(tucked.stage);
    }
  });
});

describe('where each region goes (brief Section 9)', () => {
  it('10-inch landscape: header along the top, tray on the left, spec card on the right, canvas in the middle', () => {
    const layout = layoutOf(SCREENS[0]);
    expect(layout.orientation).toBe('landscape');
    expect(layout.header).toEqual({ x: 0, y: 0, width: 1180, height: HEADER_PX });
    expect(layout.tray).toEqual({ x: 0, y: HEADER_PX, width: TRAY_PX, height: 820 - HEADER_PX });
    expect(layout.stage).toEqual({ x: TRAY_PX, y: HEADER_PX, width: 1180 - TRAY_PX, height: 820 - HEADER_PX });
    expect(layout.specCard).toEqual({ x: 1180 - 186, y: HEADER_PX, width: 186, height: 820 - HEADER_PX });
    expect(layout.canvas).toEqual({ x: TRAY_PX, y: HEADER_PX, width: 1180 - TRAY_PX - 186, height: 820 - HEADER_PX });
  });

  it('13-inch: the same arrangement with a wider spec card', () => {
    const layout = layoutOf(SCREENS[1]);
    expect(layout.orientation).toBe('landscape');
    expect(layout.tray.x).toBe(0);
    expect(right(layout.specCard)).toBe(1366);
    expect(layout.specCard.width).toBe(246);
    expect(layout.canvasShare).toBeGreaterThanOrEqual(MIN_CANVAS_SHARE);
  });

  it('tablet portrait: the tray moves to the bottom edge', () => {
    const layout = layoutOf(SCREENS[2]);
    expect(layout.orientation).toBe('portrait');
    expect(layout.tray).toEqual({ x: 0, y: 1180 - TRAY_PX, width: 820, height: TRAY_PX });
    expect(layout.stage).toEqual({ x: 0, y: HEADER_PX, width: 820, height: 1180 - HEADER_PX - TRAY_PX });
    expect(right(layout.specCard)).toBe(820);
    expect(bottom(layout.specCard)).toBe(layout.tray.y);
  });

  it('slides a tucked edge just past the screen edge it tucks into, keeping its size', () => {
    const [landscape, , portrait] = SCREENS;
    const all = Object.fromEntries(EDGES.map((edge) => [edge, true])) as Record<Edge, boolean>;
    const wide = layoutOf(landscape, { tucked: all });
    expect(bottom(wide.header)).toBe(0);
    expect(right(wide.tray)).toBe(0);
    expect(wide.tray.width).toBe(TRAY_PX);
    expect(wide.specCard.x).toBe(1180);
    const tall = layoutOf(portrait, { tucked: all });
    expect(tall.tray.y).toBe(1180);
    expect(tall.specCard.x).toBe(820);
  });

  it('hides the tray in Run mode whatever its tuck state, and Build brings it back', () => {
    for (const screen of SCREENS) {
      const run = layoutOf(screen, { mode: 'run' });
      expect(run.shown.tray).toBe(false);
      expect(run.shown).toMatchObject({ header: true, specCard: true, arenaStrip: true, runBar: true });
      expect(run.stage).toEqual(layoutOf(screen, { tucked: { tray: true } }).stage);
      expect(layoutOf(screen, { mode: 'build' }).shown.tray).toBe(true);
    }
  });

  it('mirrors the tray and the spec card for the left hand, and keeps the header reading left to right', () => {
    const [landscape, , portrait] = SCREENS;
    const wide = layoutOf(landscape, { hand: 'left' });
    expect(wide.hand).toBe('left');
    expect(right(wide.tray)).toBe(1180);
    expect(wide.stage.x).toBe(0);
    expect(wide.specCard.x).toBe(0);
    expect(wide.canvas.x).toBe(wide.specCard.width);
    expect(right(wide.canvas)).toBe(1180 - TRAY_PX);
    expect(wide.header).toEqual(layoutOf(landscape).header);
    expect(wide.canvasShare).toBe(layoutOf(landscape).canvasShare);
    const wideTucked = layoutOf(landscape, { hand: 'left', tucked: { tray: true, specCard: true } });
    expect(wideTucked.tray.x).toBe(1180);
    expect(right(wideTucked.specCard)).toBe(0);
    const tall = layoutOf(portrait, { hand: 'left' });
    expect(tall.tray).toEqual(layoutOf(portrait).tray);
    expect(tall.specCard.x).toBe(0);
  });
});
