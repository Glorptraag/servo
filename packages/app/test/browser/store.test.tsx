// The store in a real browser (task 4.9), on Chromium's own IndexedDB. Save and the blueprint's name in the header,
// with a stand-in canvas and a real store; then the real app page keeping a build across a real reload. The store's
// own rules are tested in Node on fake-indexeddb (test/store/).
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cdp, userEvent } from 'vitest/browser';
import { Dexie } from 'dexie';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import type { CanvasEventMap, CanvasHandle, CanvasMode, EditCommand, EditResult, ListView, Selection } from '@servo/canvas';
import { loadContent } from '@servo/content';
import { loadFixtures } from '@servo/content/fixtures';
import { serializeBlueprint } from '@servo/schema';
import type { Blueprint, ValidationResult } from '@servo/schema';
import { SAVE_LINES, SaveControl, Shell } from '../../src/shell/index.ts';
import { openStore } from '../../src/store/index.ts';
import type { ProfileStore, ServoStore } from '../../src/store/index.ts';

/** A stand-in for the canvas: it keeps the build it is given, and renames it as the canvas's `rename` command does. */
class StandInCanvas implements CanvasHandle {
  mode: CanvasMode = 'build';
  blueprint: Blueprint | undefined;
  selection: Selection | null = null;
  zoom = 1;
  readonly applied: EditCommand[] = [];
  private readonly listeners = new Map<keyof CanvasEventMap, Set<(event: never) => void>>();

  get listView(): ListView {
    throw new Error('not in the stand-in');
  }
  load(blueprint: Blueprint): ValidationResult<Blueprint> {
    this.blueprint = blueprint;
    return { ok: true, value: blueprint };
  }
  apply(command: EditCommand): EditResult {
    this.applied.push(command);
    if (command.kind !== 'rename' || !this.blueprint) return { ok: false, refusal: { code: 'edit.no_build', message: 'not in the stand-in' } };
    const blueprint = { ...this.blueprint, meta: { ...this.blueprint.meta, name: command.name } };
    this.blueprint = blueprint;
    for (const listener of this.listeners.get('edit') ?? []) (listener as (event: CanvasEventMap['edit']) => void)({ command, blueprint });
    return { ok: true, blueprint };
  }
  beginPlacement(): void {}
  beginPropPlacement(): void {}
  cancelPlacement(): void {}
  setRemoveTargets(): void {}
  select(): void {}
  setMode(mode: CanvasMode): void {
    this.mode = mode;
  }
  applyRunFrame(): void {}
  showHint(): boolean {
    return false;
  }
  clearHints(): void {}
  fit(): void {}
  setZoom(zoom: number): void {
    this.zoom = zoom;
  }
  tidyWires(): void {}
  setLevel(): void {}
  setPrefs(): void {}
  on<K extends keyof CanvasEventMap>(type: K, listener: (event: CanvasEventMap[K]) => void): () => void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener as (event: never) => void);
    this.listeners.set(type, set);
    return () => set.delete(listener as (event: never) => void);
  }
  destroy(): void {}
}

const { content } = loadContent();
const rollingRobot = loadFixtures().fixtures.find((fixture) => fixture.name === 'kit-rolling-start')?.blueprint as Blueprint;
const PAST = '2026-01-01T09:00:00.000Z';
const LATER = '2026-01-02T10:30:00.000Z';

let databases = 0;
const databaseName = (): string => {
  databases += 1;
  return `servo-browser-test-${databases}-${Math.random().toString(36).slice(2)}`;
};

const cleanups: (() => Promise<void> | void)[] = [];

/** How long to wait for IndexedDB and React to show a change, generously, for a busy machine. */
const SOON = { timeout: 10_000, interval: 20 };

// Nothing here is about motion, so nothing slides.
beforeAll(() => cdp().send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }));
afterAll(() => cdp().send('Emulation.setEmulatedMedia', { features: [] }));
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

interface Kept {
  readonly store: ServoStore;
  readonly name: string;
  readonly child: ProfileStore;
  readonly build: Blueprint;
  /** The store's clock, which starts at PAST. */
  readonly clock: { time: string };
}

