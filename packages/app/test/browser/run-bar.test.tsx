// The Run bar (task 4.4) in Chromium: the shell with the real canvas, the real content and sim-core, a real store in
// IndexedDB, and a clock the test moves. Run is off with a plain line until a part is placed; Run and Stop by pointer,
// touch and Space (never while typing, and one press is one toggle); Stop gives back the build byte for byte; slow
// motion steps one tick at a time with the tick's visual twin; Undo and Reset arena; each Run kept on Stop, and the
// build saved on Run (D71). No dialog anywhere (ground rule 9).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cdp, userEvent } from 'vitest/browser';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { mountCanvas } from '@servo/canvas';
import type { CanvasHandle, PropTemplate } from '@servo/canvas';
import { loadContent } from '@servo/content';
import { loadFixtures } from '@servo/content/fixtures';
import { serializeBlueprint } from '@servo/schema';
import type { Blueprint } from '@servo/schema';
import type { RunFrame } from '@servo/sim-core';
import { App } from '../../src/App.tsx';
import { RUN_BAR_TEXT, RunBar, SPIN_UP_MS } from '../../src/run-bar/index.ts';
import type { RunClock, RunLoop } from '../../src/run-bar/index.ts';
import { PLACEHOLDER_SLOTS, SAVE_LINES, SaveControl, Shell, useShell } from '../../src/shell/index.ts';
import type { CanvasSetup, ShellApi } from '../../src/shell/index.ts';
import { openStore } from '../../src/store/index.ts';
import type { ProfileStore, ServoStore } from '../../src/store/index.ts';

const { content } = loadContent();
const roller = loadFixtures().fixtures.find((fixture) => fixture.name === 'level-1-roller')?.blueprint;
if (!roller) throw new Error('no level-1-roller fixture');
const BOX: PropTemplate = { shape: 'box', size: { x: 100, y: 100, z: 60 }, grams: 80, fixed: false };

/** A clock the test moves: each `advance` runs the waiting frame callback once. */
class TestClock implements RunClock {
  time = 0;
  private waiting: (() => void) | undefined;
  now(): number {
    return this.time;
  }
  frame(callback: () => void): () => void {
    this.waiting = callback;
    return () => {
      if (this.waiting === callback) this.waiting = undefined;
    };
  }
  advance(ms: number): void {
    this.time += ms;
    const callback = this.waiting;
    this.waiting = undefined;
    flushSync(() => callback?.());
  }
}

interface Mounted {
  readonly host: HTMLElement;
  readonly shell: () => ShellApi;
  readonly canvas: () => CanvasHandle;
  readonly loop: () => RunLoop;
  readonly clock: TestClock;
  readonly frames: RunFrame[];
  readonly child: ProfileStore;
  readonly build: Blueprint;
}

const opened: { root: Root; host: HTMLElement; store: ServoStore }[] = [];

afterEach(() => {
  for (const { root, host, store } of opened.splice(0)) {
    root.unmount();
    host.remove();
    store.close();
  }
  vi.restoreAllMocks();
});

