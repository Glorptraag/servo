// The layout maths (src/shell/layout.ts). The canvas fills the screen behind the edges; the header, the tray, the
// spec card and the Run bar never cover more than 30% of it (brief Section 9's 70%), and the spec card is a readable
// 320 px wide. The browser tests check that the page draws these boxes.
import { describe, expect, it } from 'vitest';
import type { CanvasMode } from '@servo/canvas';
import { ALL_OPEN, EDGES } from '../../src/shell/edges.ts';
import type { Edge, Tucked } from '../../src/shell/edges.ts';
import {
  HEADER_PX,
  MIN_CANVAS_SHARE,
  RUN_BAR_PX,
  SPEC_CARD_PX,
  TRAY_PX,
  ZOOM_PX,
  area,
  intersect,
  solveLayout,
  specCardSize,
  unionArea,
} from '../../src/shell/layout.ts';
import type { Hand, Rect, ShellLayout } from '../../src/shell/layout.ts';

/** The screens task 4.1 names: a 10-inch tablet in landscape, a 13-inch screen, and a tablet in portrait. */
const SCREENS = [
  { name: '10-inch landscape', width: 1180, height: 820 },
  { name: '13-inch', width: 1366, height: 1024 },
  { name: 'tablet portrait', width: 820, height: 1180 },
] as const;

const MODES: readonly CanvasMode[] = ['build', 'run'];
const HANDS: readonly Hand[] = ['right', 'left'];
const ASIDE: readonly boolean[] = [false, true];

/** Every combination of tucked edges. */
const TUCK_STATES: readonly Tucked[] = Array.from({ length: 2 ** EDGES.length }, (_, bits) =>
  Object.fromEntries(EDGES.map((edge, index) => [edge, (bits & (1 << index)) !== 0])) as Record<Edge, boolean>,
);
const ALL_TUCKED = Object.fromEntries(EDGES.map((edge) => [edge, true])) as Record<Edge, boolean>;

const right = (rect: Rect): number => rect.x + rect.width;
const bottom = (rect: Rect): number => rect.y + rect.height;

const layoutOf = (
  screen: { readonly width: number; readonly height: number },
  options: { readonly tucked?: Partial<Tucked>; readonly mode?: CanvasMode; readonly hand?: Hand; readonly specCardAside?: boolean } = {},
): ShellLayout =>
  solveLayout({
    width: screen.width,
    height: screen.height,
    tucked: { ...ALL_OPEN, ...options.tucked },
    mode: options.mode ?? 'build',
    hand: options.hand ?? 'right',
    specCardAside: options.specCardAside ?? false,
  });

const everyState = function* (screen: { readonly width: number; readonly height: number }) {
  for (const tucked of TUCK_STATES) {
    for (const mode of MODES) {
      for (const hand of HANDS) {
        for (const specCardAside of ASIDE) {
          yield { state: JSON.stringify({ tucked, mode, hand, specCardAside }), layout: solveLayout({ ...screen, tucked, mode, hand, specCardAside }) };
        }
      }
    }
  }
};

/** Everything drawn over the canvas now, by name: the panels that show, the Run bar, the zoom control and the tabs. */
const drawn = (layout: ShellLayout, mode: CanvasMode): [string, Rect][] => [
  ...(layout.shown.header ? [['header', layout.header] as [string, Rect]] : []),
  ...(layout.shown.tray ? [['tray', layout.tray] as [string, Rect]] : []),
  ...(layout.shown.specCard ? [['spec card', layout.specCard] as [string, Rect]] : []),
  ...(layout.shown.arenaStrip ? [['arena strip', layout.arenaStrip] as [string, Rect]] : []),
  ['Run bar', layout.runBar],
  ['zoom control', layout.zoom],
  ...EDGES.filter((edge) => !(edge === 'tray' && mode === 'run')).map((edge): [string, Rect] => [`${edge} tab`, layout.tabs[edge]]),
];

