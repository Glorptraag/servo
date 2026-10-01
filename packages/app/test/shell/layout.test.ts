// The layout maths (src/shell/layout.ts). The canvas fills the screen behind the edges. The header, the tray, the
// spec card, the Run bar, the zoom control and the tabs never cover more than 30% of it (brief Section 9's 70%); the
// arena strip is a layer of the canvas. The spec card is a readable 320 px wide and shows only while a part is
// selected. The Run bar and the zoom control never move. The browser tests check that the page draws these boxes.
import { describe, expect, it } from 'vitest';
import type { CanvasMode } from '@servo/canvas';
import { ALL_OPEN, EDGES } from '../../src/shell/edges.ts';
import type { Edge, Tucked } from '../../src/shell/edges.ts';
import {
  HEADER_PX,
  MIN_CANVAS_SHARE,
  RUN_BAR_PX,
  SPEC_CARD_PX,
  TAB_PX,
  TRAY_PX,
  ZOOM_PX,
  area,
  intersect,
  solveLayout,
  specCardSize,
  unionArea,
} from '../../src/shell/layout.ts';
import type { Hand, LayoutInput, Rect, ShellLayout } from '../../src/shell/layout.ts';

/** The screens task 4.1 names: a 10-inch tablet in landscape, a 13-inch screen, and a tablet in portrait. */
const SCREENS = [
  { name: '10-inch landscape', width: 1180, height: 820 },
  { name: '13-inch', width: 1366, height: 1024 },
  { name: 'tablet portrait', width: 820, height: 1180 },
] as const;

const MODES: readonly CanvasMode[] = ['build', 'run'];
const HANDS: readonly Hand[] = ['right', 'left'];
const FLAGS: readonly boolean[] = [false, true];

/** Every combination of tucked edges. */
const TUCK_STATES: readonly Tucked[] = Array.from({ length: 2 ** EDGES.length }, (_, bits) =>
  Object.fromEntries(EDGES.map((edge, index) => [edge, (bits & (1 << index)) !== 0])) as Record<Edge, boolean>,
);
const ALL_TUCKED = Object.fromEntries(EDGES.map((edge) => [edge, true])) as Record<Edge, boolean>;
const STATE_COUNT = TUCK_STATES.length * MODES.length * FLAGS.length * FLAGS.length;

const right = (rect: Rect): number => rect.x + rect.width;
const bottom = (rect: Rect): number => rect.y + rect.height;
const TAB_AREA = TAB_PX * TAB_PX;
const FIXED_AREA = RUN_BAR_PX.width * RUN_BAR_PX.height + ZOOM_PX.width * ZOOM_PX.height;

/** A layout with everything open and a part selected, unless the options say otherwise. */
const layoutOf = (screen: { readonly width: number; readonly height: number }, options: Partial<Omit<LayoutInput, 'width' | 'height' | 'tucked'>> & { readonly tucked?: Partial<Tucked> } = {}): ShellLayout =>
  solveLayout({
    width: screen.width,
    height: screen.height,
    tucked: { ...ALL_OPEN, ...options.tucked },
    mode: options.mode ?? 'build',
    hand: options.hand ?? 'right',
    specCardWanted: options.specCardWanted ?? true,
    specCardAside: options.specCardAside ?? false,
  });

/** Every state on one screen for one hand: tucks, modes, a part selected or not, the card stepped aside or not. */
const statesOf = function* (screen: { readonly width: number; readonly height: number }, hand: Hand) {
  for (const tucked of TUCK_STATES) {
    for (const mode of MODES) {
      for (const specCardWanted of FLAGS) {
        for (const specCardAside of FLAGS) {
          const input = { ...screen, tucked, mode, hand, specCardWanted, specCardAside };
          yield { state: JSON.stringify({ tucked, mode, hand, specCardWanted, specCardAside }), mode, layout: solveLayout(input) };
        }
      }
    }
  }
};

/** Everything drawn over the canvas now, by name: the panels and tabs that show, the arena strip, the Run bar and the zoom control. */
const drawn = (layout: ShellLayout): [string, Rect][] => [
  ...(layout.shown.header ? [['header', layout.header] as [string, Rect]] : []),
  ...(layout.shown.tray ? [['tray', layout.tray] as [string, Rect]] : []),
  ...(layout.shown.specCard ? [['spec card', layout.specCard] as [string, Rect]] : []),
  ...(layout.shown.arenaStrip ? [['arena strip', layout.arenaStrip] as [string, Rect]] : []),
  ['Run bar', layout.runBar],
  ['zoom control', layout.zoom],
  ...EDGES.filter((edge) => layout.tabShown[edge]).map((edge): [string, Rect] => [`${edge} tab`, layout.tabs[edge]]),
];

