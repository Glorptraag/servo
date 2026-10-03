// The parent view's accounts (task 5.1) in Chromium, on its real IndexedDB and localStorage: the parental gate shows
// nothing of any child, the profile switch shows only the chosen child's builds and is what the child's app opens, and
// nothing reaches the address. Each action is tried by pointer, by touch and by keyboard (ground rule 8).
import { afterEach, describe, expect, it } from 'vitest';
import { cdp, userEvent } from 'vitest/browser';
import { openStore } from '@servo/app/store';
import type { ServoStore } from '@servo/app/store';
import { PARENT_TEXT, mountParentWith } from '../../src/accounts/index.ts';
import type { ParentHandle } from '../../src/index.ts';

const plainFloor = (name: string) => ({ name, level: 1, arena: { preset: 'open-floor', props: [] } }) as const;


let mounted: { handle: ParentHandle; host: HTMLElement; store: ServoStore } | undefined;

afterEach(() => {
  mounted?.handle.destroy();
  mounted?.host.remove();
  mounted?.store.close();
  mounted = undefined;
});

/** Robin and Sam on a fresh database, each with a build; Robin is in use. */
const family = async () => {
  const name = `servo-parent-${crypto.randomUUID()}`;
  const store = await openStore({ name });
  const robin = await store.profiles.create('Robin');
  await store.profiles.use(robin.id);
  const sam = await store.profiles.create('Sam');
  const rocket = await store.forProfile(robin.id).blueprints.create(plainFloor('Robin rocket'));
  const sorter = await store.forProfile(sam.id).blueprints.create(plainFloor('Sam sorter'));
  return { store, name, robin, sam, rocket, sorter };
};

const mount = (store: ServoStore, random: () => number = () => 0) => {
  const host = document.createElement('div');
  document.body.append(host);
  const handle = mountParentWith(host, store, { random });
  mounted = { handle, host, store };
  return host;
};

const byText = (host: HTMLElement, selector: string, text: string): HTMLElement => {
  const found = [...host.querySelectorAll<HTMLElement>(selector)].find((element) => element.textContent?.trim() === text);
  if (!found) throw new Error(`No ${selector} reads '${text}'.`);
  return found;
};

const radioFor = (host: HTMLElement, name: string): HTMLInputElement => {
  const label = byText(host, 'label', name);
  const radio = label.querySelector<HTMLInputElement>('input[type="radio"]');
  if (!radio) throw new Error(`No radio for ${name}.`);
  return radio;
};

const buildsShown = (host: HTMLElement): string[] =>
  [...host.querySelectorAll('section[aria-labelledby="servo-parent-builds"] li')].map((item) => item.textContent?.split(',')[0] ?? '');