/** A store on its own database, with one child who has kept the Rolling Start robot, made at PAST. */
const childWithBuild = async (): Promise<Kept> => {
  const name = databaseName();
  const clock = { time: PAST };
  const store = await openStore({ name, now: () => clock.time });
  cleanups.push(async () => {
    store.close();
    await Dexie.delete(name);
  });
  const child = store.forProfile((await store.profiles.create('Robin')).id);
  const kept = await child.blueprints.copy(rollingRobot);
  if (!kept.ok) throw new Error('not kept');
  return { store, name, child, build: kept.blueprint, clock };
};

interface Mounted {
  readonly header: HTMLElement;
  readonly canvas: StandInCanvas;
  saveButton(): HTMLButtonElement;
  status(): string;
  nameButton(): HTMLButtonElement | null;
  /** The name's text field, once a tap on the name has opened it. */
  nameField(): Promise<HTMLInputElement>;
}

/** The shell with the real Save in its slot, a stand-in canvas, and the child's records. */
const mountShell = async (child: ProfileStore | null, start?: Blueprint): Promise<Mounted> => {
  const host = document.createElement('div');
  host.style.cssText = 'position: fixed; left: 0; top: 0; width: 1180px; height: 820px;';
  document.body.appendChild(host);
  const root: Root = createRoot(host);
  cleanups.push(() => {
    root.unmount();
    host.remove();
  });
  const canvas = new StandInCanvas();
  root.render(<Shell content={content} level={1} storage={null} slots={{ save: <SaveControl /> }} mountCanvas={() => canvas} child={child} start={start} />);
  await vi.waitFor(() => {
    if (!host.querySelector('[data-region="header"]')) throw new Error('the shell has not mounted yet');
  }, SOON);
  const header = host.querySelector<HTMLElement>('[data-region="header"]') as HTMLElement;
  return {
    header,
    canvas,
    saveButton: () => [...header.querySelectorAll('button')].find((button) => button.textContent === 'Save') as HTMLButtonElement,
    status: () => header.querySelector('[role="status"]')?.textContent ?? '',
    nameButton: () => header.querySelector<HTMLButtonElement>('button.shell-blueprint-name'),
    nameField: () =>
      vi.waitFor(() => {
        const found = header.querySelector<HTMLInputElement>('input.shell-blueprint-name-input');
        if (!found) throw new Error('no field yet');
        return found;
      }, SOON),
  };
};

describe('Save in the header', () => {
  it('stores the build on the canvas in the child’s profile, and says so in one plain line', async () => {
    const { child, build, clock } = await childWithBuild();
    const app = await mountShell(child, build);
    expect(app.nameButton()?.textContent).toBe('Rolling robot');
    expect(app.saveButton().disabled).toBe(false);
    expect(app.status()).toBe('');

    clock.time = LATER;
    app.saveButton().click();
    await vi.waitFor(() => expect(app.status()).toBe(SAVE_LINES.saved), SOON);
    const loaded = await child.blueprints.load(build.meta.id);
    if (!loaded.ok) throw new Error('not loaded');
    expect(serializeBlueprint(loaded.blueprint)).toBe(serializeBlueprint({ ...build, meta: { ...build.meta, updatedAt: LATER } }));
    expect(app.header.querySelectorAll('[role="status"]')).toHaveLength(1);
  });

  it('shows a failed save as one plain line, never a dialog', async () => {
    const { store, child, build } = await childWithBuild();
    const app = await mountShell(child, build);
    const alert = vi.spyOn(window, 'alert');
    const confirm = vi.spyOn(window, 'confirm');
    cleanups.push(() => {
      alert.mockRestore();
      confirm.mockRestore();
    });
    await store.profiles.remove(child.profile);

    app.saveButton().click();
    await vi.waitFor(() => expect(app.status()).toBe(SAVE_LINES.notSaved), SOON);
    expect(alert).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    expect(document.querySelector('dialog, [role="dialog"], [role="alertdialog"]')).toBeNull();
    expect(app.status()).not.toContain('!');
  });

  it('is there to press only with a build on the canvas and a profile to keep it in', async () => {
    const { child, build } = await childWithBuild();
    expect((await mountShell(null, build)).saveButton().disabled).toBe(true);
    const empty = await mountShell(child);
    expect(empty.saveButton().disabled).toBe(true);
    expect(empty.nameButton()).toBeNull();
  });
});

