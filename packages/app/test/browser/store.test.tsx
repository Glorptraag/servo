// The store in a real browser (task 4.9), on Chromium's own IndexedDB. Save, autosave and the blueprint's name in the
// header, with a stand-in canvas and a real store; two tabs on one build; an edit kept when its page is reloaded or
// closed at once (save-page.html); then the real app page: its first run, a build kept across a real reload, and a
// device whose storage is blocked or full. The store's own rules are tested in Node on fake-indexeddb (test/store/).
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cdp, userEvent } from 'vitest/browser';
import { Dexie } from 'dexie';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { loadContent } from '@servo/content';
import { loadFixtures } from '@servo/content/fixtures';
import { serializeBlueprint } from '@servo/schema';
import type { Blueprint } from '@servo/schema';
import { invalidBlueprints } from '@servo/schema/fixtures';
import { AUTOSAVE_MS, SAVE_LINES, SaveControl, Shell, UNSAVED_PREFIX, useShell } from '../../src/shell/index.ts';
import type { ShellApi } from '../../src/shell/index.ts';
import { openDatabase } from '../../src/store/database.ts';
import { openStore } from '../../src/store/index.ts';
import type { ProfileStore, ServoStore } from '../../src/store/index.ts';
import { StandInCanvas } from './stand-in.ts';

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
  /** The shell, as a slot sees it. */
  shell(): ShellApi;
  /** An edit, as the canvas makes one: renames the build on it. */
  rename(name: string): void;
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
  let latest: ShellApi | null = null;
  const Probe = () => {
    latest = useShell();
    return null;
  };
  root.render(
    <Shell content={content} level={1} storage={null} slots={{ save: <SaveControl />, sound: <Probe /> }} mountCanvas={() => canvas} child={child} start={start} />,
  );
  await vi.waitFor(() => {
    if (!host.querySelector('[data-region="header"]') || !latest?.canvas) throw new Error('the shell has not mounted yet');
  }, SOON);
  const header = host.querySelector<HTMLElement>('[data-region="header"]') as HTMLElement;
  return {
    header,
    canvas,
    shell: () => {
      if (!latest) throw new Error('no shell');
      return latest;
    },
    rename: (name) => {
      const done = canvas.apply({ kind: 'rename', name });
      if (!done.ok) throw new Error(done.refusal.message);
    },
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
    // With a build but nowhere to keep it, the line says so.
    const unkept = await mountShell(null, build);
    expect(unkept.saveButton().disabled).toBe(true);
    expect(unkept.status()).toBe(SAVE_LINES.notKept);
    const empty = await mountShell(child);
    expect(empty.saveButton().disabled).toBe(true);
    expect(empty.nameButton()).toBeNull();
    expect(empty.status()).toBe('');
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

/** Every call of the child's `save`, and when it was made; each still saves as the store does. */
const watchSaves = (child: ProfileStore): { readonly at: number; readonly build: Blueprint }[] => {
  const save = child.blueprints.save;
  const calls: { readonly at: number; readonly build: Blueprint }[] = [];
  const spy = vi.spyOn(child.blueprints, 'save').mockImplementation((build) => {
    calls.push({ at: performance.now(), build });
    return save(build);
  });
  cleanups.push(() => spy.mockRestore());
  return calls;
};

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('autosave', () => {
  it('saves the build about a second after the last edit, with every edit in it, and then rests', async () => {
    const { child, build } = await childWithBuild();
    const app = await mountShell(child, build);
    const saves = watchSaves(child);
    const edits: number[] = [];
    for (const name of ['Fast', 'Faster', 'Fastest']) {
      if (edits.length > 0) await pause(300);
      app.rename(name);
      edits.push(performance.now());
    }
    await vi.waitFor(() => expect(saves.length).toBeGreaterThan(0), SOON);
    await pause(AUTOSAVE_MS + 300);
    // Each save waited a quiet second after the edit before it, so edits close together save once, and the last
    // save holds the last edit. Nothing more is saved while nothing changes.
    for (const { at } of saves) expect(at - Math.max(...edits.filter((edit) => edit < at))).toBeGreaterThanOrEqual(AUTOSAVE_MS - 20);
    expect(saves.at(-1)?.build.meta.name).toBe('Fastest');
    expect(saves.length).toBeLessThan(edits.length);
    expect((await child.blueprints.list()).map((summary) => summary.name)).toEqual(['Fastest']);
    // A save that went as expected says nothing, so a screen reader is not told "Saved" after every pause.
    expect(app.status()).toBe('');
  });

  it('tries a failed save again, later each time, until it saves, and the line goes then', async () => {
    const { child, build } = await childWithBuild();
    const app = await mountShell(child, build);
    const save = child.blueprints.save;
    let refusals = 1;
    const spy = vi.spyOn(child.blueprints, 'save').mockImplementation((next) => {
      if (refusals > 0) {
        refusals -= 1;
        return Promise.reject(new Error('The connection to the store was lost.'));
      }
      return save(next);
    });
    cleanups.push(() => spy.mockRestore());
    app.rename('Kept in the end');
    await vi.waitFor(() => expect(app.status()).toBe(SAVE_LINES.notSaved), SOON);
    await vi.waitFor(() => expect(app.status()).toBe(''), { timeout: AUTOSAVE_MS * 6, interval: 50 });
    expect(spy).toHaveBeenCalledTimes(2);
    expect((await child.blueprints.list()).map((summary) => summary.name)).toEqual(['Kept in the end']);
  });

  it('saves an Undo, which loads the build’s earlier form with load', async () => {
    const { child, build } = await childWithBuild();
    const app = await mountShell(child, build);
    app.rename('Changed');
    flushSync(() => app.shell().setMode('run'));
    flushSync(() => app.shell().setMode('build'));
    await vi.waitFor(async () => expect((await child.blueprints.list())[0]?.name).toBe('Changed'), SOON);
    // Undo: the build as it was before the rename goes back on the canvas with load, which fires no edit.
    flushSync(() => app.shell().load(build));
    await vi.waitFor(async () => expect((await child.blueprints.list())[0]?.name).toBe('Rolling robot'), SOON);
    expect(await child.blueprints.list()).toHaveLength(1);
  });

  it('saves at once when Run is pressed, and not again after', async () => {
    const { child, build } = await childWithBuild();
    const app = await mountShell(child, build);
    const saves = watchSaves(child);
    app.rename('Racer');
    const run = performance.now();
    flushSync(() => app.shell().setMode('run'));
    await vi.waitFor(() => expect(saves).toHaveLength(1), SOON);
    expect((saves[0]?.at ?? Number.POSITIVE_INFINITY) - run).toBeLessThan(AUTOSAVE_MS / 2);
    expect(saves[0]?.build.meta.name).toBe('Racer');
    await pause(AUTOSAVE_MS + 300);
    flushSync(() => app.shell().setMode('build'));
    flushSync(() => app.shell().setMode('run'));
    await pause(100);
    expect(saves).toHaveLength(1);
    expect((await child.blueprints.list()).map((summary) => summary.name)).toEqual(['Racer']);
  });

  it('saves the waiting build at once when the next edit is to another build', async () => {
    const { child, build } = await childWithBuild();
    const other = await child.blueprints.duplicate(build.meta.id, 'Other robot');
    const app = await mountShell(child, build);
    const saves = watchSaves(child);
    app.rename('First, changed');
    flushSync(() => app.shell().load(other));
    const switched = performance.now();
    app.rename('Other, changed');
    await vi.waitFor(() => expect(saves).toHaveLength(2), SOON);
    expect(saves.map((save) => [save.build.meta.id, save.build.meta.name])).toEqual([
      [build.meta.id, 'First, changed'],
      [other.meta.id, 'Other, changed'],
    ]);
    expect((saves[0]?.at ?? Number.POSITIVE_INFINITY) - switched).toBeLessThan(AUTOSAVE_MS / 2);
    expect((await child.blueprints.list()).map((summary) => summary.name).sort()).toEqual(['First, changed', 'Other, changed']);
  });

  it('leaves nothing waiting once Save is pressed', async () => {
    const { child, build } = await childWithBuild();
    const app = await mountShell(child, build);
    const saves = watchSaves(child);
    app.rename('Quick');
    app.saveButton().click();
    await vi.waitFor(() => expect(saves).toHaveLength(1), SOON);
    await pause(AUTOSAVE_MS + 300);
    expect(saves).toHaveLength(1);
  });

  it('shows a failed autosave as the same plain line, never a dialog', async () => {
    const { store, child, build } = await childWithBuild();
    const app = await mountShell(child, build);
    const alert = vi.spyOn(window, 'alert');
    cleanups.push(() => alert.mockRestore());
    await store.profiles.remove(child.profile);
    app.rename('Lost');
    await vi.waitFor(() => expect(app.status()).toBe(SAVE_LINES.notSaved), SOON);
    expect(alert).not.toHaveBeenCalled();
    expect(document.querySelector('dialog, [role="dialog"], [role="alertdialog"]')).toBeNull();
  });

  it('never overwrites a stored build that does not load', async () => {
    const { name, child, build } = await childWithBuild();
    const app = await mountShell(child, build);
    // Sync has brought a newer version of the same build from another device.
    const newer = JSON.stringify({ ...(invalidBlueprints.find((fixture) => fixture.name === 'version-2')?.data as object), meta: { ...build.meta } });
    const db = await openDatabase(name);
    await db.blueprints.put({ id: build.meta.id, profile: child.profile, document: newer });
    app.rename('Mine');
    await vi.waitFor(() => expect(app.status()).toBe(SAVE_LINES.notSaved), SOON);
    expect((await db.blueprints.get(build.meta.id))?.document).toBe(newer);
    db.close();
  });
});

describe('two tabs on one build', () => {
  it('keeps both versions, and the later save says a copy was kept', async () => {
    const { name, child, build, clock } = await childWithBuild();
    // A second tab: its own connection to the same database, on the same child's records.
    const second = await openStore({ name, now: () => clock.time });
    cleanups.push(() => second.close());
    const tabA = await mountShell(child, build);
    const tabB = await mountShell(second.forProfile(child.profile), build);

    clock.time = LATER;
    tabA.rename('Tab A edit');
    tabA.saveButton().click();
    await vi.waitFor(() => expect(tabA.status()).toBe(SAVE_LINES.saved), SOON);
    // Tab B opened the build before tab A saved it, and saves its own edit.
    tabB.rename('Tab B edit');
    tabB.saveButton().click();
    await vi.waitFor(() => expect(tabB.status()).toBe(SAVE_LINES.keptCopy), SOON);

    const builds = await child.blueprints.list();
    expect(builds.map(({ name: built, keptFrom }) => ({ built, keptFrom }))).toEqual([
      { built: 'Tab B edit', keptFrom: undefined },
      { built: 'Tab A edit', keptFrom: build.meta.id },
    ]);
    expect(builds[0]?.id).toBe(build.meta.id);
    const copy = await child.blueprints.load(builds[1]?.id ?? '');
    expect(copy.ok && copy.blueprint.parts).toEqual(build.parts);
    expect(document.querySelector('dialog, [role="dialog"], [role="alertdialog"]')).toBeNull();
  });
});

describe('leaving the page', () => {
  /** The shell with Save on a stand-in canvas, in a frame (save-page.html), on the database `name`. */
  const openSavePage = async (name: string) => {
    const frame = document.createElement('iframe');
    frame.title = 'Servo save page';
    frame.style.cssText = 'position: fixed; left: 0; top: 0; width: 1180px; height: 820px; border: 0;';
    frame.src = `/test/browser/save-page.html?store=${encodeURIComponent(name)}`;
    document.body.appendChild(frame);
    cleanups.push(() => frame.remove());
    const nameShown = (): string | null => frame.contentDocument?.querySelector('button.shell-blueprint-name')?.textContent ?? null;
    const ready = () =>
      vi.waitFor(() => {
        if (!frame.contentWindow?.servoTest || nameShown() === null) throw new Error('the page has not mounted yet');
      }, { timeout: 90_000, interval: 50 });
    await ready();
    const header = (): Element | null | undefined => frame.contentDocument?.querySelector('[data-region="header"]');
    return {
      name: nameShown,
      status: () => header()?.querySelector('[role="status"]')?.textContent ?? '',
      save: () => ([...(header()?.querySelectorAll('button') ?? [])].find((button) => button.textContent === 'Save') as HTMLButtonElement).click(),
      rename: (next: string) => frame.contentWindow?.servoTest?.rename(next),
      reload: async () => {
        const loaded = new Promise((resolve) => frame.addEventListener('load', resolve, { once: true }));
        frame.contentWindow?.location.reload();
        await loaded;
        await ready();
      },
      close: () => frame.remove(),
    };
  };

  it('keeps an edit when the page is reloaded or closed at once, inside the quiet second', async () => {
    const { store, name, build } = await childWithBuild();
    store.close();
    const page = await openSavePage(name);
    expect(page.name()).toBe('Rolling robot');

    page.rename('Renamed, then reloaded');
    await page.reload();
    // The page and its memory started again; the name comes from IndexedDB.
    await vi.waitFor(() => expect(page.name()).toBe('Renamed, then reloaded'), SOON);

    page.rename('Renamed, then closed');
    page.close();
    // The next time the page opens, the edit is there, saved to the build it was made on.
    const again = await openSavePage(name);
    await vi.waitFor(() => expect(again.name()).toBe('Renamed, then closed'), SOON);
    const reader = await openStore({ name });
    try {
      const builds = await reader.forProfile((await reader.profiles.list())[0]?.id ?? '').blueprints.list();
      expect(builds.map(({ id, name: built }) => ({ id, built }))).toEqual([{ id: build.meta.id, built: 'Renamed, then closed' }]);
    } finally {
      reader.close();
    }
    // Every note the pages left has been saved and forgotten.
    expect(Object.keys(localStorage).filter((item) => item.startsWith(`${UNSAVED_PREFIX}${name}:`))).toEqual([]);
  }, 300_000);

  it('keeps a newer save from another tab at the id when a page left its edit unsaved, and says a copy was kept', async () => {
    // The reviewer's sequence: tab A edits and is closed at once; tab B saves later; tab A is opened again.
    const { store, name, build } = await childWithBuild();
    store.close();
    const tabA = await openSavePage(name);
    const tabB = await openSavePage(name);
    tabA.rename('A edit, tab closed at once');
    tabA.close();
    tabB.rename('B edit, saved later');
    tabB.save();
    await vi.waitFor(() => expect([SAVE_LINES.saved, SAVE_LINES.keptCopy]).toContain(tabB.status()), SOON);

    const again = await openSavePage(name);
    // The newer build opens, at its id, and A's edit is kept as a copy of it, once. Whichever saw the two versions meet,
    // B's save (when A's had landed as its page went) or A's opening (when it had not), says a copy was kept.
    await vi.waitFor(() => expect(again.name()).toBe('B edit, saved later'), SOON);
    expect([again.status(), tabB.status()]).toContain(SAVE_LINES.keptCopy);
    const reader = await openStore({ name });
    try {
      const builds = await reader.forProfile((await reader.profiles.list())[0]?.id ?? '').blueprints.list();
      expect(builds.map(({ id, name: built, keptFrom }) => ({ id: id === build.meta.id ? 'the build' : 'a copy', built, keptFrom }))).toEqual([
        { id: 'the build', built: 'B edit, saved later', keptFrom: undefined },
        { id: 'a copy', built: 'A edit, tab closed at once', keptFrom: build.meta.id },
      ]);
    } finally {
      reader.close();
    }
    expect(Object.keys(localStorage).filter((item) => item.startsWith(`${UNSAVED_PREFIX}${name}:`))).toEqual([]);
  }, 300_000);
});

describe('the app page', () => {
  /** How long an app page may take to start: it loads every module and starts WebGL, which a busy machine slows a lot. */
  const BOOT = { timeout: 90_000, interval: 50 };

  /** The real app in a frame, on the database `name`, its storage blocked or full when asked. A reload starts the page and every module again. */
  const openPage = async (name: string, storage?: string) => {
    const frame = document.createElement('iframe');
    frame.title = 'Servo';
    frame.style.cssText = 'position: fixed; left: 0; top: 0; width: 1180px; height: 820px; border: 0;';
    frame.src = `/test/browser/store-page.html?store=${encodeURIComponent(name)}${storage ? `&${storage}` : ''}`;
    document.body.appendChild(frame);
    cleanups.push(() => frame.remove());
    const header = (): HTMLElement => {
      const found = frame.contentDocument?.querySelector<HTMLElement>('[data-region="header"]');
      if (!found) throw new Error('no header');
      return found;
    };
    const ready = () =>
      vi.waitFor(() => {
        if (!frame.contentDocument?.querySelector('[data-region="stage"] canvas')) throw new Error('the app has not mounted yet');
        header();
      }, BOOT);
    await ready();
    return {
      name: () => header().querySelector('button.shell-blueprint-name')?.textContent ?? null,
      status: () => header().querySelector('[role="status"]')?.textContent ?? '',
      save: () => ([...header().querySelectorAll('button')].find((button) => button.textContent === 'Save') as HTMLButtonElement).click(),
      saveDisabled: () => ([...header().querySelectorAll('button')].find((button) => button.textContent === 'Save') as HTMLButtonElement).disabled,
      dialogs: () => frame.contentDocument?.querySelectorAll('dialog, [role="dialog"], [role="alertdialog"]').length ?? 0,
      reload: async () => {
        const loaded = new Promise((resolve) => frame.addEventListener('load', resolve, { once: true }));
        frame.contentWindow?.location.reload();
        await loaded;
        await ready();
      },
      close: () => frame.remove(),
    };
  };

  /** What the database holds, read from outside the page: the profiles, the one profile's builds, and its first build. */
  const stored = async (name: string) => {
    const reader = await openStore({ name });
    try {
      const profiles = await reader.profiles.list();
      const kid = reader.forProfile(profiles[0]?.id ?? '');
      const builds = await kid.blueprints.list();
      const loaded = await kid.blueprints.load(builds[0]?.id ?? '');
      if (!loaded.ok) throw new Error('not loaded');
      return { profiles, builds, build: loaded.blueprint };
    } finally {
      reader.close();
    }
  };

  it('makes one "Builder 1" with an empty "Build 1" on its first run, and keeps what it saved across a real reload', async () => {
    const name = databaseName();
    cleanups.push(() => Dexie.delete(name));
    // Two tabs opening at once on the first run still make one profile and one build.
    const [page, other] = await Promise.all([openPage(name), openPage(name)]);
    await vi.waitFor(() => expect(page.name()).toBe('Build 1'), SOON);
    await vi.waitFor(() => expect(other.name()).toBe('Build 1'), SOON);
    other.close();

    page.save();
    await vi.waitFor(() => expect(page.status()).toBe(SAVE_LINES.saved), SOON);
    const before = await stored(name);
    expect(before.profiles.map((profile) => profile.name)).toEqual(['Builder 1']);
    expect(before.profiles[0]?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(before.builds.map(({ name: built, level }) => ({ built, level }))).toEqual([{ built: 'Build 1', level: 1 }]);
    expect(before.build).toMatchObject({ parts: [], wires: [], arena: { preset: 'open-floor', props: [] } });

    await page.reload();
    // The page and its memory started again: what the app wrote before the reload comes back from IndexedDB, and
    // nothing is made a second time.
    await vi.waitFor(() => expect(page.name()).toBe('Build 1'), SOON);
    expect(page.status()).toBe('');
    page.save();
    await vi.waitFor(() => expect(page.status()).toBe(SAVE_LINES.saved), SOON);
    const after = await stored(name);
    expect(after.profiles).toEqual(before.profiles);
    expect(after.builds.map((summary) => summary.id)).toEqual(before.builds.map((summary) => summary.id));
    expect(after.build.meta.updatedAt >= before.build.meta.updatedAt).toBe(true);
    expect(serializeBlueprint(after.build)).toBe(serializeBlueprint({ ...before.build, meta: { ...before.build.meta, updatedAt: after.build.meta.updatedAt } }));
  }, 300_000);
  it.each([
    ['blocked', 'opening IndexedDB throws, as when site data is blocked'],
    ['full', 'every write throws a quota error, so the first profile cannot be made'],
  ])('lets the child build on, unsaved, with a line saying so, when storage is %s: %s', async (mode) => {
    const name = databaseName();
    cleanups.push(() => Dexie.delete(name));
    const page = await openPage(name, mode);
    // An empty build to work on, kept only in the page, and one plain line.
    await vi.waitFor(() => expect(page.name()).toBe('Build 1'), SOON);
    expect(page.status()).toBe(SAVE_LINES.notKept);
    expect(page.saveDisabled()).toBe(true);
    expect(page.dialogs()).toBe(0);
  }, 300_000);
});
