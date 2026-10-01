// Task 4.1's layout tests: the real app page at a 10-inch tablet in landscape, a 13-inch screen and a tablet in
// portrait. The canvas fills the screen behind the edges; each region sits where brief Section 9 puts it; the chrome
// leaves at least 70% of the canvas uncovered with everything open, as each edge tucks away and with all of them
// tucked; the spec card is away at rest, as nothing is selected; the Run bar never tucks; and the tuck states
// survive a real reload. shell.test.tsx shows the card, which needs a selection the real canvas cannot make yet
// (task 3.4), and checks that the Run button never moves.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cdp } from 'vitest/browser';
import { EDGES, EDGE_NAMES, RUN_BAR_NAME, TUCKED_KEY } from '../../src/shell/edges.ts';
import type { Edge } from '../../src/shell/edges.ts';
import { MIN_CANVAS_SHARE, intersect, unionArea } from '../../src/shell/layout.ts';
import type { Rect } from '../../src/shell/layout.ts';
import { SCREENS, boxOf, closeAll, colourDistance, openApp, overlap } from './frame.ts';
import type { AppFrame, Box, Rgb } from './frame.ts';

/** Measurements in CSS pixels agree to within this. */
const PX = 0.5;

/** The device's motion preference, as CSS media sees it in the test page and the frames in it. */
const reduceMotion = (reduce: boolean) =>
  cdp().send('Emulation.setEmulatedMedia', { features: reduce ? [{ name: 'prefers-reduced-motion', value: 'reduce' }] : [] });

// The geometry tests look at where regions end up, so the device asks for reduced motion and every move is instant.
// Headless Chromium also holds a composited transition until something else draws a frame, which a device never
// does. The motion tests below switch motion back on and check what each move is set to do, or step it by hand.
beforeAll(() => reduceMotion(true));
beforeEach(() => localStorage.clear());
afterEach(closeAll);
afterAll(async () => {
  localStorage.clear();
  await reduceMotion(false);
});

const rectOf = (box: Box): Rect => ({ x: box.left, y: box.top, width: box.width, height: box.height });

/** The edges whose tab shows with nothing selected: the spec card's waits for a part. */
const TABBED: readonly Edge[] = ['header', 'tray', 'arenaStrip'];

/**
 * The share of the screen's canvas that nothing covers: the canvas less the header, the tray and the spec card where
 * they show, the Run bar's room and the zoom control, which always show, and the tabs that show. The arena strip is
 * a layer of the canvas.
 */
const visibleShare = (app: AppFrame): number => {
  const screen: Rect = { x: 0, y: 0, width: app.screen.width, height: app.screen.height };
  const covering = [
    ...(['header', 'tray', 'specCard'] as const).filter((name) => app.region(name).dataset.shown === 'true').map((name) => app.region(name)),
    app.region('runBar'),
    app.region('zoom'),
    ...EDGES.map((edge) => app.tab(edge)).filter((tab) => !tab.hidden),
  ]
    .map((element) => intersect(rectOf(boxOf(element)), screen))
    .filter((rect): rect is Rect => rect !== null);
  return 1 - unionArea(covering) / (screen.width * screen.height);
};

const expectSameBox = (actual: Box, expected: Pick<Box, 'left' | 'top' | 'right' | 'bottom'>, what: string): void => {
  for (const side of ['left', 'top', 'right', 'bottom'] as const) {
    expect(Math.abs(actual[side] - expected[side]), `${what}: ${side} ${actual[side]} against ${expected[side]}`).toBeLessThanOrEqual(PX);
  }
};

const isShown = (element: HTMLElement): boolean => getComputedStyle(element).visibility !== 'hidden';

/** Every control a child can reach now. */
const visibleButtons = (app: AppFrame): HTMLButtonElement[] =>
  [...app.doc.querySelectorAll('button')].filter((button) => !button.hidden && !button.closest('[inert]') && isShown(button));

const EDGE_ELEMENT: Readonly<Record<Edge, string>> = {
  header: 'header',
  tray: 'section',
  specCard: 'aside',
  arenaStrip: 'section',
};

