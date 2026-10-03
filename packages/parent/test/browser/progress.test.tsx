// The progress view (task 5.2) in Chromium, on its real IndexedDB, with real sim-core Runs kept as the app keeps them:
// shown only behind the parental gate (D28) and only for the child in use, followed to the other child by the profile
// switch by pointer, touch and keyboard (ground rule 8), read again each time the gate opens the view, plain counts and
// real part names with no id, score or exclamation mark on the page (ground rule 7).
import { afterEach, describe, expect, it } from 'vitest';
import { cdp, userEvent } from 'vitest/browser';
import { openStore } from '@servo/app/store';
import type { ServoStore } from '@servo/app/store';
import type { ProfileId, RunRecord } from '@servo/schema';
import { PARENT_TEXT, mountParentWith } from '../../src/accounts/index.ts';
import type { ParentHandle } from '../../src/index.ts';
import { PROGRESS_TEXT } from '../../src/progress/index.ts';
import { fixture, planOf, runAll, without } from '../progress/runs.ts';

let mounted: { handle: ParentHandle; host: HTMLElement; store: ServoStore } | undefined;

afterEach(() => {
  mounted?.handle.destroy();
  mounted?.host.remove();
  mounted?.store.close();
  mounted = undefined;
});

const spinner = fixture('broken-reversed-motor');
const owned = (runs: readonly RunRecord[], profile: ProfileId): RunRecord[] => runs.map((run) => ({ ...run, profile }));

/** Robin fixed the spinning robot's reversed motor; Sam ran the roller once. Robin is in use. */
const family = async () => {
  const store = await openStore({ name: `servo-progress-${crypto.randomUUID()}` });
  const robin = await store.profiles.create('Robin');
  await store.profiles.use(robin.id);
  const sam = await store.profiles.create('Sam');
  const robinRuns = owned(await runAll([planOf(spinner), { ...planOf(spinner), blueprint: without(spinner.blueprint, 'motor-right') }]), robin.id);
  const samRuns = owned(await runAll([planOf(fixture('level-1-roller'))], 10), sam.id);
  for (const run of robinRuns) await store.forProfile(robin.id).runs.add(run);
  for (const run of samRuns) await store.forProfile(sam.id).runs.add(run);
  return { store, robin, sam, runs: [...robinRuns, ...samRuns] };
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

const progressOf = (host: HTMLElement): HTMLElement | null => host.querySelector<HTMLElement>('section.servo-progress');
const heading = (host: HTMLElement): string | null | undefined => progressOf(host)?.querySelector('h2')?.textContent;
const figures = (host: HTMLElement): string[] => [...(progressOf(host)?.querySelectorAll('h3') ?? [])].map((h3) => h3.textContent ?? '');

const radioFor = (host: HTMLElement, name: string): HTMLInputElement => {
  const label = [...host.querySelectorAll('label')].find((element) => element.textContent?.trim() === name);
  const radio = label?.querySelector<HTMLInputElement>('input[type="radio"]');
  if (!radio) throw new Error(`No radio for ${name}.`);
  return radio;
};

const tap = async (element: Element): Promise<void> => {
  const frame = window.frameElement?.getBoundingClientRect();
  const scale = frame ? frame.width / window.innerWidth : 1;
  const box = element.getBoundingClientRect();
  const point = { x: (frame?.left ?? 0) + (box.left + box.width / 2) * scale, y: (frame?.top ?? 0) + (box.top + box.height / 2) * scale };
  await cdp().send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, id: 0 }] });
  await cdp().send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
};

const ROBIN = ['Parts met: 6', 'Unscripted builds passed: 0', 'Faults fixed: 1', 'Time in the sandbox', 'Parts named'];

describe('the progress view', () => {
  it('shows nothing until the gate is answered, then only the child in use, in plain words with no ids', async () => {
    const { store, robin, sam, runs } = await family();
    const host = mount(store);
    await expect.poll(() => host.querySelector('input')).toBeTruthy();
    expect(progressOf(host)).toBeNull();
    expect(host.textContent).not.toContain('Robin');
    await passGate(host);

    await expect.poll(() => figures(host)).toEqual(ROBIN);
    expect(heading(host)).toBe(PROGRESS_TEXT.title('Robin'));
    const text = progressOf(host)?.textContent ?? '';
    expect(text).toContain(PROGRESS_TEXT.runs(2));
    expect(text).toContain('DC motor, first used');
    // The fault's line is the DC motor's own spec-card line for it, with how long the fix took.
    const fault = progressOf(host)?.querySelectorAll('ul')[1]?.textContent ?? '';
    expect(fault).toMatch(/^DC motor\. .+ Fixed in 2 Runs and under a minute|^DC motor\. .+ Fixed in 2 Runs and 1 minute/);
    expect(text).toContain(PROGRESS_TEXT.sandboxAbsent);
    expect(text).toContain(PROGRESS_TEXT.noRound);
    // Nothing of Sam's, no id, no exclamation mark.
    expect(text).not.toContain('Sam');
    for (const id of [robin.id, sam.id, ...runs.map((run) => run.id), ...runs.map((run) => run.blueprintId)]) expect(host.innerHTML).not.toContain(id);
    expect(text).not.toContain('!');
  }, 600_000);

  it('follows the profile switch by pointer, touch and keyboard, each time showing only that child', async () => {
    const { store } = await family();
    const host = mount(store);
    await passGate(host);
    await expect.poll(() => heading(host)).toBe(PROGRESS_TEXT.title('Robin'));

    const sams = ['Parts met: 5', 'Unscripted builds passed: 0', 'Faults fixed: 0', 'Time in the sandbox', 'Parts named'];
    await userEvent.click(radioFor(host, 'Sam'));
    await expect.poll(() => heading(host)).toBe(PROGRESS_TEXT.title('Sam'));
    await expect.poll(() => figures(host)[2]).toBe(sams[2]);
    expect(progressOf(host)?.textContent).toContain(PROGRESS_TEXT.runs(1));

    await tap(radioFor(host, 'Robin'));
    await expect.poll(() => heading(host)).toBe(PROGRESS_TEXT.title('Robin'));
    await expect.poll(() => figures(host)).toEqual(ROBIN);

    radioFor(host, 'Robin').focus();
    await userEvent.keyboard('{ArrowDown}');
    await expect.poll(() => heading(host)).toBe(PROGRESS_TEXT.title('Sam'));
    await expect.poll(() => figures(host)[2]).toBe(sams[2]);
    expect(progressOf(host)?.textContent).not.toContain('Robin');
  }, 600_000);

  it('is read again when the gate opens the view after the page was hidden', async () => {
    const { store, robin } = await family();
    let random = 0;
    const host = mount(store, () => random);
    await passGate(host);
    await expect.poll(() => figures(host)).toEqual(ROBIN);

    // A card-game round is played meanwhile, then the page is hidden and shown.
    await store.forProfile(robin.id).cardGames.add([
      { part: 'dc-motor', named: true },
      { part: 'caster', named: false },
    ]);
    let state: DocumentVisibilityState = 'hidden';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
    try {
      random = 0.99;
      document.dispatchEvent(new Event('visibilitychange'));
      state = 'visible';
      document.dispatchEvent(new Event('visibilitychange'));
    } finally {
      delete (document as { visibilityState?: unknown }).visibilityState;
    }
    await expect.poll(() => progressOf(host)).toBeNull();
    await passGate(host, '171');
    await expect.poll(() => progressOf(host)?.textContent ?? '').toContain('1 of 2 parts named in the card game');
  }, 600_000);
});
