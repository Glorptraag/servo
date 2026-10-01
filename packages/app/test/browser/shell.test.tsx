// The shell's own behaviour, mounted directly with a stand-in canvas: slots land in their regions, the header follows
// the build, Run mode moves the tray out, the left-handed mirror, the zoom control, and storage that refuses.
// layout.test.ts checks the real page with the real canvas; the last test here mounts the real app with mountApp.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cdp } from 'vitest/browser';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import type { CanvasEventMap, CanvasHandle, CanvasMode, CanvasPrefs, EditCommand, EditResult, ListView, Selection } from '@servo/canvas';
import { contentFrom } from '@servo/content';
import type { Blueprint, Kit, Level, ValidationResult } from '@servo/schema';
import { validBlueprints } from '@servo/schema/fixtures';
import { mountApp } from '../../src/index.ts';
import { ALL_OPEN, DEFAULT_PREFS, EDGES, Shell, TUCKED_KEY, useShell, zoomInFrom } from '../../src/shell/index.ts';
import type { ShellApi, ShellProps, ShellSlots } from '../../src/shell/index.ts';
import { boxOf } from './frame.ts';

/** Records what the shell asks of the canvas, and fires events as the canvas would. */
class StandInCanvas implements CanvasHandle {
  mode: CanvasMode = 'build';
  blueprint: Blueprint | undefined;
  selection: Selection | null = null;
  zoom = 1;
  readonly calls: string[] = [];
  private readonly listeners = new Map<keyof CanvasEventMap, Set<(event: never) => void>>();

  get listView(): ListView {
    throw new Error('not in the stand-in');
  }
  load(blueprint: Blueprint): ValidationResult<Blueprint> {
    this.blueprint = blueprint;
    this.calls.push('load');
    return { ok: true, value: blueprint };
  }
  apply(command: EditCommand): EditResult {
    throw new Error(`not in the stand-in: ${command.kind}`);
  }
  beginPlacement(): void {}
  beginPropPlacement(): void {}
  cancelPlacement(): void {}
  setRemoveTargets(): void {}
  select(): void {}
  setMode(mode: CanvasMode): void {
    this.mode = mode;
    this.calls.push(`setMode ${mode}`);
  }
  applyRunFrame(): void {}
  showHint(): boolean {
    return false;
  }
  clearHints(): void {}
  fit(): void {
    this.calls.push('fit');
  }
  setZoom(zoom: number): void {
    this.zoom = zoom;
    this.calls.push(`setZoom ${zoom.toFixed(4)}`);
  }
  tidyWires(): void {}
  setLevel(level: Level): void {
    this.calls.push(`setLevel ${level}`);
  }
  setPrefs(prefs: CanvasPrefs): void {
    this.calls.push(`setPrefs leftHanded=${prefs.leftHanded}`);
  }
  on<K extends keyof CanvasEventMap>(type: K, listener: (event: CanvasEventMap[K]) => void): () => void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener as (event: never) => void);
    this.listeners.set(type, set);
    return () => set.delete(listener as (event: never) => void);
  }
  emit<K extends keyof CanvasEventMap>(type: K, event: CanvasEventMap[K]): void {
    for (const listener of this.listeners.get(type) ?? []) (listener as (event: CanvasEventMap[K]) => void)(event);
  }
  destroy(): void {
    this.calls.push('destroy');
  }
}

/** An in-memory Storage. */
const memoryStorage = (): Storage => {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => void items.delete(key),
    setItem: (key, value) => void items.set(key, String(value)),
  };
};

/** Clicks as a tap does, and lets React commit the update the click scheduled. */
const tap = async (element: HTMLElement | null): Promise<void> => {
  if (!element) throw new Error('nothing to tap');
  element.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

/** Waits until nothing on the page is animating. */
const settled = (): Promise<void> =>
  vi.waitFor(() => {
    if (document.getAnimations().some((animation) => animation.playState === 'running')) throw new Error('still moving');
  });

const content = contentFrom({ records: {} }).content;
const rollingStart = validBlueprints.find((fixture) => fixture.name === 'rolling-start')?.data as Blueprint;
const kit: Kit = { id: 'rolling-start', name: 'Rolling Start', level: 1, parts: [], tray: [] };

interface Mounted {
  readonly host: HTMLElement;
  readonly canvas: StandInCanvas;
  readonly shell: ShellApi;
  region(name: string): HTMLElement;
  tab(edge: string): HTMLButtonElement;
  render(props?: Partial<ShellProps>): void;
}

const roots: { root: Root; host: HTMLElement }[] = [];

// These tests are about where things end up, so the device asks for reduced motion and nothing slides. Headless
// Chromium also holds a composited transition until something else draws a frame. layout.test.ts checks the motion.
beforeAll(() => cdp().send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }));
afterAll(() => cdp().send('Emulation.setEmulatedMedia', { features: [] }));

