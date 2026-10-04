// The parent view follows this device's access options (task 7.5, R-6.4 PAR-3, R-5.7 Q2): high contrast,
// dyslexia-friendly type, the left-handed layout and read-aloud, the same four the child's app follows (task 5.7),
// read through @servo/app/store. Each option shows on the gate and past it, changes the page as soon as it is turned,
// and is followed when another page of the app on this device turns it (the `storage` event).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ACCESS_KEY, AccessStore } from '@servo/app/store';
import type { AccessPrefs } from '@servo/app/store';
import { PARENT_TEXT } from '../../src/accounts/index.ts';
import { CARD_GAME_TEXT } from '../../src/card-game/index.ts';
import { ANSWER, GATE, SOON, openGate, openParent, unmountParents } from './harness.tsx';
import { keyboard, keysOn, pointer, touch } from './input.ts';

afterEach(() => {
  unmountParents();
  localStorage.removeItem(ACCESS_KEY);
  vi.restoreAllMocks();
});

const root = (host: HTMLElement): HTMLElement => {
  const found = host.querySelector<HTMLElement>('.servo-parent');
  if (!found) throw new Error('no parent root');
  return found;
};

const set = (access: AccessStore, on: Partial<AccessPrefs>): void => {
  for (const [option, value] of Object.entries(on)) access.set(option as keyof AccessPrefs, value === true);
};

const style = (element: Element): CSSStyleDeclaration => getComputedStyle(element);

describe('the parent view and the access options', () => {
  it('starts with every option off: the standard theme and type, the right-handed layout', async () => {
    const page = await openParent();
    const view = root(page.host);
    expect(view.dataset).toMatchObject({ contrast: 'standard', typeface: 'standard', hand: 'right' });
    expect(style(page.one('h1')).textAlign).not.toBe('right');
    expect(style(page.button('Rename Robin')).borderTopStyle).not.toBe('solid');
  });

  it('takes high contrast: white ground, black ink, 2 px black edges on its buttons and fields', async () => {
    const page = await openParent();
    set(page.access, { highContrast: true });
    const view = root(page.host);
    await vi.waitFor(() => expect(view.dataset.contrast).toBe('high'), SOON);
    expect(style(view).backgroundColor).toBe('rgb(255, 255, 255)');
    expect(style(view).color).toBe('rgb(0, 0, 0)');
    for (const control of [page.button('Rename Robin'), page.one('#servo-parent-add'), page.button(CARD_GAME_TEXT.start)]) {
      expect(style(control).borderTopWidth).toBe('2px');
      expect(style(control).borderTopStyle).toBe('solid');
      expect(style(control).borderTopColor).toBe('rgb(0, 0, 0)');
      expect(style(control).color).toBe('rgb(0, 0, 0)');
    }
    set(page.access, { highContrast: false });
    await vi.waitFor(() => expect(view.dataset.contrast).toBe('standard'), SOON);
  });

  it('takes the dyslexia-friendly type on its text, buttons and fields, with wider spacing', async () => {
    const page = await openParent();
    const plain = style(page.one('h1')).fontFamily;
    set(page.access, { dyslexiaType: true });
    const view = root(page.host);
    await vi.waitFor(() => expect(view.dataset.typeface).toBe('dyslexia-friendly'), SOON);
    expect(style(page.one('h1')).fontFamily).not.toBe(plain);
    expect(style(page.one('h1')).fontFamily).toContain('OpenDyslexic');
    for (const control of [page.button('Rename Robin'), page.one('#servo-parent-add')]) {
      expect(style(control).fontFamily).toContain('OpenDyslexic');
      expect(style(control).letterSpacing).not.toBe('normal');
    }
    expect(style(view).lineHeight).not.toBe('normal');
  });

  it('takes the left-handed layout: each row of controls and each line of text to the right edge, in the same order', async () => {
    const page = await openParent();
    const order = [...page.host.querySelectorAll('button')].map((button) => button.textContent);
    set(page.access, { leftHanded: true });
    const view = root(page.host);
    await vi.waitFor(() => expect(view.dataset.hand).toBe('left'), SOON);
    expect(style(page.one('h1')).textAlign).toBe('right');
    const row = page.button('Rename Robin').parentElement as HTMLElement;
    expect(style(row).justifyContent).toBe('flex-end');
    // The row's last control sits at the view's right edge.
    const edge = view.getBoundingClientRect().right;
    const last = page.button('Remove Robin').getBoundingClientRect().right;
    expect(edge - last).toBeLessThan(24);
    expect([...page.host.querySelectorAll('button')].map((button) => button.textContent)).toEqual(order);
  });

  it('takes read-aloud: a tap or click on words reads them, keyboard focus reads a control, a new status line is read', async () => {
    const spoken: string[] = [];
    const speech = {
      synth: { speak: (utterance: SpeechSynthesisUtterance) => void spoken.push(utterance.text), cancel: () => undefined },
      Utterance: class {
        rate = 1;
        lang = '';
        readonly text: string;
        constructor(text: string) {
          this.text = text;
        }
      } as unknown as new (text: string) => SpeechSynthesisUtterance,
    };
    const access = new AccessStore(null);
    const page = await openGate(undefined, { access, speech });
    await touch(page.one(`${GATE} p`));
    expect(spoken, 'read-aloud is off').toEqual([]);

    access.set('readAloud', true);
    await touch(page.one(`${GATE} p`));
    await vi.waitFor(() => expect(spoken).toContain(PARENT_TEXT.gateIntro), SOON);
    await keysOn(page.one(`${GATE} input`), `${ANSWER}{Enter}`);
    await vi.waitFor(() => expect(page.host.querySelector('h1')?.textContent).toBe(PARENT_TEXT.title), SOON);
    await pointer(page.one('h1'));
    await vi.waitFor(() => expect(spoken).toContain(PARENT_TEXT.title), SOON);
    await keyboard(page.button('Rename Robin'), '{Shift}');
    await vi.waitFor(() => expect(spoken).toContain('Rename Robin'), SOON);
    await keysOn(page.button(CARD_GAME_TEXT.start));
    await keysOn(() => page.button(CARD_GAME_TEXT.stop));
    await vi.waitFor(() => expect(spoken).toContain(CARD_GAME_TEXT.stopped), SOON);
  });

  it('follows another page of this device turning an option, through localStorage', async () => {
    localStorage.setItem(ACCESS_KEY, JSON.stringify({ highContrast: true }));
    const page = await openGate(undefined, { access: undefined });
    await vi.waitFor(() => expect(root(page.host).dataset.contrast).toBe('high'), SOON);
    localStorage.setItem(ACCESS_KEY, JSON.stringify({ highContrast: false, leftHanded: true, dyslexiaType: true }));
    window.dispatchEvent(new StorageEvent('storage', { key: ACCESS_KEY }));
    await vi.waitFor(() => expect(root(page.host).dataset).toMatchObject({ contrast: 'standard', hand: 'left', typeface: 'dyslexia-friendly' }), SOON);
  });
});