describe('the canvas keeps at least 70% of the screen', () => {
  for (const screen of SCREENS) {
    it(`${screen.name}: in all ${TUCK_STATES.length * MODES.length * HANDS.length * ASIDE.length} states`, () => {
      for (const { state, layout } of everyState(screen)) {
        expect(layout.canvasShare, state).toBeGreaterThanOrEqual(MIN_CANVAS_SHARE);
        expect(layout.covered, state).toBeLessThanOrEqual((1 - MIN_CANVAS_SHARE) * screen.width * screen.height);
      }
    });
  }

  it('counts what the header, the tray, the spec card and the Run bar cover, each overlap once', () => {
    for (const screen of SCREENS) {
      for (const { state, layout } of everyState(screen)) {
        const covering = [
          layout.shown.header ? layout.header : null,
          layout.shown.tray ? layout.tray : null,
          layout.shown.specCard ? layout.specCard : null,
          layout.runBar,
        ].filter((rect): rect is Rect => rect !== null);
        // Checked against a count of every 4 px square whose centre something covers.
        let squares = 0;
        for (let x = 2; x < screen.width; x += 4) {
          for (let y = 2; y < screen.height; y += 4) {
            if (covering.some((rect) => x >= rect.x && x < right(rect) && y >= rect.y && y < bottom(rect))) squares += 1;
          }
        }
        expect(Math.abs(squares * 16 - layout.covered) / layout.covered, `${screen.name} ${state}`).toBeLessThan(0.02);
      }
    }
  }, 60_000);

  it('with everything open, on any screen from a small tablet up to a large monitor, either way up', () => {
    for (let short = 744; short <= 1440; short += 16) {
      for (let long = Math.max(short, 1024); long <= 2560; long += 32) {
        for (const screen of [
          { width: long, height: short },
          { width: short, height: long },
        ]) {
          const layout = layoutOf(screen);
          expect(layout.canvasShare, JSON.stringify(screen)).toBeGreaterThanOrEqual(MIN_CANVAS_SHARE);
          expect(layout.specCard.width, JSON.stringify(screen)).toBe(SPEC_CARD_PX);
          expect(layout.specCard.height, JSON.stringify(screen)).toBeGreaterThan(200);
        }
      }
    }
  });

  it('leaves only the Run bar over the canvas with every edge it can tuck tucked', () => {
    for (const screen of SCREENS) {
      const layout = layoutOf(screen, { tucked: ALL_TUCKED });
      expect(layout.covered).toBe(RUN_BAR_PX.width * RUN_BAR_PX.height);
      expect(layout.canvasShare).toBeGreaterThan(0.97);
    }
  });

  it('only uncovers more canvas as an edge tucks, the tray goes for a Run or the spec card steps aside', () => {
    for (const screen of SCREENS) {
      const open = layoutOf(screen).covered;
      for (const edge of ['header', 'tray', 'specCard'] as const) {
        expect(layoutOf(screen, { tucked: { [edge]: true } }).covered, `${screen.name}, ${edge}`).toBeLessThan(open);
      }
      // The arena strip is a tool on the canvas, like the zoom control: it is not counted as covering it.
      expect(layoutOf(screen, { tucked: { arenaStrip: true } }).covered).toBe(open);
      expect(layoutOf(screen, { mode: 'run' }).covered).toBeLessThan(open);
      expect(layoutOf(screen, { specCardAside: true }).covered).toBeLessThan(open);
    }
  });
});

describe('the canvas', () => {
  it('fills the screen behind the edges in every state, so it never resizes when one tucks', () => {
    for (const screen of SCREENS) {
      for (const { state, layout } of everyState(screen)) {
        expect(layout.stage, state).toEqual({ x: 0, y: 0, width: screen.width, height: screen.height });
      }
    }
  });
});

