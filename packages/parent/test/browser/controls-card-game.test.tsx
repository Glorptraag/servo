// The card game's controls, each by touch, pointer and keyboard (ground rule 8, R-6.4 PAR-2): Start a round, Show
// the name and Hide the name, Named and Not named, Stop the round, Play another round, Back to the parent view and Try
// keeping it again. While a round is on it has the page to itself (R-7.1, D40): every press here is checked on a page
// whose other sections are put away. After each press focus is on the round's heading, its closing line, its status
// line or a control, never the page's body (R-6.4 PAR-11).
import { afterEach, expect, vi } from 'vitest';
import type { ServoStore } from '@servo/app/store';
import { CARD_GAME_TEXT } from '../../src/card-game/index.ts';
import { DECK_SIZE } from '../../src/index.ts';
import { threePaths } from './controls.ts';
import { SOON, cardHeading, finishRound, game, markAll, openParent, startRound, unmountParents } from './harness.tsx';
import type { ParentPage } from './harness.tsx';
import { keysOn } from './input.ts';

afterEach(() => {
  unmountParents();
  vi.restoreAllMocks();
});

/** The rest of the page is put away while a round is on. */
const pageHidden = (page: ParentPage): boolean =>
  ['section[aria-labelledby="servo-parent-children"]', 'section[aria-labelledby="servo-parent-builds"]', '.servo-progress'].every(
    (selector) => !page.host.querySelector(selector)?.checkVisibility(),
  );

const nameLine = (page: ParentPage): HTMLElement => {
  const found = game(page).querySelector<HTMLElement>('[role="group"] p[id]');
  if (!found) throw new Error('no name line');
  return found;
};

const kept = async (page: ParentPage) => page.store.forProfile(page.robin.id).cardGames.list();

threePaths('start', {
  open: () => openParent(),
  control: (page) => page.button(CARD_GAME_TEXT.start),
  then: async (page) => {
    await vi.waitFor(() => expect(cardHeading(page)).toBe(CARD_GAME_TEXT.card(1, DECK_SIZE)), SOON);
    expect(document.activeElement).toBe(game(page).querySelector('h3'));
    expect(pageHidden(page)).toBe(true);
  },
});

threePaths('show-name', {
  open: async () => {
    const page = await openParent();
    await startRound(page);
    return page;
  },
  control: (page) => page.button(CARD_GAME_TEXT.showName),
  then: async (page) => {
    await vi.waitFor(() => expect(nameLine(page).hidden).toBe(false), SOON);
    expect(nameLine(page).textContent).not.toBe('');
    const toggle = page.button(CARD_GAME_TEXT.hideName);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(toggle);
  },
});

threePaths('hide-name', {
  open: async () => {
    const page = await openParent();
    await startRound(page);
    await keysOn(page.button(CARD_GAME_TEXT.showName));
    await vi.waitFor(() => page.button(CARD_GAME_TEXT.hideName), SOON);
    return page;
  },
  control: (page) => page.button(CARD_GAME_TEXT.hideName),
  then: async (page) => {
    await vi.waitFor(() => expect(nameLine(page).hidden).toBe(true), SOON);
    const toggle = page.button(CARD_GAME_TEXT.showName);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(toggle);
  },
});

for (const [id, label, named] of [
  ['named', CARD_GAME_TEXT.named, true],
  ['not-named', CARD_GAME_TEXT.notNamed, false],
] as const) {
  // Each mark on the last card keeps the round, so the mark is checked in the record it makes.
  const mark = {
    open: async () => {
      const page = await openParent();
      await startRound(page);
      for (let n = 1; n < DECK_SIZE; n += 1) {
        await keysOn(() => page.button(CARD_GAME_TEXT.named));
        await vi.waitFor(() => expect(cardHeading(page)).toBe(CARD_GAME_TEXT.card(n + 1, DECK_SIZE)), SOON);
      }
      return page;
    },
    control: (page: ParentPage) => page.button(label),
    then: async (page: ParentPage) => {
      await vi.waitFor(() => expect(document.activeElement?.textContent).toBe(CARD_GAME_TEXT.done), SOON);
      const rounds = await kept(page);
      expect(rounds).toHaveLength(1);
      expect(rounds[0]?.cards.at(-1)?.named).toBe(named);
      expect(pageHidden(page)).toBe(true);
    },
  };
  if (id === 'named') threePaths('named', mark);
  else threePaths('not-named', mark);
}

threePaths('stop', {
  open: async () => {
    const page = await openParent();
    await startRound(page);
    return page;
  },
  control: (page) => page.button(CARD_GAME_TEXT.stop),
  then: async (page) => {
    await vi.waitFor(() => expect(document.activeElement?.textContent).toBe(CARD_GAME_TEXT.start), SOON);
    expect(game(page).querySelector('[role="status"]')?.textContent).toBe(CARD_GAME_TEXT.stopped);
    expect(await kept(page)).toEqual([]);
    expect(pageHidden(page)).toBe(false);
  },
});

threePaths('again', {
  open: async () => {
    const page = await openParent();
    await finishRound(page);
    return page;
  },
  control: (page) => page.button(CARD_GAME_TEXT.again),
  then: async (page) => {
    await vi.waitFor(() => expect(cardHeading(page)).toBe(CARD_GAME_TEXT.card(1, DECK_SIZE)), SOON);
    expect(document.activeElement).toBe(game(page).querySelector('h3'));
    expect(pageHidden(page)).toBe(true);
    expect(await kept(page)).toHaveLength(1);
  },
});

threePaths('leave', {
  open: async () => {
    const page = await openParent();
    await finishRound(page);
    return page;
  },
  control: (page) => page.button(CARD_GAME_TEXT.leave),
  then: async (page) => {
    await vi.waitFor(() => expect(document.activeElement?.textContent).toBe(CARD_GAME_TEXT.start), SOON);
    // The page comes back, and progress shows the round just kept (D38: the adult reads it there).
    expect(pageHidden(page)).toBe(false);
    await vi.waitFor(() => expect(page.one('.servo-progress').textContent).toContain(`${DECK_SIZE} of ${DECK_SIZE} parts named`), SOON);
  },
});

/** The store refuses rounds until `accept` is called. */
const refusing = (store: ServoStore): { accept: () => void } => {
  const scope = store.forProfile.bind(store);
  let refuse = true;
  vi.spyOn(store, 'forProfile').mockImplementation((profile) => {
    const child = scope(profile);
    const add: typeof child.cardGames.add = (cards) => (refuse ? Promise.reject(new Error('refused')) : child.cardGames.add(cards));
    return { ...child, cardGames: { ...child.cardGames, add } };
  });
  return {
    accept: () => {
      refuse = false;
    },
  };
};

let store: { accept: () => void } | undefined;
threePaths('save-again', {
  open: async () => {
    const page = await openParent((opened) => {
      store = refusing(opened);
    });
    await startRound(page);
    await markAll(page);
    await vi.waitFor(() => expect(document.activeElement?.textContent).toBe(CARD_GAME_TEXT.saveAgain), SOON);
    store?.accept();
    return page;
  },
  control: (page) => page.button(CARD_GAME_TEXT.saveAgain),
  then: async (page) => {
    await vi.waitFor(() => expect(document.activeElement?.textContent).toBe(CARD_GAME_TEXT.done), SOON);
    expect(await kept(page)).toHaveLength(1);
  },
});