/** A tap with one finger, through the browser's own touch input. */
const tap = async (element: Element): Promise<void> => {
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

describe('the parental gate (D28)', () => {
  it('shows nothing of any child, and reads no profile, until an adult answers', async () => {
    const { store, robin, sam } = await family();
    let reads = 0;
    const list = store.profiles.list.bind(store.profiles);
    const inUse = store.profiles.inUse.bind(store.profiles);
    Object.assign(store.profiles, {
      list: () => (reads++, list()),
      inUse: () => (reads++, inUse()),
    });
    // 6 × 12 first, then 9 × 19 after a wrong answer.
    let random = 0;
    const host = mount(store, () => random);
    await expect.poll(() => host.textContent).toContain('What is 6 × 12?');
    random = 0.99;
    await userEvent.fill(host.querySelector('input') as HTMLInputElement, '71');
    await userEvent.keyboard('{Enter}');
    await expect.poll(() => host.textContent).toContain(PARENT_TEXT.gateWrong);
    expect(host.textContent).toContain('What is 9 × 19?');
    for (const text of ['Robin', 'Sam', 'Robin rocket', robin.id, sam.id]) expect(host.innerHTML).not.toContain(text);
    expect(reads).toBe(0);

    await userEvent.fill(host.querySelector('input') as HTMLInputElement, '171');
    await userEvent.keyboard('{Enter}');
    await expect.poll(() => host.querySelector('h1')?.textContent).toBe(PARENT_TEXT.title);
    expect(reads).toBeGreaterThan(0);
  });
});

describe('the profile switch', () => {
  it('shows only the chosen child’s builds, makes that child the one in use, and writes nothing to the address', async () => {
    const { store, robin, sam, rocket, sorter } = await family();
    const address = window.location.href;
    const history = window.history.length;
    const host = mount(store);
    await passGate(host);

    await expect.poll(() => buildsShown(host)).toEqual(['Robin rocket']);
    expect(radioFor(host, 'Robin').checked).toBe(true);
    expect(host.textContent).not.toContain('Sam sorter');

    // Pointer.
    await userEvent.click(radioFor(host, 'Sam'));
    await expect.poll(() => buildsShown(host)).toEqual(['Sam sorter']);
    expect(host.textContent).not.toContain('Robin rocket');
    expect((await store.profiles.inUse())?.id).toBe(sam.id);

    // Touch.
    await tap(radioFor(host, 'Robin'));
    await expect.poll(() => buildsShown(host)).toEqual(['Robin rocket']);
    expect((await store.profiles.inUse())?.id).toBe(robin.id);

    // Keyboard: arrows move through the radio group.
    radioFor(host, 'Robin').focus();
    await userEvent.keyboard('{ArrowDown}');
    await expect.poll(() => buildsShown(host)).toEqual(['Sam sorter']);
    expect((await store.profiles.inUse())?.id).toBe(sam.id);
    expect(document.activeElement).toBe(radioFor(host, 'Sam'));

    // No profile or build id is on the page, and nothing reached the address or the history.
    for (const id of [robin.id, sam.id, rocket.meta.id, sorter.meta.id]) expect(host.innerHTML).not.toContain(id);
    expect(window.location.href).toBe(address);
    expect(window.history.length).toBe(history);
    expect(host.textContent).not.toContain('!');
  });

  it('adds and renames a child, and the child in use stays in use', async () => {
    const { store, robin } = await family();
    const host = mount(store);
    await passGate(host);

    await userEvent.fill(host.querySelector('#servo-parent-add') as HTMLInputElement, '  Ari  ');
    await userEvent.click(byText(host, 'button', PARENT_TEXT.add));
    await expect.poll(() => [...host.querySelectorAll('fieldset label')].map((label) => label.textContent)).toEqual(['Robin', 'Sam', 'Ari']);
    expect(radioFor(host, 'Robin').checked).toBe(true);
    expect((await store.profiles.inUse())?.id).toBe(robin.id);

    await userEvent.fill(host.querySelector('#servo-parent-add') as HTMLInputElement, '   ');
    await userEvent.click(byText(host, 'button', PARENT_TEXT.add));
    await expect.poll(() => host.textContent).toContain('A name is 1 to 60 characters.');
    expect(await store.profiles.list()).toHaveLength(3);

    await userEvent.click(host.querySelector('button[aria-label="Rename Sam"]') as HTMLElement);
    await userEvent.fill(host.querySelector('#servo-parent-name-1') as HTMLInputElement, 'Samira');
    await userEvent.keyboard('{Enter}');
    await expect.poll(async () => (await store.profiles.list()).map((profile) => profile.name)).toEqual(['Robin', 'Samira', 'Ari']);
    await expect.poll(() => host.querySelector('#servo-parent-name-1')).toBeNull();

    // Escape leaves the name as it was.
    await userEvent.click(host.querySelector('button[aria-label="Rename Ari"]') as HTMLElement);
    await userEvent.fill(host.querySelector('#servo-parent-name-2') as HTMLInputElement, 'Nobody');
    await userEvent.keyboard('{Escape}');
    await expect.poll(() => host.querySelector('#servo-parent-name-2')).toBeNull();
    expect((await store.profiles.list()).map((profile) => profile.name)).toEqual(['Robin', 'Samira', 'Ari']);
  });

  it('removes a child only once the adult confirms, inline, with their builds and their unsaved notes', async () => {
    const { store, name, robin, sam, rocket, sorter } = await family();
    const page = crypto.randomUUID();
    const note = (database: string, profile: string) => [`servo.unsaved:${database}:${page}:${profile} ${rocket.meta.id}`, JSON.stringify({ profile })] as const;
    const robinsNote = note(name, robin.id);
    const samsNote = note(name, sam.id);
    const otherDatabase = note('servo-elsewhere', robin.id);
    const host = mount(store);
    await passGate(host);

    await userEvent.click(host.querySelector('button[aria-label="Remove Robin"]') as HTMLElement);
    await expect.poll(() => host.textContent).toContain('Remove Robin from this device?');
    expect(document.querySelector('dialog, [role="dialog"], [role="alertdialog"]')).toBeNull();
    await userEvent.click(byText(host, 'button', PARENT_TEXT.keep));
    await expect.poll(() => host.textContent).not.toContain('Remove Robin from this device?');
    expect(await store.profiles.list()).toHaveLength(2);

    // Builds the app's journal noted for Robin go with Robin; Sam's, and another database's, stay.
    for (const item of [robinsNote, samsNote, otherDatabase]) localStorage.setItem(...item);
    await tap(host.querySelector('button[aria-label="Remove Robin"]') as HTMLElement);
    await expect.poll(() => host.textContent).toContain('Remove Robin from this device?');
    await tap(byText(host, 'button', PARENT_TEXT.removeConfirm));
    await expect.poll(() => [...host.querySelectorAll('fieldset label')].map((label) => label.textContent)).toEqual(['Sam']);

    // Sam is the only child now, so Sam is in use, and only Sam's build shows.
    expect(radioFor(host, 'Sam').checked).toBe(true);
    await expect.poll(() => buildsShown(host)).toEqual(['Sam sorter']);
    expect(await store.forProfile(robin.id).blueprints.list()).toEqual([]);
    await expect(store.forProfile(robin.id).blueprints.load(rocket.meta.id)).rejects.toThrow();
    expect((await store.forProfile(sam.id).blueprints.load(sorter.meta.id)).ok).toBe(true);
    expect(localStorage.getItem(robinsNote[0])).toBeNull();
    expect(localStorage.getItem(samsNote[0])).toBe(samsNote[1]);
    expect(localStorage.getItem(otherDatabase[0])).toBe(otherDatabase[1]);
    for (const [item] of [samsNote, otherDatabase]) localStorage.removeItem(item);
  });
});