describe('the spec card', () => {
  it('is a readable 320 px wide on the target screens, as tall as the 70% floor allows', () => {
    expect(specCardSize(1180, 820)).toEqual({ width: 320, height: 358 });
    expect(specCardSize(1366, 1024)).toEqual({ width: 320, height: 661 });
    expect(specCardSize(820, 1180)).toEqual({ width: 320, height: 398 });
    // A large monitor: as tall as leaves the zoom control room below it.
    expect(specCardSize(1920, 1080)).toEqual({ width: 320, height: 1080 - HEADER_PX - 12 - ZOOM_PX.height - 12 });
    expect(specCardSize(400, 300)).toEqual({ width: 0, height: 0 });
  });

  it('keeps its size whatever else is tucked, so it never jumps', () => {
    for (const screen of SCREENS) {
      const { width, height } = specCardSize(screen.width, screen.height);
      for (const { state, layout } of everyState(screen)) {
        expect([layout.specCard.width, layout.specCard.height], state).toEqual([width, height]);
      }
    }
  });

  it('lies on the right edge under the header, never covering the canvas fully, with the zoom control clear below it', () => {
    for (const screen of SCREENS) {
      const layout = layoutOf(screen);
      expect(right(layout.specCard)).toBe(screen.width);
      expect(layout.specCard.y).toBe(HEADER_PX);
      expect(area(layout.specCard)).toBeLessThan(area(layout.work) / 2);
      expect(bottom(layout.specCard)).toBeLessThan(layout.zoom.y);
    }
  });

  it('steps aside, off the screen, while the child drags on the canvas', () => {
    for (const screen of SCREENS) {
      const aside = layoutOf(screen, { specCardAside: true });
      expect(aside.shown.specCard).toBe(false);
      expect(aside.specCard.x).toBe(screen.width);
      expect(right(aside.tabs.specCard)).toBe(screen.width);
      const mirrored = layoutOf(screen, { specCardAside: true, hand: 'left' });
      expect(right(mirrored.specCard)).toBe(0);
    }
  });
});

