// The spec card (task 4.3) in the real shell at the 10-inch landscape size (1180 × 820), with the real content and a
// stand-in canvas that applies commands through the canvas's own `applyEdit`. Every Level 1–2 part's card at Levels 1
// and 2 with nothing cut off; settings by pointer, touch and keyboard, each one `set-setting` and locked in Run; a
// slider in child-sized steps; live readouts in Run equal to the run record's values; failure lines while they happen;
// speak-it reading exactly the words shown, and no button without speechSynthesis.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cdp, userEvent } from 'vitest/browser';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { applyEdit } from '@servo/canvas';
import type { CanvasEventMap, CanvasHandle, CanvasMode, EditCommand, EditResult, ListView, Selection } from '@servo/canvas';
import { loadContent } from '@servo/content';
import { loadFixtures } from '@servo/content/fixtures';
import type { Blueprint, Level, PartRecord, RunEvent, ValuePayload } from '@servo/schema';
import { validBlueprints } from '@servo/schema/fixtures';
import { createSimulation } from '@servo/sim-core';
import type { RunFrame } from '@servo/sim-core';
import { Shell, specCardSize, useShell } from '../../src/shell/index.ts';
import type { ShellApi } from '../../src/shell/index.ts';
import { SPEAK_RATE, SpecCard, createRunFrames, formatReadout, pageSpeech, titleOf } from '../../src/spec-card/index.ts';
import type { RunFrames, SpeechPort } from '../../src/spec-card/index.ts';

const { content } = loadContent();
const { fixtures } = loadFixtures();
const launchParts = content.parts.filter((part) => part.identity.level <= 2);
const TEN_INCH = { width: 1180, height: 820 } as const;

/** The canvas's command path without its drawing: `apply` runs `applyEdit` and fires `edit`, `select` fires `select`. */
class StandInCanvas implements CanvasHandle {
  mode: CanvasMode = 'build';
  blueprint: Blueprint | undefined;
  selection: Selection | null = null;
  zoom = 1;
  readonly applied: EditCommand[] = [];
  private readonly listeners = new Map<keyof CanvasEventMap, Set<(event: never) => void>>();

  get listView(): ListView {
    throw new Error('not in the stand-in');
  }
  load(blueprint: Blueprint) {
    this.blueprint = blueprint;
    return { ok: true, value: blueprint } as const;
  }
  apply(command: EditCommand): EditResult {
    this.applied.push(command);
    if (this.mode === 'run') return { ok: false, refusal: { code: 'edit.locked', message: 'Run mode' } };
    if (!this.blueprint) return { ok: false, refusal: { code: 'edit.no_build', message: 'no build' } };
    const result = applyEdit(this.blueprint, command, content.catalogue);
    if (result.ok) {
      this.blueprint = result.blueprint;
      this.emit('edit', { command, blueprint: result.blueprint });
    }
    return result;
  }
  beginPlacement(): void {}
  beginPropPlacement(): void {}
  cancelPlacement(): void {}
  setRemoveTargets(): void {}
  select(selection: Selection | null): void {
    this.selection = selection;
    this.emit('select', { selection });
  }
  setMode(mode: CanvasMode): void {
    this.mode = mode;
  }
  applyRunFrame(): void {}
  showHint(): boolean {
    return false;
  }
  clearHints(): void {}
  fit(): void {}
  setZoom(zoom: number): void {
    this.zoom = zoom;
  }
  tidyWires(): void {}
  setSafeArea(): void {}
  setLevel(): void {}
  setPrefs(): void {}
  on<K extends keyof CanvasEventMap>(type: K, listener: (event: CanvasEventMap[K]) => void): () => void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener as (event: never) => void);
    this.listeners.set(type, set);
    return () => set.delete(listener as (event: never) => void);
  }
  emit<K extends keyof CanvasEventMap>(type: K, event: CanvasEventMap[K]): void {
    for (const listener of this.listeners.get(type) ?? []) (listener as (event: CanvasEventMap[K]) => void)(event);
  }
  destroy(): void {}
}

