// The card game (task 5.4) in the parent view, in Chromium on its real IndexedDB: behind the gate, for the child in use
// only; ten pictures of Level 1–2 parts with each name hidden until the adult shows it; marked by pointer, by touch and
// by keyboard (ground rule 8); the round kept for that child alone and read by progress, while the game screen the child
// watches ends on a neutral line with no count, verdict, id, praise or exclamation mark (ground rule 7, D40). A round
// stopped, left by a child switch or by the page being hidden keeps nothing.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cdp, userEvent } from 'vitest/browser';
import { openStore } from '@servo/app/store';
import type { ServoStore } from '@servo/app/store';
import { PARENT_TEXT, mountParentWith } from '../../src/accounts/index.ts';
import { CARD_GAME_TEXT } from '../../src/card-game/index.ts';
import { DECK_SIZE } from '../../src/index.ts';
import type { ParentHandle } from '../../src/index.ts';

let mounted: { handle: ParentHandle; host: HTMLElement; store: ServoStore } | undefined;

afterEach(() => {
  vi.restoreAllMocks();
  mounted?.handle.destroy();
  mounted?.host.remove();
  mounted?.store.close();
  mounted = undefined;
});

const family = async () => {
  const store = await openStore({ name: `servo-card-game-${crypto.randomUUID()}` });
  const robin = await store.profiles.create('Robin');
  await store.profiles.use(robin.id);
  const sam = await store.profiles.create('Sam');
  return { store, robin, sam };
};

const mount = (store: ServoStore, random: () => number = () => 0) => {
  const host = document.createElement('div');
  document.body.append(host);
  const handle = mountParentWith(host, store, { random });
  mounted = { handle, host, store };
  return host;
};

const passGate = async (host: HTMLElement, answer = '72'): Promise<void> => {
  await expect.poll(() => host.querySelector('input')).toBeTruthy();
  await userEvent.fill(host.querySelector('input') as HTMLInputElement, answer);
  await userEvent.keyboard('{Enter}');
  await expect.poll(() => host.querySelector('h1')?.textContent).toBe(PARENT_TEXT.title);
};

const game = (host: HTMLElement): HTMLElement | null => host.querySelector<HTMLElement>('section.servo-card-game');
const button = (host: HTMLElement, text: string): HTMLButtonElement => {
  const found = [...(game(host)?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find((element) => element.textContent?.trim() === text);
  if (!found) throw new Error(`No button reads '${text}'.`);
  return found;
};
const cardHeading = (host: HTMLElement): string | null | undefined => game(host)?.querySelector('h3')?.textContent;
/** The card's name as the adult would read it once shown. */
const hiddenName = (host: HTMLElement): HTMLElement | null => game(host)?.querySelector<HTMLElement>('[role="group"] p[id]') ?? null;

const tap = async (element: Element): Promise<void> => {
  const frame = window.frameElement?.getBoundingClientRect();
  const scale = frame ? frame.width / window.innerWidth : 1;
  const box = element.getBoundingClientRect();
  const point = { x: (frame?.left ?? 0) + (box.left + box.width / 2) * scale, y: (frame?.top ?? 0) + (box.top + box.height / 2) * scale };
  await cdp().send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, id: 0 }] });
  await cdp().send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
};

/** What the game screen shows, which the child watches: never a count or a verdict on a card. */
const VERDICT = /\d+\s+of\s+\d+\s+parts|parts named|\bnot named\b|:\s*(named|not named)|\bscore\b|\bcorrect\b|\bright\b|\bwrong\b/i;
const expectNoVerdict = (host: HTMLElement): void => {
  const section = game(host);
  // The two mark buttons' own labels are allowed; nothing else may say named or not named.
  const text = [...(section?.querySelectorAll('h2, h3, p, li') ?? [])].map((element) => element.textContent ?? '').join('\n');
  expect(text).not.toMatch(VERDICT);
  expect(section?.querySelector('ul, ol')).toBeNull();
};

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

const radioFor = (host: HTMLElement, name: string): HTMLInputElement => {
  const label = [...host.querySelectorAll('label')].find((element) => element.textContent?.trim() === name);
  const radio = label?.querySelector<HTMLInputElement>('input[type="radio"]');
  if (!radio) throw new Error(`No radio for ${name}.`);
  return radio;
};

