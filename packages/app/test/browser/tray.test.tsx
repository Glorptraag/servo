// The part tray and the Parts Library (task 4.2) in the shell, round the real canvas: the tray shows exactly the
// kit's parts by family; a tile places its part by touch and by pointer, dragged or tap-then-tap, through the canvas's
// own placement; the keyboard and screen-reader path lists the places `listView.placementsFor` offers (D84); a part
// dragged back to the tray is removed; the library opens over the canvas with working family and domain filters,
// and before Level 3 nothing drags out of it.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cdp, userEvent } from 'vitest/browser';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { mountCanvas } from '@servo/canvas';
import type { CanvasHandle, EditEvent, PlacementEvent } from '@servo/canvas';
import { probeCanvas } from '@servo/canvas/testing';
import { loadContent } from '@servo/content';
import { BLUEPRINT_VERSION } from '@servo/schema';
import type { Blueprint, Kit, Level, Vec2 } from '@servo/schema';
import { LIBRARY_TITLE, domainOptions, familyOptions } from '../../src/library/index.ts';
import { DEFAULT_PREFS, Shell, useShell } from '../../src/shell/index.ts';
import type { ShellApi } from '../../src/shell/index.ts';
import { Tray, kitForLevel, trayGroups } from '../../src/tray/index.ts';

const { content } = loadContent();
const kitAt = (level: Level): Kit => {
  const kit = kitForLevel(content.kits, level);
  if (!kit) throw new Error(`no kit at Level ${level}`);
  return kit;
};

const emptyBuild = (level: Level): Blueprint => ({
  version: BLUEPRINT_VERSION,
  parts: [],
  wires: [],
  arena: { preset: 'open-floor', props: [] },
  meta: { id: '00000000-0000-4000-8000-000000000042', name: 'Tray test', level, createdAt: '2026-10-03T00:00:00.000Z', updatedAt: '2026-10-03T00:00:00.000Z', highWater: { parts: 0, wires: 0 } },
});

interface Mounted {
  readonly host: HTMLElement;
  readonly canvas: CanvasHandle;
  readonly shell: ShellApi;
  readonly edits: EditEvent[];
  readonly placements: PlacementEvent[];
  tile(part: string): HTMLButtonElement;
  tiles(): string[];
  /** A point on the canvas clear of every panel, in page coordinates. */
  readonly open: Vec2;
}

const roots: { root: Root; host: HTMLElement }[] = [];

beforeAll(() => cdp().send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }));
afterAll(() => cdp().send('Emulation.setEmulatedMedia', { features: [] }));
afterEach(() => {
  for (const { root, host } of roots.splice(0)) {
    root.unmount();
    host.remove();
  }
});

const mountTray = async (level: Level = 1, size = { width: 1180, height: 820 }): Promise<Mounted> => {
  const host = document.createElement('div');
  host.style.cssText = `position: fixed; left: 0; top: 0; width: ${size.width}px; height: ${size.height}px;`;
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push({ root, host });
  let handle: CanvasHandle | undefined;
  let latest: ShellApi | null = null;
  const Probe = () => {
    latest = useShell();
    return null;
  };
  const edits: EditEvent[] = [];
  const placements: PlacementEvent[] = [];
  flushSync(() =>
    root.render(
      <Shell
        content={content}
        level={level}
        kit={kitAt(level)}
        storage={null}
        start={emptyBuild(level)}
        slots={{ tray: <Tray />, sound: <Probe /> }}
        mountCanvas={(element, setup) => {
          handle = mountCanvas(element, { catalogue: content.catalogue, resolveArt: (key) => content.art.get(key), level: setup.level, prefs: setup.prefs });
          handle.on('edit', (event) => edits.push(event));
          handle.on('placement', (event) => placements.push(event));
          return handle;
        }}
      />,
    ),
  );
  await vi.waitFor(() => {
    if (!latest?.canvas || !handle?.blueprint) throw new Error('the canvas is not up yet');
  });
  if (!handle) throw new Error('no canvas');
  await probeCanvas(handle).ready;
  const canvas = handle;
  const tray = host.querySelector<HTMLElement>('[data-region="tray"]');
  if (!tray) throw new Error('no tray');
  const box = tray.getBoundingClientRect();
  const portrait = size.height > size.width;
  return {
    host,
    canvas,
    get shell(): ShellApi {
      if (!latest) throw new Error('no shell');
      return latest;
    },
    edits,
    placements,
    tile: (part) => {
      const found = tray.querySelector<HTMLButtonElement>(`button[data-part="${part}"]`);
      if (!found) throw new Error(`no tile for ${part}`);
      return found;
    },
    tiles: () => [...tray.querySelectorAll<HTMLElement>('button[data-part]')].map((tile) => tile.dataset.part ?? ''),
    open: portrait ? { x: size.width / 2, y: box.top / 2 + 40 } : { x: box.right + (size.width - box.right - 80) / 2, y: size.height / 2 },
  };
};