/** Speak-it's voice, recording what it is asked to read. */
const recordingSpeech = (): SpeechPort & { readonly said: { text: string; rate: number }[]; cancels: number } => {
  const said: { text: string; rate: number }[] = [];
  const port = {
    said,
    cancels: 0,
    synth: {
      speak: (utterance: SpeechSynthesisUtterance) => void said.push({ text: utterance.text, rate: utterance.rate }),
      cancel: () => {
        port.cancels += 1;
        said.length = 0;
      },
    },
    Utterance: class {
      text: string;
      rate = 1;
      lang = '';
      constructor(text: string) {
        this.text = text;
      }
    } as unknown as SpeechPort['Utterance'],
  };
  return port;
};

const rollingStart = validBlueprints.find((fixture) => fixture.name === 'rolling-start')?.data as Blueprint;
/** A build of one loose part, `p1`. */
const onePart = (record: PartRecord): Blueprint => ({
  ...rollingStart,
  parts: [{ id: 'p1', part: record.id, position: { x: 0, y: 0 }, rotation: 0, settings: {} }],
  wires: [],
  meta: { ...rollingStart.meta, highWater: { ...rollingStart.meta.highWater, parts: 1 } },
});
const part = (id: string): PartRecord => {
  const record = content.catalogue.parts.get(id);
  if (!record) throw new Error(`no part ${id}`);
  return record;
};

interface Mounted {
  readonly host: HTMLElement;
  readonly canvas: StandInCanvas;
  readonly shell: ShellApi;
  readonly panel: HTMLElement;
  readonly frames: RunFrames;
  card(): HTMLElement;
  select(partId: string | null): void;
}

const roots: { root: Root; host: HTMLElement }[] = [];

// Where things end up, so nothing slides (as shell.test.tsx).
beforeAll(() => cdp().send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }));
afterAll(() => cdp().send('Emulation.setEmulatedMedia', { features: [] }));
afterEach(() => {
  for (const { root, host } of roots.splice(0)) {
    root.unmount();
    host.remove();
  }
});

const mount = async (build: Blueprint, level: Level, speech: SpeechPort | null = recordingSpeech()): Promise<Mounted> => {
  const host = document.createElement('div');
  host.style.cssText = `position: fixed; left: 0; top: 0; width: ${TEN_INCH.width}px; height: ${TEN_INCH.height}px;`;
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push({ root, host });
  const canvas = new StandInCanvas();
  const frames = createRunFrames();
  let latest: ShellApi | null = null;
  const Probe = () => {
    latest = useShell();
    return null;
  };
  const items = new Map<string, string>();
  const storage = {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key: string) => items.get(key) ?? null,
    key: (index: number) => [...items.keys()][index] ?? null,
    removeItem: (key: string) => void items.delete(key),
    setItem: (key: string, value: string) => void items.set(key, value),
  };
  flushSync(() =>
    root.render(
      <Shell
        content={content}
        level={level}
        mountCanvas={() => canvas}
        storage={storage}
        slots={{ specCard: <SpecCard frames={frames} speech={speech} />, sound: <Probe /> }}
      />,
    ),
  );
  await vi.waitFor(() => {
    if (!latest?.canvas) throw new Error('the shell has not mounted its canvas yet');
  });
  const shell = (): ShellApi => {
    if (!latest) throw new Error('no shell');
    return latest;
  };
  flushSync(() => shell().load(build));
  const panel = host.querySelector<HTMLElement>('[data-region="specCard"]');
  if (!panel) throw new Error('no spec card panel');
  return {
    host,
    canvas,
    get shell() {
      return shell();
    },
    panel,
    frames,
    card: () => {
      const found = panel.querySelector<HTMLElement>('article.spec-card');
      if (!found) throw new Error('no card');
      return found;
    },
    select: (partId) => flushSync(() => canvas.select(partId === null ? null : { kind: 'part', partId })),
  };
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A real finger on an element, through CDP, as the browser delivers it. */
const touch = async (element: Element): Promise<void> => {
  const box = element.getBoundingClientRect();
  const frame = window.frameElement?.getBoundingClientRect();
  const point = { x: (frame?.left ?? 0) + box.left + box.width / 2, y: (frame?.top ?? 0) + box.top + box.height / 2 };
  await cdp().send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, id: 1 }] });
  await cdp().send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
};