/** The shell round the real canvas, opened on `start` kept as the child's own build in a store of its own. */
const mount = async (start: Blueprint | 'empty', wrap: (child: ProfileStore) => ProfileStore = (child) => child): Promise<Mounted> => {
  const store = await openStore({ name: `servo-run-bar-${crypto.randomUUID()}` });
  const profile = await store.profiles.create('Builder 1');
  const child = store.forProfile(profile.id);
  const build =
    start === 'empty'
      ? await child.blueprints.create({ name: 'Build 1', level: 1, arena: { preset: 'open-floor', props: [] } })
      : await child.blueprints.copy(start).then((copied) => {
          if (!copied.ok) throw new Error('the fixture did not copy');
          return copied.blueprint;
        });
  const host = document.createElement('div');
  host.style.cssText = 'position: fixed; left: 0; top: 0; width: 1180px; height: 820px;';
  document.body.appendChild(host);
  const root = createRoot(host);
  opened.push({ root, host, store });
  const clock = new TestClock();
  const frames: RunFrame[] = [];
  let shell: ShellApi | null = null;
  let loop: RunLoop | null = null;
  const Probe = () => {
    shell = useShell();
    return null;
  };
  const counting = (into: HTMLElement, setup: CanvasSetup): CanvasHandle => {
    const handle = mountCanvas(into, { catalogue: content.catalogue, resolveArt: (key) => content.art.get(key), level: setup.level, prefs: setup.prefs });
    const draw = handle.applyRunFrame.bind(handle);
    handle.applyRunFrame = (frame) => {
      frames.push(frame);
      draw(frame);
    };
    return handle;
  };
  await new Promise<void>((ready) => {
    root.render(
      <Shell
        content={content}
        level={1}
        storage={null}
        child={wrap(child)}
        start={build}
        mountCanvas={counting}
        onReady={ready}
        slots={{
          ...PLACEHOLDER_SLOTS,
          goal: <Probe />,
          save: <SaveControl />,
          runBar: (
            <RunBar
              clock={clock}
              seed={() => 7}
              onLoop={(made) => {
                loop = made ?? loop;
              }}
            />
          ),
        }}
      />,
    );
  });
  await vi.waitFor(() => expect(loop).not.toBeNull(), { timeout: 30_000 });
  const need = <T,>(value: T | null, what: string): T => {
    if (value === null) throw new Error(`no ${what}`);
    return value;
  };
  return {
    host,
    shell: () => need(shell, 'shell'),
    canvas: () => need(need(shell, 'shell').canvas, 'canvas'),
    loop: () => need(loop, 'loop'),
    clock,
    frames,
    child,
    build,
  };
};

const runBar = (app: Mounted): HTMLElement => {
  const bar = app.host.querySelector<HTMLElement>('[data-region="runBar"] .run-bar');
  if (!bar) throw new Error('no Run bar');
  return bar;
};

const button = (app: Mounted, name: string): HTMLButtonElement => {
  const found = [...runBar(app).querySelectorAll('button')].find((candidate) => (candidate.getAttribute('aria-label') ?? candidate.textContent) === name);
  if (!found) throw new Error(`no ${name} button`);
  return found;
};

const toggle = (app: Mounted): HTMLButtonElement => {
  const found = runBar(app).querySelector<HTMLButtonElement>('.run-bar-toggle');
  if (!found) throw new Error('no Run/Stop toggle');
  return found;
};

/** A finger on `element`: a real touch through CDP, which the browser turns into the button's click. */
const touch = async (element: HTMLElement): Promise<void> => {
  const box = element.getBoundingClientRect();
  const frame = window.frameElement?.getBoundingClientRect();
  const point = { x: (frame?.left ?? 0) + box.left + box.width / 2, y: (frame?.top ?? 0) + box.top + box.height / 2 };
  await cdp().send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, id: 1 }] });
  await cdp().send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
};

const playing = async (app: Mounted): Promise<void> => {
  await expect.poll(() => app.loop().phase, { timeout: 30_000 }).toBe('spin-up');
};

const SOON = { timeout: 10_000 };

