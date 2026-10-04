// The header's controls, the edges' tabs and the zoom control, each by touch, pointer and keyboard (ground rule 8,
// review R-6.4 APP-1 to APP-5). Home, the build's name and its field, the hint button through to "Do it for me",
// Sound and Save on the real App; the tabs and the zoom control on the shell round the real canvas, where Tidy wires
// gives the routes the canvas's own `tidyWires()` gives.
import { afterAll, afterEach, beforeAll, expect, vi } from 'vitest';
import { cdp, userEvent } from 'vitest/browser';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { mountCanvas } from '@servo/canvas';
import type { CanvasHandle } from '@servo/canvas';
import { probeCanvas } from '@servo/canvas/testing';
import type { Blueprint } from '@servo/schema';
import { HINT_TEXT } from '../../src/hints/index.ts';
import { EDGES, PLACEHOLDER_SLOTS, SAVE_LINES, Shell, zoomInFrom, zoomOutFrom } from '../../src/shell/index.ts';
import type { CanvasSetup } from '../../src/shell/index.ts';
import { MUTED_KEY } from '../../src/sound/mute.ts';
import { SOON, content, fixture, listedWires, mountApp, openChallenge, unmountApps } from './app-harness.tsx';
import type { MountedApp } from './app-harness.tsx';
import { threePaths } from './controls.ts';
import { clickAt, keyboard, pointOn, pressBy, tick, touch, touchAt } from './input.ts';
import type { Path } from './input.ts';

beforeAll(() => cdp().send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }));
afterAll(() => cdp().send('Emulation.setEmulatedMedia', { features: [] }));
afterEach(unmountApps);

const header = (app: MountedApp): HTMLElement => app.one('[data-region="header"]');

threePaths('home', {
  open: () => mountApp(),
  control: (app) => app.button('Home', '[data-region="header"]'),
  then: async (app) => {
    await vi.waitFor(() => app.one('.servo-home'), SOON);
    expect(app.button('Home', '[data-region="header"]').getAttribute('aria-expanded')).toBe('true');
  },
});

threePaths('blueprint-name', {
  open: () => mountApp(),
  control: (app) => app.one('button.shell-blueprint-name'),
  then: async (app) => {
    const field = await vi.waitFor(() => app.one<HTMLInputElement>('input.shell-blueprint-name-input'), SOON);
    expect(field.value).toBe('Build 1');
    expect(document.activeElement).toBe(field);
  },
});

threePaths('blueprint-name-field', {
  open: async () => {
    const app = await mountApp();
    await keyboard(app.one('button.shell-blueprint-name'));
    await vi.waitFor(() => app.one('input.shell-blueprint-name-input'), SOON);
    return app;
  },
  control: (app) => app.one('input.shell-blueprint-name-input'),
  // Into the field, the words typed, and out of it: a finger taps in, types on the screen's keyboard and taps away;
  // a mouse clicks in and away; a keyboard types and presses Enter.
  press: async (path, field, app) => {
    const away = pointOn(app.one('.shell-level'));
    if (path === 'touch') {
      await touch(field, 0.95);
      await cdp().send('Input.insertText', { text: ' two' });
      await touchAt(away);
    } else if (path === 'pointer') {
      await clickAt(pointOn(field, 0.95));
      await userEvent.keyboard('{End} two');
      await clickAt(away);
    } else {
      await keyboard(field, '{End} two{Enter}');
    }
  },
  then: async (app) => {
    await vi.waitFor(() => expect(app.one('button.shell-blueprint-name').textContent).toBe('Build 1 two'), SOON);
    await vi.waitFor(async () => {
      const stored = await app.child.blueprints.load(app.first.meta.id);
      expect(stored.ok && stored.blueprint.meta.name).toBe('Build 1 two');
    }, SOON);
  },
});

