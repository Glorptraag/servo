// Two pages on one device (R-5.1 finding 1): the parent view in this page, and the child's app open in a frame beside
// it, on the same database. When the adult switches or removes a child, the open app follows: what waited is saved
// to the child who made it first, then the app opens for the child in use now. No build lands under the wrong child.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { openStore } from '@servo/app/store';
import type { ServoStore } from '@servo/app/store';
import { PARENT_TEXT, mountParentWith } from '../../src/accounts/index.ts';

const BOOT = { timeout: 90_000, interval: 50 };
const SOON = { timeout: 20_000, interval: 50 };
const plainFloor = (name: string) => ({ name, level: 1, arena: { preset: 'open-floor', props: [] } }) as const;

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

/** The child's app in a frame, on the database `name`. */
const openApp = async (name: string) => {
  const frame = document.createElement('iframe');
  frame.title = 'Servo';
  frame.style.cssText = 'position: fixed; right: 0; top: 0; width: 1180px; height: 820px; border: 0;';
  frame.src = `/test/browser/app-page.html?store=${encodeURIComponent(name)}`;
  document.body.appendChild(frame);
  cleanups.push(() => frame.remove());
  const header = (): HTMLElement => {
    const found = frame.contentDocument?.querySelector<HTMLElement>('[data-region="header"]');
    if (!found) throw new Error('no header');
    return found;
  };
  await vi.waitFor(() => {
    if (!frame.contentDocument?.querySelector('[data-region="stage"] canvas')) throw new Error('the app has not mounted yet');
    header();
  }, BOOT);
  const nameButton = () => header().querySelector<HTMLButtonElement>('button.shell-blueprint-name');
  return {
    /** The name of the build on the app's canvas. */
    name: () => nameButton()?.textContent ?? null,
    /** An edit, as the child makes one: renames the build through the header's name field. It waits to be saved. */
    rename: async (next: string) => {
      await vi.waitFor(() => expect(nameButton()?.disabled).toBe(false), SOON);
      nameButton()?.click();
      const input = await vi.waitFor(() => {
        const found = header().querySelector<HTMLInputElement>('input.shell-blueprint-name-input');
        if (!found) throw new Error('no name field');
        return found;
      }, SOON);
      const setValue = Object.getOwnPropertyDescriptor((frame.contentWindow as typeof window).HTMLInputElement.prototype, 'value')?.set;
      setValue?.call(input, next);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.blur();
      await vi.waitFor(() => expect(nameButton()?.textContent).toBe(next), SOON);
    },
  };
};

/** Each child's builds, by name, read from outside both pages. */
const buildsOf = async (store: ServoStore, profiles: readonly string[]) =>
  Object.fromEntries(
    await Promise.all(profiles.map(async (profile) => [profile, (await store.forProfile(profile).blueprints.list()).map((build) => build.name).sort()] as const)),
  );

const radioFor = (host: HTMLElement, name: string): HTMLInputElement => {
  const label = [...host.querySelectorAll('label')].find((element) => element.textContent?.trim() === name);
  const radio = label?.querySelector<HTMLInputElement>('input[type="radio"]');
  if (!radio) throw new Error(`No radio for ${name}.`);
  return radio;
};

describe('an app page open beside the parent view', () => {
  it('follows the switch and a removal, saving each edit under the child who made it', async () => {
    const name = `servo-follow-${crypto.randomUUID()}`;
    const store = await openStore({ name });
    cleanups.push(() => store.close());
    const robin = await store.profiles.create('Robin');
    await store.profiles.use(robin.id);
    const sam = await store.profiles.create('Sam');
    await store.forProfile(robin.id).blueprints.create(plainFloor('Robin build'));
    await store.forProfile(sam.id).blueprints.create(plainFloor('Sam build'));

    // The parent page: this one.
    const host = document.createElement('div');
    document.body.append(host);
    const parent = mountParentWith(host, store, { random: () => 0 });
    cleanups.push(() => {
      parent.destroy();
      host.remove();
    });
    await expect.poll(() => host.querySelector('input')).toBeTruthy();
    await userEvent.fill(host.querySelector('input') as HTMLInputElement, '72');
    await userEvent.click([...host.querySelectorAll('button')].find((button) => button.textContent === PARENT_TEXT.gateContinue) as HTMLElement);
    await expect.poll(() => host.querySelector('h1')?.textContent).toBe(PARENT_TEXT.title);

    // The app page opens for Robin, the child in use.
    const app = await openApp(name);
    await vi.waitFor(() => expect(app.name()).toBe('Robin build'), SOON);

    // Robin edits, and the adult switches to Sam before the edit's quiet second is up.
    await app.rename('Robin edit');
    radioFor(host, 'Sam').click();
    await vi.waitFor(() => expect(app.name()).toBe('Sam build'), SOON);
    expect(await buildsOf(store, [robin.id, sam.id])).toEqual({ [robin.id]: ['Robin edit'], [sam.id]: ['Sam build'] });

    // Sam's edits are Sam's.
    await app.rename('Sam edit');
    await vi.waitFor(async () => expect(await buildsOf(store, [robin.id, sam.id])).toEqual({ [robin.id]: ['Robin edit'], [sam.id]: ['Sam edit'] }), SOON);

    // Sam edits again, and the adult removes Sam at once: the app follows to Robin, the only child left, and Sam's
    // waiting edit goes with Sam, never to Robin and never into a note.
    await app.rename('Sam late');
    (host.querySelector('button[aria-label="Remove Sam"]') as HTMLElement).click();
    const confirm = await vi.waitFor(() => {
      const found = [...host.querySelectorAll('button')].find((button) => button.textContent === PARENT_TEXT.removeConfirm);
      if (!found) throw new Error('no confirm');
      return found;
    }, SOON);
    confirm.click();
    await vi.waitFor(() => expect(app.name()).toBe('Robin edit'), SOON);
    // Long enough for any save the edit would have made.
    await new Promise((resolve) => setTimeout(resolve, 2500));
    expect(await buildsOf(store, [robin.id, sam.id])).toEqual({ [robin.id]: ['Robin edit'], [sam.id]: [] });
    expect(Object.keys(localStorage).filter((item) => item.startsWith(`servo.unsaved:${name}:`) && item.includes(sam.id))).toEqual([]);
  }, 300_000);
});
