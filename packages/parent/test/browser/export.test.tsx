// The parts-list export (task 5.3) in the parent view, in Chromium on its real IndexedDB: behind the gate, each build
// of the child in use opens its parts list in place, by pointer, by touch and by keyboard (ground rule 8), prints the
// list alone, and closes back to the button that opened it.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cdp, userEvent } from 'vitest/browser';
import { DATA_NOTE, openStore, telemetryOf } from '@servo/app/store';
import type { ServoStore } from '@servo/app/store';
import { loadFixtures } from '@servo/content/fixtures';
import type { Blueprint } from '@servo/schema';
import { PARENT_TEXT, mountParentWith } from '../../src/accounts/index.ts';
import { EXPORT_TEXT, LIST_TEXT } from '../../src/export/index.ts';
import type { ParentHandle } from '../../src/index.ts';

const fixture = (name: string): Blueprint => {
  const found = loadFixtures().fixtures.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`No fixture ${name}.`);
  return found.blueprint;
};

let mounted: { handle: ParentHandle; host: HTMLElement; store: ServoStore } | undefined;

afterEach(async () => {
  mounted?.handle.destroy();
  mounted?.host.remove();
  mounted?.store.close();
  mounted = undefined;
  vi.restoreAllMocks();
  await cdp().send('Emulation.setEmulatedMedia', { media: '' });
});

/** Robin, in use, with both kit robots; Sam with a Rolling Start robot of their own. */
const family = async () => {
  const store = await openStore({ name: `servo-parent-${crypto.randomUUID()}` });
  const robin = await store.profiles.create('Robin');
  await store.profiles.use(robin.id);
  const sam = await store.profiles.create('Sam');
  const keep = async (profile: string, name: string, kit: string) => {
    const load = await store.forProfile(profile).blueprints.copy(fixture(kit), name);
    if (!load.ok) throw new Error(`${kit} did not validate.`);
    return load.blueprint;
  };
  const roller = await keep(robin.id, 'Robin roller', 'kit-rolling-start');
  const bumper = await keep(robin.id, 'Robin bumper', 'kit-circuit-crew');
  const samRoller = await keep(sam.id, 'Sam roller', 'kit-rolling-start');
  return { store, robin, sam, roller, bumper, samRoller };
};

const mount = (store: ServoStore) => {
  const host = document.createElement('div');
  document.body.append(host);
  const handle = mountParentWith(host, store, { random: () => 0 });
  mounted = { handle, host, store };
  return host;
};

const byText = (host: HTMLElement, selector: string, text: string): HTMLElement => {
  const found = [...host.querySelectorAll<HTMLElement>(selector)].find((element) => element.textContent?.trim() === text);
  if (!found) throw new Error(`No ${selector} reads '${text}'.`);
  return found;
};

const opener = (host: HTMLElement, build: string): HTMLButtonElement => {
  const button = host.querySelector<HTMLButtonElement>(`button[aria-label="${EXPORT_TEXT.openFor(build)}"]`);
  if (!button) throw new Error(`No parts-list button for ${build}.`);
  return button;
};

const panel = (host: HTMLElement): HTMLElement | null => host.querySelector('section.servo-parts-list');
const heading = (host: HTMLElement): string | undefined => panel(host)?.querySelector('h3')?.textContent ?? undefined;
const rows = (host: HTMLElement): string[][] =>
  [...(panel(host)?.querySelectorAll('tbody tr') ?? [])].map((row) => [...row.children].map((cell) => cell.textContent ?? ''));

/** A tap with one finger, through the browser's own touch input, on the element scrolled to the middle of the page. */
const tap = async (element: Element): Promise<void> => {
  const before = element.getBoundingClientRect();
  window.scrollTo({ top: window.scrollY + before.top + before.height / 2 - window.innerHeight / 2, behavior: 'instant' });
  await expect
    .poll(() => {
      const box = element.getBoundingClientRect();
      return box.top >= 0 && box.bottom <= window.innerHeight;
    })
    .toBe(true);
  const frame = window.frameElement?.getBoundingClientRect();
  const scale = frame ? frame.width / window.innerWidth : 1;
  const box = element.getBoundingClientRect();
  const point = { x: (frame?.left ?? 0) + (box.left + box.width / 2) * scale, y: (frame?.top ?? 0) + (box.top + box.height / 2) * scale };
  await cdp().send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, id: 0 }] });
  await cdp().send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
};