/** Every way text could be cut off: past the card's sides, clipped, ellipsed or clamped. Empty when nothing is. */
const truncations = (panel: HTMLElement): string[] => {
  const problems: string[] = [];
  const style = getComputedStyle(panel);
  const inner = panel.getBoundingClientRect();
  const left = inner.left + parseFloat(style.paddingLeft) - 0.5;
  const right = inner.right - parseFloat(style.paddingRight) + 0.5;
  if (panel.scrollWidth > panel.clientWidth) problems.push(`the panel scrolls sideways: ${panel.scrollWidth} > ${panel.clientWidth}`);
  if (!['auto', 'scroll'].includes(style.overflowY)) problems.push(`the panel cannot scroll: overflow-y ${style.overflowY}`);
  for (const element of panel.querySelectorAll<HTMLElement>('*')) {
    if (element instanceof SVGElement || element instanceof HTMLInputElement) continue;
    const css = getComputedStyle(element);
    const name = `${element.tagName.toLowerCase()}.${element.className} "${(element.textContent ?? '').slice(0, 30)}"`;
    if (css.textOverflow === 'ellipsis') problems.push(`${name}: ellipsis`);
    if (css.webkitLineClamp !== 'none' && css.webkitLineClamp !== '') problems.push(`${name}: line clamp`);
    if (element.scrollWidth > element.clientWidth + 1 && element.clientWidth > 0) problems.push(`${name}: wider inside (${element.scrollWidth} > ${element.clientWidth})`);
    if (element.scrollHeight > element.clientHeight + 1 && element.clientHeight > 0 && css.overflowY !== 'visible') {
      problems.push(`${name}: clipped below (${element.scrollHeight} > ${element.clientHeight})`);
    }
    const box = element.getBoundingClientRect();
    if (box.width > 0 && (box.left < left || box.right > right)) problems.push(`${name}: past the card's side (${box.left}–${box.right} outside ${left}–${right})`);
  }
  // Every line is reachable: scrolled to the bottom, the last thing on the card shows.
  panel.scrollTop = panel.scrollHeight;
  const last = [...panel.querySelectorAll<HTMLElement>('article.spec-card > *')].at(-1);
  if (last && last.getBoundingClientRect().bottom > panel.getBoundingClientRect().bottom - parseFloat(style.paddingBottom) + 0.5) {
    problems.push('the last line cannot be scrolled into view');
  }
  panel.scrollTop = 0;
  return problems;
};

describe('every Level 1–2 card at the 10-inch size', () => {
  const fits: string[] = [];
  afterAll(() => console.info(`Cards in ${specCardSize(TEN_INCH.width, TEN_INCH.height).height} px: ${fits.join(', ')}`));

  for (const level of [1, 2] as const) {
    for (const record of launchParts) {
      it(`${record.id} at Level ${level}: its words, its ports and settings, nothing cut off`, async () => {
        const app = await mount(onePart(record), level);
        app.select('p1');
        const size = specCardSize(TEN_INCH.width, TEN_INCH.height);
        const box = app.panel.getBoundingClientRect();
        expect([box.width, box.height]).toEqual([size.width, size.height]);
        expect(app.panel.dataset.shown).toBe('true');
        const card = app.card();
        expect(card.dataset.part).toBe(record.id);
        expect(card.querySelector('h2')?.textContent).toBe(titleOf(record.identity.name));
        expect(card.querySelector('.spec-card-picture')).not.toBeNull();
        const layer = (name: string) => card.querySelector(`[data-layer="${name}"]`)?.textContent ?? null;
        expect(layer('does')).toBe(record.card.does);
        expect(layer('needs')).toBe(level >= 2 ? record.card.needs : null);
        expect(layer('gives')).toBe(level >= 2 ? record.card.gives : null);
        expect(layer('popular-mechanics')).toBe(level >= 2 ? record.card.popularMechanics : null);
        expect(layer('safety')).toBe(level >= 2 ? (record.card.safetyNote ?? null) : null);
        expect([...card.querySelectorAll('.spec-card-port')].map((port) => port.textContent)).toEqual(record.ports.map((port) => port.label));
        expect([...card.querySelectorAll<HTMLElement>('[data-setting]')].map((setting) => setting.dataset.setting)).toEqual(
          record.settings.filter((setting) => setting.unlockLevel <= level).map((setting) => setting.id),
        );
        expect(card.textContent).not.toMatch(/!/);
        expect(truncations(app.panel)).toEqual([]);
        // Fitting without scrolling is wanted where possible, and depends on the device's typeface (no font ships yet,
        // task 5.7), so it is reported, not asserted: on macOS every Level 1 card fits; Linux's wider fallback differs.
        const over = app.panel.scrollHeight - app.panel.clientHeight;
        fits.push(`${record.id} (L${level}) ${over <= 0 ? 'fits' : `scrolls ${over} px`}`);
      });
    }
  }
});

