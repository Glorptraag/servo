// The Level 3 slot (task 6.6) in the real app: the real shell, canvas and Run bar at the 10-inch size, with the real
// content plus the schema's example microcontroller, as the content has no brain yet (test/program-view/fixtures.ts).
// Off by default: the servo motor's angle stays locked, a microcontroller's card shows no program, and in a Run the
// servo motor gets no signal. On, from the device's localStorage: only the angle unlocks (rule 10), by keyboard,
// pointer and touch on the card's native slider and from the canvas's list view, which give the same build; the
// program view follows it; and
// Run on the real Run bar sweeps the servo motor to the angle set.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cdp, userEvent } from 'vitest/browser';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { mountCanvas } from '@servo/canvas';
import { serializeBlueprint } from '@servo/schema';
import { App } from '../../src/App.tsx';
import { FLAGS_KEY } from '../../src/flags/index.ts';
import { slotSetting } from '../../src/program-view/index.ts';
import { Shell, useShell } from '../../src/shell/index.ts';
import type { ShellApi } from '../../src/shell/index.ts';
import { SpecCard } from '../../src/spec-card/index.ts';
import { benchContent, servoOnBrain } from '../program-view/fixtures.ts';

/** The bench, with a DC motor and an LED left loose: their Level 3 settings must stay locked with the slot on. */
const bench = (() => {
  const build = servoOnBrain();
  return {
    ...build,
    parts: [
      ...build.parts,
      { id: 'motor', part: 'dc-motor', position: { x: 140, y: 60 }, rotation: 0, settings: {} },
      { id: 'lamp', part: 'led', position: { x: 140, y: -60 }, rotation: 0, settings: {} },
    ],
  };
})();

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
  root.render(<App content={content} start={bench} onReady={() => (ready = true)} />);
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

const settingIds = (host: HTMLElement): (string | undefined)[] =>
  [...card(host).querySelectorAll<HTMLElement>('[data-setting]')].map((each) => each.dataset.setting);
const liveAngle = (host: HTMLElement): number => Number(card(host).querySelector<HTMLElement>('[data-readout="angle"]')?.dataset.value);
const runButton = (host: HTMLElement) => element<HTMLButtonElement>(host, '.run-bar [data-run]');
const phase = (host: HTMLElement) => element<HTMLElement>(host, '.run-bar').dataset.phase;

