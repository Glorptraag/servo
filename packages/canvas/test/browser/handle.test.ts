// The handle's task 3.1 members: mounting and unmounting, load, modes, prefs, level and the stubs of later tasks.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cdp } from 'vitest/browser';
import type { Blueprint } from '@servo/schema';
import { mountCanvas } from '../../src/index.ts';
import { CANVAS_NAME } from '../../src/renderer/surface.ts';
import type { CanvasSurface } from '../../src/renderer/surface.ts';
import { STANDARD_PALETTE } from '../../src/renderer/style.ts';
import { catalogue, fixture } from '../helpers/catalogue.ts';
import { PREFS, artFrom, colourDistance, describeRgb, listen, mount, reset, rgbOf, settle, shoot, svgArt, unmountAll } from './helpers.ts';

// Tests that mount and destroy canvases make their own; the rest share one (helpers.ts, `reset`).
let surface: CanvasSurface;

beforeAll(async () => {
  ({ surface } = await mount());
});

beforeEach(() => reset(surface));

afterAll(unmountAll);

describe('mounting', () => {
  it('fills its host with one canvas element that has an accessible name', async () => {
    const { host, surface, unmount } = await mount({}, { width: 640, height: 480 });
    const canvases = host.querySelectorAll('canvas');
    expect(canvases).toHaveLength(1);
    expect(canvases[0]).toBe(surface.canvas);
    expect(surface.canvas.getAttribute('role')).toBe('img');
    expect(surface.canvas.getAttribute('aria-label')).toBe(CANVAS_NAME);
    const box = surface.canvas.getBoundingClientRect();
    expect([box.width, box.height]).toEqual([640, 480]);
    expect(surface.canvas.width).toBe(640 * window.devicePixelRatio);
    expect(getComputedStyle(surface.canvas).touchAction).toBe('none');
    unmount();
  });

  it('follows its host’s size, keeping the view centred', async () => {
    const { host, surface, unmount } = await mount({}, { width: 640, height: 480 });
    surface.load(fixture('rolling-start'));
    const centre = surface.camera.screenToWorld({ x: 320, y: 240 });
    host.style.width = '900px';
    host.style.height = '600px';
    await expect.poll(() => surface.camera.width).toBe(900);
    expect(surface.camera.height).toBe(600);
    expect(surface.canvas.width).toBe(900 * window.devicePixelRatio);
    const after = surface.camera.screenToWorld({ x: 450, y: 300 });
    expect(after.x).toBeCloseTo(centre.x, 9);
    expect(after.y).toBeCloseTo(centre.y, 9);
    unmount();
  });

  it('never shows a blank frame while its host changes size, as when an edge slides', async () => {
    const { host, surface, unmount } = await mount({ resolveArt: artFrom({ 'part/battery-pack-2-cell': svgArt('#2050c0') }) });
    surface.load(fixture('rolling-start'));
    await settle(surface);
    // Hold back the canvas's own frames: what shows after each step is only what it drew while the host resized.
    const original = window.requestAnimationFrame;
    const held: FrameRequestCallback[] = [];
    window.requestAnimationFrame = (callback) => {
      held.push(callback);
      return 0;
    };
    try {
      for (const width of [1100, 1020, 940, 860, 780]) {
        const resized = new Promise<void>((resolve) => {
          const watcher = new ResizeObserver(() => {
            watcher.disconnect();
            resolve();
          });
          watcher.observe(surface.canvas);
        });
        host.style.width = `${width}px`;
        await resized;
        const shot = await shoot(surface.canvas);
        expect(shot.width).toBe(width * window.devicePixelRatio);
        const bench = shot.at({ x: 12, y: 12 });
        const picture = shot.at(surface.camera.worldToScreen({ x: -45, y: 0 }));
        expect(colourDistance(bench, rgbOf(STANDARD_PALETTE.workbench)), `the bench at ${width} px: ${describeRgb(bench)}`).toBeLessThanOrEqual(12);
        expect(colourDistance(picture, rgbOf(0x2050c0)), `the battery pack at ${width} px: ${describeRgb(picture)}`).toBeLessThanOrEqual(12);
      }
    } finally {
      window.requestAnimationFrame = original;
      for (const callback of held) original.call(window, callback);
      unmount();
    }
  });

  it('leaves nothing behind in its host when destroyed, and destroying twice is harmless', async () => {
    const { host, surface, unmount } = await mount();
    const other = document.createElement('p');
    host.prepend(other);
    surface.load(fixture('rolling-start'));
    await settle(surface);
    surface.destroy();
    surface.destroy();
    expect([...host.children]).toEqual([other]);
    expect(() => surface.load(fixture('rolling-start'))).toThrow(/destroyed/);
    unmount();
  });

  it('can be destroyed before its renderer is up', () => {
    const host = document.createElement('div');
    host.style.cssText = 'width: 300px; height: 200px;';
    document.body.appendChild(host);
    const handle = mountCanvas(host, { catalogue, resolveArt: () => undefined, level: 1, prefs: PREFS });
    handle.destroy();
    expect(host.children).toHaveLength(0);
    host.remove();
  });
});