describe('the blueprint’s name in the header', () => {
  it('renames the build through the canvas, and Save keeps the new name', async () => {
    const { child, build } = await childWithBuild();
    const app = await mountShell(child, build);
    app.nameButton()?.click();
    const field = await app.nameField();
    expect(field.value).toBe('Rolling robot');
    expect(document.activeElement).toBe(field);
    await userEvent.fill(field, '  Fast   one ');
    await userEvent.keyboard('{Enter}');
    await vi.waitFor(() => expect(app.nameButton()?.textContent).toBe('Fast one'), SOON);
    expect(app.canvas.applied).toEqual([{ kind: 'rename', name: 'Fast one' }]);

    app.saveButton().click();
    await vi.waitFor(() => expect(app.status()).toBe(SAVE_LINES.saved), SOON);
    expect((await child.blueprints.list()).map((summary) => summary.name)).toEqual(['Fast one']);
  });

  it('keeps the old name on Escape, and when the new one is empty', async () => {
    const { child, build } = await childWithBuild();
    const app = await mountShell(child, build);
    for (const [typed, key] of [
      ['Slow one', '{Escape}'],
      ['   ', '{Enter}'],
    ] as const) {
      app.nameButton()?.click();
      const field = await app.nameField();
      await userEvent.fill(field, typed);
      await userEvent.keyboard(key);
      await vi.waitFor(() => expect(app.nameButton()?.textContent).toBe('Rolling robot'), SOON);
    }
    expect(app.canvas.applied).toEqual([]);
  });
});

describe('the app page', () => {
  /** The real app in a frame, on the database `name`. A reload starts the page and every module again. */
  const openPage = async (name: string) => {
    const frame = document.createElement('iframe');
    frame.title = 'Servo';
    frame.style.cssText = 'position: fixed; left: 0; top: 0; width: 1180px; height: 820px; border: 0;';
    frame.src = `/test/browser/store-page.html?store=${encodeURIComponent(name)}`;
    document.body.appendChild(frame);
    cleanups.push(() => frame.remove());
    const header = (): HTMLElement => {
      const found = frame.contentDocument?.querySelector<HTMLElement>('[data-region="header"]');
      if (!found) throw new Error('no header');
      return found;
    };
    const ready = () =>
      vi.waitFor(
        () => {
          if (!frame.contentDocument?.querySelector('[data-region="stage"] canvas')) throw new Error('the app has not mounted yet');
          header();
        },
        { timeout: 30_000, interval: 50 },
      );
    await ready();
    return {
      name: () => header().querySelector('button.shell-blueprint-name')?.textContent ?? null,
      status: () => header().querySelector('[role="status"]')?.textContent ?? '',
      save: () => ([...header().querySelectorAll('button')].find((button) => button.textContent === 'Save') as HTMLButtonElement).click(),
      reload: async () => {
        const loaded = new Promise((resolve) => frame.addEventListener('load', resolve, { once: true }));
        frame.contentWindow?.location.reload();
        await loaded;
        await ready();
      },
    };
  };

  it('keeps a build in IndexedDB across a real reload of the page', async () => {
    const { store, name, build } = await childWithBuild();
    store.close();
    const page = await openPage(name);
    await vi.waitFor(() => expect(page.name()).toBe('Rolling robot'), SOON);

    page.save();
    await vi.waitFor(() => expect(page.status()).toBe(SAVE_LINES.saved), SOON);
    const reader = await openStore({ name });
    const [summary] = await reader.forProfile((await reader.profiles.list())[0]?.id ?? '').blueprints.list();
    reader.close();
    expect(summary?.id).toBe(build.meta.id);
    const savedAt = summary?.updatedAt ?? '';
    expect(savedAt > PAST).toBe(true);

    await page.reload();
    // The page and its memory started again: the build, and the save made before the reload, come back from IndexedDB.
    await vi.waitFor(() => expect(page.name()).toBe('Rolling robot'), SOON);
    expect(page.status()).toBe('');
    page.save();
    await vi.waitFor(() => expect(page.status()).toBe(SAVE_LINES.saved), SOON);
    const after = await openStore({ name });
    const kid = after.forProfile((await after.profiles.list())[0]?.id ?? '');
    const loaded = await kid.blueprints.load(build.meta.id);
    after.close();
    if (!loaded.ok) throw new Error('not loaded');
    expect(loaded.blueprint.meta.updatedAt >= savedAt).toBe(true);
    expect(serializeBlueprint(loaded.blueprint)).toBe(serializeBlueprint({ ...build, meta: { ...build.meta, updatedAt: loaded.blueprint.meta.updatedAt } }));
  });
});
