// The sound layer (task 4.10) in Chromium. The real app page shows the sound switch in its header, on at first; off
// survives a real reload, and so does on again. In the shell with the real canvas: the switch by pointer, touch and
// Enter (Space stays Run and Stop, D42); a wire landed through the canvas's command layer clicks once; and the real
// Web Audio sink makes its AudioContext only at the child's first gesture, running, and suspends it with sound off.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cdp, userEvent } from 'vitest/browser';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { mountCanvas } from '@servo/canvas';
import type { CanvasHandle } from '@servo/canvas';
import { loadContent } from '@servo/content';
import { loadFixtures } from '@servo/content/fixtures';
import { RunBar } from '../../src/run-bar/index.ts';
import type { RunClock } from '../../src/run-bar/index.ts';
import { PLACEHOLDER_SLOTS, Shell, useShell } from '../../src/shell/index.ts';
import type { CanvasSetup, ShellApi } from '../../src/shell/index.ts';
import { MUTED_KEY, SOUND_TEXT, SoundControl, SoundLayer, WebAudioSink } from '../../src/sound/index.ts';
import type { AudioSink, SoundCue } from '../../src/sound/index.ts';
import { SCREENS, closeAll, openApp } from './frame.ts';

const { content } = loadContent();
const roller = loadFixtures().fixtures.find((fixture) => fixture.name === 'level-1-roller')?.blueprint;
if (!roller) throw new Error('no level-1-roller fixture');

const opened: { root: Root; host: HTMLElement; layer: SoundLayer }[] = [];

beforeEach(() => localStorage.removeItem(MUTED_KEY));
afterEach(() => {
  for (const { root, host, layer } of opened.splice(0)) {
    root.unmount();
    host.remove();
    layer.dispose();
  }
  closeAll();
  localStorage.removeItem(MUTED_KEY);
});

const switchIn = (root: ParentNode): HTMLButtonElement => {
  const found = root.querySelector<HTMLButtonElement>('[data-region="header"] button[role="switch"].sound-control');
  if (!found) throw new Error('no sound switch');
  return found;
};

describe('the sound switch on the app page', () => {
  it('starts on, and keeps off, then on, across a real reload', async () => {
    const app = await openApp(SCREENS[0] ?? { name: 'tablet', width: 1180, height: 820 });
    const sound = switchIn(app.doc);
    expect(sound.getAttribute('aria-checked')).toBe('true');
    expect(sound.textContent).toContain(SOUND_TEXT.label);
    expect(sound.textContent).toContain(SOUND_TEXT.on);

    await app.press(sound);
    expect(switchIn(app.doc).getAttribute('aria-checked')).toBe('false');
    expect(localStorage.getItem(MUTED_KEY)).toBe('true');

    await app.reload();
    expect(switchIn(app.doc).getAttribute('aria-checked')).toBe('false');
    expect(switchIn(app.doc).textContent).toContain(SOUND_TEXT.off);

    await app.press(switchIn(app.doc));
    await app.reload();
    expect(switchIn(app.doc).getAttribute('aria-checked')).toBe('true');
    expect(localStorage.getItem(MUTED_KEY)).toBe('false');
  });
});

class Heard implements AudioSink {
  readonly cues: SoundCue[] = [];
  play(cue: SoundCue): void {
    this.cues.push(cue);
  }
  setMuted(): void {}
  unlock(): void {}
  close(): void {}
}

/** A clock that never reaches the next frame: a Run stays in its spin-up. */
const HELD: RunClock = { now: () => 0, frame: () => () => undefined };

