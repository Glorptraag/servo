// Task 4.1's layout tests: the real app page at a 10-inch tablet in landscape, a 13-inch screen and a tablet in
// portrait. Each region sits where brief Section 9 puts it; the canvas keeps at least 70% of the screen with every
// edge open, as each edge tucks away, and with all of them tucked; and the tuck states survive a real reload.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cdp } from 'vitest/browser';
import { EDGES, EDGE_NAMES, TUCKED_KEY } from '../../src/shell/edges.ts';
import type { Edge } from '../../src/shell/edges.ts';
import { MIN_CANVAS_SHARE } from '../../src/shell/layout.ts';
import { SCREENS, boxOf, closeAll, colourDistance, openApp, overlap } from './frame.ts';
import type { AppFrame, Box, Rgb } from './frame.ts';

/** Measurements in CSS pixels agree to within this. */
const PX = 0.5;

/** The device's motion preference, as CSS media sees it in the test page and the frames in it. */
const reduceMotion = (reduce: boolean) =>
  cdp().send('Emulation.setEmulatedMedia', { features: reduce ? [{ name: 'prefers-reduced-motion', value: 'reduce' }] : [] });

// The geometry tests look at where regions end up, so the device asks for reduced motion and every move is instant.
// Headless Chromium also holds a composited transition until something else draws a frame, which a device never
// does. The motion tests below switch motion back on and check what each move is set to do.
beforeAll(() => reduceMotion(true));
beforeEach(() => localStorage.clear());
afterEach(closeAll);
afterAll(async () => {
  localStorage.clear();
  await reduceMotion(false);
});

/** The canvas a child can see: the canvas's box less whatever part of it a panel covers (the spec card). */
const canvasShare = (app: AppFrame): number => {
  const stage = boxOf(app.region('stage'));
  const covered = app.region('specCard').dataset.shown === 'true' ? overlap(stage, boxOf(app.region('specCard'))) : 0;
  return (stage.width * stage.height - covered) / (app.screen.width * app.screen.height);
};

const expectSameBox = (actual: Box, expected: Box, what: string): void => {
  for (const side of ['left', 'top', 'right', 'bottom'] as const) {
    expect(Math.abs(actual[side] - expected[side]), `${what}: ${side} ${actual[side]} against ${expected[side]}`).toBeLessThanOrEqual(PX);
  }
};

const isShown = (element: HTMLElement): boolean => getComputedStyle(element).visibility !== 'hidden';

/** Every control a child can reach now. */
const visibleButtons = (app: AppFrame): HTMLButtonElement[] =>
  [...app.doc.querySelectorAll('button')].filter((button) => !button.hidden && !button.closest('[inert]') && isShown(button));

const EDGE_SELECTOR: Readonly<Record<Edge, string>> = {
  header: 'header',
  tray: 'section',
  specCard: 'aside',
  arenaStrip: 'section',
  runBar: 'section',
};