describe('settings', () => {
  it('a choice by pointer, touch and keyboard: one set-setting each, the card following the build (D15)', async () => {
    const app = await mount(onePart(part('motor-driver')), 2);
    app.select('p1');
    const radios = (setting: string) => [...app.card().querySelectorAll<HTMLInputElement>(`[data-setting="${setting}"] input`)];
    const checked = (setting: string) => radios(setting).find((radio) => radio.checked)?.value;
    expect([checked('motor-a'), checked('motor-b')]).toEqual(['forward', 'forward']);

    // A mouse on Motor A's Backward.
    await userEvent.click(radios('motor-a')[2]?.closest('label') ?? app.card());
    await vi.waitFor(() => expect(checked('motor-a')).toBe('backward'));
    expect(app.canvas.applied).toEqual([{ kind: 'set-setting', partId: 'p1', setting: 'motor-a', value: 'backward' }]);
    expect(app.shell.blueprint?.parts[0]?.settings).toEqual({ 'motor-a': 'backward' });

    // A finger on Motor B's Stop.
    await touch(radios('motor-b')[1]?.closest('label') ?? app.card());
    await vi.waitFor(() => expect(checked('motor-b')).toBe('stop'));

    // Keys: the arrows move along the choices.
    radios('motor-b')[1]?.focus();
    await userEvent.keyboard('{ArrowRight}');
    await vi.waitFor(() => expect(checked('motor-b')).toBe('backward'));
    expect(app.canvas.applied.map((command) => (command.kind === 'set-setting' ? [command.setting, command.value] : command.kind))).toEqual([
      ['motor-a', 'backward'],
      ['motor-b', 'stop'],
      ['motor-b', 'backward'],
    ]);

    // Undo loads the build before: the card follows it.
    flushSync(() => app.shell.load(onePart(part('motor-driver'))));
    expect([checked('motor-a'), checked('motor-b')]).toEqual(['forward', 'forward']);

    // The spoken words follow the choice: the setting's name and the option chosen.
    const speak = app.card().querySelector<HTMLElement>('[data-setting="motor-a"] [data-speak]');
    expect(speak?.textContent).toBe('Motor A');
    expect(app.card().querySelector('[data-setting="motor-a"] label[data-speak]')?.textContent).toBe('Forward');
  });

  it('is shown but locked in Run mode, so the build never changes (ground rule 4)', async () => {
    const app = await mount(onePart(part('dc-motor')), 2);
    app.select('p1');
    flushSync(() => app.shell.setMode('run'));
    const fieldset = app.card().querySelector<HTMLFieldSetElement>('[data-setting="direction"]');
    expect(fieldset?.disabled).toBe(true);
    await userEvent.click(fieldset?.querySelectorAll('label')[1] ?? app.card(), { force: true });
    await settle();
    expect(app.canvas.applied).toEqual([]);
    flushSync(() => app.shell.setMode('build'));
    expect(fieldset?.disabled).toBe(false);
  });

  it('a slider in child-sized steps with the real unit, by keyboard and by drag, one change on release (Level 3)', async () => {
    const app = await mount(onePart(part('servo-motor')), 3);
    app.select('p1');
    const slider = () => {
      const found = app.card().querySelector<HTMLInputElement>('[data-setting="angle"] input[type="range"]');
      if (!found) throw new Error('no slider');
      return found;
    };
    const shown = () => app.card().querySelector('[data-setting="angle"] output')?.textContent;
    expect([slider().min, slider().max, slider().step, slider().value]).toEqual(['0', '180', '15', '90']);
    expect(shown()).toBe('90°');
    expect(slider().getAttribute('aria-valuetext')).toBe('90°');
    expect(slider().getBoundingClientRect().height).toBeGreaterThanOrEqual(44);

    slider().focus();
    await userEvent.keyboard('{ArrowRight}');
    await vi.waitFor(() => expect(shown()).toBe('105°'));
    expect(app.canvas.applied).toEqual([{ kind: 'set-setting', partId: 'p1', setting: 'angle', value: 105 }]);

    // A drag along the track: the value follows the pointer and the build changes once, when it lets go.
    const box = slider().getBoundingClientRect();
    const frame = window.frameElement?.getBoundingClientRect();
    const at = (fraction: number) => ({
      x: (frame?.left ?? 0) + box.left + 16 + (box.width - 32) * fraction,
      y: (frame?.top ?? 0) + box.top + box.height / 2,
    });
    const mouse = (type: 'mousePressed' | 'mouseMoved' | 'mouseReleased', point: { x: number; y: number }, buttons: number) =>
      cdp().send('Input.dispatchMouseEvent', { type, ...point, button: 'left', buttons, clickCount: 1 });
    await mouse('mousePressed', at(7 / 12), 1);
    await mouse('mouseMoved', at(9 / 12), 1);
    await mouse('mouseMoved', at(10 / 12), 1);
    await vi.waitFor(() => expect(shown()).toBe('150°'));
    expect(app.canvas.applied).toHaveLength(1);
    await mouse('mouseReleased', at(10 / 12), 0);
    await vi.waitFor(() => expect(app.canvas.applied).toHaveLength(2));
    expect(app.canvas.applied[1]).toEqual({ kind: 'set-setting', partId: 'p1', setting: 'angle', value: 150 });
    expect(app.shell.blueprint?.parts[0]?.settings).toEqual({ angle: 150 });
  });
});