// Real input through the Chrome DevTools Protocol: trusted touch and mouse events, as a hand or a mouse sends them.
type Hand = 'touch' | 'mouse';

const offset = (): Vec2 => {
  const frame = window.frameElement?.getBoundingClientRect();
  return { x: frame?.left ?? 0, y: frame?.top ?? 0 };
};

const send = async (hand: Hand, phase: 'down' | 'move' | 'up', at: Vec2): Promise<void> => {
  const point = { x: offset().x + at.x, y: offset().y + at.y };
  if (hand === 'mouse') {
    const type = phase === 'down' ? 'mousePressed' : phase === 'up' ? 'mouseReleased' : 'mouseMoved';
    await cdp().send('Input.dispatchMouseEvent', { type, ...point, button: 'left', buttons: phase === 'up' ? 0 : 1, clickCount: phase === 'move' ? 0 : 1 });
    return;
  }
  const type = phase === 'down' ? 'touchStart' : phase === 'up' ? 'touchEnd' : 'touchMove';
  await cdp().send('Input.dispatchTouchEvent', { type, touchPoints: phase === 'up' ? [] : [{ ...point, id: 0 }] });
};

const middleOf = (element: Element): Vec2 => {
  const box = element.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
};

const tap = async (hand: Hand, at: Vec2): Promise<void> => {
  await send(hand, 'down', at);
  await send(hand, 'up', at);
};

const drag = async (hand: Hand, from: Vec2, to: Vec2, steps = 8): Promise<void> => {
  await send(hand, 'down', from);
  for (let i = 1; i <= steps; i++) await send(hand, 'move', { x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps });
  // The finger rests before it lifts. A finger lifted while moving flings whatever the browser was scrolling, and a
  // tap during a fling only stops it: in CI the next test's first tap on the Library button did nothing.
  await new Promise((resolve) => setTimeout(resolve, 120));
  await send(hand, 'move', to);
  await send(hand, 'up', to);
};

const placedTypes = (canvas: CanvasHandle): string[] => (canvas.blueprint?.parts ?? []).map((part) => part.part);