afterEach(() => {
  for (const { root, host } of roots.splice(0)) {
    root.unmount();
    host.remove();
  }
});

const mountShell = async (props: Partial<ShellProps> = {}, size = { width: 1180, height: 820 }): Promise<Mounted> => {
  const host = document.createElement('div');
  host.style.cssText = `position: fixed; left: 0; top: 0; width: ${size.width}px; height: ${size.height}px;`;
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push({ root, host });
  const canvas = new StandInCanvas();
  let latest: ShellApi | null = null;
  const Probe = () => {
    latest = useShell();
    return null;
  };
  const render = (more: Partial<ShellProps> = {}): void => {
    const all = { ...props, ...more };
    const slots: ShellSlots = { ...all.slots, sound: <Probe /> };
    root.render(<Shell content={content} level={1} storage={memoryStorage()} mountCanvas={() => canvas} {...all} slots={slots} />);
  };
  render();
  await vi.waitFor(() => {
    if (!latest?.canvas) throw new Error('the shell has not mounted its canvas yet');
  });
  const one = <T extends Element>(selector: string): T => {
    const found = host.querySelector<T>(selector);
    if (!found) throw new Error(`nothing matches ${selector}`);
    return found;
  };
  return {
    host,
    canvas,
    get shell(): ShellApi {
      if (!latest) throw new Error('no shell');
      return latest;
    },
    region: (name) => one<HTMLElement>(`[data-region="${name}"]`),
    tab: (edge) => one<HTMLButtonElement>(`button.shell-tab[data-edge="${edge}"]`),
    render,
  };
};