const mount = async (sink: AudioSink) => {
  const layer = new SoundLayer({ sink, storage: localStorage });
  const host = document.createElement('div');
  host.style.cssText = 'position: fixed; left: 0; top: 0; width: 1180px; height: 820px;';
  document.body.appendChild(host);
  const root = createRoot(host);
  opened.push({ root, host, layer });
  let shell: ShellApi | null = null;
  const Probe = () => {
    shell = useShell();
    return null;
  };
  const draw = (into: HTMLElement, setup: CanvasSetup): CanvasHandle =>
    mountCanvas(into, { catalogue: content.catalogue, resolveArt: (key) => content.art.get(key), level: setup.level, prefs: setup.prefs });
  await new Promise<void>((ready) => {
    root.render(
      <Shell
        content={content}
        level={1}
        storage={null}
        start={roller}
        mountCanvas={draw}
        onReady={ready}
        slots={{ ...PLACEHOLDER_SLOTS, goal: <Probe />, sound: <SoundControl layer={layer} />, runBar: <RunBar clock={HELD} seed={() => 7} /> }}
      />,
    );
  });
  await vi.waitFor(() => expect(shell?.canvas).toBeTruthy(), { timeout: 30_000 });
  const canvas = (): CanvasHandle => {
    const handle = (shell as ShellApi | null)?.canvas;
    if (!handle) throw new Error('no canvas');
    return handle;
  };
  return { host, layer, canvas, button: () => switchIn(host) };
};

/** A finger on `element`: a real touch through CDP, which the browser turns into the button's click. */
const touch = async (element: HTMLElement): Promise<void> => {
  const box = element.getBoundingClientRect();
  const frame = window.frameElement?.getBoundingClientRect();
  const point = { x: (frame?.left ?? 0) + box.left + box.width / 2, y: (frame?.top ?? 0) + box.top + box.height / 2 };
  await cdp().send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, id: 1 }] });
  await cdp().send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
};

describe('the sound switch in the shell', () => {
  it('turns by pointer, touch and Enter, and Space on it is still Run, not sound', async () => {
    const app = await mount(new Heard());
    await userEvent.click(app.button());
    await expect.poll(() => app.button().getAttribute('aria-checked')).toBe('false');
    await touch(app.button());
    await expect.poll(() => app.button().getAttribute('aria-checked')).toBe('true');
    app.button().focus();
    await userEvent.keyboard('{Enter}');
    await expect.poll(() => app.button().getAttribute('aria-checked')).toBe('false');
    expect(app.layer.muted).toBe(true);
    const toggle = (): string | null => app.host.querySelector('.run-bar-toggle')?.getAttribute('data-run') ?? null;
    expect(toggle()).toBe('run');
    await userEvent.keyboard(' ');
    await expect.poll(toggle, { timeout: 30_000 }).toBe('stop');
    expect(app.button().getAttribute('aria-checked')).toBe('false');
    await userEvent.keyboard(' ');
    await expect.poll(toggle).toBe('run');
    expect(app.button().getAttribute('aria-checked')).toBe('false');
    expect(localStorage.getItem(MUTED_KEY)).toBe('true');
  });

  it('clicks once as a wire lands through the command layer, and not as one is taken away', async () => {
    const sink = new Heard();
    const app = await mount(sink);
    const wire = roller.wires.find((candidate) => candidate.id === 'w10');
    if (!wire) throw new Error('no wire w10');
    expect(app.canvas().apply({ kind: 'disconnect', wireId: wire.id }).ok).toBe(true);
    expect(sink.cues).toEqual([]);
    expect(app.canvas().apply({ kind: 'connect', from: wire.from, to: wire.to }).ok).toBe(true);
    expect(sink.cues).toEqual([{ kind: 'click' }]);
  });

  it('makes a running AudioContext only at the first gesture, and suspends it with sound off', async () => {
    const contexts: AudioContext[] = [];
    const sink = new WebAudioSink(() => {
      const made = new AudioContext();
      contexts.push(made);
      return made;
    });
    const app = await mount(sink);
    expect(contexts).toEqual([]);
    await userEvent.click(app.host.querySelector<HTMLElement>('[data-region="header"]') ?? app.host);
    expect(contexts).toHaveLength(1);
    await expect.poll(() => contexts[0]?.state).toBe('running');
    await userEvent.click(app.button());
    await expect.poll(() => contexts[0]?.state).toBe('suspended');
    await userEvent.click(app.button());
    await expect.poll(() => contexts[0]?.state).toBe('running');
    expect(contexts).toHaveLength(1);
  });
});
