// The parent view's keys beyond pressing a control, and where focus goes when what held it leaves (ground rule 8,
// R-6.4 PAR-2 and PAR-11): Enter in the add and rename fields, Escape on the rename form and on the removal confirm,
// the status line holding focus while a round is kept, and the gate's field taking focus when the gate asks again
// after the page was hidden. Focus never rests on the page's body.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PARENT_TEXT } from '../../src/accounts/index.ts';
import { CARD_GAME_TEXT } from '../../src/card-game/index.ts';
import { DECK_SIZE } from '../../src/index.ts';
import { ANSWER, GATE, SOON, cardHeading, game, openParent, openRemove, openRename, replaceText, startRound, unmountParents } from './harness.tsx';
import { keysOn } from './input.ts';

afterEach(() => {
  unmountParents();
  vi.restoreAllMocks();
});

const names = async (page: Awaited<ReturnType<typeof openParent>>): Promise<string[]> => (await page.store.profiles.list()).map((profile) => profile.name).sort();

/** Hides and shows the page, as switching away from the tab does. */
const hideAndShow = (): void => {
  let state: DocumentVisibilityState = 'hidden';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  try {
    document.dispatchEvent(new Event('visibilitychange'));
    state = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
  } finally {
    delete (document as { visibilityState?: unknown }).visibilityState;
  }
};

describe('keys in the fields and groups', () => {
  it('adds a child with Enter in the field, keeping focus there', async () => {
    const page = await openParent();
    const field = page.one<HTMLInputElement>('#servo-parent-add');
    await replaceText(field, 'Kai');
    await keysOn(field, '{Enter}');
    await vi.waitFor(async () => expect(await names(page)).toEqual(['Kai', 'Robin', 'Sam']), SOON);
    await vi.waitFor(() => expect(field.value).toBe(''), SOON);
    expect(document.activeElement).toBe(field);
  });

  it('saves a new name with Enter in the rename field, and Escape there cancels', async () => {
    const page = await openParent();
    await replaceText(await openRename(page), 'Robyn');
    await keysOn(page.one('input[id^="servo-parent-name-"]'), '{Enter}');
    await vi.waitFor(async () => expect(await names(page)).toEqual(['Robyn', 'Sam']), SOON);
    await vi.waitFor(() => expect(document.activeElement?.getAttribute('aria-label')).toBe('Rename Robyn'), SOON);

    await keysOn(page.button('Rename Robyn'));
    const field = await vi.waitFor(() => page.one<HTMLInputElement>('input[id^="servo-parent-name-"]'), SOON);
    await replaceText(field, 'Rob');
    await keysOn(field, '{Escape}');
    await vi.waitFor(() => expect(page.host.querySelector('input[id^="servo-parent-name-"]')).toBeNull(), SOON);
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Rename Robyn');
    expect(await names(page)).toEqual(['Robyn', 'Sam']);
  });

  it('keeps the profile on Escape in the removal confirm, from either of its buttons, and returns focus to Remove', async () => {
    const page = await openParent();
    for (const from of [PARENT_TEXT.keep, PARENT_TEXT.removeConfirm]) {
      await openRemove(page);
      await keysOn(page.button(from), '{Escape}');
      await vi.waitFor(() => expect(page.host.querySelector('[role="group"][aria-label="Remove Robin"]')).toBeNull(), SOON);
      expect(document.activeElement?.getAttribute('aria-label')).toBe('Remove Robin');
    }
    expect(await names(page)).toEqual(['Robin', 'Sam']);
  });

  it('removes with Space on Remove profile, and focus moves to the child left', async () => {
    const page = await openParent();
    await openRemove(page);
    await keysOn(page.button(PARENT_TEXT.removeConfirm), ' ');
    await vi.waitFor(async () => expect(await names(page)).toEqual(['Sam']), SOON);
    await vi.waitFor(() => expect(document.activeElement).toBe(page.one('fieldset input[type="radio"]')), SOON);
  });

  it('moves focus to adding a child once the last child is removed', async () => {
    const page = await openParent();
    for (const name of ['Robin', 'Sam']) {
      await openRemoveOf(page, name);
      await keysOn(page.button(PARENT_TEXT.removeConfirm));
      await vi.waitFor(async () => expect(await names(page)).not.toContain(name), SOON);
    }
    await vi.waitFor(() => expect(document.activeElement).toBe(page.one('#servo-parent-add')), SOON);
  });
});

const openRemoveOf = async (page: Awaited<ReturnType<typeof openParent>>, name: string): Promise<void> => {
  await keysOn(page.button(`Remove ${name}`));
  await vi.waitFor(() => page.one(`[role="group"][aria-label="Remove ${name}"]`), SOON);
};

describe('focus when what held it goes', () => {
  it('rests on the round’s status line while the round is kept, then the closing line (R-6.4 PAR-11)', async () => {
    let release: () => void = () => undefined;
    const page = await openParent((store) => {
      const scope = store.forProfile.bind(store);
      vi.spyOn(store, 'forProfile').mockImplementation((profile) => {
        const child = scope(profile);
        const add: typeof child.cardGames.add = (cards) =>
          new Promise((resolve, reject) => {
            release = () => void child.cardGames.add(cards).then(resolve, reject);
          });
        return { ...child, cardGames: { ...child.cardGames, add } };
      });
    });
    await startRound(page);
    for (let n = 1; n <= DECK_SIZE; n += 1) {
      await vi.waitFor(() => expect(cardHeading(page)).toBe(CARD_GAME_TEXT.card(n, DECK_SIZE)), SOON);
      await keysOn(() => page.button(CARD_GAME_TEXT.notNamed));
    }
    const status = game(page).querySelector('[role="status"]');
    await vi.waitFor(() => expect(status?.textContent).toBe(CARD_GAME_TEXT.saving), SOON);
    expect(document.activeElement).toBe(status);
    release();
    await vi.waitFor(() => expect(document.activeElement?.textContent).toBe(CARD_GAME_TEXT.done), SOON);
  });

  it('goes to the view’s title once the gate lets the adult in', async () => {
    const page = await openParent();
    expect(document.activeElement).toBe(page.one('h1'));
  });

  it('goes to the gate’s field when the gate asks again after the page was hidden', async () => {
    const page = await openParent();
    await keysOn(page.button('Rename Robin'));
    hideAndShow();
    const field = await vi.waitFor(() => page.one<HTMLInputElement>(`${GATE} input`), SOON);
    expect(document.activeElement).toBe(field);
    await keysOn(field, `${ANSWER}{Enter}`);
    await vi.waitFor(() => expect(page.host.querySelector('h1')?.textContent).toBe(PARENT_TEXT.title), SOON);
    expect(document.activeElement).toBe(page.one('h1'));
  });
});