describe('the shell', () => {
  it('puts each slot in its region', async () => {
    const mark = (name: string) => <span data-slot={name}>{name}</span>;
    const slots: ShellSlots = {
      home: mark('home'),
      goal: mark('goal'),
      hints: mark('hints'),
      save: mark('save'),
      tray: mark('tray'),
      specCard: mark('specCard'),
      arenaStrip: mark('arenaStrip'),
      runBar: mark('runBar'),
    };
    const app = await mountShell({ slots });
    for (const name of ['home', 'goal', 'hints', 'save']) expect(app.region('header').querySelector(`[data-slot="${name}"]`), name).not.toBeNull();
    for (const name of ['tray', 'specCard', 'arenaStrip', 'runBar']) expect(app.region(name).querySelector(`[data-slot="${name}"]`), name).not.toBeNull();
  });

  it('shows the kit and level name, and the build’s name as load and every edit leave it', async () => {
    const app = await mountShell({ kit });
    const header = app.region('header');
    expect(header.textContent).toContain('Rolling Start');
    expect(header.textContent).toContain('Level 1 · Parts');
    flushSync(() => app.shell.load(rollingStart));
    expect(app.canvas.calls).toContain('load');
    expect(header.textContent).toContain('Rolling robot');
    const renamed: Blueprint = { ...rollingStart, meta: { ...rollingStart.meta, name: 'Fast one' } };
    flushSync(() => app.canvas.emit('edit', { command: { kind: 'rename', name: 'Fast one' }, blueprint: renamed }));
    expect(header.textContent).toContain('Fast one');
    expect(header.textContent).not.toContain('Rolling robot');
    flushSync(() => app.render({ level: 2, kit: undefined }));
    expect(header.textContent).toContain('Level 2 · Circuits');
    expect(header.textContent).not.toContain('Rolling Start');
    await vi.waitFor(() => expect(app.canvas.calls).toContain('setLevel 2'));
  });

  it('moves the tray out in Run mode and brings it back as the child left it on Stop', async () => {
    const storage = memoryStorage();
    const app = await mountShell({ storage });
    flushSync(() => app.shell.setMode('run'));
    expect(app.canvas.calls).toEqual(['setMode run']);
    expect(app.region('tray').dataset.shown).toBe('false');
    expect(app.tab('tray').hidden).toBe(true);
    expect(app.shell.tucked.tray).toBe(false);
    expect(app.region('specCard').dataset.shown).toBe('true');
    // The Run bar is always there, with no tab to tuck it.
    expect(getComputedStyle(app.region('runBar')).visibility).toBe('visible');
    expect(app.host.querySelector('button.shell-tab[data-edge="runBar"]')).toBeNull();
    flushSync(() => app.shell.setMode('build'));
    expect(app.region('tray').dataset.shown).toBe('true');
    expect(app.tab('tray').hidden).toBe(false);
    expect(storage.getItem(TUCKED_KEY)).toBeNull();

    await tap(app.tab('tray'));
    flushSync(() => app.shell.setMode('run'));
    flushSync(() => app.shell.setMode('build'));
    expect(app.region('tray').dataset.shown).toBe('false');
    expect(app.tab('tray').getAttribute('aria-expanded')).toBe('false');
  });

  it('mirrors the tray, the spec card and the controls on the canvas for the left hand', async () => {
    const app = await mountShell({}, { width: 1180, height: 820 });
    expect(boxOf(app.region('tray')).left).toBe(0);
    expect(boxOf(app.region('specCard')).right).toBe(1180);
    flushSync(() => app.shell.setPrefs({ ...DEFAULT_PREFS, leftHanded: true }));
    await settled();
    expect(boxOf(app.region('tray')).right).toBe(1180);
    expect(boxOf(app.region('specCard')).left).toBe(0);
    await vi.waitFor(() => expect(app.canvas.calls).toContain('setPrefs leftHanded=true'));
    // The card's tab sits on its right, the tray's on its left, and the zoom control in the bottom left corner.
    expect(boxOf(app.tab('specCard')).left).toBe(boxOf(app.region('specCard')).right);
    expect(boxOf(app.tab('tray')).right).toBe(boxOf(app.region('tray')).left);
    expect(boxOf(app.region('zoom')).left).toBe(8);
    expect(boxOf(app.region('header')).left).toBe(0);
    expect(boxOf(app.region('header')).right).toBe(1180);
  });

  it('steps the spec card aside while a pointer drags on the canvas, not for a tap, and while asked to', async () => {
    const app = await mountShell();
    const host = app.host.querySelector<HTMLElement>('.shell-canvas-host');
    if (!host) throw new Error('no canvas host');
    const send = (type: string, x: number, y: number, buttons: number): void => {
      host.dispatchEvent(new PointerEvent(type, { pointerId: 7, pointerType: 'touch', clientX: x, clientY: y, buttons, bubbles: true, cancelable: true }));
    };
    const card = app.region('specCard');
    send('pointerdown', 500, 500, 1);
    send('pointermove', 503, 502, 1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    // Under the drag threshold: still a tap.
    expect(card.dataset.shown).toBe('true');
    send('pointermove', 530, 510, 1);
    await vi.waitFor(() => expect(card.dataset.shown).toBe('false'));
    expect(app.shell.specCardAside).toBe(true);
    expect(app.shell.tucked.specCard).toBe(false);
    send('pointerup', 530, 510, 0);
    await vi.waitFor(() => expect(card.dataset.shown).toBe('true'));

    // A press that never moves is a tap: the card stays.
    send('pointerdown', 500, 500, 1);
    send('pointerup', 500, 500, 0);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(card.dataset.shown).toBe('true');

    // Asked to, as tap-then-tap wiring will: aside until asked back.
    flushSync(() => app.shell.setSpecCardAside(true));
    expect(card.dataset.shown).toBe('false');
    flushSync(() => app.shell.setSpecCardAside(false));
    expect(card.dataset.shown).toBe('true');
  });

  it('zooms along its ladder and re-centres with Fit', async () => {
    const app = await mountShell();
    const button = (name: string) => app.host.querySelector<HTMLButtonElement>(`.shell-zoom button[aria-label="${name}"]`);
    await tap(button('Zoom in'));
    await tap(button('Zoom in'));
    await tap(button('Zoom out'));
    await tap(button('Fit'));
    expect(app.canvas.calls).toEqual([`setZoom ${zoomInFrom(1).toFixed(4)}`, 'setZoom 2.0000', `setZoom ${zoomInFrom(1).toFixed(4)}`, 'fit']);
  });

  it('tucks edges for the visit when storage refuses, and saves them when it can', async () => {
    const refusing = memoryStorage();
    refusing.getItem = () => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    };
    refusing.setItem = () => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    };
    const app = await mountShell({ storage: refusing });
    expect(app.shell.tucked).toEqual(ALL_OPEN);
    await tap(app.tab('header'));
    expect(app.tab('header').getAttribute('aria-expanded')).toBe('false');
    expect(app.region('header').dataset.shown).toBe('false');

    const storage = memoryStorage();
    const saving = await mountShell({ storage });
    for (const edge of EDGES) await tap(saving.tab(edge));
    await vi.waitFor(() => expect(JSON.parse(storage.getItem(TUCKED_KEY) ?? '[]')).toEqual([...EDGES]));
  });
});

describe('mountApp', () => {
  it('draws the shell and the canvas in its host, and destroy takes them away', async () => {
    const host = document.createElement('div');
    host.style.cssText = 'position: fixed; left: 0; top: 0; width: 1180px; height: 820px;';
    document.body.appendChild(host);
    try {
      const app = await mountApp(host);
      expect(host.querySelector('.servo-shell')).not.toBeNull();
      expect(host.querySelector('[data-region="stage"] canvas')).not.toBeNull();
      expect(host.querySelector('[data-region="tray"]')?.textContent).toBe('Part tray');
      expect(host.querySelector<HTMLButtonElement>('[data-region="runBar"] button')?.disabled).toBe(true);
      app.destroy();
      expect(host.childElementCount).toBe(0);
    } finally {
      host.remove();
    }
  });
});