describe('where each region goes (brief Section 9)', () => {
  it('10-inch landscape: header along the top, tray on the left, spec card on the right, Run bar at the bottom centre', () => {
    const layout = layoutOf(SCREENS[0]);
    expect(layout.orientation).toBe('landscape');
    expect(layout.header).toEqual({ x: 0, y: 0, width: 1180, height: HEADER_PX });
    expect(layout.tray).toEqual({ x: 0, y: HEADER_PX, width: TRAY_PX, height: 820 - HEADER_PX });
    expect(layout.work).toEqual({ x: TRAY_PX, y: HEADER_PX, width: 1180 - TRAY_PX, height: 820 - HEADER_PX });
    expect(layout.specCard).toEqual({ x: 1180 - 320, y: HEADER_PX, width: 320, height: 358 });
    expect(layout.runBar).toEqual({ x: TRAY_PX + (1180 - TRAY_PX - RUN_BAR_PX.width) / 2, y: 820 - 12 - RUN_BAR_PX.height, ...RUN_BAR_PX });
    expect(layout.zoom).toEqual({ x: 1180 - 8 - ZOOM_PX.width, y: 820 - 12 - ZOOM_PX.height, ...ZOOM_PX });
    expect(layout.arenaStrip.y).toBe(HEADER_PX + 6);
    expect(layout.arenaStrip.x).toBeGreaterThan(TRAY_PX);
    expect(right(layout.arenaStrip)).toBeLessThan(layout.specCard.x);
  });

  it('13-inch: the same arrangement, with a taller spec card', () => {
    const layout = layoutOf(SCREENS[1]);
    expect(layout.orientation).toBe('landscape');
    expect(layout.tray.x).toBe(0);
    expect(right(layout.specCard)).toBe(1366);
    expect(layout.specCard.height).toBe(661);
  });

  it('tablet portrait: the tray moves to the bottom edge, and the Run bar sits above it', () => {
    const layout = layoutOf(SCREENS[2]);
    expect(layout.orientation).toBe('portrait');
    expect(layout.tray).toEqual({ x: 0, y: 1180 - TRAY_PX, width: 820, height: TRAY_PX });
    expect(layout.work).toEqual({ x: 0, y: HEADER_PX, width: 820, height: 1180 - HEADER_PX - TRAY_PX });
    expect(layout.specCard).toEqual({ x: 820 - 320, y: HEADER_PX, width: 320, height: 398 });
    expect(bottom(layout.runBar)).toBe(layout.tray.y - 12);
  });

  it('never puts one thing on the canvas over another, in any state', () => {
    for (const screen of SCREENS) {
      for (const tucked of TUCK_STATES) {
        for (const mode of MODES) {
          for (const hand of HANDS) {
            for (const specCardAside of ASIDE) {
              const layout = solveLayout({ ...screen, tucked, mode, hand, specCardAside });
              const things = drawn(layout, mode);
              for (const [index, [nameA, a]] of things.entries()) {
                for (const [nameB, b] of things.slice(index + 1)) {
                  const state = `${screen.name} ${JSON.stringify({ tucked, mode, hand, specCardAside })}`;
                  expect(intersect(a, b), `${nameA} and ${nameB}, ${state}`).toBeNull();
                }
              }
            }
          }
        }
      }
    }
  });

  it('slides a tucked edge just past the screen edge it tucks into, keeping its size', () => {
    const [landscape, , portrait] = SCREENS;
    const wide = layoutOf(landscape, { tucked: ALL_TUCKED });
    expect(bottom(wide.header)).toBe(0);
    expect(right(wide.tray)).toBe(0);
    expect(wide.tray.width).toBe(TRAY_PX);
    expect(wide.specCard.x).toBe(1180);
    expect(bottom(wide.arenaStrip)).toBe(0);
    expect(wide.work).toEqual({ x: 0, y: 0, width: 1180, height: 820 });
    const tall = layoutOf(portrait, { tucked: ALL_TUCKED });
    expect(tall.tray.y).toBe(1180);
    expect(tall.specCard.x).toBe(820);
  });

  it('hides the tray in Run mode whatever its tuck state, and Build brings it back', () => {
    for (const screen of SCREENS) {
      const run = layoutOf(screen, { mode: 'run' });
      expect(run.shown).toEqual({ header: true, tray: false, specCard: true, arenaStrip: true });
      expect(run.work).toEqual(layoutOf(screen, { tucked: { tray: true } }).work);
      expect(layoutOf(screen, { mode: 'build' }).shown.tray).toBe(true);
    }
  });

  it('mirrors the tray, the spec card and the controls on the canvas for the left hand; the header stays', () => {
    for (const screen of SCREENS) {
      const rightHanded = layoutOf(screen);
      const leftHanded = layoutOf(screen, { hand: 'left' });
      const mirrored = (rect: Rect): Rect => ({ ...rect, x: screen.width - rect.x - rect.width });
      expect(leftHanded.hand).toBe('left');
      expect(leftHanded.header).toEqual(rightHanded.header);
      for (const key of ['tray', 'specCard', 'arenaStrip', 'runBar', 'zoom', 'work'] as const) {
        expect(leftHanded[key], `${screen.name}, ${key}`).toEqual(mirrored(rightHanded[key]));
      }
      for (const edge of EDGES) expect(leftHanded.tabs[edge], `${screen.name}, ${edge} tab`).toEqual(mirrored(rightHanded.tabs[edge]));
      expect(leftHanded.covered).toBe(rightHanded.covered);
    }
    expect(layoutOf(SCREENS[0], { hand: 'left' }).specCard.x).toBe(0);
    expect(right(layoutOf(SCREENS[0], { hand: 'left' }).tray)).toBe(1180);
  });
});

describe('unionArea', () => {
  it('counts each overlap once', () => {
    const a: Rect = { x: 0, y: 0, width: 10, height: 10 };
    const b: Rect = { x: 5, y: 0, width: 10, height: 10 };
    const c: Rect = { x: 0, y: 5, width: 15, height: 10 };
    expect(unionArea([])).toBe(0);
    expect(unionArea([a])).toBe(100);
    expect(unionArea([a, b])).toBe(150);
    expect(unionArea([a, b, c])).toBe(225);
    expect(unionArea([a, { x: 2, y: 2, width: 3, height: 3 }])).toBe(100);
    expect(unionArea([a, { x: 20, y: 20, width: 5, height: 5 }])).toBe(125);
  });
});