/** Each subject's readouts at `tick`, folded from the run record's value events. */
const foldValues = (events: readonly RunEvent[], tick: number): Map<string, ValuePayload> => {
  const values = new Map<string, ValuePayload>();
  for (const event of events) {
    if (event.tick > tick) break;
    if (event.kind === 'value') values.set(event.partId, { ...values.get(event.partId), ...event.payload });
  }
  return values;
};

const runFixture = async (name: string) => {
  const fixture = fixtures.find((candidate) => candidate.name === name);
  if (!fixture) throw new Error(`no fixture ${name}`);
  const arena = content.catalogue.arenas?.get(fixture.blueprint.arena.preset);
  if (!arena) throw new Error('no arena');
  const simulation = await createSimulation({ blueprint: fixture.blueprint, catalogue: content.catalogue, arena, seed: fixture.seed });
  const frames: RunFrame[] = [simulation.frame];
  while (simulation.tick < fixture.ticks) {
    for (const input of fixture.inputs.filter((candidate) => candidate.tick === simulation.tick)) {
      simulation.input({ partId: input.partId, kind: input.kind, closed: input.closed });
    }
    frames.push(simulation.step());
  }
  const record = simulation.record({
    id: '00000000-0000-4000-8000-000000000000',
    startedAt: '2026-10-01T09:00:00.000Z',
    endedAt: '2026-10-01T09:00:03.000Z',
    runNumber: 1,
    hints: [],
  });
  simulation.dispose();
  return { fixture, frames, record };
};