/** Presses the hint button by `path` until its ladder does it: each rung's line, then one new wire (APP-1). */
const climb = async (path: Path, button: HTMLElement, app: MountedApp): Promise<void> => {
  const spoken = (): string => app.one('.hint-spoken').textContent ?? '';
  const wires = listedWires(app);
  for (let rung = 0; rung < 3; rung += 1) {
    const before = spoken();
    await pressBy(path, button);
    await vi.waitFor(() => expect(spoken()).not.toBe(before), SOON);
    expect(spoken()).not.toBe('');
    expect(listedWires(app)).toBe(wires);
  }
  await pressBy(path, button);
  await vi.waitFor(() => expect(listedWires(app)).toBe(wires + 1), SOON);
};

threePaths('hint-button', {
  open: async () => {
    const app = await mountApp();
    await openChallenge(app, 'Meet the switch');
    await vi.waitFor(() => expect(app.one('button.hint-button').getAttribute('aria-disabled')).toBe('false'), SOON);
    return app;
  },
  control: (app) => app.one('button.hint-button'),
  press: (path, button, app) => climb(path, button, app),
  then: async (app) => {
    expect(app.one('button.hint-button').textContent).toBe(HINT_TEXT.button);
    await vi.waitFor(() => expect(app.host.querySelector('.hint-said')?.textContent).toBe("Wired the battery pack's plus to side A"), SOON);
    expect(app.one('.hint-spoken').textContent).toBe("Wired the battery pack's plus to side A");
  },
});

let muted: string | null = null;
threePaths('sound', {
  open: async () => {
    muted = localStorage.getItem(MUTED_KEY);
    localStorage.removeItem(MUTED_KEY);
    const app = await mountApp();
    expect(app.one('button.sound-control').getAttribute('aria-checked')).toBe('true');
    return app;
  },
  control: (app) => app.one('button.sound-control'),
  then: async (app) => {
    await vi.waitFor(() => expect(app.one('button.sound-control').getAttribute('aria-checked')).toBe('false'), SOON);
    expect(app.one('button.sound-control').dataset.muted).toBe('true');
  },
  close: () => {
    if (muted === null) localStorage.removeItem(MUTED_KEY);
    else localStorage.setItem(MUTED_KEY, muted);
  },
});

threePaths('save', {
  open: () => mountApp(),
  control: (app) => app.button('Save', '[data-region="header"]'),
  then: async (app) => {
    await vi.waitFor(() => expect(header(app).querySelector('.shell-save-status')?.textContent).toBe(SAVE_LINES.saved), SOON);
  },
});

// The tabs and the zoom control, on the shell round the real canvas.

interface OnCanvas {
  readonly host: HTMLElement;
  readonly canvas: CanvasHandle;
  one<T extends HTMLElement = HTMLElement>(selector: string): T;
}

const roots: { root: Root; host: HTMLElement }[] = [];
afterEach(() => {
  for (const { root, host } of roots.splice(0)) {
    root.unmount();
    host.remove();
  }
});

const mountOnCanvas = async (start: Blueprint = fixture('level-1-roller')): Promise<OnCanvas> => {
  const host = document.createElement('div');
  host.style.cssText = 'position: fixed; left: 0; top: 0; width: 1180px; height: 820px;';
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push({ root, host });
  let handle: CanvasHandle | undefined;
  const draw = (into: HTMLElement, setup: CanvasSetup): CanvasHandle => {
    handle = mountCanvas(into, { catalogue: content.catalogue, resolveArt: (key) => content.art.get(key), level: setup.level, prefs: setup.prefs });
    return handle;
  };
  await new Promise<void>((ready) =>
    root.render(<Shell content={content} level={1} storage={null} start={start} slots={PLACEHOLDER_SLOTS} mountCanvas={draw} onReady={ready} />),
  );
  const canvas = await vi.waitFor(() => {
    if (!handle?.blueprint) throw new Error('the canvas has no build yet');
    return handle;
  }, SOON);
  await probeCanvas(canvas).ready;
  // The zoom control and the tabs work once the shell has the canvas, and the shell fits the first build it loads.
  await vi.waitFor(() => expect(host.querySelector<HTMLButtonElement>('.shell-zoom button')?.disabled).toBe(false), SOON);
  await tick(50);
  return {
    host,
    canvas,
    one: (selector) => {
      const found = host.querySelector<HTMLElement>(selector);
      if (!found) throw new Error(`nothing matches ${selector}`);
      return found as never;
    },
  };
};