describe('the Run bar', () => {
  it('keeps Run off with one plain line until a part is placed, then lets it run', async () => {
    const alerts = [vi.spyOn(window, 'alert'), vi.spyOn(window, 'confirm')];
    const app = await mount('empty');
    const run = toggle(app);
    expect(run.textContent).toBe(RUN_BAR_TEXT.run);
    // Off, but focusable, so a keyboard or screen reader reaches it and hears why (rule 8).
    expect(run.getAttribute('aria-disabled')).toBe('true');
    // The toggle turns on in the render after the loop is handed out (onLoop runs in the same effect as setLoop).
    await vi.waitFor(() => expect(run.disabled).toBe(false), SOON);
    // A press does nothing. (Playwright will not click what is aria-disabled, so this is the DOM's click.)
    run.click();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(app.loop().phase).toBe('build');
    const reason = runBar(app).querySelector('.run-bar-reason');
    expect(reason?.textContent).toBe(RUN_BAR_TEXT.nothingPlaced);
    expect(reason?.getAttribute('role')).toBe('status');
    expect(run.getAttribute('aria-describedby')).toBe(reason?.id);
    expect(runBar(app).querySelector('[role="group"]')).toBeNull();
    // Space does nothing with nothing to run.
    await userEvent.keyboard(' ');
    expect(app.loop().phase).toBe('build');
    expect(app.canvas().mode).toBe('build');

    flushSync(() => app.canvas().apply({ kind: 'place-part', part: 'chassis' }));
    expect(toggle(app).getAttribute('aria-disabled')).toBe('false');
    expect(runBar(app).querySelector('.run-bar-reason')).toBeNull();
    expect(runBar(app).querySelector('[role="group"]')?.getAttribute('aria-label')).toBe(RUN_BAR_TEXT.clock);
    expect(toggle(app).hasAttribute('aria-describedby')).toBe(false);
    await userEvent.click(toggle(app));
    await playing(app);
    expect(app.canvas().mode).toBe('run');
    expect(toggle(app).textContent).toBe(RUN_BAR_TEXT.stop);
    // Real words only, and no exclamation marks in system text (ground rule 7); no dialog (ground rule 9).
    expect(runBar(app).textContent).not.toContain('!');
    for (const alert of alerts) expect(alert).not.toHaveBeenCalled();
  });

  it('runs and stops by pointer, touch and Space, and Stop gives back the build exactly', async () => {
    const app = await mount(roller);
    const canvas = app.canvas();
    const before = serializeBlueprint(canvas.blueprint as Blueprint);
    expect(toggle(app).getAttribute('aria-keyshortcuts')).toBe('Space');

    // Pointer: Run, the spin-up holds tick 0, then the robot moves.
    await userEvent.click(toggle(app));
    await playing(app);
    expect(app.host.querySelector('.servo-shell')?.getAttribute('data-mode')).toBe('run');
    expect(app.frames.map((frame) => frame.tick)).toEqual([0]);
    app.clock.advance(SPIN_UP_MS / 2);
    expect(app.frames.map((frame) => frame.tick)).toEqual([0]);
    app.clock.advance(SPIN_UP_MS / 2);
    for (let tick = 0; tick < 29; tick += 1) app.clock.advance(1000 / 30);
    expect(app.frames.map((frame) => frame.tick)).toEqual(Array.from({ length: 31 }, (_, tick) => tick));
    const poses = (frame: RunFrame | undefined): string => JSON.stringify([...(frame?.live.values() ?? [])].map((state) => state.motion));
    expect(poses(app.frames.at(-1))).not.toBe(poses(app.frames[0]));
    // In Run mode the build is locked, so Undo and Reset arena are off.
    expect(button(app, RUN_BAR_TEXT.undo).disabled).toBe(true);
    expect(button(app, RUN_BAR_TEXT.resetArena).disabled).toBe(true);

    // Touch: Stop. Build mode, tick 0, and the build exactly as it was (ground rule 4).
    await touch(toggle(app));
    await vi.waitFor(() => expect(canvas.mode).toBe('build'), SOON);
    expect(app.loop().phase).toBe('build');
    expect(app.loop().tick).toBe(0);
    expect(serializeBlueprint(canvas.blueprint as Blueprint)).toBe(before);
    expect(serializeBlueprint(app.shell().blueprint as Blueprint)).toBe(before);
    expect(toggle(app).textContent).toBe(RUN_BAR_TEXT.run);

    // Space with focus on the page: Run, then Stop.
    (document.activeElement as HTMLElement | null)?.blur();
    await userEvent.keyboard(' ');
    await playing(app);
    await userEvent.keyboard(' ');
    await vi.waitFor(() => expect(canvas.mode).toBe('build'), SOON);

    // Space with focus on the toggle itself: one press is one toggle, not two.
    toggle(app).focus();
    await userEvent.keyboard(' ');
    await playing(app);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(app.loop().phase).toBe('spin-up');
    toggle(app).focus();
    await userEvent.keyboard(' ');
    await vi.waitFor(() => expect(canvas.mode).toBe('build'), SOON);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(app.loop().phase).toBe('build');
    expect(serializeBlueprint(canvas.blueprint as Blueprint)).toBe(before);

    // Space while typing the build's name types a space (4.4 note).
    await userEvent.click(app.host.querySelector<HTMLButtonElement>('button.shell-blueprint-name') as HTMLButtonElement);
    const field = app.host.querySelector<HTMLInputElement>('input.shell-blueprint-name-input');
    expect(field).not.toBeNull();
    field?.focus();
    await userEvent.keyboard('{End} 2');
    expect(field?.value.endsWith(' 2')).toBe(true);
    expect(app.loop().phase).toBe('build');
  });

  it('steps one tick at a time in slow motion, each with the tick’s visual twin', async () => {
    const app = await mount(roller);
    const twin = (): HTMLElement => runBar(app).querySelector<HTMLElement>('.run-bar-twin') as HTMLElement;
    const spoken = (): string | null | undefined => runBar(app).querySelector('.run-bar-spoken')?.textContent;
    expect(spoken()).toBe('30 ticks a second');
    expect(button(app, RUN_BAR_TEXT.faster).disabled).toBe(true);
    // Slower, by pointer and touch, down to 1 tick a second.
    for (let step = 0; step < 3; step += 1) await userEvent.click(button(app, RUN_BAR_TEXT.slower));
    for (let step = 0; step < 3; step += 1) await touch(button(app, RUN_BAR_TEXT.slower));
    await vi.waitFor(() => expect(spoken()).toBe('1 tick a second, slow motion'), SOON);
    expect(button(app, RUN_BAR_TEXT.slower).disabled).toBe(true);

    await userEvent.click(toggle(app));
    await playing(app);
    expect(twin().dataset.shown).toBe('true');
    expect(twin().dataset.tick).toBe('0');
    const seen: Element[] = [];
    app.clock.advance(SPIN_UP_MS);
    for (let tick = 1; tick <= 4; tick += 1) {
      if (tick > 1) {
        // Between steps nothing moves on: half a second on, still the tick before.
        app.clock.advance(500);
        expect(twin().dataset.tick).toBe(String(tick - 1));
        app.clock.advance(500);
      }
      // One step, one frame on the canvas, one beat of the twin: the dot fills or empties and pulses again.
      expect(app.frames.map((frame) => frame.tick)).toEqual(Array.from({ length: tick + 1 }, (_, at) => at));
      expect(twin().dataset.tick).toBe(String(tick));
      expect(twin().dataset.beat).toBe(tick % 2 === 0 ? 'even' : 'odd');
      expect(twin().textContent).toBe(`${RUN_BAR_TEXT.tick} ${tick}`);
      const beat = twin().querySelector('.run-bar-beat');
      if (!beat) throw new Error('no beat');
      expect(seen).not.toContain(beat);
      seen.push(beat);
    }
    // Faster again, mid-Run, by keyboard: back at normal speed the twin goes, as the tick sound does.
    button(app, RUN_BAR_TEXT.faster).focus();
    for (let step = 0; step < 6; step += 1) await userEvent.keyboard('{Enter}');
    await vi.waitFor(() => expect(spoken()).toBe('30 ticks a second'), SOON);
    expect(twin().dataset.shown).toBe('false');
    await userEvent.click(toggle(app));
    await vi.waitFor(() => expect(app.canvas().mode).toBe('build'), SOON);
  });

  it('undoes each edit, and Reset arena drops the child’s props and is undone too (D29)', async () => {
    const app = await mount(roller);
    const canvas = app.canvas();
    const before = serializeBlueprint(canvas.blueprint as Blueprint);
    const undo = (): HTMLButtonElement => button(app, RUN_BAR_TEXT.undo);
    const reset = (): HTMLButtonElement => button(app, RUN_BAR_TEXT.resetArena);
    expect(undo().disabled).toBe(true);
    expect(reset().disabled).toBe(true);

    flushSync(() => canvas.apply({ kind: 'remove-part', partId: 'caster' }));
    expect(canvas.blueprint?.parts.some((part) => part.id === 'caster')).toBe(false);
    expect(undo().disabled).toBe(false);
    await userEvent.click(undo());
    await vi.waitFor(() => expect(serializeBlueprint(canvas.blueprint as Blueprint)).toBe(before), SOON);
    expect(undo().disabled).toBe(true);

    flushSync(() => canvas.apply({ kind: 'place-prop', prop: BOX, at: { x: 900, y: 300, heading: 0 } }));
    flushSync(() => canvas.apply({ kind: 'place-prop', prop: BOX, at: { x: 900, y: 500, heading: 0 } }));
    const withProps = serializeBlueprint(canvas.blueprint as Blueprint);
    expect(canvas.blueprint?.arena.props).toHaveLength(2);
    expect(reset().disabled).toBe(false);
    await touch(reset());
    await vi.waitFor(() => expect(canvas.blueprint?.arena.props).toEqual([]), SOON);
    expect(canvas.blueprint?.arena.preset).toBe(roller.arena.preset);
    expect(canvas.blueprint?.parts).toEqual(JSON.parse(withProps).parts);
    expect(canvas.blueprint?.wires).toEqual(JSON.parse(withProps).wires);
    expect(reset().disabled).toBe(true);
    // Undo brings the props back, then each one away.
    await userEvent.click(undo());
    await vi.waitFor(() => expect(serializeBlueprint(canvas.blueprint as Blueprint)).toBe(withProps), SOON);
    await userEvent.click(undo());
    await userEvent.click(undo());
    await vi.waitFor(() => expect(serializeBlueprint(canvas.blueprint as Blueprint)).toBe(before), SOON);
  });

  it('never waits on the store: a stalled store still runs at once, and a failed save is the plain save line', async () => {
    const never = new Promise<never>(() => undefined);
    const app = await mount(roller, (child) => ({
      ...child,
      blueprints: { ...child.blueprints, save: () => Promise.reject(new Error('The store is full.')) },
      runs: { ...child.runs, list: () => never, add: () => never },
    }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    flushSync(() => app.canvas().apply({ kind: 'rename', name: 'Rolling robot 2' }));
    await userEvent.click(toggle(app));
    await playing(app);
    app.clock.advance(SPIN_UP_MS);
    app.clock.advance(1000 / 30);
    expect(app.loop().phase).toBe('running');
    await userEvent.click(toggle(app));
    await vi.waitFor(() => expect(app.canvas().mode).toBe('build'), SOON);
    // The Simulation is kept, and the store is still not answering: the next Run starts at once, with no loading.
    await userEvent.click(toggle(app));
    expect(app.loop().phase).toBe('spin-up');
    await userEvent.click(toggle(app));
    await vi.waitFor(() => expect(app.host.querySelector('[data-region="header"] [role="status"]')?.textContent).toBe(SAVE_LINES.notSaved), SOON);
    expect(warn).toHaveBeenCalledWith('The earlier Runs of this build were not read in time, so this Run is not kept.');
  });

  it('keeps each Run on Stop, and saves the build as Run is pressed (D71)', async () => {
    const app = await mount(roller);
    const canvas = app.canvas();
    flushSync(() => canvas.apply({ kind: 'rename', name: 'Rolling robot 2' }));
    await userEvent.click(toggle(app));
    await playing(app);
    await vi.waitFor(async () => {
      const stored = await app.child.blueprints.load(app.build.meta.id);
      expect(stored.ok && stored.blueprint.meta.name).toBe('Rolling robot 2');
    }, SOON);
    app.clock.advance(SPIN_UP_MS);
    for (let tick = 1; tick < 15; tick += 1) app.clock.advance(1000 / 30);
    await userEvent.click(toggle(app));
    await vi.waitFor(async () => expect(await app.child.runs.list({ blueprintId: app.build.meta.id })).toHaveLength(1), SOON);
    await userEvent.click(toggle(app));
    await playing(app);
    app.clock.advance(SPIN_UP_MS);
    await userEvent.click(toggle(app));
    await vi.waitFor(async () => expect(await app.child.runs.list({ blueprintId: app.build.meta.id })).toHaveLength(2), SOON);
    // A Run stopped in its spin-up showed nothing, so it is not kept (R-4.4, finding 1).
    await userEvent.click(toggle(app));
    await playing(app);
    await userEvent.click(toggle(app));
    await vi.waitFor(() => expect(app.canvas().mode).toBe('build'), SOON);
    await new Promise((resolve) => setTimeout(resolve, 200));
    const runs = await app.child.runs.list({ blueprintId: app.build.meta.id });
    expect(runs.map((run) => [run.runNumber, run.ticks, run.seed])).toEqual([
      [1, 15, 7],
      [2, 1, 7],
    ]);
    expect(runs.every((run) => run.profile === app.child.profile)).toBe(true);
  });
});

describe('the app’s Run bar and spec card together', () => {
  it('gives the spec card each frame, so its live readouts follow the Run and clear on Stop', async () => {
    const host = document.createElement('div');
    host.style.cssText = 'position: fixed; left: 0; top: 0; width: 1180px; height: 820px;';
    document.body.appendChild(host);
    const root = createRoot(host);
    try {
      await new Promise<void>((ready) => root.render(<App content={content} start={roller} onReady={ready} />));
      // Select the left DC motor through the canvas's list view: the screen-reader path to the spec card.
      const inList = (selector: string): HTMLButtonElement | null => host.querySelector<HTMLButtonElement>(`.servo-list-view ${selector}`);
      await vi.waitFor(() => expect(inList('[data-toggle="part:motor-left"]')).not.toBeNull(), { timeout: 30_000 });
      inList('[data-toggle="part:motor-left"]')?.click();
      await vi.waitFor(() => expect(inList('[data-action="select:part:motor-left"]')).not.toBeNull(), SOON);
      inList('[data-action="select:part:motor-left"]')?.click();
      const card = (): HTMLElement => host.querySelector<HTMLElement>('[data-region="specCard"]') as HTMLElement;
      await vi.waitFor(() => expect(card().dataset.shown).toBe('true'), SOON);
      const readouts = (): Element | null => card().querySelector('.spec-card-readouts');
      expect(readouts()).toBeNull();

      const run = host.querySelector<HTMLButtonElement>('[data-region="runBar"] .run-bar-toggle') as HTMLButtonElement;
      run.click();
      // Live readouts appear with the Run, and change as it steps.
      await vi.waitFor(() => expect(readouts()).not.toBeNull(), { timeout: 30_000 });
      const values = (): string => [...card().querySelectorAll('.spec-card-readout')].map((readout) => readout.getAttribute('data-value')).join(' ');
      const first = values();
      await vi.waitFor(() => expect(values()).not.toBe(first), { timeout: 30_000 });
      run.click();
      await vi.waitFor(() => expect(readouts()).toBeNull(), SOON);
      expect(run.textContent).toBe(RUN_BAR_TEXT.run);
    } finally {
      root.unmount();
      host.remove();
    }
  });
});