const passGate = async (host: HTMLElement): Promise<void> => {
  await expect.poll(() => host.querySelector('input')).toBeTruthy();
  await userEvent.fill(host.querySelector('input') as HTMLInputElement, '72');
  await userEvent.click(byText(host, 'button', PARENT_TEXT.gateContinue));
  await expect.poll(() => host.querySelector('h1')?.textContent).toBe(PARENT_TEXT.title);
};

describe('the data note (task 6.2)', () => {
  it('closes the parent view behind the gate, as headings, paragraphs and lists, with every event it lists', async () => {
    const { store } = await family();
    const host = mount(store);
    await expect.poll(() => host.querySelector('input')).toBeTruthy();
    expect(host.textContent).not.toContain('What Servo keeps');
    await passGate(host);
    await expect.poll(() => host.querySelector('section[aria-labelledby="servo-parent-data-note"]')).toBeTruthy();
    const section = host.querySelector('section[aria-labelledby="servo-parent-data-note"]') as HTMLElement;
    expect(section.querySelector('h2')?.textContent).toBe('What Servo keeps');
    // Four events in plain words, with no code names (task 7.7).
    expect(section.querySelectorAll('li')).toHaveLength(4);
    expect(section.querySelector('code')).toBeNull();
    // Every word of docs/data-note.md, without its Markdown, in order.
    const words = (text: string) => text.replace(/^#+ |^- /gm, '').split(/\s+/).filter(Boolean);
    expect(words(section.innerText)).toEqual(words(DATA_NOTE));
    // Brief Section 13: it explains in one screen, at this project's 1180 by 820 viewport.
    expect(section.getBoundingClientRect().height).toBeLessThanOrEqual(window.innerHeight);
    expect(host.querySelector('main')?.lastElementChild?.previousElementSibling).toBe(section);
    expect(section.querySelector('button, input, a, [role="dialog"]')).toBeNull();
  });
});

describe('the parts list in the parent view', () => {
  it('is offered only behind the gate, and only for the child in use', async () => {
    const { store, roller, samRoller } = await family();
    const host = mount(store);
    await expect.poll(() => host.querySelector('input')).toBeTruthy();
    expect(host.querySelector('button[aria-label^="Parts list"]')).toBeNull();
    await passGate(host);
    await expect.poll(() => [...host.querySelectorAll('button[aria-label^="Parts list"]')].map((button) => button.getAttribute('aria-label'))).toEqual(
      expect.arrayContaining([EXPORT_TEXT.openFor('Robin roller'), EXPORT_TEXT.openFor('Robin bumper')]),
    );
    expect(host.querySelectorAll('button[aria-label^="Parts list"]')).toHaveLength(2);
    expect(host.textContent).not.toContain('Sam roller');
    for (const id of [roller.meta.id, samRoller.meta.id]) expect(host.innerHTML).not.toContain(id);
  });

  it('opens by pointer with every part once and its family, the wiring and the safety notes, and closes back to its button', async () => {
    const { store, roller, robin, sam } = await family();
    const host = mount(store);
    await passGate(host);
    await expect.poll(() => host.querySelector(`button[aria-label="${EXPORT_TEXT.openFor('Robin roller')}"]`)).toBeTruthy();

    await userEvent.click(opener(host, 'Robin roller'));
    await expect.poll(() => heading(host)).toBe(EXPORT_TEXT.title('Robin roller'));
    // The list made is one export event for Robin (task 6.2), and nothing for Sam.
    await expect.poll(async () => (await telemetryOf(store.forProfile(robin.id))).map((event) => [event.kind, 'what' in event ? event.what : ''])).toEqual([
      ['export', 'parts-list'],
    ]);
    expect(await telemetryOf(store.forProfile(sam.id))).toEqual([]);
    await expect.poll(() => document.activeElement).toBe(panel(host)?.querySelector('h3'));
    expect(opener(host, 'Robin roller').getAttribute('aria-expanded')).toBe('true');
    expect(rows(host)).toEqual([
      ['2-cell battery pack', 'Power', '1'],
      ['Switch', 'Power', '1'],
      ['DC motor', 'Actuators', '2'],
      ['Large wheel', 'Drivetrain', '2'],
      ['Caster', 'Structure & Ride', '1'],
      ['Chassis', 'Structure & Ride', '1'],
    ]);
    const wiring = [...(panel(host)?.querySelectorAll('ol li') ?? [])].map((item) => item.textContent);
    expect(wiring).toHaveLength(roller.wires.length);
    expect(wiring.filter((line) => line?.includes(LIST_TEXT.marker))).toHaveLength(2);
    // The real-kit notes are not numbered steps: they sit in their own list, after the connections.
    const notes = [...(panel(host)?.querySelectorAll('ul.servo-real-kit li') ?? [])].map((item) => item.textContent);
    expect(notes).toContain(LIST_TEXT.alreadyCrossed('DC motor (right motor mount)', 'plus (+)', 'minus (−)'));
    expect(notes).toContain(LIST_TEXT.adult);
    expect(panel(host)?.querySelector('ol .servo-real-kit, ol li ul')).toBeNull();
    expect(byText(panel(host) as HTMLElement, 'h4', EXPORT_TEXT.realKit).compareDocumentPosition(panel(host)?.querySelector('ol') as Node)).toBe(
      Node.DOCUMENT_POSITION_PRECEDING,
    );
    expect(panel(host)?.textContent).toContain('Use real battery packs only with an adult nearby');
    expect(document.querySelector('dialog, [role="dialog"], [role="alertdialog"]')).toBeNull();
    expect(host.textContent).not.toContain('!');
    expect(host.innerHTML).not.toContain(roller.meta.id);

    await userEvent.click(byText(panel(host) as HTMLElement, 'button', EXPORT_TEXT.close));
    await expect.poll(() => panel(host)).toBeNull();
    expect(document.activeElement).toBe(opener(host, 'Robin roller'));
  });

  it('opens and closes by touch', async () => {
    const { store } = await family();
    const host = mount(store);
    await passGate(host);
    await expect.poll(() => host.querySelector(`button[aria-label="${EXPORT_TEXT.openFor('Robin bumper')}"]`)).toBeTruthy();

    await tap(opener(host, 'Robin bumper'));
    await expect.poll(() => heading(host)).toBe(EXPORT_TEXT.title('Robin bumper'));
    expect(rows(host).map(([name]) => name)).toEqual(['2-cell battery pack', 'Motor driver', 'Switch', 'Bumper switch', 'DC motor', 'Large wheel', 'Caster', 'Chassis', 'Buzzer', 'LED']);
    // Focus moves to the list's heading, which scrolls the page; then the adult taps Close.
    await expect.poll(() => document.activeElement).toBe(panel(host)?.querySelector('h3'));
    await tap(byText(panel(host) as HTMLElement, 'button', EXPORT_TEXT.close));
    await expect.poll(() => panel(host)).toBeNull();
    expect(document.activeElement).toBe(opener(host, 'Robin bumper'));
  });

  it('opens with Enter, closes with Escape back to its button, and switches build with Space', async () => {
    const { store } = await family();
    const host = mount(store);
    await passGate(host);
    await expect.poll(() => host.querySelector(`button[aria-label="${EXPORT_TEXT.openFor('Robin roller')}"]`)).toBeTruthy();

    opener(host, 'Robin roller').focus();
    await userEvent.keyboard('{Enter}');
    await expect.poll(() => heading(host)).toBe(EXPORT_TEXT.title('Robin roller'));
    await expect.poll(() => document.activeElement).toBe(panel(host)?.querySelector('h3'));
    await userEvent.keyboard('{Escape}');
    await expect.poll(() => panel(host)).toBeNull();
    expect(document.activeElement).toBe(opener(host, 'Robin roller'));

    opener(host, 'Robin bumper').focus();
    await userEvent.keyboard(' ');
    await expect.poll(() => heading(host)).toBe(EXPORT_TEXT.title('Robin bumper'));
    await expect.poll(() => document.activeElement).toBe(panel(host)?.querySelector('h3'));
    // Tab reaches Print and Close inside the list, and Enter on Close closes it.
    await userEvent.tab();
    expect(document.activeElement?.textContent).toBe(EXPORT_TEXT.print);
    await userEvent.tab();
    expect(document.activeElement?.textContent).toBe(EXPORT_TEXT.close);
    await userEvent.keyboard('{Enter}');
    await expect.poll(() => panel(host)).toBeNull();
    expect(document.activeElement).toBe(opener(host, 'Robin bumper'));
  });

  it('prints with the browser’s own print, and on paper shows the list alone, without its buttons', async () => {
    const { store } = await family();
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const host = mount(store);
    await passGate(host);
    await expect.poll(() => host.querySelector(`button[aria-label="${EXPORT_TEXT.openFor('Robin roller')}"]`)).toBeTruthy();
    await userEvent.click(opener(host, 'Robin roller'));
    await expect.poll(() => heading(host)).toBe(EXPORT_TEXT.title('Robin roller'));

    await userEvent.click(byText(panel(host) as HTMLElement, 'button', EXPORT_TEXT.print));
    expect(print).toHaveBeenCalledTimes(1);

    const printButton = byText(panel(host) as HTMLElement, 'button', EXPORT_TEXT.print);
    expect(printButton.checkVisibility()).toBe(true);
    await cdp().send('Emulation.setEmulatedMedia', { media: 'print' });
    await expect.poll(() => printButton.checkVisibility()).toBe(false);
    expect(byText(panel(host) as HTMLElement, 'button', EXPORT_TEXT.close).checkVisibility()).toBe(false);
    // The rest of the page takes no room on paper, so no blank pages print.
    expect((host.querySelector('h1') as HTMLElement).checkVisibility()).toBe(false);
    expect(getComputedStyle(host.querySelector('h1') as HTMLElement).display).toBe('none');
    expect(opener(host, 'Robin roller').checkVisibility()).toBe(false);
    expect((panel(host)?.querySelector('h3') as HTMLElement).checkVisibility()).toBe(true);
    expect((panel(host)?.querySelector('tbody td') as HTMLElement).checkVisibility()).toBe(true);
    expect((panel(host)?.querySelector('ul.servo-real-kit li') as HTMLElement).checkVisibility()).toBe(true);

    // Once the list is closed, printing the page prints the page.
    await cdp().send('Emulation.setEmulatedMedia', { media: '' });
    await userEvent.click(byText(panel(host) as HTMLElement, 'button', EXPORT_TEXT.close));
    await expect.poll(() => panel(host)).toBeNull();
    await cdp().send('Emulation.setEmulatedMedia', { media: 'print' });
    await expect.poll(() => matchMedia('print').matches).toBe(true);
    expect((host.querySelector('h1') as HTMLElement).checkVisibility()).toBe(true);
  });

  it('closes when the adult switches child, and says so in one line when a build cannot be opened', async () => {
    const { store, robin, roller } = await family();
    const host = mount(store);
    await passGate(host);
    await expect.poll(() => host.querySelector(`button[aria-label="${EXPORT_TEXT.openFor('Robin roller')}"]`)).toBeTruthy();
    await userEvent.click(opener(host, 'Robin roller'));
    await expect.poll(() => heading(host)).toBe(EXPORT_TEXT.title('Robin roller'));

    const sam = [...host.querySelectorAll('fieldset label')].find((label) => label.textContent === 'Sam')?.querySelector('input') as HTMLInputElement;
    await userEvent.click(sam);
    await expect.poll(() => host.querySelector(`button[aria-label="${EXPORT_TEXT.openFor('Sam roller')}"]`)).toBeTruthy();
    expect(panel(host)).toBeNull();

    const robinRadio = [...host.querySelectorAll('fieldset label')].find((label) => label.textContent === 'Robin')?.querySelector('input') as HTMLInputElement;
    await userEvent.click(robinRadio);
    await expect.poll(() => host.querySelector(`button[aria-label="${EXPORT_TEXT.openFor('Robin roller')}"]`)).toBeTruthy();
    // Gone from the store since the view last read it.
    await store.forProfile(robin.id).blueprints.remove(roller.meta.id);
    await userEvent.click(opener(host, 'Robin roller'));
    await expect.poll(() => host.textContent).toContain(EXPORT_TEXT.failed);
    expect(panel(host)).toBeNull();
  });
});