describe.each(SCREENS)('$name ($width × $height)', (screen) => {
  const portrait = screen.height > screen.width;

  it('puts every region where the brief puts it, with the canvas at least 70% of the screen', async () => {
    const app = await openApp(screen);
    const header = boxOf(app.region('header'));
    const tray = boxOf(app.region('tray'));
    const stage = boxOf(app.region('stage'));
    const card = boxOf(app.region('specCard'));
    const seen = boxOf(app.region('canvas'));
    const strip = boxOf(app.region('arenaStrip'));
    const runBar = boxOf(app.region('runBar'));

    // Header: a thin top edge across the screen.
    expectSameBox(header, { left: 0, top: 0, right: screen.width, bottom: header.bottom, width: 0, height: 0 }, 'header');
    expect(header.height).toBeGreaterThanOrEqual(44);
    expect(header.height).toBeLessThanOrEqual(64);

    // Part tray: the left edge, or the bottom edge in portrait; big enough for a 96 px tile.
    if (portrait) {
      expectSameBox(tray, { left: 0, top: tray.top, right: screen.width, bottom: screen.height, width: 0, height: 0 }, 'tray');
      expect(tray.height).toBeGreaterThanOrEqual(96);
    } else {
      expectSameBox(tray, { left: 0, top: header.bottom, right: tray.right, bottom: screen.height, width: 0, height: 0 }, 'tray');
      expect(tray.width).toBeGreaterThanOrEqual(96);
    }

    // Canvas: everything the header and the tray leave, and the canvas element fills it.
    const expectedStage = portrait
      ? { left: 0, top: header.bottom, right: screen.width, bottom: tray.top, width: 0, height: 0 }
      : { left: tray.right, top: header.bottom, right: screen.width, bottom: screen.height, width: 0, height: 0 };
    expectSameBox(stage, expectedStage, 'canvas');
    expectSameBox(boxOf(app.canvasElement()), stage, 'canvas element');

    // Spec card: slides over the canvas's right side, top to bottom.
    expectSameBox(card, { left: card.left, top: stage.top, right: stage.right, bottom: stage.bottom, width: 0, height: 0 }, 'spec card');
    expect(card.width).toBeGreaterThan(100);
    expectSameBox(seen, { left: stage.left, top: stage.top, right: card.left, bottom: stage.bottom, width: 0, height: 0 }, 'seen canvas');

    // Arena strip: along the top of the canvas.
    expect(strip.top - stage.top).toBeGreaterThanOrEqual(0);
    expect(strip.top - stage.top).toBeLessThanOrEqual(12);
    expect(strip.left).toBeGreaterThanOrEqual(seen.left);
    expect(strip.right).toBeLessThanOrEqual(seen.right);
    expect(strip.width).toBeGreaterThan(seen.width / 2);

    // Run bar: bottom centre of the canvas, floating over it.
    expect(Math.abs((runBar.left + runBar.right) / 2 - (seen.left + seen.right) / 2)).toBeLessThanOrEqual(1);
    expect(stage.bottom - runBar.bottom).toBeGreaterThanOrEqual(0);
    expect(stage.bottom - runBar.bottom).toBeLessThanOrEqual(24);

    expect(canvasShare(app)).toBeGreaterThanOrEqual(MIN_CANVAS_SHARE);
  });

  it('names every region and control, and keeps every target at least 44 px', async () => {
    const app = await openApp(screen);
    const { doc } = app;
    expect(doc.querySelectorAll('header')).toHaveLength(1);
    expect(doc.querySelectorAll('main')).toHaveLength(1);
    expect(app.canvasElement().getAttribute('role')).toBe('img');
    expect(app.canvasElement().getAttribute('aria-label')).toBe('Build canvas');
    for (const edge of EDGES) {
      const tab = app.tab(edge);
      expect(tab.getAttribute('aria-label')).toBe(EDGE_NAMES[edge]);
      expect(tab.getAttribute('aria-expanded')).toBe('true');
      const region = doc.getElementById(tab.getAttribute('aria-controls') ?? '');
      expect(region?.tagName.toLowerCase(), edge).toBe(EDGE_SELECTOR[edge]);
      if (edge !== 'header') expect(region?.getAttribute('aria-label')).toBe(EDGE_NAMES[edge]);
    }
    const zoom = doc.querySelector('[role="group"][aria-label="Zoom"]');
    expect([...(zoom?.querySelectorAll('button') ?? [])].map((button) => button.getAttribute('aria-label'))).toEqual(['Zoom in', 'Fit', 'Zoom out']);
    const buttons = visibleButtons(app);
    expect(buttons.length).toBeGreaterThanOrEqual(EDGES.length + 3);
    for (const button of buttons) {
      const box = boxOf(button);
      const name = button.getAttribute('aria-label') ?? button.textContent;
      expect(box.width, `${name} width`).toBeGreaterThanOrEqual(44);
      expect(box.height, `${name} height`).toBeGreaterThanOrEqual(44);
    }
    // Nothing on screen is an exclamation in system text (ground rule 7).
    expect(doc.body.textContent).not.toContain('!');
  });

  it('keeps the controls on the canvas apart and on the canvas', async () => {
    const app = await openApp(screen);
    const seen = boxOf(app.region('canvas'));
    const floating = [app.region('arenaStrip'), app.region('runBar'), ...app.region('canvas').querySelectorAll<HTMLElement>('button')].filter(
      (element) => !element.closest('section') || element.matches('section'),
    );
    const boxes = floating.map((element) => ({ element, box: boxOf(element) }));
    for (const { element, box } of boxes) {
      const name = element.getAttribute('aria-label') ?? element.className;
      expect(box.left, name).toBeGreaterThanOrEqual(seen.left);
      expect(box.right, name).toBeLessThanOrEqual(seen.right);
      expect(box.top, name).toBeGreaterThanOrEqual(seen.top);
      expect(box.bottom, name).toBeLessThanOrEqual(seen.bottom);
    }
    for (const [index, a] of boxes.entries()) {
      for (const b of boxes.slice(index + 1)) {
        const names = `${a.element.getAttribute('aria-label')} and ${b.element.getAttribute('aria-label')}`;
        expect(overlap(a.box, b.box), names).toBe(0);
      }
    }
  });

  it('gives the canvas more room as each edge tucks away, and the whole screen with all of them tucked', async () => {
    const app = await openApp(screen);
    let share = canvasShare(app);
    for (const edge of EDGES) {
      await app.press(app.tab(edge));
      const tab = app.tab(edge);
      const region = app.doc.getElementById(tab.getAttribute('aria-controls') ?? '') as HTMLElement;
      expect(tab.getAttribute('aria-expanded'), edge).toBe('false');
      expect(region.inert, edge).toBe(true);
      expect(isShown(region), edge).toBe(false);
      const next = canvasShare(app);
      expect(next, edge).toBeGreaterThanOrEqual(share);
      expect(next, edge).toBeGreaterThanOrEqual(MIN_CANVAS_SHARE);
      expectSameBox(boxOf(app.canvasElement()), boxOf(app.region('stage')), `canvas element after tucking ${edge}`);
      share = next;
    }
    const whole = { left: 0, top: 0, right: screen.width, bottom: screen.height, width: screen.width, height: screen.height };
    expectSameBox(boxOf(app.region('stage')), whole, 'canvas with every edge tucked');
    expectSameBox(boxOf(app.canvasElement()), whole, 'canvas element with every edge tucked');
    expect(canvasShare(app)).toBe(1);
    // Every tab is still on screen to bring its edge back.
    for (const edge of EDGES) {
      const box = boxOf(app.tab(edge));
      expect(box.left >= 0 && box.top >= 0 && box.right <= screen.width && box.bottom <= screen.height, edge).toBe(true);
    }
    for (const edge of [...EDGES].reverse()) await app.press(app.tab(edge));
    expect(EDGES.map((edge) => app.tab(edge).getAttribute('aria-expanded'))).toEqual(EDGES.map(() => 'true'));
    expect(canvasShare(app)).toBeCloseTo(canvasShare(await openApp(screen)), 6);
  });

  it('keeps the tuck states across a reload', async () => {
    const app = await openApp(screen);
    await app.press(app.tab('tray'));
    await app.press(app.tab('specCard'));
    await app.press(app.tab('runBar'));
    expect(JSON.parse(localStorage.getItem(TUCKED_KEY) ?? 'null')).toEqual(['tray', 'specCard', 'runBar']);
    const before = boxOf(app.region('stage'));

    await app.reload();
    const expanded = Object.fromEntries(EDGES.map((edge) => [edge, app.tab(edge).getAttribute('aria-expanded')]));
    expect(expanded).toEqual({ header: 'true', tray: 'false', specCard: 'false', arenaStrip: 'true', runBar: 'false' });
    expect(isShown(app.region('tray'))).toBe(false);
    expect(isShown(app.region('specCard'))).toBe(false);
    expect(isShown(app.region('runBar'))).toBe(false);
    expect(isShown(app.region('header'))).toBe(true);
    expectSameBox(boxOf(app.region('stage')), before, 'canvas after the reload');
    expectSameBox(boxOf(app.canvasElement()), before, 'canvas element after the reload');

    for (const edge of ['tray', 'specCard', 'runBar']) await app.press(app.tab(edge));
    await app.reload();
    expect(EDGES.map((edge) => app.tab(edge).getAttribute('aria-expanded'))).toEqual(EDGES.map(() => 'true'));
    expect(canvasShare(app)).toBeGreaterThanOrEqual(MIN_CANVAS_SHARE);
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
  /** Points on the canvas a child sees, as fractions of its box, clear of every control floating on it. */
  const PROBES: readonly (readonly [number, number])[] = [
    [0.3, 0.45],
    [0.5, 0.45],
    [0.7, 0.45],
    [0.4, 0.7],
    [0.6, 0.7],
  ];

  it('slides the edges in 120–200 ms (brief Section 11)', async () => {
    await reduceMotion(false);
    try {
      const app = await openApp(screen);
      const moving: readonly [string, readonly string[]][] = [
        ['header', ['transform']],
        ['tray', ['transform']],
        ['specCard', ['transform']],
        ['arenaStrip', ['transform']],
        ['runBar', ['transform']],
        ['stage', ['left', 'top', 'width', 'height']],
        ['canvas', ['left', 'top', 'width', 'height']],
      ];
      for (const [region, properties] of moving) {
        const timing = durations(app.region(region));
        for (const property of properties) {
          const seconds = timing.get(property);
          expect(seconds, `${region} ${property}`).toBeGreaterThanOrEqual(0.12);
          expect(seconds, `${region} ${property}`).toBeLessThanOrEqual(0.2);
        }
      }
      // A tap on the tray's tab starts the slide: the tray moves out and the canvas grows into its room.
      app.tab('tray').click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      const started = app.doc
        .getAnimations()
        .map((animation) => ({ animation, target: (animation.effect as KeyframeEffect | null)?.target }))
        .filter(({ target }) => target === app.region('tray') || target === app.region('stage'));
      const properties = started.map(({ animation }) => (animation as CSSTransition).transitionProperty).sort();
      expect(properties).toEqual(expect.arrayContaining(['left', 'transform', 'visibility', 'width']));
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

  it('never shows a blank canvas while an edge slides', async () => {
    await reduceMotion(false);
    try {
      const app = await openApp(screen);
      for (const edge of ['tray', 'tray', 'header', 'header'] as const) {
        const from = boxOf(app.region('stage'));
        app.tab(edge).click();
        await new Promise((resolve) => setTimeout(resolve, 0));
        // Hold the slide and step it through, so each screenshot lands inside it. A screenshot makes the browser draw
        // a frame: it lays the page out at that moment of the slide, and the canvas resizes to follow its host. The
        // page's animation frames are held back meanwhile, so the canvas has only its resize to draw in: a canvas
        // that waited for its next frame would show its cleared, black buffer here.
        const release = app.holdAnimationFrames();
        const slide = app.doc.getAnimations();
        expect(slide.length, edge).toBeGreaterThan(0);
        for (const animation of slide) animation.pause();
        const areas: number[] = [];
        for (const progress of [0.2, 0.4, 0.6, 0.8]) {
          for (const animation of slide) {
            const { delay, duration } = animation.effect?.getComputedTiming() ?? {};
            animation.currentTime = (Number(delay) + Number(duration)) * progress;
          }
          const picture = await app.shoot();
          const stage = boxOf(app.region('stage'));
          const seen = boxOf(app.region('canvas'));
          areas.push(stage.width * stage.height);
          const step = `${edge} slide at ${progress * 100}%`;
          // The canvas's drawing buffer has followed its host to this size, and has been drawn: never blank.
          expect([app.canvasElement().width, app.canvasElement().height], step).toEqual([Math.round(stage.width), Math.round(stage.height)]);
          for (const [fx, fy] of PROBES) {
            const colour = picture.at({ x: seen.left + seen.width * fx, y: seen.top + seen.height * fy });
            expect(colourDistance(colour, WORKBENCH), `${step}, at ${fx}, ${fy}: ${colour.join(', ')}`).toBeLessThanOrEqual(12);
          }
        }
        release();
        for (const animation of slide) animation.finish();
        await app.settle();
        const to = boxOf(app.region('stage'));
        const [small, large] = [from.width * from.height, to.width * to.height].sort((a, b) => a - b) as [number, number];
        expect(large, edge).toBeGreaterThan(small);
        // Every step was inside the slide, not at either end of it.
        expect(areas.every((value) => value > small + 1 && value < large - 1), `${edge}: ${areas.join(', ')}`).toBe(true);
      }
    } finally {
      await reduceMotion(true);
    }
  });

  it('moves nothing when the device asks for reduced motion', async () => {
    const app = await openApp(screen);
    for (const region of ['header', 'tray', 'specCard', 'arenaStrip', 'runBar', 'stage', 'canvas']) {
      expect([...durations(app.region(region)).values()].every((seconds) => seconds === 0), region).toBe(true);
    }
    app.tab('tray').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(app.doc.getAnimations().filter((animation) => animation.playState === 'running')).toHaveLength(0);
    expect(app.tab('tray').getAttribute('aria-expanded')).toBe('false');
  });
});