describe('load', () => {
  it('validates, canonicalises and keeps the build, firing no edit', () => {
    const edits = listen(surface, 'edit');
    const blueprint = fixture('rolling-start');
    const shuffled: Blueprint = { ...blueprint, parts: [...blueprint.parts].reverse(), wires: [...blueprint.wires].reverse() };
    const result = surface.load(shuffled);
    expect(result.ok).toBe(true);
    expect(surface.blueprint).toEqual(blueprint);
    expect(result.ok && result.value).toEqual(blueprint);
    expect(edits).toEqual([]);
    expect(surface.scene.parts).toHaveLength(8);
  });

  it('refuses a build that does not validate, and keeps the current one', () => {
    surface.load(fixture('rolling-start'));
    const broken = { ...fixture('led-circuit'), version: 2 } as unknown as Blueprint;
    const result = surface.load(broken);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.issues[0]?.code).toBe('blueprint.newer_version');
    expect(surface.blueprint?.meta.name).toBe('Rolling robot');
  });

  it('keeps the view: Undo loads an earlier build without moving anything', () => {
    surface.load(fixture('rolling-start'));
    surface.setZoom(2);
    surface.camera.panBy(120, -40, surface.limits());
    const view = [surface.camera.centreX, surface.camera.centreY, surface.zoom];
    surface.load(fixture('led-circuit'));
    expect([surface.camera.centreX, surface.camera.centreY, surface.zoom]).toEqual(view);
  });

  it('throws in Run mode, and works again back in Build mode', () => {
    surface.load(fixture('rolling-start'));
    surface.setMode('run');
    expect(() => surface.load(fixture('led-circuit'))).toThrow(/Run mode/);
    surface.setMode('build');
    expect(surface.load(fixture('led-circuit')).ok).toBe(true);
  });

  it('shows a build on a read-only canvas too (D43)', async () => {
    const { surface: readOnly, unmount } = await mount({ readOnly: true });
    expect(readOnly.load(fixture('bumper-robot')).ok).toBe(true);
    expect(readOnly.scene.parts).toHaveLength(13);
    unmount();
  });
});

describe('modes', () => {
  it('runs and stops on the same surface: the arena comes up in Run mode and goes back on Stop', async () => {
    surface.load(fixture('rolling-start'));
    await settle(surface);
    expect(surface.mode).toBe('build');
    expect(surface.modeBlend).toBe(0);
    surface.setMode('run');
    expect(surface.mode).toBe('run');
    await settle(surface);
    expect(surface.modeBlend).toBe(1);
    const before = surface.blueprint;
    surface.setMode('build');
    await settle(surface);
    expect(surface.modeBlend).toBe(0);
    expect(surface.blueprint).toBe(before);
  });

  it('fades between Build and Run, and makes every fade instant when the device asks for reduced motion', async () => {
    surface.load(fixture('rolling-start'));
    await settle(surface);
    surface.setMode('run');
    expect(surface.modeBlend, 'a fade under way').toBeLessThan(1);
    surface.setMode('build');
    await settle(surface);
    const session = cdp();
    await session.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    try {
      surface.setMode('run');
      expect(surface.modeBlend).toBe(1);
      surface.setMode('build');
      expect(surface.modeBlend).toBe(0);
      surface.wakeGrid();
      expect(surface.gridOpacity).toBe(1);
    } finally {
      await session.send('Emulation.setEmulatedMedia', { features: [] });
    }
  });

  it('refuses a mode it does not know', () => {
    expect(() => surface.setMode('replay' as never)).toThrow(RangeError);
  });
});

describe('prefs and level', () => {
  it('swaps to the high-contrast palette and back', () => {
    surface.load(fixture('led-circuit'));
    surface.setPrefs({ ...PREFS, highContrast: true });
    expect(surface.canvasBackground()).toBe(0xffffff);
    surface.setPrefs(PREFS);
    expect(surface.canvasBackground()).toBe(0xebe8e3);
  });

  it('writes names in the typeface the prefs ask for', () => {
    surface.load(fixture('led-circuit'));
    const family = (): string => String(surface.partView('led')?.labelFont);
    expect(family()).toMatch(/Nunito/);
    surface.setPrefs({ ...PREFS, typeface: 'dyslexia-friendly' });
    expect(family()).toMatch(/OpenDyslexic/);
  });

  it('takes a new level without changing the build', () => {
    surface.load(fixture('rolling-start'));
    const before = surface.blueprint;
    surface.setLevel(1);
    expect(surface.currentLevel).toBe(1);
    expect(surface.blueprint).toBe(before);
  });
});

describe('members later tasks build', () => {
  it('say which task builds them', () => {
    expect(surface.selection).toBeNull();
    expect(() => surface.listView).toThrow(/task 3\.6/);
    expect(() => surface.select(null)).toThrow(/task 3\.4/);
  });
});