describe('the Level 3 slot', () => {
  it('is off by default: the angle is locked, a microcontroller shows no program, and a Run gives the servo motor no signal', async () => {
    expect(localStorage.getItem(FLAGS_KEY)).toBeNull();
    const host = await mount();
    await select(host, 'servo');
    expect(element<HTMLElement>(host, 'article.spec-card').dataset.part).toBe('servo-motor');
    expect(card(host).querySelector('[data-setting="angle"]')).toBeNull();
    expect(await listAction(host, 'servo', 'setting:servo:angle:up')).toBeNull();
    await select(host, 'brain');
    expect(element<HTMLElement>(host, 'article.spec-card').dataset.part).toBe('microcontroller');
    expect(card(host).querySelector('.program-view')).toBeNull();

    await select(host, 'servo');
    runButton(host).click();
    await vi.waitFor(() => expect(phase(host)).toBe('running'), { timeout: 20_000 });
    await vi.waitFor(() => expect(card(host).querySelector('.spec-card-faults')?.textContent).toBe('No signal: the arm stays where it is and hums.'), {
      timeout: 10_000,
    });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(liveAngle(host)).toBe(90);
    runButton(host).click();
    await vi.waitFor(() => expect(phase(host)).toBe('build'));
  });

  it('on: only the angle unlocks, by keyboard, pointer and touch, and the program view follows it', async () => {
    localStorage.setItem(FLAGS_KEY, JSON.stringify(['level-3-slot']));
    const host = await mount();

    // The microcontroller's program: out 1 follows the servo motor's angle, 90° until it is set.
    await select(host, 'brain');
    expect(card(host).querySelector('.program-view h3')?.textContent).toBe('Program');
    expect(rule(host)?.textContent).toBe('Always set out 1 to the servo motor’s angle, 90°.');
    expect(rule(host)?.dataset.level).toBe('0.5');

    // Rule 10: the DC motor's speed and the LED's colour stay locked at Level 1, on the card and in the list view.
    await select(host, 'motor');
    expect(settingIds(host)).not.toContain('speed');
    expect(await listAction(host, 'motor', 'select:part:motor')).not.toBeNull();
    expect(host.querySelector('[data-action^="setting:motor:speed:"]')).toBeNull();
    expect(await listAction(host, 'lamp', 'select:part:lamp')).not.toBeNull();
    expect(host.querySelector('[data-action^="setting:lamp:colour:"]')).toBeNull();
    await select(host, 'lamp');
    expect(settingIds(host)).not.toContain('colour');

    // The servo motor's card at the child's level, with the angle open.
    await select(host, 'servo');
    expect(element<HTMLElement>(host, 'article.spec-card').dataset.level).toBe('1');
    expect(settingIds(host)).toEqual(['angle']);
    expect([slider(host).min, slider(host).max, slider(host).step, slider(host).value]).toEqual(['0', '180', '15', '90']);
    expect(slider(host).getAttribute('aria-valuetext')).toBe('90°');

    slider(host).focus();
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}{ArrowLeft}');
    await vi.waitFor(() => expect(shownAngle(host)).toBe('45°'));

    await dragSlider(host, 3 / 12, 10 / 12, 'mouse');
    await vi.waitFor(() => expect(shownAngle(host)).toBe('150°'));

    await dragSlider(host, 10 / 12, 4 / 12, 'touch');
    await vi.waitFor(() => expect(shownAngle(host)).toBe('60°'));

    // The list view, delivered with the slider (rule 8).
    const up = await listAction(host, 'servo', 'setting:servo:angle:up');
    expect(up?.textContent).toBe('Set servo motor angle to 75°');
    up?.click();
    await vi.waitFor(() => expect(shownAngle(host)).toBe('75°'));

    await select(host, 'brain');
    expect(rule(host)?.textContent).toBe('Always set out 1 to the servo motor’s angle, 75°.');
    expect(Number(rule(host)?.dataset.level)).toBeCloseTo(75 / 180, 12);
    expect(document.querySelector('dialog, [role="dialog"], [role="alertdialog"]')).toBeNull();
  });

  it('on: the list view and the card’s slider give the same build (rule 8)', async () => {
    // The app's composition (App.tsx) on the real canvas, with the shell's build in reach: the slot's setting given
    // to the card and to the canvas's list view.
    const build = async (by: 'slider' | 'list'): Promise<string> => {
      const host = document.createElement('div');
      host.style.cssText = 'position: fixed; left: 0; top: 0; width: 1180px; height: 820px;';
      document.body.appendChild(host);
      const root = createRoot(host);
      mounted = { root, host };
      let shell: ShellApi | null = null;
      const Probe = () => {
        shell = useShell();
        return null;
      };
      root.render(
        <Shell
          content={content}
          level={1}
          storage={null}
          start={bench}
          slots={{ specCard: <SpecCard speech={null} unlocked={slotSetting} />, sound: <Probe /> }}
          mountCanvas={(where, setup) =>
            mountCanvas(where, { catalogue: content.catalogue, resolveArt: () => undefined, level: setup.level, prefs: setup.prefs, unlockSettings: slotSetting })
          }
        />,
      );
      await vi.waitFor(() => expect((shell as ShellApi | null)?.canvas).toBeTruthy());
      const start = (shell as ShellApi | null)?.blueprint;
      if (by === 'list') {
        const down = await listAction(host, 'servo', 'setting:servo:angle:down');
        expect(down?.textContent).toBe('Set servo motor angle to 75°');
        down?.click();
      } else {
        await select(host, 'servo');
        slider(host).focus();
        await userEvent.keyboard('{ArrowLeft}');
      }
      await vi.waitFor(() => expect((shell as ShellApi | null)?.blueprint).not.toBe(start));
      const after = (shell as ShellApi | null)?.blueprint;
      if (!after) throw new Error('no build');
      expect(after.parts.find((part) => part.id === 'servo')?.settings).toEqual({ angle: 75 });
      root.unmount();
      host.remove();
      mounted = undefined;
      return serializeBlueprint(after);
    };
    expect(await build('list')).toBe(await build('slider'));
  });

  it('on: Run on the real Run bar sweeps the servo motor to the angle set, and Stop brings it back', async () => {
    localStorage.setItem(FLAGS_KEY, JSON.stringify(['level-3-slot']));
    const host = await mount();
    await select(host, 'servo');
    slider(host).focus();
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}{ArrowLeft}');
    await vi.waitFor(() => expect(shownAngle(host)).toBe('45°'));

    const seen: number[] = [];
    runButton(host).click();
    await vi.waitFor(
      () => {
        const angle = liveAngle(host);
        if (Number.isFinite(angle) && seen.at(-1) !== angle) seen.push(angle);
        expect(angle).toBeCloseTo(45, 6);
      },
      { timeout: 20_000, interval: 5 },
    );
    expect(phase(host)).toBe('running');
    // A sweep from 90°, never going back, with no no-signal line.
    expect(seen[0]).toBe(90);
    expect(seen.every((angle, index) => index === 0 || angle <= (seen[index - 1] ?? 90))).toBe(true);
    expect(card(host).querySelector('.spec-card-faults')?.textContent).toBe('');

    runButton(host).click();
    await vi.waitFor(() => expect(phase(host)).toBe('build'));
    expect(shownAngle(host)).toBe('45°');
    expect(document.querySelector('dialog, [role="dialog"], [role="alertdialog"]')).toBeNull();
  });
});
