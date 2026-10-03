// Shared links (task 5.6) in Chromium: a link made from a child's build in a real store opens on the real, read-only
// canvas and replays, with Stop and Run again by pointer, touch and keyboard, and the canvas's list view reading the
// build out. Opening it opens no database and writes nothing: not to IndexedDB, page storage, the address or the
// history. A refused link is one plain line, never a dialog. The canvas is the real one, drawing every frame (task
// 3.5), with the frames it is handed counted. With prefers-reduced-motion the replay waits for Run. Last, the real
// page (index.html with a #share= fragment) opens the link and its canvas really moves.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cdp, userEvent } from 'vitest/browser';
import { mountCanvas } from '@servo/canvas';
import type { CanvasHandle, CanvasOptions } from '@servo/canvas';
import { loadContent } from '@servo/content';
import { loadFixtures } from '@servo/content/fixtures';
import { serializeBlueprint } from '@servo/schema';
import type { RunFrame } from '@servo/sim-core';
import { SHARE_TEXT, SHARED_BUILD_NAME, mountSharedPage, shareLinkOf } from '../../src/sharing/index.ts';
import type { SharedPageHandle } from '../../src/sharing/index.ts';
import { openStore } from '../../src/store/index.ts';

const { content } = loadContent();
const roller = loadFixtures().fixtures.find((fixture) => fixture.name === 'level-1-roller')?.blueprint;
if (!roller) throw new Error('no level-1-roller fixture');

const hosts: HTMLElement[] = [];
const handles: SharedPageHandle[] = [];

afterEach(() => {
  for (const handle of handles.splice(0)) handle.destroy();
  for (const host of hosts.splice(0)) host.remove();
  vi.restoreAllMocks();
});

const hostOf = (): HTMLElement => {
  const host = document.createElement('div');
  host.style.cssText = 'position: fixed; inset: 0';
  document.body.append(host);
  hosts.push(host);
  return host;
};

/** The real canvas, with every frame it is handed counted and then drawn. */
const counting = (frames: RunFrame[]) => (host: HTMLElement, options: CanvasOptions): CanvasHandle => {
  const canvas = mountCanvas(host, options);
  const draw = canvas.applyRunFrame.bind(canvas);
  return Object.assign(canvas, {
    applyRunFrame: (frame: RunFrame) => {
      frames.push(frame);
      draw(frame);
    },
  });
};

const statusOf = (root: ParentNode): string | null | undefined => root.querySelector('.share-bar [role="status"]')?.textContent;

/** A tap with one finger, through the browser's own touch input. */
const tap = async (element: Element): Promise<void> => {
  const box = element.getBoundingClientRect();
  const point = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  await cdp().send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, id: 0 }] });
  await cdp().send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
};

const button = (host: HTMLElement): HTMLButtonElement => {
  const found = host.querySelector<HTMLButtonElement>('.share-bar button');
  if (!found) throw new Error('no replay button');
  return found;
};

/** A child's build in a real store on this device, and the link the parent view would make for it. */
const childLink = async (database: string): Promise<{ fragment: string; url: string; profileId: string; profileName: string; buildId: string }> => {
  const store = await openStore({ name: database });
  try {
    const profile = await store.profiles.create('Ada Lindqvist');
    const kept = await store.forProfile(profile.id).blueprints.copy(roller, 'Ada fast robot');
    if (!kept.ok) throw new Error('not kept');
    const link = await shareLinkOf(kept.blueprint, store.content.catalogue, { base: `${location.origin}/` });
    if (!link.ok) throw new Error('no link');
    return { fragment: link.fragment, url: link.url, profileId: profile.id, profileName: profile.name, buildId: kept.blueprint.meta.id };
  } finally {
    store.close();
  }
};

const countRows = async (database: string): Promise<string> => {
  const store = await openStore({ name: database });
  try {
    const profiles = await store.profiles.list();
    const rows = await Promise.all(
      profiles.map(async (profile) => {
        const child = store.forProfile(profile.id);
        return { profile: profile.id, builds: await child.blueprints.list(), runs: await child.runs.list() };
      }),
    );
    return JSON.stringify(rows);
  } finally {
    store.close();
  }
};