describe('live readouts in Run', () => {
  it('show exactly the run record’s values, every part, every tick (switch-in-the-line)', async () => {
    const { fixture, frames, record } = await runFixture('switch-in-the-line');
    const app = await mount(fixture.blueprint, 2);
    expect(app.card).toThrow();
    let compared = 0;
    for (const placed of fixture.blueprint.parts) {
      app.select(placed.id);
      expect(app.card().querySelector('.spec-card-readouts')).toBeNull();
      flushSync(() => app.shell.setMode('run'));
      for (const frame of frames) {
        flushSync(() => app.frames.push(frame));
        const expected = foldValues(record.events ?? [], frame.tick).get(placed.id) ?? {};
        const rows = [...app.card().querySelectorAll<HTMLElement>('[data-readout]')];
        const shown = Object.fromEntries(rows.map((row) => [row.dataset.readout, row.dataset.value]));
        expect(shown, `${placed.id} at tick ${frame.tick}`).toEqual(Object.fromEntries(Object.entries(expected).map(([key, value]) => [key, String(value)])));
        for (const row of rows) {
          const key = row.dataset.readout as keyof ValuePayload;
          const value = expected[key];
          if (value === undefined) throw new Error('no value');
          expect(row.querySelector('dd')?.textContent).toBe(formatReadout(key, value));
        }
        compared += rows.length;
      }
      expect(truncations(app.panel)).toEqual([]);
      flushSync(() => app.frames.clear());
      flushSync(() => app.shell.setMode('build'));
      expect(app.card().querySelector('.spec-card-readouts')).toBeNull();
    }
    expect(compared).toBeGreaterThan(1000);
  });

  it('show the card line of each failure while it happens, never a dialog (ground rule 9)', async () => {
    const { fixture, frames } = await runFixture('broken-missing-return-wire');
    const named = fixture.expect.namedFault;
    if (!named) throw new Error('no named fault');
    const app = await mount(fixture.blueprint, 2);
    app.select(named.partId);
    flushSync(() => app.shell.setMode('run'));
    const lines = () => [...app.card().querySelectorAll('.spec-card-faults li')].map((line) => line.textContent);
    flushSync(() => app.frames.push(frames[0] as RunFrame));
    expect(lines()).toEqual([]);
    const last = frames.at(-1) as RunFrame;
    flushSync(() => app.frames.push(last));
    const record = content.catalogue.parts.get(fixture.blueprint.parts.find((placed) => placed.id === named.partId)?.part ?? '');
    const line = record?.failureModes.find((mode) => mode.id === named.failure)?.cardLine;
    expect(line).toBeDefined();
    expect(lines()).toContain(line);
    expect(app.card().querySelector('.spec-card-faults')?.getAttribute('aria-live')).toBe('polite');
    expect(document.querySelector('dialog, [role="dialog"], [role="alertdialog"]')).toBeNull();
    flushSync(() => app.shell.setMode('build'));
    expect(app.card().querySelector('.spec-card-faults')).toBeNull();
  });
});

describe('speak-it', () => {
  it('reads exactly the words on the card, line by line, unhurried', async () => {
    const speech = recordingSpeech();
    const record = part('dc-motor');
    const app = await mount(onePart(record), 2, speech);
    app.select('p1');
    const button = app.card().querySelector<HTMLButtonElement>('button[aria-label="Read aloud"]');
    if (!button) throw new Error('no speak-it button');
    expect(button.getBoundingClientRect().width).toBeGreaterThanOrEqual(44);
    await userEvent.click(button);
    expect(speech.said.map((line) => line.text)).toEqual([
      'DC motor',
      record.card.does,
      record.card.needs,
      record.card.gives,
      ...record.ports.map((port) => port.label),
      'Direction',
      'Forward',
      record.card.popularMechanics,
    ]);
    expect(speech.said.every((line) => line.rate === SPEAK_RATE)).toBe(true);
    // Every line read is on the card as the child sees it.
    const seen = app.card().innerText.replace(/\s+/g, ' ');
    for (const { text } of speech.said) expect(seen).toContain(text);
    // Pressed again, it starts again rather than reading twice over.
    const once = speech.said.length;
    await userEvent.click(button);
    expect(speech.cancels).toBe(2);
    expect(speech.said).toHaveLength(once);
  });

  it('reads the readouts and failure lines shown in Run', async () => {
    const { fixture, frames } = await runFixture('broken-missing-return-wire');
    const named = fixture.expect.namedFault;
    if (!named) throw new Error('no named fault');
    const speech = recordingSpeech();
    const app = await mount(fixture.blueprint, 1, speech);
    app.select(named.partId);
    flushSync(() => app.shell.setMode('run'));
    flushSync(() => app.frames.push(frames.at(-1) as RunFrame));
    await userEvent.click(app.card().querySelector<HTMLButtonElement>('button[aria-label="Read aloud"]') ?? app.card());
    const rows = [...app.card().querySelectorAll('[data-readout]')].flatMap((row) => [row.querySelector('dt')?.textContent, row.querySelector('dd')?.textContent]);
    const faults = [...app.card().querySelectorAll('.spec-card-faults li')].map((line) => line.textContent);
    expect(rows.length).toBeGreaterThan(0);
    expect(speech.said.map((line) => line.text).slice(1, 1 + rows.length + faults.length)).toEqual([...rows, ...faults]);
  });

  it('has no button where the browser has no speechSynthesis', async () => {
    const app = await mount(onePart(part('switch')), 1, null);
    app.select('p1');
    expect(app.card().querySelector('button[aria-label="Read aloud"]')).toBeNull();
    expect(pageSpeech()).not.toBeNull();
  });
});
