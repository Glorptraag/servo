// The parent view for the three-path tests (controls-*.test.tsx, task 7.5): a store of its own in IndexedDB with Robin
// (in use, with a build) and Sam, the access options in memory, and the gate's question fixed at 6 × 12. Helpers open
// its screens without pressing the control a test is about: setting up goes by keyboard (keysOn), so a test's own
// press is the only touch or pointer input it makes.
import { expect, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { AccessStore, openStore } from '@servo/app/store';
import type { BlueprintSummary, Profile, ServoStore } from '@servo/app/store';
import { PARENT_TEXT, mountParentWith } from '../../src/accounts/index.ts';
import type { ParentOptions } from '../../src/accounts/index.ts';
import { CARD_GAME_TEXT } from '../../src/card-game/index.ts';
import { DECK_SIZE } from '../../src/index.ts';
import type { ParentHandle } from '../../src/index.ts';
import { focusOn, keysOn } from './input.ts';

export const SOON = { timeout: 30_000 };

/** The gate's question with `random` fixed at 0: 6 × 12. */
export const ANSWER = '72';

export const plainFloor = (name: string) => ({ name, level: 1, arena: { preset: 'open-floor', props: [] } }) as const;

export interface ParentPage {
  readonly host: HTMLElement;
  readonly store: ServoStore;
  readonly robin: Profile;
  readonly sam: Profile;
  readonly build: BlueprintSummary;
  readonly access: AccessStore;
  /** The one element in the view matching `selector`. */
  one<T extends HTMLElement = HTMLElement>(selector: string): T;
  /** The button in the view whose accessible name (its label, or else its text) is `name`. */
  button(name: string): HTMLButtonElement;
}

const mounted: { handle: ParentHandle; host: HTMLElement; store: ServoStore }[] = [];

export const unmountParents = (): void => {
  for (const { handle, host, store } of mounted.splice(0)) {
    handle.destroy();
    host.remove();
    store.close();
  }
};

export const nameOf = (element: Element): string => (element.getAttribute('aria-label') ?? element.textContent ?? '').trim();

/**
 * The parent view on a fresh store, at its gate. `prepare` changes the store first where a test needs to; `options`
 * replaces the view's options (an `access` of undefined follows this device's own).
 */
export const openGate = async (prepare?: (store: ServoStore) => void, options: ParentOptions = {}): Promise<ParentPage> => {
  const store = await openStore({ name: `servo-parent-controls-${crypto.randomUUID()}` });
  const robin = await store.profiles.create('Robin');
  await store.profiles.use(robin.id);
  const sam = await store.profiles.create('Sam');
  const created = await store.forProfile(robin.id).blueprints.create(plainFloor('Robin rocket'));
  const build = (await store.forProfile(robin.id).blueprints.list()).find((summary) => summary.id === created.meta.id);
  if (!build) throw new Error('the build was not kept');
  prepare?.(store);
  const given: ParentOptions = { random: () => 0, access: new AccessStore(null), speech: null, ...options };
  const access = given.access ?? new AccessStore(null);
  const host = document.createElement('div');
  document.body.append(host);
  const handle = mountParentWith(host, store, given);
  mounted.push({ handle, host, store });
  const one = <T extends HTMLElement = HTMLElement>(selector: string): T => {
    const found = host.querySelector<T>(selector);
    if (!found) throw new Error(`nothing in the view matches ${selector}`);
    return found;
  };
  const button = (name: string): HTMLButtonElement => {
    const found = [...host.querySelectorAll<HTMLButtonElement>('button')].find((element) => nameOf(element) === name);
    if (!found) throw new Error(`no button is named '${name}'`);
    return found;
  };
  await vi.waitFor(() => one(`${GATE} input`), SOON);
  return { host, store, robin, sam, build, access, one, button };
};

export const GATE = 'main[aria-labelledby="servo-parent-gate"]';

/** The parent view past its gate, with every section loaded. */
export const openParent = async (prepare?: (store: ServoStore) => void, options?: ParentOptions): Promise<ParentPage> => {
  const page = await openGate(prepare, options);
  await keysOn(page.one(`${GATE} input`), `${ANSWER}{Enter}`);
  await vi.waitFor(() => {
    expect(page.host.querySelector('h1')?.textContent).toBe(PARENT_TEXT.title);
    expect(page.host.querySelector('.servo-progress h3')).not.toBeNull();
    page.button(CARD_GAME_TEXT.start);
  }, SOON);
  return page;
};

export const game = (page: ParentPage): HTMLElement => page.one('section.servo-card-game');

/** The card heading's text, while a round is on. */
export const cardHeading = (page: ParentPage): string | null | undefined => game(page).querySelector('h3')?.textContent;

/** A round started, on its first card. */
export const startRound = async (page: ParentPage): Promise<void> => {
  await keysOn(page.button(CARD_GAME_TEXT.start));
  await vi.waitFor(() => expect(cardHeading(page)).toBe(CARD_GAME_TEXT.card(1, DECK_SIZE)), SOON);
};

/** Every card marked named, by keyboard, until the round is kept or refused. */
export const markAll = async (page: ParentPage): Promise<void> => {
  for (let n = 1; n <= DECK_SIZE; n += 1) {
    await vi.waitFor(() => expect(cardHeading(page)).toBe(CARD_GAME_TEXT.card(n, DECK_SIZE)), SOON);
    await keysOn(() => page.button(CARD_GAME_TEXT.named));
  }
};

/** A round played to its closing line. */
export const finishRound = async (page: ParentPage): Promise<void> => {
  await startRound(page);
  await markAll(page);
  await vi.waitFor(() => page.button(CARD_GAME_TEXT.again), SOON);
};

/** The parts list of Robin's build, open. */
export const openPartsList = async (page: ParentPage): Promise<HTMLElement> => {
  await keysOn(page.one('button[aria-label^="Parts list for"]'));
  return vi.waitFor(() => page.one('section.servo-parts-list'), SOON);
};

/** The Copy link field, shown because the clipboard refused, with focus moved off it. */
export const showLinkField = async (page: ParentPage): Promise<HTMLInputElement> => {
  vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('refused'));
  await keysOn(page.one('button[aria-label^="Copy link"]'));
  const field = await vi.waitFor(() => page.one<HTMLInputElement>('section[aria-labelledby="servo-parent-builds"] input[readonly]'), SOON);
  await focusOn(page.one('button[aria-label^="Copy link"]'));
  return field;
};

/** Robin's row in the rename form. */
export const openRename = async (page: ParentPage): Promise<HTMLInputElement> => {
  await keysOn(page.button('Rename Robin'));
  return vi.waitFor(() => page.one<HTMLInputElement>('input[id^="servo-parent-name-"]'), SOON);
};

/** Robin's row asking to confirm the removal. */
export const openRemove = async (page: ParentPage): Promise<HTMLElement> => {
  await keysOn(page.button('Remove Robin'));
  return vi.waitFor(() => page.one('[role="group"][aria-label="Remove Robin"]'), SOON);
};

/** Text typed into the field that has focus, clearing it first. */
export const replaceText = async (field: HTMLInputElement, text: string): Promise<void> => {
  await focusOn(field);
  await userEvent.clear(field);
  if (text) await userEvent.keyboard(text);
};