/** The canvas the header and the tray leave, from where they are on the page. */
const workOf = (app: AppFrame): Pick<Box, 'left' | 'top' | 'right' | 'bottom'> => {
  const { width, height } = app.screen;
  const header = app.region('header').dataset.shown === 'true' ? boxOf(app.region('header')).bottom : 0;
  const trayShown = app.region('tray').dataset.shown === 'true';
  const tray = boxOf(app.region('tray'));
  if (height > width) return { left: 0, top: header, right: width, bottom: trayShown ? tray.top : height };
  return { left: trayShown ? tray.right : 0, top: header, right: width, bottom: height };
};

describe.each(SCREENS)('$name ($width × $height)', (screen) => {
  const portrait = screen.height > screen.width;
  const whole = { left: 0, top: 0, right: screen.width, bottom: screen.height };

  it('fills the screen with the canvas and puts every region where the brief puts it, leaving 70% of it uncovered', async () => {
    const app = await openApp(screen);
    const header = boxOf(app.region('header'));
    const tray = boxOf(app.region('tray'));
    const strip = boxOf(app.region('arenaStrip'));
    const runBar = boxOf(app.region('runBar'));
    const pill = boxOf(app.region('runBarPill'));
    const zoom = boxOf(app.region('zoom'));

    // The canvas fills the screen behind the edges.
    expectSameBox(boxOf(app.region('stage')), whole, 'canvas');
    expectSameBox(boxOf(app.canvasElement()), whole, 'canvas element');

    // Header: a thin top edge across the screen.
    expectSameBox(header, { left: 0, top: 0, right: screen.width, bottom: header.bottom }, 'header');
    expect(header.height).toBeGreaterThanOrEqual(44);
    expect(header.height).toBeLessThanOrEqual(64);

    // Part tray: the left edge, or the bottom edge in portrait; big enough for a 96 px tile.
    if (portrait) {
      expectSameBox(tray, { left: 0, top: tray.top, right: screen.width, bottom: screen.height }, 'tray');
      expect(tray.height).toBeGreaterThanOrEqual(96);
    } else {
      expectSameBox(tray, { left: 0, top: header.bottom, right: tray.right, bottom: screen.height }, 'tray');
      expect(tray.width).toBeGreaterThanOrEqual(96);
    }
    const work = workOf(app);

    // Spec card: away at rest, with no tab, since nothing is selected (brief Section 9: it slides in on a tap).
    expect(app.region('specCard').dataset.shown).toBe('false');
    expect(isShown(app.region('specCard'))).toBe(false);
    expect(boxOf(app.region('specCard')).left).toBeGreaterThanOrEqual(screen.width - PX);
    expect(app.tab('specCard').hidden).toBe(true);

    // Arena strip: along the top of the canvas, clear of where the spec card shows.
    expect(strip.top - work.top).toBeGreaterThanOrEqual(0);
    expect(strip.top - work.top).toBeLessThanOrEqual(12);
    expect(strip.left).toBeGreaterThan(work.left);
    expect(strip.right).toBeLessThan(screen.width - 300);

    // Run bar: bottom centre of the canvas, its bar inside the room the layout keeps for it.
    expect(Math.abs((runBar.left + runBar.right) / 2 - (work.left + work.right) / 2)).toBeLessThanOrEqual(1);
    expect(work.bottom - runBar.bottom).toBeGreaterThanOrEqual(0);
    expect(work.bottom - runBar.bottom).toBeLessThanOrEqual(24);
    expect(Math.abs((pill.left + pill.right) / 2 - (runBar.left + runBar.right) / 2)).toBeLessThanOrEqual(1);
    expect(overlap(pill, runBar)).toBeCloseTo(pill.width * pill.height, 3);

    // Zoom control: the bottom corner on the spec card's side.
    expect(work.right - zoom.right).toBeLessThanOrEqual(12);
    expect(work.bottom - zoom.bottom).toBeLessThanOrEqual(16);

    expect(visibleShare(app)).toBeGreaterThanOrEqual(MIN_CANVAS_SHARE);
  });

  it('names every region and control, gives the Run bar no tab, and keeps every target at least 44 px', async () => {
    const app = await openApp(screen);
    const { doc } = app;
    expect(doc.querySelectorAll('header')).toHaveLength(1);
    expect(doc.querySelectorAll('main')).toHaveLength(1);
    expect(app.canvasElement().getAttribute('role')).toBe('img');
    expect(app.canvasElement().getAttribute('aria-label')).toBe('Build canvas');
    for (const edge of EDGES) {
      const tab = app.tab(edge);
      expect(tab.getAttribute('aria-label')).toBe(EDGE_NAMES[edge]);
      expect(tab.getAttribute('aria-expanded')).toBe(edge === 'specCard' ? 'false' : 'true');
      const region = doc.getElementById(tab.getAttribute('aria-controls') ?? '');
      expect(region?.tagName.toLowerCase(), edge).toBe(EDGE_ELEMENT[edge]);
      if (edge !== 'header') expect(region?.getAttribute('aria-label')).toBe(EDGE_NAMES[edge]);
    }
    const runBar = app.region('runBar');
    expect(runBar.getAttribute('aria-label')).toBe(RUN_BAR_NAME);
    expect(doc.querySelectorAll('button.shell-tab')).toHaveLength(EDGES.length);
    expect(doc.querySelector(`[aria-controls="${runBar.id}"]`)).toBeNull();
    // With nothing selected the spec card has nothing to show, so its tab is out of the way too.
    const tabs = visibleButtons(app).filter((button) => button.matches('.shell-tab'));
    expect(tabs.map((button) => button.dataset.edge)).toEqual([...TABBED]);
    const zoom = doc.querySelector('[role="group"][aria-label="Zoom"]');
    expect([...(zoom?.querySelectorAll('button') ?? [])].map((button) => button.getAttribute('aria-label'))).toEqual(['Zoom in', 'Fit', 'Zoom out']);
    const buttons = visibleButtons(app);
    expect(buttons.length).toBeGreaterThanOrEqual(TABBED.length + 3);
    for (const button of buttons) {
      const box = boxOf(button);
      const name = button.getAttribute('aria-label') ?? button.textContent;
      expect(box.width, `${name} width`).toBeGreaterThanOrEqual(44);
      expect(box.height, `${name} height`).toBeGreaterThanOrEqual(44);
    }
    // Nothing on screen is an exclamation in system text (ground rule 7).
    expect(doc.body.textContent).not.toContain('!');
  });

  it('never puts one thing over another', async () => {
    const app = await openApp(screen);
    const named = [
      ...(['header', 'tray', 'arenaStrip', 'runBar', 'zoom'] as const).map((name) => [name, app.region(name)] as const),
      ...TABBED.map((edge) => [`${edge} tab`, app.tab(edge)] as const),
    ];
    const boxes = named.map(([name, element]) => ({ name, box: boxOf(element) }));
    for (const [index, a] of boxes.entries()) {
      for (const b of boxes.slice(index + 1)) expect(overlap(a.box, b.box), `${a.name} and ${b.name}`).toBe(0);
    }
  });

  it('uncovers more canvas as each edge tucks away, and keeps the Run bar', async () => {
    const app = await openApp(screen);
    let share = visibleShare(app);
    for (const edge of TABBED) {
      await app.press(app.tab(edge));
      const tab = app.tab(edge);
      const region = app.doc.getElementById(tab.getAttribute('aria-controls') ?? '') as HTMLElement;
      expect(tab.getAttribute('aria-expanded'), edge).toBe('false');
      expect(region.inert, edge).toBe(true);
      expect(isShown(region), edge).toBe(false);
      const next = visibleShare(app);
      expect(next, edge).toBeGreaterThanOrEqual(share);
      expect(next, edge).toBeGreaterThanOrEqual(MIN_CANVAS_SHARE);
      expectSameBox(boxOf(app.canvasElement()), whole, `canvas element after tucking ${edge}`);
      share = next;
    }
    // With everything tucked only the Run bar, the zoom control and the tabs lie over the canvas, and every tab is
    // on screen to bring its edge back.
    const runBar = boxOf(app.region('runBar'));
    const zoom = boxOf(app.region('zoom'));
    expect(isShown(app.region('runBar'))).toBe(true);
    const rest = runBar.width * runBar.height + zoom.width * zoom.height + TABBED.length * 44 * 44;
    expect(visibleShare(app)).toBeCloseTo(1 - rest / (screen.width * screen.height), 6);
    for (const edge of TABBED) {
      const box = boxOf(app.tab(edge));
      expect(box.left >= 0 && box.top >= 0 && box.right <= screen.width && box.bottom <= screen.height, edge).toBe(true);
    }
    for (const edge of [...TABBED].reverse()) await app.press(app.tab(edge));
    expect(TABBED.map((edge) => app.tab(edge).getAttribute('aria-expanded'))).toEqual(TABBED.map(() => 'true'));
    expect(visibleShare(app)).toBeCloseTo(visibleShare(await openApp(screen)), 6);
  });

  it('keeps the tuck states across a reload', async () => {
    const app = await openApp(screen);
    for (const edge of TABBED) await app.press(app.tab(edge));
    expect(JSON.parse(localStorage.getItem(TUCKED_KEY) ?? 'null')).toEqual([...TABBED]);
    const share = visibleShare(app);

    await app.reload();
    expect(TABBED.map((edge) => app.tab(edge).getAttribute('aria-expanded'))).toEqual(TABBED.map(() => 'false'));
    for (const edge of TABBED) expect(isShown(app.region(edge)), edge).toBe(false);
    expect(visibleShare(app)).toBeCloseTo(share, 6);
    expectSameBox(boxOf(app.canvasElement()), whole, 'canvas element after the reload');

    for (const edge of TABBED) await app.press(app.tab(edge));
    // A save from before the Run bar stopped tucking leaves it where it is.
    localStorage.setItem(TUCKED_KEY, '["runBar"]');
    await app.reload();
    expect(TABBED.map((edge) => app.tab(edge).getAttribute('aria-expanded'))).toEqual(TABBED.map(() => 'true'));
    expect(isShown(app.region('runBar'))).toBe(true);
    expect(visibleShare(app)).toBeGreaterThanOrEqual(MIN_CANVAS_SHARE);
  });
});

