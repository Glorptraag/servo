// The Level 3 slot (task 6.6) in the real app: the real shell and canvas at the 10-inch size, with the real content
// plus the schema's example microcontroller (test/program-view/fixtures.ts). Off by default: the servo motor's angle
// stays locked on its card and in the list view, and a microcontroller's card shows no program. On, from the device's
// localStorage: the angle is set by keyboard, pointer, touch and the list view (rule 8), and the microcontroller's
// program view follows it. That the angle then sweeps the servo motor in a Run is test/program-view/program.test.ts.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cdp, userEvent } from 'vitest/browser';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { App } from '../../src/App.tsx';
import { FLAGS_KEY } from '../../src/flags/index.ts';
import { benchContent, servoOnBrain } from '../program-view/fixtures.ts';

const content = benchContent();
let mounted: { root: Root; host: HTMLElement } | undefined;

beforeAll(() => cdp().send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }));
afterAll(() => cdp().send('Emulation.setEmulatedMedia', { features: [] }));
afterEach(() => {
  mounted?.root.unmount();
  mounted?.host.remove();
  mounted = undefined;
  localStorage.removeItem(FLAGS_KEY);
});

/** The real app with the servo motor on a microcontroller's out 1, the flags read from this device. */
const mount = async (): Promise<HTMLElement> => {
  const host = document.createElement('div');
  host.style.cssText = 'position: fixed; left: 0; top: 0; width: 1180px; height: 820px;';
  document.body.appendChild(host);
  const root = createRoot(host);
  mounted = { root, host };
  let ready = false;
  root.render(<App content={content} start={servoOnBrain()} onReady={() => (ready = true)} />);
  await vi.waitFor(() => {
    if (!ready) throw new Error('the app has not mounted its canvas yet');
  });
  return host;
};

const element = <T extends Element>(host: HTMLElement, selector: string): T => {
  const found = host.querySelector<T>(selector);
  if (!found) throw new Error(`nothing matches ${selector}`);
  return found;
};

/** The list view, as a screen reader works it: open a part's actions, then press one. */
const listAction = async (host: HTMLElement, partId: string, action: string): Promise<HTMLButtonElement | null> => {
  const toggle = element<HTMLButtonElement>(host, `[data-toggle="part:${partId}"]`);
  if (toggle.getAttribute('aria-expanded') !== 'true') toggle.click();
  await vi.waitFor(() => expect(element(host, `[data-toggle="part:${partId}"]`).getAttribute('aria-expanded')).toBe('true'));
  return host.querySelector<HTMLButtonElement>(`[data-action="${action}"]`);
};

const select = async (host: HTMLElement, partId: string): Promise<void> => {
  const button = await listAction(host, partId, `select:part:${partId}`);
  if (!button) throw new Error(`no select action for ${partId}`);
  button.click();
  await vi.waitFor(() => expect(element<HTMLElement>(host, 'article.spec-card').dataset.part).toBeTruthy());
};

const card = (host: HTMLElement) => element<HTMLElement>(host, '[data-region="specCard"]');
const slider = (host: HTMLElement) => element<HTMLInputElement>(card(host), '[data-setting="angle"] input[type="range"]');
const shownAngle = (host: HTMLElement) => card(host).querySelector('[data-setting="angle"] output')?.textContent;
const rule = (host: HTMLElement) => card(host).querySelector<HTMLElement>('.program-view-rule');

/** A real pointer or finger along the slider's track, from one fraction of it to another, through CDP. */
const dragSlider = async (host: HTMLElement, from: number, to: number, by: 'mouse' | 'touch'): Promise<void> => {
  const box = slider(host).getBoundingClientRect();
  const frame = window.frameElement?.getBoundingClientRect();
  const at = (fraction: number) => ({
    x: (frame?.left ?? 0) + box.left + 16 + (box.width - 32) * fraction,
    y: (frame?.top ?? 0) + box.top + box.height / 2,
  });
  if (by === 'mouse') {
    const mouse = (type: 'mousePressed' | 'mouseMoved' | 'mouseReleased', point: { x: number; y: number }, buttons: number) =>
      cdp().send('Input.dispatchMouseEvent', { type, ...point, button: 'left', buttons, clickCount: 1 });
    await mouse('mousePressed', at(from), 1);
    await mouse('mouseMoved', at((from + to) / 2), 1);
    await mouse('mouseMoved', at(to), 1);
    await mouse('mouseReleased', at(to), 0);
    return;
  }
  const finger = (type: 'touchStart' | 'touchMove' | 'touchEnd', point?: { x: number; y: number }) =>
    cdp().send('Input.dispatchTouchEvent', { type, touchPoints: point ? [{ ...point, id: 1 }] : [] });
  await finger('touchStart', at(from));
  await finger('touchMove', at((from + to) / 2));
  await finger('touchMove', at(to));
  await finger('touchEnd');
};

describe('the Level 3 slot', () => {
  it('is off by default: the angle is locked on the card and in the list view, and a microcontroller shows no program', async () => {
    expect(localStorage.getItem(FLAGS_KEY)).toBeNull();
    const host = await mount();
    await select(host, 'servo');
    expect(element<HTMLElement>(host, 'article.spec-card').dataset.part).toBe('servo-motor');
    expect(card(host).querySelector('[data-setting="angle"]')).toBeNull();
    expect(await listAction(host, 'servo', 'setting:servo:angle:up')).toBeNull();
    await select(host, 'brain');
    expect(element<HTMLElement>(host, 'article.spec-card').dataset.part).toBe('microcontroller');
    expect(card(host).querySelector('.program-view')).toBeNull();
  });

  it('on: the angle is set by keyboard, pointer, touch and list view, and the program view follows it', async () => {
    localStorage.setItem(FLAGS_KEY, JSON.stringify(['level-3-slot']));
    const host = await mount();

    // The microcontroller's program: out 1 follows the servo motor's angle, 90° until it is set.
    await select(host, 'brain');
    expect(card(host).querySelector('.program-view h3')?.textContent).toBe('Program');
    expect(rule(host)?.textContent).toBe('Always set out 1 to the servo motor’s angle, 90°.');
    expect(rule(host)?.dataset.level).toBe('0.5');

    // The servo motor's card at the child's level, with the angle open (the header still says Level 1's words).
    await select(host, 'servo');
    expect(element<HTMLElement>(host, 'article.spec-card').dataset.level).toBe('1');
    expect([slider(host).min, slider(host).max, slider(host).step, slider(host).value]).toEqual(['0', '180', '15', '90']);

    slider(host).focus();
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}{ArrowLeft}');
    await vi.waitFor(() => expect(shownAngle(host)).toBe('45°'));

    await dragSlider(host, 3 / 12, 10 / 12, 'mouse');
    await vi.waitFor(() => expect(shownAngle(host)).toBe('150°'));

    await dragSlider(host, 10 / 12, 4 / 12, 'touch');
    await vi.waitFor(() => expect(shownAngle(host)).toBe('60°'));

    const up = await listAction(host, 'servo', 'setting:servo:angle:up');
    expect(up?.textContent).toBe('Set servo motor angle to 75°');
    up?.click();
    await vi.waitFor(() => expect(shownAngle(host)).toBe('75°'));

    await select(host, 'brain');
    expect(rule(host)?.textContent).toBe('Always set out 1 to the servo motor’s angle, 75°.');
    expect(Number(rule(host)?.dataset.level)).toBeCloseTo(75 / 180, 12);
    expect(document.querySelector('dialog, [role="dialog"], [role="alertdialog"]')).toBeNull();
  });
});