/** What covers the canvas: all of the above but the arena strip, a layer of the canvas. */
const coveringOf = (layout: ShellLayout): Rect[] => drawn(layout).filter(([name]) => name !== 'arena strip').map(([, rect]) => rect);

describe('the canvas keeps at least 70% of the screen', () => {
  for (const screen of SCREENS) {
    it(`${screen.name}: in all ${STATE_COUNT * HANDS.length} states`, () => {
      for (const hand of HANDS) {
        for (const { state, layout } of statesOf(screen, hand)) {
          expect(layout.canvasShare, state).toBeGreaterThanOrEqual(MIN_CANVAS_SHARE);
          expect(layout.covered, state).toBeLessThanOrEqual((1 - MIN_CANVAS_SHARE) * screen.width * screen.height);
        }
      }
    });
  }

  it('counts the header, tray and card where they show, the Run bar, the zoom control and the tabs that show, each overlap once', () => {
    for (const screen of SCREENS) {
      for (const { state, layout } of statesOf(screen, 'right')) {
        const covering = coveringOf(layout);
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

  it('with everything open and a part selected, on any screen from a small tablet up to a large monitor, either way up', () => {
    for (let short = 744; short <= 1440; short += 16) {
      for (let long = Math.max(short, 1024); long <= 2560; long += 32) {
        for (const screen of [
          { width: long, height: short },
          { width: short, height: long },
        ]) {
          const layout = layoutOf(screen);
          expect(layout.canvasShare, JSON.stringify(screen)).toBeGreaterThanOrEqual(MIN_CANVAS_SHARE);
          expect(layout.specCard.width, JSON.stringify(screen)).toBe(SPEC_CARD_PX);
          expect(layout.specCard.height, JSON.stringify(screen)).toBeGreaterThan(150);
        }
      }
    }
  });

  it('leaves only the Run bar, the zoom control and the tabs over the canvas with every edge tucked', () => {
    for (const screen of SCREENS) {
      const resting = layoutOf(screen, { tucked: ALL_TUCKED, specCardWanted: false });
      expect(resting.covered).toBe(FIXED_AREA + 3 * TAB_AREA);
      const selected = layoutOf(screen, { tucked: ALL_TUCKED });
      expect(selected.covered).toBe(FIXED_AREA + 4 * TAB_AREA);
      expect(selected.canvasShare).toBeGreaterThan(0.95);
    }
  });

  it('only uncovers more canvas as an edge tucks, the tray goes for a Run, the card steps aside or nothing is selected', () => {
    for (const screen of SCREENS) {
      const open = layoutOf(screen).covered;
      for (const edge of ['header', 'tray', 'specCard'] as const) {
        expect(layoutOf(screen, { tucked: { [edge]: true } }).covered, `${screen.name}, ${edge}`).toBeLessThan(open);
      }
      // The arena strip is a layer of the canvas, not something over it.
      expect(layoutOf(screen, { tucked: { arenaStrip: true } }).covered).toBe(open);
      expect(layoutOf(screen, { mode: 'run' }).covered).toBeLessThan(open);
      expect(layoutOf(screen, { specCardAside: true }).covered).toBeLessThan(open);
      expect(layoutOf(screen, { specCardWanted: false }).covered).toBeLessThan(open);
    }
  });
});

describe('the canvas', () => {
  it('fills the screen behind the edges in every state, so it never resizes when one tucks', () => {
    for (const screen of SCREENS) {
      for (const { state, layout } of statesOf(screen, 'right')) {
        expect(layout.stage, state).toEqual({ x: 0, y: 0, width: screen.width, height: screen.height });
      }
    }
  });
});

describe('the Run bar and the zoom control', () => {
  it('never move: not for Run or Stop, a tuck, a selection or the card stepping aside', () => {
    for (const screen of SCREENS) {
      for (const hand of HANDS) {
        const home = layoutOf(screen, { hand });
        for (const { state, layout } of statesOf(screen, hand)) {
          expect(layout.runBar, `${screen.name} ${state}`).toEqual(home.runBar);
          expect(layout.zoom, `${screen.name} ${state}`).toEqual(home.zoom);
        }
      }
    }
  });

  it('sit at the bottom centre of the canvas beside the tray and in its bottom corner on the card side', () => {
    const wide = layoutOf(SCREENS[0]);
    expect(wide.runBar).toEqual({ x: TRAY_PX + (1180 - TRAY_PX - RUN_BAR_PX.width) / 2, y: 820 - 12 - RUN_BAR_PX.height, ...RUN_BAR_PX });
    expect(wide.zoom).toEqual({ x: 1180 - 8 - ZOOM_PX.width, y: 820 - 12 - ZOOM_PX.height, ...ZOOM_PX });
    const tall = layoutOf(SCREENS[2]);
    expect(tall.runBar).toEqual({ x: (820 - RUN_BAR_PX.width) / 2, y: 1180 - TRAY_PX - 12 - RUN_BAR_PX.height, ...RUN_BAR_PX });
    // Where the Build layout puts it, in Run mode too, when the tray has gone.
    expect(layoutOf(SCREENS[2], { mode: 'run' }).runBar).toEqual(tall.runBar);
  });
});

describe('the spec card', () => {
  it('is a readable 320 px wide on the target screens, as tall as the 70% floor allows', () => {
    expect(specCardSize(1180, 820)).toEqual({ width: 320, height: 315 });
    expect(specCardSize(1366, 1024)).toEqual({ width: 320, height: 617 });
    expect(specCardSize(820, 1180)).toEqual({ width: 320, height: 355 });
    // A large monitor: as tall as leaves the zoom control room below it.
    expect(specCardSize(1920, 1080)).toEqual({ width: 320, height: 1080 - HEADER_PX - 12 - ZOOM_PX.height - 12 });
    expect(specCardSize(400, 300)).toEqual({ width: 0, height: 0 });
  });

  it('is away at rest, with no tab, and slides in when a part is selected unless the child has tucked it', () => {
    for (const screen of SCREENS) {
      const resting = layoutOf(screen, { specCardWanted: false });
      expect(resting.shown.specCard).toBe(false);
      expect(resting.tabShown.specCard).toBe(false);
      expect(resting.specCard.x).toBe(screen.width);
      const selected = layoutOf(screen);
      expect(selected.shown.specCard).toBe(true);
      expect(selected.tabShown.specCard).toBe(true);
      expect(right(selected.specCard)).toBe(screen.width);
      expect(right(selected.tabs.specCard)).toBe(selected.specCard.x);
      const tucked = layoutOf(screen, { tucked: { specCard: true } });
      expect(tucked.shown.specCard).toBe(false);
      expect(tucked.tabShown.specCard).toBe(true);
      expect(right(tucked.tabs.specCard)).toBe(screen.width);
    }
  });

  it('keeps its size whatever else changes, so it never jumps', () => {
    for (const screen of SCREENS) {
      const { width, height } = specCardSize(screen.width, screen.height);
      for (const { state, layout } of statesOf(screen, 'right')) {
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
      expect(right(layoutOf(screen, { specCardAside: true, hand: 'left' }).specCard)).toBe(0);
    }
  });
});

describe('the arena strip', () => {
  it('keeps its width and its tab where the card shows, whatever the card does, and follows the header up', () => {
    for (const screen of SCREENS) {
      for (const hand of HANDS) {
        const home = layoutOf(screen, { hand });
        for (const { state, layout } of statesOf(screen, hand)) {
          expect([layout.arenaStrip.x, layout.arenaStrip.width], `${screen.name} ${state}`).toEqual([home.arenaStrip.x, home.arenaStrip.width]);
          expect(layout.tabs.arenaStrip.x, `${screen.name} ${state}`).toBe(home.tabs.arenaStrip.x);
        }
      }
      const raised = layoutOf(screen, { tucked: { header: true } });
      expect(raised.arenaStrip.y).toBe(6);
    }
  });
});

describe('where each region goes (brief Section 9)', () => {
  it('10-inch landscape: header along the top, tray on the left, spec card on the right', () => {
    const layout = layoutOf(SCREENS[0]);
    expect(layout.orientation).toBe('landscape');
    expect(layout.header).toEqual({ x: 0, y: 0, width: 1180, height: HEADER_PX });
    expect(layout.tray).toEqual({ x: 0, y: HEADER_PX, width: TRAY_PX, height: 820 - HEADER_PX });
    expect(layout.work).toEqual({ x: TRAY_PX, y: HEADER_PX, width: 1180 - TRAY_PX, height: 820 - HEADER_PX });
    expect(layout.specCard).toEqual({ x: 1180 - 320, y: HEADER_PX, width: 320, height: 315 });
    expect(layout.arenaStrip.y).toBe(HEADER_PX + 6);
    expect(layout.arenaStrip.x).toBeGreaterThan(TRAY_PX);
    expect(right(layout.arenaStrip)).toBeLessThan(layout.specCard.x);
  });

  it('13-inch: the same arrangement, with a taller spec card', () => {
    const layout = layoutOf(SCREENS[1]);
    expect(layout.orientation).toBe('landscape');
    expect(layout.tray.x).toBe(0);
    expect(right(layout.specCard)).toBe(1366);
    expect(layout.specCard.height).toBe(617);
  });

  it('tablet portrait: the tray moves to the bottom edge, and the Run bar sits above it', () => {
    const layout = layoutOf(SCREENS[2]);
    expect(layout.orientation).toBe('portrait');
    expect(layout.tray).toEqual({ x: 0, y: 1180 - TRAY_PX, width: 820, height: TRAY_PX });
    expect(layout.work).toEqual({ x: 0, y: HEADER_PX, width: 820, height: 1180 - HEADER_PX - TRAY_PX });
    expect(layout.specCard).toEqual({ x: 820 - 320, y: HEADER_PX, width: 320, height: 355 });
    expect(bottom(layout.runBar)).toBe(layout.tray.y - 12);
  });

  it('never puts one thing on the canvas over another, in any state', () => {
    for (const screen of SCREENS) {
      for (const hand of HANDS) {
        for (const { state, layout } of statesOf(screen, hand)) {
          const things = drawn(layout);
          for (const [index, [nameA, a]] of things.entries()) {
            for (const [nameB, b] of things.slice(index + 1)) expect(intersect(a, b), `${nameA} and ${nameB}, ${screen.name} ${state}`).toBeNull();
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

  it('hides the tray and its tab in Run mode whatever its tuck state, and Build brings them back', () => {
    for (const screen of SCREENS) {
      const run = layoutOf(screen, { mode: 'run' });
      expect(run.shown).toEqual({ header: true, tray: false, specCard: true, arenaStrip: true });
      expect(run.tabShown.tray).toBe(false);
      expect(run.work).toEqual(layoutOf(screen, { tucked: { tray: true } }).work);
      const build = layoutOf(screen, { mode: 'build' });
      expect([build.shown.tray, build.tabShown.tray]).toEqual([true, true]);
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
      expect(leftHanded.safeArea).toEqual({ ...rightHanded.safeArea, left: rightHanded.safeArea.right, right: rightHanded.safeArea.left });
      expect(leftHanded.covered).toBe(rightHanded.covered);
    }
    expect(layoutOf(SCREENS[0], { hand: 'left' }).specCard.x).toBe(0);
    expect(right(layoutOf(SCREENS[0], { hand: 'left' }).tray)).toBe(1180);
  });
});

describe('the safe area (task 3.7)', () => {
  it('starts past the header, the tray, the card where it shows, the Run bar and the zoom control', () => {
    const [landscape, , portrait] = SCREENS;
    expect(layoutOf(landscape).safeArea).toEqual({ top: HEADER_PX, left: TRAY_PX, bottom: 12 + RUN_BAR_PX.height, right: 320 });
    expect(layoutOf(landscape, { specCardWanted: false }).safeArea.right).toBe(8 + ZOOM_PX.width);
    expect(layoutOf(landscape, { tucked: ALL_TUCKED }).safeArea).toEqual({ top: 0, left: 0, bottom: 12 + RUN_BAR_PX.height, right: 8 + ZOOM_PX.width });
    expect(layoutOf(portrait).safeArea).toEqual({ top: HEADER_PX, left: 0, bottom: TRAY_PX + 12 + RUN_BAR_PX.height, right: 320 });
    // The Run bar stays put, so it still bounds the bottom when the tray has gone.
    expect(layoutOf(portrait, { mode: 'run' }).safeArea.bottom).toBe(TRAY_PX + 12 + RUN_BAR_PX.height);
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
    expect(unionArea([a, { x: 3, y: 3, width: 0, height: 9 }])).toBe(100);
  });
});