describe('motion', () => {
  /** Each animated property's duration in seconds, from the computed transition lists. */
  const durations = (element: Element): Map<string, number> => {
    const style = getComputedStyle(element);
    const properties = style.transitionProperty.split(',').map((name) => name.trim());
    const times = style.transitionDuration.split(',').map((time) => Number.parseFloat(time));
    return new Map(properties.map((name, index) => [name, times[index % times.length] ?? 0]));
  };

  const screen = SCREENS[0] ?? { name: '10-inch landscape', width: 1180, height: 820 };

  /** The canvas's workbench with nothing on it (packages/canvas, the standard palette). */
  const WORKBENCH: Rgb = [0xeb, 0xe8, 0xe3];
  /** Points on the canvas, as fractions of the screen, clear of every edge and control on any screen here. */
  const PROBES: readonly (readonly [number, number])[] = [
    [0.34, 0.63],
    [0.55, 0.63],
    [0.64, 0.37],
    [0.34, 0.8],
  ];

  /** Reads the canvas at the probes from a real screenshot: never blank, always the workbench. */
  const expectWorkbench = async (app: AppFrame, step: string): Promise<void> => {
    const picture = await app.shoot();
    const width = app.element.clientWidth;
    const height = app.element.clientHeight;
    for (const [fx, fy] of PROBES) {
      const colour = picture.at({ x: width * fx, y: height * fy });
      expect(colourDistance(colour, WORKBENCH), `${step}, at ${fx}, ${fy}: ${colour.join(', ')}`).toBeLessThanOrEqual(12);
    }
  };

  it('slides the edges in 120–200 ms (brief Section 11), and never moves the canvas or the Run bar', async () => {
    await reduceMotion(false);
    try {
      const app = await openApp(screen);
      for (const region of ['header', 'tray', 'specCard', 'arenaStrip']) {
        const seconds = durations(app.region(region)).get('transform');
        expect(seconds, region).toBeGreaterThanOrEqual(0.12);
        expect(seconds, region).toBeLessThanOrEqual(0.2);
      }
      for (const edge of EDGES) expect(durations(app.tab(edge)).get('transform'), `${edge} tab`).toBe(0.16);
      expect(getComputedStyle(app.region('stage')).transitionDuration).toBe('0s');
      // A tap on the tray's tab starts the slide: the tray moves out, and the tabs beside it move with its edge.
      app.tab('tray').click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      const started = app.doc.getAnimations().map((animation) => ({ animation, target: (animation.effect as KeyframeEffect | null)?.target }));
      const onTray = started.filter(({ target }) => target === app.region('tray')).map(({ animation }) => (animation as CSSTransition).transitionProperty);
      expect(onTray.sort()).toEqual(['transform', 'visibility']);
      for (const still of ['stage', 'runBar', 'zoom']) expect(started.some(({ target }) => target === app.region(still)), still).toBe(false);
      for (const { animation } of started) {
        const { duration, delay } = animation.effect?.getComputedTiming() ?? {};
        const total = Number(duration) + Number(delay);
        expect(total, (animation as CSSTransition).transitionProperty).toBeGreaterThanOrEqual(120);
        expect(total, (animation as CSSTransition).transitionProperty).toBeLessThanOrEqual(200);
      }
    } finally {
      await reduceMotion(true);
    }
  });

  it('never shows a blank canvas while an edge slides, or while the screen changes size', async () => {
    await reduceMotion(false);
    try {
      const app = await openApp(screen);
      // The page's animation frames are held back throughout, so the canvas can draw only as it resizes: a canvas
      // that waited for its next frame would show its cleared, black buffer in these screenshots. Each screenshot
      // makes the browser draw a frame, laying the page out at that moment.
      const release = app.holdAnimationFrames();
      try {
        for (const edge of ['tray', 'tray', 'header', 'header', 'arenaStrip', 'arenaStrip'] as const) {
          app.tab(edge).click();
          await new Promise((resolve) => setTimeout(resolve, 0));
          // Hold the slide and step through it, so each screenshot lands inside it.
          const slide = app.doc.getAnimations();
          expect(slide.length, edge).toBeGreaterThan(0);
          for (const animation of slide) animation.pause();
          for (const progress of [0.25, 0.5, 0.75]) {
            for (const animation of slide) {
              const { delay, duration } = animation.effect?.getComputedTiming() ?? {};
              animation.currentTime = (Number(delay) + Number(duration)) * progress;
            }
            await expectWorkbench(app, `${edge} slide at ${progress * 100}%`);
            // The canvas stays the whole screen while edges slide over it.
            expect([app.canvasElement().width, app.canvasElement().height]).toEqual([screen.width, screen.height]);
          }
          for (const animation of slide) animation.finish();
        }
        // A screen changing size (a tablet turning, a window resized) does resize the canvas: it draws at once.
        for (const width of [1140, 1100, 1060, 1000]) {
          app.element.style.width = `${width}px`;
          await expectWorkbench(app, `screen ${width} wide`);
          expect([app.canvasElement().width, app.canvasElement().height]).toEqual([width, screen.height]);
        }
      } finally {
        release();
      }
    } finally {
      await reduceMotion(true);
    }
  });

  it('moves nothing when the device asks for reduced motion', async () => {
    const app = await openApp(screen);
    for (const region of ['header', 'tray', 'specCard', 'arenaStrip', 'runBar', 'zoom', 'stage']) {
      expect([...durations(app.region(region)).values()].every((seconds) => seconds === 0), region).toBe(true);
    }
    app.tab('tray').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(app.doc.getAnimations().filter((animation) => animation.playState === 'running')).toHaveLength(0);
    expect(app.tab('tray').getAttribute('aria-expanded')).toBe('false');
  });
});