describe('opening a shared link', () => {
  it('opens the build on a read-only canvas and replays it, opening no store and writing nothing', async () => {
    const database = `servo-share-${crypto.randomUUID()}`;
    const { fragment, url, profileId, profileName, buildId } = await childLink(database);
    const before = await countRows(database);
    const address = location.href;
    const historyLength = history.length;
    const opens = vi.spyOn(indexedDB, 'open');
    const stored = vi.spyOn(Storage.prototype, 'setItem');
    const pushed = vi.spyOn(history, 'pushState');
    const replaced = vi.spyOn(history, 'replaceState');
    const alerts = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    expect(url.endsWith(fragment)).toBe(true);

    const frames: RunFrame[] = [];
    const host = hostOf();
    const handle = await mountSharedPage(host, fragment, { mountCanvas: counting(frames), reducedMotion: () => false });
    handles.push(handle);

    // The build: the real canvas, read-only, with the shared build loaded.
    const canvas = handle.canvas();
    if (!canvas) throw new Error('no canvas');
    expect(host.querySelector('canvas')).toBeTruthy();
    expect(host.querySelector('h1')?.textContent).toBe(SHARED_BUILD_NAME);
    expect(canvas.blueprint?.parts).toEqual(handle.read.ok ? handle.read.blueprint.parts : undefined);
    expect(canvas.apply({ kind: 'rename', name: 'Changed' })).toMatchObject({ ok: false, refusal: { code: 'edit.locked' } });

    // The replay: Run mode at once, then frames past tick 0 after the spin-up.
    await expect.poll(() => canvas.mode, { timeout: 30_000 }).toBe('run');
    await expect.poll(() => frames.at(-1)?.tick ?? 0, { timeout: 30_000 }).toBeGreaterThan(1);
    expect(frames[0]?.tick).toBe(0);
    expect(button(host).textContent).toBe(SHARE_TEXT.stop);
    expect(statusOf(host)).toBe(SHARE_TEXT.running);

    // Stop by pointer, Run again by touch, Stop by keyboard: all three paths.
    await userEvent.click(button(host));
    await expect.poll(() => canvas.mode, { timeout: 10_000 }).toBe('build');
    expect(handle.replay()?.tick).toBe(0);
    expect(button(host).textContent).toBe(SHARE_TEXT.runAgain);
    frames.length = 0;
    await tap(button(host));
    await expect.poll(() => canvas.mode, { timeout: 30_000 }).toBe('run');
    await expect.poll(() => frames.at(-1)?.tick ?? 0, { timeout: 30_000 }).toBeGreaterThan(1);
    expect(frames[0]?.tick).toBe(0);
    button(host).focus();
    await userEvent.keyboard('{Enter}');
    await expect.poll(() => canvas.mode, { timeout: 10_000 }).toBe('build');

    // The list view reads the shared build out too, with nothing to change it.
    expect(canvas.listView).toBeTruthy();

    // Nothing of the child is on the page, and nothing was written anywhere.
    for (const absent of [profileId, profileName, 'Ada', buildId]) expect(document.body.innerHTML).not.toContain(absent);
    expect(document.title).not.toContain('Ada');
    expect(opens).not.toHaveBeenCalled();
    expect(stored).not.toHaveBeenCalled();
    expect(pushed).not.toHaveBeenCalled();
    expect(replaced).not.toHaveBeenCalled();
    expect(alerts).not.toHaveBeenCalled();
    expect(location.href).toBe(address);
    expect(history.length).toBe(historyLength);
    expect(host.querySelector('dialog, [role="dialog"], [role="alertdialog"]')).toBeNull();
    vi.restoreAllMocks();
    expect(await countRows(database)).toBe(before);
    indexedDB.deleteDatabase(database);
  });

  it('shows a refused link as one plain line, never a dialog, and never the canvas', async () => {
    const alerts = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    const opens = vi.spyOn(indexedDB, 'open');
    const link = await shareLinkOf(roller, content.catalogue, { base: `${location.origin}/` });
    if (!link.ok) throw new Error('no link');
    const cut = link.fragment.slice(0, -6);
    for (const [hash, line] of [
      [cut, SHARE_TEXT.refused],
      ['#share=', SHARE_TEXT.refused],
      ['#share=9.abc', SHARE_TEXT.newer],
    ] as const) {
      const host = hostOf();
      const handle = await mountSharedPage(host, hash);
      handles.push(handle);
      await expect.poll(() => host.querySelector('[role="status"]')?.textContent).toBe(line);
      expect(host.querySelector('canvas')).toBeNull();
      expect(host.querySelector('dialog, [role="dialog"], [role="alertdialog"]')).toBeNull();
      expect(line).not.toContain('!');
    }
    expect(alerts).not.toHaveBeenCalled();
    expect(opens).not.toHaveBeenCalled();
  });

  it('shows the build’s name only when the link carries it', async () => {
    const named = { ...roller, meta: { ...roller.meta, name: 'Track racer' } };
    const link = await shareLinkOf(named, content.catalogue, { base: `${location.origin}/`, includeName: true });
    if (!link.ok) throw new Error('no link');
    const host = hostOf();
    const handle = await mountSharedPage(host, link.fragment, { mountCanvas: counting([]), reducedMotion: () => false });
    handles.push(handle);
    expect(host.querySelector('h1')?.textContent).toBe('Track racer');
    // The name stays on the page: never in the title, which lands in the browser's history.
    expect(document.title).not.toContain('Track racer');
    expect(serializeBlueprint(handle.canvas()?.blueprint ?? roller)).toContain('Track racer');
  });

  // Other test files set and clear the page's emulated media while this one runs, so each test here says which it
  // wants; prefersReducedMotion itself is checked in test/sharing/view.test.ts.
  it('waits at tick 0 for Run under reduced motion, then replays as usual', async () => {
    const link = await shareLinkOf(roller, content.catalogue, { base: `${location.origin}/` });
    if (!link.ok) throw new Error('no link');
    const frames: RunFrame[] = [];
    const host = hostOf();
    const handle = await mountSharedPage(host, link.fragment, { mountCanvas: counting(frames), reducedMotion: () => true });
    handles.push(handle);
    await expect.poll(() => statusOf(host), { timeout: 10_000 }).toBe(SHARE_TEXT.ready);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(frames).toEqual([]);
    expect(handle.canvas()?.mode).toBe('build');
    expect(button(host).textContent).toBe(SHARE_TEXT.run);
    await userEvent.click(button(host));
    await expect.poll(() => handle.canvas()?.mode, { timeout: 30_000 }).toBe('run');
    await expect.poll(() => frames.at(-1)?.tick ?? 0, { timeout: 30_000 }).toBeGreaterThan(1);
  });

  it('opens from its address on the real page, and the robot really moves on the canvas', async () => {
    const link = await shareLinkOf(roller, content.catalogue, { base: `${location.origin}/` });
    if (!link.ok) throw new Error('no link');
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position: fixed; left: 0; top: 0; width: 1180px; height: 820px; border: 0';
    frame.src = `/index.html${link.fragment}`;
    document.body.append(frame);
    hosts.push(frame);
    const doc = (): Document | null => frame.contentDocument;
    await expect.poll(() => doc()?.querySelector('.share-stage canvas'), { timeout: 30_000 }).toBeTruthy();
    // The child's app is not what opened: no shell.
    expect(doc()?.querySelector('[data-region="stage"]')).toBeNull();
    // The page reads the emulated media, which other test files change: under reduced motion it waits for Run.
    await expect.poll(() => [SHARE_TEXT.ready, SHARE_TEXT.running].includes(statusOf(doc() as Document) as never), { timeout: 30_000 }).toBe(true);
    if (statusOf(doc() as Document) === SHARE_TEXT.ready) doc()?.querySelector<HTMLButtonElement>('.share-bar button')?.click();
    await expect.poll(() => statusOf(doc() as Document), { timeout: 30_000 }).toBe(SHARE_TEXT.running);
    /** The page's pixels, straight from the compositor. */
    const shoot = async (): Promise<Uint8ClampedArray> => {
      const outer = window.frameElement?.getBoundingClientRect();
      const box = frame.getBoundingClientRect();
      const clip = { x: (outer?.left ?? 0) + box.left, y: (outer?.top ?? 0) + box.top + 60, width: box.width, height: box.height - 160, scale: 1 };
      const png = (await cdp().send('Page.captureScreenshot', { format: 'png', clip })) as { readonly data: string };
      const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${png.data}`)).blob());
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('no 2D context');
      context.drawImage(bitmap, 0, 0);
      return context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    };
    const differing = (a: Uint8ClampedArray, b: Uint8ClampedArray): number => {
      let count = 0;
      for (let index = 0; index < a.length; index += 4) {
        if (Math.abs((a[index] ?? 0) - (b[index] ?? 0)) + Math.abs((a[index + 1] ?? 0) - (b[index + 1] ?? 0)) + Math.abs((a[index + 2] ?? 0) - (b[index + 2] ?? 0)) > 30) count += 1;
      }
      return count;
    };
    const first = await shoot();
    await expect
      .poll(async () => differing(first, await shoot()), { timeout: 30_000, interval: 500 })
      .toBeGreaterThan(200);
    expect(statusOf(doc() as Document)).not.toBe(SHARE_TEXT.failed);
  });
});