describe('the card game', () => {
  it('is offered only behind the gate, and only for the child in use', async () => {
    const { store } = await family();
    const host = mount(store);
    await expect.poll(() => host.querySelector('input')).toBeTruthy();
    expect(game(host)).toBeNull();
    await passGate(host);
    await expect.poll(() => game(host)?.querySelector('h2')?.textContent).toBe(CARD_GAME_TEXT.title('Robin'));
    expect(game(host)?.textContent).not.toContain('Sam');
  }, 600_000);

  it('plays a round by pointer, touch and keyboard, keeps it for the child in use alone, and progress reads it', async () => {
    const { store, robin, sam } = await family();
    const host = mount(store);
    await passGate(host);
    await expect.poll(() => game(host)).toBeTruthy();
    await userEvent.click(button(host, CARD_GAME_TEXT.start));

    const shown: { name: string; named: boolean }[] = [];
    for (let n = 1; n <= DECK_SIZE; n += 1) {
      await expect.poll(() => cardHeading(host)).toBe(CARD_GAME_TEXT.card(n, DECK_SIZE));
      // Focus moves to each card's heading, for a screen reader.
      expect(document.activeElement?.textContent).toBe(CARD_GAME_TEXT.card(n, DECK_SIZE));
      // A picture, and the name hidden until the adult shows it.
      expect(game(host)?.querySelector('.servo-card-picture')).toBeTruthy();
      expectNoVerdict(host);
      const name = hiddenName(host);
      expect(name?.hidden).toBe(true);
      const show = button(host, CARD_GAME_TEXT.showName);
      expect(show.getAttribute('aria-expanded')).toBe('false');
      await userEvent.click(show);
      await expect.poll(() => hiddenName(host)?.hidden).toBe(false);
      expect(button(host, CARD_GAME_TEXT.hideName).getAttribute('aria-expanded')).toBe('true');
      shown.push({ name: hiddenName(host)?.textContent ?? '', named: n % 3 !== 0 });

      const target = button(host, n % 3 === 0 ? CARD_GAME_TEXT.notNamed : CARD_GAME_TEXT.named);
      if (n % 3 === 1) await userEvent.click(target);
      else if (n % 3 === 2) await tap(target);
      else {
        target.focus();
        await userEvent.keyboard(n % 2 === 0 ? '{Enter}' : ' ');
      }
    }

    // The round ends on one neutral line, with focus on it: no count and no verdict on any card, for the child watches.
    await expect.poll(() => document.activeElement?.textContent).toBe(CARD_GAME_TEXT.done);
    expect(game(host)?.querySelector('h3')).toBeNull();
    expectNoVerdict(host);
    for (const card of shown) expect(game(host)?.textContent).not.toContain(card.name);
    const named = shown.filter((card) => card.named).length;

    const rounds = await store.forProfile(robin.id).cardGames.list();
    expect(rounds).toHaveLength(1);
    const kept = rounds[0]?.cards ?? [];
    expect(new Set(kept.map((card) => card.part)).size).toBe(DECK_SIZE);
    const nameOf = (part: string) => store.content.parts.find((record) => record.id === part)?.identity.name ?? '';
    expect(kept.map((card) => nameOf(card.part).toLowerCase())).toEqual(shown.map((card) => card.name.toLowerCase()));
    expect(kept.map((card) => card.named)).toEqual(shown.map((card) => card.named));
    for (const card of kept) {
      expect(store.content.parts.find((record) => record.id === card.part)?.identity.level).toBeLessThanOrEqual(2);
    }
    expect(await store.forProfile(sam.id).cardGames.list()).toEqual([]);

    // Progress, the adult's record, reads the round at once.
    await expect.poll(() => host.querySelector('section.servo-progress')?.textContent ?? '').toContain(`${named} of ${DECK_SIZE} parts named`);

    // No id, no exclamation mark anywhere on the page.
    for (const id of [robin.id, sam.id, rounds[0]?.id ?? '']) expect(host.innerHTML).not.toContain(id);
    expect(host.textContent).not.toContain('!');
  }, 600_000);

  it('keeps nothing from a round stopped part way, or left by a child switch', async () => {
    const { store, robin, sam } = await family();
    const host = mount(store);
    await passGate(host);
    await expect.poll(() => game(host)).toBeTruthy();

    await userEvent.click(button(host, CARD_GAME_TEXT.start));
    await expect.poll(() => cardHeading(host)).toBe(CARD_GAME_TEXT.card(1, DECK_SIZE));
    await userEvent.click(button(host, CARD_GAME_TEXT.named));
    await expect.poll(() => cardHeading(host)).toBe(CARD_GAME_TEXT.card(2, DECK_SIZE));
    await userEvent.click(button(host, CARD_GAME_TEXT.stop));
    await expect.poll(() => game(host)?.querySelector('[role="status"]')?.textContent).toBe(CARD_GAME_TEXT.stopped);
    expect(document.activeElement?.textContent).toBe(CARD_GAME_TEXT.start);

    await userEvent.keyboard('{Enter}');
    await expect.poll(() => cardHeading(host)).toBe(CARD_GAME_TEXT.card(1, DECK_SIZE));
    await userEvent.click(button(host, CARD_GAME_TEXT.notNamed));
    await userEvent.click(radioFor(host, 'Sam'));
    await expect.poll(() => game(host)?.querySelector('h2')?.textContent).toBe(CARD_GAME_TEXT.title('Sam'));
    expect(game(host)?.querySelector('h3')).toBeNull();

    expect(await store.forProfile(robin.id).cardGames.list()).toEqual([]);
    expect(await store.forProfile(sam.id).cardGames.list()).toEqual([]);
  }, 600_000);

  it('keeps nothing from a round under way when the page is hidden', async () => {
    const { store, robin } = await family();
    let random = 0;
    const host = mount(store, () => random);
    await passGate(host);
    await expect.poll(() => game(host)).toBeTruthy();
    await userEvent.click(button(host, CARD_GAME_TEXT.start));
    await expect.poll(() => cardHeading(host)).toBe(CARD_GAME_TEXT.card(1, DECK_SIZE));
    await userEvent.click(button(host, CARD_GAME_TEXT.named));
    await expect.poll(() => cardHeading(host)).toBe(CARD_GAME_TEXT.card(2, DECK_SIZE));

    random = 0.99;
    hideAndShow();
    await expect.poll(() => game(host)).toBeNull();
    await passGate(host, '171');
    await expect.poll(() => game(host)?.querySelector('h2')?.textContent).toBe(CARD_GAME_TEXT.title('Robin'));
    expect(game(host)?.querySelector('h3')).toBeNull();
    expect(await store.forProfile(robin.id).cardGames.list()).toEqual([]);
  }, 600_000);

  it('moves focus to Try keeping it again when the store refuses a round, and keeps it on the retry', async () => {
    const { store, robin } = await family();
    const scope = store.forProfile.bind(store);
    let refuse = true;
    vi.spyOn(store, 'forProfile').mockImplementation((profile) => {
      const child = scope(profile);
      const add: typeof child.cardGames.add = (cards) => (refuse ? Promise.reject(new Error('refused')) : child.cardGames.add(cards));
      return { ...child, cardGames: { ...child.cardGames, add } };
    });
    const host = mount(store);
    await passGate(host);
    await expect.poll(() => game(host)).toBeTruthy();
    await userEvent.click(button(host, CARD_GAME_TEXT.start));
    for (let n = 1; n <= DECK_SIZE; n += 1) {
      await expect.poll(() => cardHeading(host)).toBe(CARD_GAME_TEXT.card(n, DECK_SIZE));
      await userEvent.click(button(host, CARD_GAME_TEXT.notNamed));
    }
    await expect.poll(() => document.activeElement?.textContent).toBe(CARD_GAME_TEXT.saveAgain);
    expect(game(host)?.querySelector('[role="status"]')?.textContent).toBe(CARD_GAME_TEXT.saveFailed);
    // Nothing on the failed screen throws the finished round away.
    expect(() => button(host, CARD_GAME_TEXT.again)).toThrow();
    expectNoVerdict(host);

    refuse = false;
    await userEvent.keyboard('{Enter}');
    await expect.poll(() => document.activeElement?.textContent).toBe(CARD_GAME_TEXT.done);
    expect(await scope(robin.id).cardGames.list()).toHaveLength(1);
  }, 600_000);
});