const tab = (shell: OnCanvas, edge: string): HTMLButtonElement => shell.one<HTMLButtonElement>(`button.shell-tab[data-edge="${edge}"]`);

threePaths('edge-tab', {
  open: async () => {
    const shell = await mountOnCanvas();
    // The spec card's tab shows while a part is selected.
    flushSync(() => shell.canvas.select({ kind: 'part', partId: shell.canvas.blueprint?.parts[0]?.id ?? '' }));
    await vi.waitFor(() => expect(tab(shell, 'specCard').hidden).toBe(false), SOON);
    return shell;
  },
  control: (shell) => tab(shell, 'header'),
  // Each edge's tab in turn, by the same path.
  press: async (path, _first, shell) => {
    for (const edge of EDGES) {
      await pressBy(path, tab(shell, edge));
      await vi.waitFor(() => expect(tab(shell, edge).getAttribute('aria-expanded')).toBe('false'), SOON);
    }
  },
  then: async (shell) => {
    for (const edge of EDGES) expect(shell.one(`[data-region="${edge}"]`).dataset.shown, edge).toBe('false');
  },
});

const zoomButton = (shell: OnCanvas, name: string): HTMLButtonElement => shell.one<HTMLButtonElement>(`.shell-zoom button[aria-label="${name}"]`);

let fitted = 0;

threePaths('zoom-in', {
  open: async () => {
    const shell = await mountOnCanvas();
    fitted = shell.canvas.zoom;
    return shell;
  },
  control: (shell) => zoomButton(shell, 'Zoom in'),
  then: async (shell) => {
    await vi.waitFor(() => expect(shell.canvas.zoom).toBeCloseTo(zoomInFrom(fitted), 6), SOON);
    expect(shell.canvas.zoom).toBeGreaterThan(fitted);
  },
});

threePaths('zoom-out', {
  open: async () => {
    const shell = await mountOnCanvas();
    fitted = shell.canvas.zoom;
    return shell;
  },
  control: (shell) => zoomButton(shell, 'Zoom out'),
  then: async (shell) => {
    await vi.waitFor(() => expect(shell.canvas.zoom).toBeCloseTo(zoomOutFrom(fitted), 6), SOON);
    expect(shell.canvas.zoom).toBeLessThan(fitted);
  },
});

threePaths('fit', {
  open: async () => {
    const shell = await mountOnCanvas();
    shell.canvas.fit();
    fitted = shell.canvas.zoom;
    shell.canvas.setZoom(fitted * 2);
    expect(shell.canvas.zoom).not.toBeCloseTo(fitted, 3);
    return shell;
  },
  control: (shell) => zoomButton(shell, 'Fit'),
  then: async (shell) => {
    await vi.waitFor(() => expect(shell.canvas.zoom).toBeCloseTo(fitted, 6), SOON);
  },
});

/** Every wire's line as drawn, corner by corner, on the canvas plane. */
const lines = (canvas: CanvasHandle): string =>
  JSON.stringify((canvas.blueprint?.wires ?? []).map((wire) => [wire.id, probeCanvas(canvas).wire(wire.id)?.path.map((place) => place.world)]));

/** The roller, some of whose lines cross part bodies, so tidying routes them. */
const tangled = (): Blueprint => fixture('level-1-roller');

let tidied = '';
let straight = '';

threePaths('tidy-wires', {
  open: async () => {
    // The routes the canvas's own tidyWires() gives this build, on a canvas of their own.
    const expected = await mountOnCanvas(tangled());
    straight = lines(expected.canvas);
    expected.canvas.tidyWires();
    tidied = lines(expected.canvas);
    for (const { root, host } of roots.splice(0)) {
      root.unmount();
      host.remove();
    }
    return mountOnCanvas(tangled());
  },
  control: (shell) => zoomButton(shell, 'Tidy wires'),
  then: async (shell) => {
    await vi.waitFor(() => expect(lines(shell.canvas)).toBe(tidied), SOON);
    expect(tidied).not.toBe(straight);
  },
});