describe('the part tray', () => {
  for (const level of [1, 2] as const) {
    it(`shows exactly the Level ${level} kit's parts, as big tiles grouped by family`, async () => {
      const app = await mountTray(level);
      const kit = kitAt(level);
      const groups = trayGroups(kit, content.catalogue);
      expect(app.tiles()).toEqual(groups.flatMap((group) => group.tiles.map((tile) => tile.part)));
      expect(app.tiles().sort()).toEqual(kit.parts.map((entry) => entry.part).sort());
      const sections = [...app.host.querySelectorAll<HTMLElement>('[data-region="tray"] section[data-family]')];
      expect(sections.map((section) => section.dataset.family)).toEqual(groups.map((group) => group.family));
      for (const [index, section] of sections.entries()) {
        const group = groups[index];
        expect(section.querySelector('h3')?.textContent).toBe(group?.label);
        // The section is named by its family, for screen readers.
        const label = app.host.ownerDocument.getElementById(section.getAttribute('aria-labelledby') ?? '');
        expect(label?.textContent).toBe(group?.label);
        expect([...section.querySelectorAll<HTMLElement>('button[data-part]')].map((tile) => tile.dataset.part)).toEqual(group?.tiles.map((tile) => tile.part));
      }
      for (const entry of kit.parts) {
        const tile = app.tile(entry.part);
        const record = content.catalogue.parts.get(entry.part);
        const box = tile.getBoundingClientRect();
        expect(box.width, entry.part).toBeGreaterThanOrEqual(80);
        expect(box.height, entry.part).toBeGreaterThanOrEqual(72);
        expect(tile.textContent?.toLowerCase()).toContain(record?.identity.name.toLowerCase());
        expect(tile.getAttribute('aria-label')).toMatch(new RegExp(`, ${entry.quantity} in the kit$`));
        expect(tile.textContent).not.toMatch(/!/);
      }
      // Never selectable, so a mouse drag never selects text and starts a native drag (G3).
      const tray = app.host.querySelector<HTMLElement>('.tray');
      expect(tray && getComputedStyle(tray).userSelect).toBe('none');
      // A drag across the tray is the tray's (it carries the part); only a drag along it scrolls, so a sideways swipe
      // never reaches the page, which a touch browser can read as Back.
      expect(tray && getComputedStyle(tray).touchAction).toBe('pan-y');
      expect(getComputedStyle(app.tile(kit.parts[0]?.part ?? '')).touchAction).toBe('pan-y');
      for (const picture of app.host.querySelectorAll<HTMLImageElement>('.tray img')) expect(picture.draggable).toBe(false);
    });
  }

  it('lays the tiles along the bottom edge in portrait, in a row', async () => {
    const app = await mountTray(1, { width: 820, height: 1180 });
    const tray = app.host.querySelector<HTMLElement>('.tray');
    expect(tray && getComputedStyle(tray).touchAction).toBe('pan-x');
    expect(getComputedStyle(app.tile('chassis')).touchAction).toBe('pan-x');
    const boxes = app.tiles().map((part) => app.tile(part).getBoundingClientRect());
    for (const [index, box] of boxes.entries()) {
      expect(box.top).toBeGreaterThanOrEqual(1180 - 112);
      if (index > 0) expect(box.left).toBeGreaterThan(boxes[index - 1]?.left ?? 0);
    }
  });

  for (const hand of ['touch', 'mouse'] as const) {
    it(`places a part by ${hand}, tap-then-tap, and a second tap on the tile lets it go`, async () => {
      const app = await mountTray(1);
      const tile = app.tile('chassis');
      await tap(hand, middleOf(tile));
      await vi.waitFor(() => expect(tile.getAttribute('aria-pressed')).toBe('true'));
      await tap(hand, app.open);
      await vi.waitFor(() => expect(placedTypes(app.canvas)).toEqual(['chassis']));
      await vi.waitFor(() => expect(tile.getAttribute('aria-pressed')).toBe('false'));
      expect(app.placements.at(-1)).toEqual({ kind: 'part', part: 'chassis', placed: true });

      const caster = app.tile('caster');
      await tap(hand, middleOf(caster));
      await vi.waitFor(() => expect(caster.getAttribute('aria-pressed')).toBe('true'));
      await tap(hand, middleOf(caster));
      await vi.waitFor(() => expect(caster.getAttribute('aria-pressed')).toBe('false'));
      expect(app.placements.at(-1)).toEqual({ kind: 'part', part: 'caster', placed: false });
      expect(placedTypes(app.canvas)).toEqual(['chassis']);
    });

    it(`places a part by ${hand}, dragged from its tile onto the canvas`, async () => {
      const app = await mountTray(1);
      await drag(hand, middleOf(app.tile('battery-pack-2-cell')), app.open);
      await vi.waitFor(() => expect(placedTypes(app.canvas)).toEqual(['battery-pack-2-cell']));
      expect(app.placements).toEqual([{ kind: 'part', part: 'battery-pack-2-cell', placed: true }]);
      expect(app.edits.map((edit) => edit.command.kind)).toEqual(['place-part']);
      expect(app.tile('battery-pack-2-cell').getAttribute('aria-pressed')).toBe('false');
    });

    it(`removes a part dragged back to the tray by ${hand}`, async () => {
      const app = await mountTray(1);
      await drag(hand, middleOf(app.tile('switch')), app.open);
      await vi.waitFor(() => expect(placedTypes(app.canvas)).toEqual(['switch']));
      const placed = probeCanvas(app.canvas).part('p1');
      if (!placed) throw new Error('the switch is not drawn');
      const tray = app.host.querySelector('[data-region="tray"]');
      if (!tray) throw new Error('no tray');
      await drag(hand, placed.centre.page, { x: middleOf(tray).x, y: 600 });
      await vi.waitFor(() => expect(placedTypes(app.canvas)).toEqual([]));
    });
  }

  it('offers the keyboard and screen readers the places the list view gives, and places through them (D84)', async () => {
    const app = await mountTray(1);
    const chassis = app.tile('chassis');
    chassis.focus();
    await userEvent.keyboard('{Enter}');
    const dialog = await vi.waitFor(() => {
      const found = app.host.querySelector<HTMLDialogElement>('dialog.tray-places');
      if (!found?.open) throw new Error('no places');
      return found;
    });
    expect(dialog.querySelector('h2')?.textContent).toBe('Where the chassis can go');
    const offered = [...dialog.querySelectorAll<HTMLButtonElement>('ul button')].map((button) => button.textContent);
    expect(offered).toEqual(app.canvas.listView.placementsFor('chassis').map((action) => action.label));
    expect(offered.length).toBeGreaterThan(0);
    // Focus lands in the list; Enter places.
    expect(dialog.contains(document.activeElement)).toBe(true);
    await userEvent.keyboard('{Enter}');
    await vi.waitFor(() => expect(placedTypes(app.canvas)).toEqual(['chassis']));
    await vi.waitFor(() => expect(document.activeElement).toBe(chassis));
    expect(app.host.querySelector('dialog.tray-places')).toBeNull();
    expect(app.host.querySelector('.tray [role="status"]')?.textContent).toBe('Placed the chassis.');

    // With the chassis down, a DC motor can go on a free mount point as well as the workbench.
    const motor = app.tile('dc-motor');
    motor.focus();
    await userEvent.keyboard(' ');
    const motorPlaces = await vi.waitFor(() => {
      const found = app.host.querySelector<HTMLDialogElement>('dialog.tray-places');
      if (!found?.open) throw new Error('no places');
      return found;
    });
    const actions = app.canvas.listView.placementsFor('dc-motor');
    expect(actions.length).toBeGreaterThan(1);
    const mountAction = actions.find((action) => action.does.kind === 'edit' && action.does.command.kind === 'place-part' && action.does.command.attach);
    if (!mountAction) throw new Error('no mount point offered');
    const button = [...motorPlaces.querySelectorAll<HTMLButtonElement>('ul button')].find((each) => each.textContent === mountAction.label);
    button?.click();
    await vi.waitFor(() => expect(placedTypes(app.canvas).sort()).toEqual(['chassis', 'dc-motor']));
    // The same command as the list view's, so the same bytes as touch and pointer give.
    expect(app.edits.at(-1)?.command).toEqual(mountAction.does.kind === 'edit' ? mountAction.does.command : undefined);

    // Escape closes the list without placing, and focus goes back to the tile.
    const caster = app.tile('caster');
    caster.focus();
    await userEvent.keyboard('{Enter}');
    await vi.waitFor(() => expect(app.host.querySelector<HTMLDialogElement>('dialog.tray-places')?.open).toBe(true));
    await userEvent.keyboard('{Escape}');
    await vi.waitFor(() => expect(app.host.querySelector('dialog.tray-places')).toBeNull());
    expect(document.activeElement).toBe(caster);
    expect(placedTypes(app.canvas).sort()).toEqual(['chassis', 'dc-motor']);
  });

  it('lets go of a waiting part and closes its lists when Run takes the tray away', async () => {
    const app = await mountTray(1);
    await tap('mouse', middleOf(app.tile('chassis')));
    await vi.waitFor(() => expect(app.tile('chassis').getAttribute('aria-pressed')).toBe('true'));
    flushSync(() => app.shell.setMode('run'));
    await vi.waitFor(() => expect(app.tile('chassis').getAttribute('aria-pressed')).toBe('false'));
    expect(app.host.querySelector<HTMLElement>('[data-region="tray"]')?.dataset.shown).toBe('false');
    flushSync(() => app.shell.setMode('build'));
    await tap('mouse', app.open);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(placedTypes(app.canvas)).toEqual([]);
  });
});

describe('the Parts Library', () => {
  const openLibrary = async (app: Mounted, step = 'first'): Promise<HTMLDialogElement> => {
    const button = [...app.host.querySelectorAll<HTMLButtonElement>('[data-region="tray"] button')].find((each) => each.textContent === 'Library');
    if (!button) throw new Error('no Library button');
    await tap('touch', middleOf(button));
    return vi.waitFor(() => {
      const found = app.host.querySelector<HTMLDialogElement>('dialog.library');
      if (!found?.open) throw new Error(`the library is not open (${step} tap)`);
      return found;
    });
  };
  /** Longer than a double tap, so a second tap on the Library button is a tap of its own, as a child's would be. */
  const pause = (): Promise<unknown> => new Promise((resolve) => setTimeout(resolve, 600));
  const cards = (dialog: HTMLElement): string[] => [...dialog.querySelectorAll<HTMLElement>('[data-part]')].map((card) => card.dataset.part ?? '').sort();
  const chip = (dialog: HTMLElement, label: string): HTMLInputElement => {
    const found = [...dialog.querySelectorAll<HTMLLabelElement>('label.library-chip')].find((each) => each.textContent === label)?.querySelector('input');
    if (!found) throw new Error(`no ${label} chip`);
    return found;
  };

  it('opens the whole catalogue over the canvas from the tray, on one shelf per family', async () => {
    const app = await mountTray(1);
    const dialog = await openLibrary(app);
    expect(dialog.querySelector('h2')?.textContent).toBe(LIBRARY_TITLE);
    expect(cards(dialog)).toEqual(content.parts.map((part) => part.id).sort());
    const box = dialog.getBoundingClientRect();
    expect(box.width).toBeGreaterThan(1180 * 0.8);
    expect(box.height).toBeGreaterThan(820 * 0.8);
    const shelves = [...dialog.querySelectorAll<HTMLElement>('section[data-family]')];
    expect(shelves.map((shelf) => shelf.dataset.family)).toEqual(familyOptions(content.parts).map((option) => option.id));
    expect(dialog.textContent).not.toMatch(/!/);
    // Every target is at least 44 px.
    for (const target of dialog.querySelectorAll<HTMLElement>('button, label.library-chip')) {
      const each = target.getBoundingClientRect();
      expect(each.height, target.textContent ?? '').toBeGreaterThanOrEqual(44);
    }
  });

  it('filters by family and by domain, together, by touch, pointer and keyboard', async () => {
    const app = await mountTray(1);
    const dialog = await openLibrary(app);
    const families = familyOptions(content.parts);
    const domains = domainOptions(content.parts);
    const count = (): string | null | undefined => dialog.querySelector('[role="status"]')?.textContent;
    expect(count()).toBe(`${content.parts.length} parts`);

    for (const family of families) {
      await tap('touch', middleOf(chip(dialog, family.label)));
      await vi.waitFor(() => expect(cards(dialog)).toEqual(content.parts.filter((part) => part.identity.family === family.id).map((part) => part.id).sort()));
    }
    await userEvent.click(chip(dialog, 'All families'));
    for (const domain of domains) {
      await userEvent.click(chip(dialog, domain.label));
      await vi.waitFor(() => expect(cards(dialog)).toEqual(content.parts.filter((part) => part.identity.domains.includes(domain.id)).map((part) => part.id).sort()));
    }
    // Both at once: a family and a domain that share no part show none, and say so.
    const pair = families.flatMap((family) => domains.map((domain) => ({ family, domain }))).find(({ family, domain }) => !content.parts.some((part) => part.identity.family === family.id && part.identity.domains.includes(domain.id)));
    if (pair) {
      await userEvent.click(chip(dialog, pair.family.label));
      await userEvent.click(chip(dialog, pair.domain.label));
      await vi.waitFor(() => expect(cards(dialog)).toEqual([]));
      expect(count()).toBe('No parts in this family and domain');
    }
    // The arrow keys move along a filter, as in any radio group.
    await userEvent.click(chip(dialog, 'All families'));
    await userEvent.click(chip(dialog, 'All domains'));
    chip(dialog, 'All families').focus();
    await userEvent.keyboard('{ArrowRight}');
    const first = families[0];
    if (!first) throw new Error('no family');
    await vi.waitFor(() => expect(cards(dialog)).toEqual(content.parts.filter((part) => part.identity.family === first.id).map((part) => part.id).sort()));
  });

  it('is browse-only before Level 3: nothing drags out of it onto the canvas', async () => {
    const app = await mountTray(2);
    const dialog = await openLibrary(app);
    const card = dialog.querySelector<HTMLElement>('[data-part]');
    if (!card) throw new Error('no card');
    expect(dialog.querySelectorAll('[data-part] button, [data-part][draggable="true"], [data-part] [draggable="true"]')).toHaveLength(0);
    // Not selectable either: a selection would be a native drag, which cancels the pointer (G3).
    expect(getComputedStyle(card).userSelect).toBe('none');
    // Only vertical scrolling is the browser's: a sideways swipe never reaches the page, where Chrome on a touch
    // screen reads it as Back (seen in CI, where it unloaded the test page).
    for (const each of [dialog, dialog.querySelector('.library-shelves')]) expect(each && getComputedStyle(each).touchAction).toBe('pan-y');
    const page = location.href;
    for (const hand of ['touch', 'mouse'] as const) {
      // Out past the overlay's edge, over the canvas, and well inside the page, so every release lands.
      await drag(hand, middleOf(card), { x: 1145, y: 400 });
      await drag(hand, middleOf(card), { x: middleOf(card).x + 300, y: middleOf(card).y });
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(app.placements).toEqual([]);
    expect(app.edits).toEqual([]);
    expect(placedTypes(app.canvas)).toEqual([]);
    expect(location.href).toBe(page);
  });

  it('closes with Close, Escape and Run, and gives focus back to the Library button', async () => {
    const app = await mountTray(1);
    const dialog = await openLibrary(app);
    const close = [...dialog.querySelectorAll<HTMLButtonElement>('button')].find((each) => each.textContent === 'Close');
    await userEvent.click(close as HTMLButtonElement);
    await vi.waitFor(() => expect(app.host.querySelector('dialog.library')).toBeNull());
    expect(document.activeElement?.textContent).toBe('Library');

    await pause();
    await openLibrary(app, 'second');
    await userEvent.keyboard('{Escape}');
    await vi.waitFor(() => expect(app.host.querySelector('dialog.library')).toBeNull());
    expect(document.activeElement?.textContent).toBe('Library');

    await pause();
    await openLibrary(app, 'third');
    flushSync(() => app.shell.setMode('run'));
    await vi.waitFor(() => expect(app.host.querySelector('dialog.library')).toBeNull());
    flushSync(() => app.shell.setMode('build'));
    expect(app.host.querySelector('dialog.library')).toBeNull();
  });
});

describe('the tray with prefs', () => {
  it('needs a longer drag at a lower drag sensitivity before the canvas carries the part', async () => {
    const app = await mountTray(1);
    flushSync(() => app.shell.setPrefs({ ...DEFAULT_PREFS, dragSensitivity: 0.25 }));
    const tile = app.tile('caster');
    const from = middleOf(tile);
    // 20 px is a drag at sensitivity 1 but not at 0.25 (32 px): it stays a tap.
    await send('mouse', 'down', from);
    await send('mouse', 'move', { x: from.x + 20, y: from.y });
    await send('mouse', 'up', { x: from.x + 20, y: from.y });
    await vi.waitFor(() => expect(tile.getAttribute('aria-pressed')).toBe('true'));
    expect(app.placements).toEqual([]);
  });
});
