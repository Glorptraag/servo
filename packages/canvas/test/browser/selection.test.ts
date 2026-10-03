// Task 3.4's done-when: selection and focus states. Real input through CDP (trusted mouse and touch), the `select`
// event with the right ids on every path, Run mode and read-only inspection, props, the hint rungs, and a screenshot
// for each focus state and rung, backed by pixel probes. Positions come from the testing entry, as the e2e harness
// reads them. Reduced motion throughout, so fades are instant and a hint holds still for its screenshot.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cdp, page } from 'vitest/browser';
import type { Blueprint, PlacedPartId, Prop, Vec2, WireId } from '@servo/schema';
import type { CanvasSurface } from '../../src/renderer/surface.ts';
import { STANDARD_PALETTE } from '../../src/renderer/style.ts';
import { PORT_MM } from '../../src/scene/units.ts';
import { HINT_GAP_MM, HINT_RING_MM, PROP_RING_MM, SOCKET_REACH_MM } from '../../src/selection/views.ts';
import { probeCanvas } from '../../src/testing.ts';
import type { CanvasProbe } from '../../src/testing.ts';
import { blueprintOf, fixture } from '../helpers/catalogue.ts';
import { PREFS, colourDistance, describeRgb, frames, listen, mount, rgbOf, settle, shoot, unmountAll } from './helpers.ts';
import type { Shot } from './helpers.ts';
import { pictures, tap } from './placing.ts';

let surface: CanvasSurface;
let host: HTMLElement;
let probe: CanvasProbe;

const reduceMotion = async (on: boolean): Promise<void> => {
  await cdp().send('Emulation.setEmulatedMedia', { features: on ? [{ name: 'prefers-reduced-motion', value: 'reduce' }] : [] });
};

beforeAll(async () => {
  await reduceMotion(true);
  ({ surface, host } = await mount({ resolveArt: pictures }));
  probe = probeCanvas(surface);
});

afterAll(async () => {
  unmountAll();
  await reduceMotion(false);
});

/** Loads a build in Build mode with nothing selected and no hint, `centre` in the middle at zoom 1. */
const load = (blueprint: Blueprint, centre: Vec2 = { x: 0, y: 0 }): void => {
  surface.setMode('build');
  surface.setPrefs(PREFS);
  surface.select(null);
  surface.clearHints();
  expect(surface.load(blueprint).ok).toBe(true);
  probe.setView(centre, 1);
};

beforeEach(() => load(fixture('rolling-start')));

const show = async (): Promise<Shot> => {
  surface.requestFrame();
  await settle(surface);
  return shoot(surface.canvas);
};

/** A plane point in CSS pixels from the canvas's top left, for `hitAt` and screenshots. */
const screenOf = (world: Vec2): Vec2 => surface.camera.worldToScreen(world);

/** A page point on a part, as close to its middle as a tap reaches the part itself (not a socket or a wire on it). */
const onPart = (id: PlacedPartId): Vec2 => {
  const part = probe.part(id);
  if (!part) throw new Error(`no part ${id}`);
  const xs = part.corners.map((corner) => corner.world.x);
  const ys = part.corners.map((corner) => corner.world.y);
  const hits: Vec2[] = [];
  for (let x = Math.min(...xs); x <= Math.max(...xs); x += 2) {
    for (let y = Math.min(...ys); y <= Math.max(...ys); y += 2) {
      const hit = surface.hitAt(screenOf({ x, y }));
      if (hit?.kind === 'part' && hit.part.id === id) hits.push({ x, y });
    }
  }
  const centre = part.centre.world;
  const best = hits.sort((a, b) => Math.hypot(a.x - centre.x, a.y - centre.y) - Math.hypot(b.x - centre.x, b.y - centre.y))[0];
  if (!best) throw new Error(`no spot on ${id} reaches it`);
  return probe.pageOf(best);
};

/** A page point on a wire that a tap reaches. */
const onWire = (id: WireId): Vec2 => {
  const wire = probe.wire(id);
  if (!wire) throw new Error(`no wire ${id}`);
  for (const t of [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8]) {
    const at = { x: wire.from.world.x + (wire.to.world.x - wire.from.world.x) * t, y: wire.from.world.y + (wire.to.world.y - wire.from.world.y) * t };
    const hit = surface.hitAt(screenOf(at));
    if (hit?.kind === 'wire' && hit.wire.id === id) return probe.pageOf(at);
  }
  throw new Error(`no spot on ${id} reaches it`);
};

/** Empty workbench below Rolling Start. */
const EMPTY: Vec2 = { x: -180, y: 140 };

const key = (name: 'Delete' | 'Enter'): void => {
  surface.canvas.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
};

const selections = (events: readonly { readonly selection: unknown }[]): unknown[] => events.map((event) => event.selection);

describe('a tap or a click selects, and `select` says so with the right ids', () => {
  it('selects a part by click and by touch, once per change, and empty workbench clears it', async () => {
    const events = listen(surface, 'select');
    await tap('mouse', onPart('battery'));
    await tap('mouse', onPart('battery'));
    await tap('touch', onPart('switch'));
    expect(surface.placement.selectedPart, 'the switch’s handles').toBe('switch');
    await tap('touch', probe.pageOf(EMPTY));
    expect(selections(events)).toEqual([{ kind: 'part', partId: 'battery' }, { kind: 'part', partId: 'switch' }, null]);
    expect(surface.selection).toBeNull();
    expect(surface.placement.selectedPart).toBeUndefined();
  });

  it('selects a wire, with its bin and its label, and a tap on a part moves the selection there', async () => {
    const events = listen(surface, 'select');
    await tap('touch', onWire('w8'));
    expect(surface.selection).toEqual({ kind: 'wire', wireId: 'w8' });
    expect(surface.wiring.selectedWire).toBe('w8');
    expect(probe.handles().has('bin')).toBe(true);
    expect(probe.wireLabel).toBe('power');
    await tap('mouse', onPart('caster'));
    expect(surface.selection).toEqual({ kind: 'part', partId: 'caster' });
    expect(surface.wiring.selectedWire).toBeUndefined();
    expect(probe.wireLabel).toBeUndefined();
    expect(selections(events)).toEqual([{ kind: 'wire', wireId: 'w8' }, null, { kind: 'part', partId: 'caster' }]);
  });

  it('a drive linkage says turning', async () => {
    surface.select({ kind: 'wire', wireId: 'w6' });
    expect(probe.wireLabel).toBe('turning');
    expect(surface.wiring.selectedWire).toBe('w6');
  });

  it('clears the selection when Delete removes the selected part or wire', async () => {
    const events = listen(surface, 'select');
    await tap('mouse', onPart('switch'));
    key('Delete');
    expect(surface.blueprint?.parts.some((part) => part.id === 'switch')).toBe(false);
    await tap('mouse', onWire('w11'));
    key('Delete');
    expect(surface.blueprint?.wires.some((wire) => wire.id === 'w11')).toBe(false);
    expect(selections(events)).toEqual([{ kind: 'part', partId: 'switch' }, null, { kind: 'wire', wireId: 'w11' }, null]);
  });
});

describe('`select` from the app and the list view', () => {
  it('fires only on a change, and hands a part to placement’s handles and a wire to wiring’s bin', () => {
    const events = listen(surface, 'select');
    surface.select({ kind: 'part', partId: 'motor-left' });
    surface.select({ kind: 'part', partId: 'motor-left' });
    expect(surface.placement.selectedPart).toBe('motor-left');
    surface.select({ kind: 'wire', wireId: 'w9' });
    expect(surface.placement.selectedPart).toBeUndefined();
    expect(surface.wiring.selectedWire).toBe('w9');
    // A mount is selectable, to inspect, but has no bin: it comes off with `unmount`.
    surface.select({ kind: 'wire', wireId: 'w1' });
    expect(surface.wiring.selectedWire).toBeUndefined();
    surface.select({ kind: 'part', partId: 'no-such-part' });
    surface.select({ kind: 'wire', wireId: 'w99' });
    surface.select(null);
    surface.select(null);
    expect(selections(events)).toEqual([
      { kind: 'part', partId: 'motor-left' },
      { kind: 'wire', wireId: 'w9' },
      { kind: 'wire', wireId: 'w1' },
      null,
    ]);
    expect(() => surface.select({ kind: 'port' } as never)).toThrow(RangeError);
  });

  it('keeps the selection through a load that still has it, and clears it when the build loses it', () => {
    const events = listen(surface, 'select');
    surface.select({ kind: 'part', partId: 'caster' });
    expect(surface.load(fixture('rolling-start')).ok).toBe(true);
    expect(surface.selection).toEqual({ kind: 'part', partId: 'caster' });
    expect(surface.load(fixture('led-circuit')).ok).toBe(true);
    expect(surface.selection).toBeNull();
    surface.select({ kind: 'wire', wireId: 'w3' });
    surface.apply({ kind: 'disconnect', wireId: 'w3' });
    expect(selections(events)).toEqual([{ kind: 'part', partId: 'caster' }, null, { kind: 'wire', wireId: 'w3' }, null]);
  });
});

describe('the list view (task 3.6)', () => {
  const perform = (subject: Parameters<CanvasSurface['listView']['actionsFor']>[0], id: string): boolean => {
    const action = surface.listView.actionsFor(subject).find((each) => each.id === id);
    if (!action) throw new Error(`no action ${id}`);
    return surface.listView.perform(action);
  };

  it('selects through the same selection, with the handles and the bin, in Build and Run mode', () => {
    const events = listen(surface, 'select');
    expect(perform({ kind: 'part', partId: 'switch' }, 'select:part:switch')).toBe(true);
    expect(surface.placement.selectedPart).toBe('switch');
    expect(perform({ kind: 'wire', wireId: 'w8' }, 'select:wire:w8')).toBe(true);
    expect(surface.wiring.selectedWire).toBe('w8');
    expect(probe.wireLabel).toBe('power');
    surface.setMode('run');
    expect(perform({ kind: 'part', partId: 'caster' }, 'select:part:caster')).toBe(true);
    expect(selections(events)).toEqual([
      { kind: 'part', partId: 'switch' },
      { kind: 'wire', wireId: 'w8' },
      { kind: 'part', partId: 'caster' },
    ]);
  });

  it('reads out the rung drawn now as its text twin', () => {
    expect(surface.listView.hint).toBeUndefined();
    surface.showHint({ step: 'pulse-port', target: { placed: 'battery', port: 'plus' }, line: 'The battery pack’s plus (+)' });
    expect(surface.listView.hint).toEqual({ step: 'pulse-port', line: 'The battery pack’s plus (+)' });
    surface.showHint({ step: 'pulse-part', target: { part: 'servo-motor' }, line: 'The servo motor' });
    expect(surface.listView.hint).toBeUndefined();
    surface.showHint({ step: 'pulse-part', target: { placed: 'switch' }, line: 'The switch' });
    surface.clearHints();
    expect(surface.listView.hint).toBeUndefined();
  });
});

describe('Run mode and a read-only canvas: a tap inspects', () => {
  it('keeps the selection through Run and Stop, selects by tap while running, and shows the handles again on Stop', async () => {
    const events = listen(surface, 'select');
    surface.select({ kind: 'part', partId: 'battery' });
    surface.setMode('run');
    expect(surface.selection).toEqual({ kind: 'part', partId: 'battery' });
    expect(surface.placement.selectedPart, 'no handles in Run mode').toBeUndefined();
    await tap('touch', onPart('motor-left'));
    await tap('mouse', onWire('w12'));
    expect(probe.wireLabel).toBe('power');
    await tap('mouse', onPart('caster'));
    surface.setMode('build');
    expect(surface.placement.selectedPart).toBe('caster');
    expect(selections(events)).toEqual([
      { kind: 'part', partId: 'battery' },
      { kind: 'part', partId: 'motor-left' },
      { kind: 'wire', wireId: 'w12' },
      { kind: 'part', partId: 'caster' },
    ]);
    surface.setMode('run');
    await tap('touch', probe.pageOf(EMPTY));
    expect(surface.selection).toBeNull();
  });

  it('selects by tap on a read-only canvas, with no handles, and Delete changes nothing', async () => {
    const readOnly = await mount({ resolveArt: pictures, readOnly: true }, { width: 600, height: 420 });
    try {
      expect(readOnly.surface.load(fixture('rolling-start')).ok).toBe(true);
      const own = probeCanvas(readOnly.surface);
      own.setView({ x: 0, y: 0 }, 1);
      await frames(2);
      const events = listen(readOnly.surface, 'select');
      const spot = { x: -70, y: 0 };
      const hit = readOnly.surface.hitAt(readOnly.surface.camera.worldToScreen(spot));
      if (hit?.kind !== 'part') throw new Error('no part under the spot');
      const partId = hit.part.id;
      await tap('touch', own.pageOf(spot));
      expect(readOnly.surface.selection).toEqual({ kind: 'part', partId });
      expect(readOnly.surface.placement.selectedPart).toBeUndefined();
      readOnly.surface.canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
      expect(readOnly.surface.blueprint?.parts.some((part) => part.id === partId)).toBe(true);
      expect(selections(events)).toEqual([{ kind: 'part', partId }]);
    } finally {
      readOnly.unmount();
    }
  });
});

// The Rolling Start robot sits on the open floor's start pose (300, 600): canvas (x, y) is arena (300 + x, 600 − y).
const box = (id: string, x: number, y: number): Prop => ({ id, shape: 'box', size: { x: 100, y: 100, z: 60 }, grams: 80, at: { x, y, heading: 0 }, fixed: false });
const rolling = fixture('rolling-start');
const withProps: Blueprint = blueprintOf({ parts: rolling.parts, wires: rolling.wires, arena: { preset: 'open-floor', props: [box('prop-1', 490, 670), box('prop-2', 490, 530)] } }, 'Props');

describe('props', () => {
  it('selects one of the child’s props by tap, and its bin and Delete remove it', async () => {
    load(withProps, { x: 100, y: 0 });
    const events = listen(surface, 'select');
    const edits = listen(surface, 'edit');
    await tap('mouse', probe.pageOf({ x: 190, y: -70 }));
    expect(surface.selection).toEqual({ kind: 'prop', propId: 'prop-1' });
    const bin = probe.handles().get('bin');
    expect(bin, 'the prop’s bin').toBeDefined();
    await tap('touch', bin?.page as Vec2);
    await tap('touch', probe.pageOf({ x: 190, y: 70 }));
    expect(surface.selection).toEqual({ kind: 'prop', propId: 'prop-2' });
    key('Delete');
    expect(edits.map((edit) => edit.command)).toEqual([
      { kind: 'remove-prop', propId: 'prop-1' },
      { kind: 'remove-prop', propId: 'prop-2' },
    ]);
    expect(selections(events)).toEqual([{ kind: 'prop', propId: 'prop-1' }, null, { kind: 'prop', propId: 'prop-2' }, null]);
  });

  it('lets a prop go on a tap on the build or on empty workbench', async () => {
    load(withProps, { x: 100, y: 0 });
    surface.select({ kind: 'prop', propId: 'prop-1' });
    await tap('mouse', onPart('battery'));
    expect(surface.selection).toEqual({ kind: 'part', partId: 'battery' });
    surface.select({ kind: 'prop', propId: 'prop-1' });
    await tap('touch', probe.pageOf({ x: 300, y: 140 }));
    expect(surface.selection).toBeNull();
  });

  it('selects a preset’s prop to inspect it, with no bin', async () => {
    // The wall stop's box sits at arena (1000, 950): canvas (700, −350).
    const preset = blueprintOf({ parts: rolling.parts, wires: rolling.wires, arena: { preset: 'wall-stop', props: [] } }, 'Wall stop');
    load(preset, { x: 700, y: -350 });
    await tap('touch', probe.pageOf({ x: 700, y: -350 }));
    expect(surface.selection).toEqual({ kind: 'prop', propId: 'box' });
    expect(probe.handles().size).toBe(0);
    key('Delete');
    expect(surface.load(preset).ok && surface.selection).toEqual({ kind: 'prop', propId: 'box' });
  });
});

const expectNear = (shot: Shot, world: Vec2, expected: readonly [number, number, number], what: string, tolerance = 12): void => {
  const actual = shot.at(screenOf(world));
  expect(colourDistance(actual, expected), `${what}: ${describeRgb(actual)} where ${describeRgb(expected)} was expected`).toBeLessThanOrEqual(tolerance);
};

const expectChanged = (before: Shot, after: Shot, world: Vec2, what: string, by = 40): void => {
  expect(colourDistance(before.at(screenOf(world)), after.at(screenOf(world))), what).toBeGreaterThan(by);
};

const expectSame = (before: Shot, after: Shot, world: Vec2, what: string): void => {
  expect(colourDistance(before.at(screenOf(world)), after.at(screenOf(world))), what).toBeLessThanOrEqual(12);
};

const socket = (key: string): Vec2 => {
  const found = probe.socket(key);
  if (!found) throw new Error(`no socket ${key}`);
  return found.at.world;
};

describe('focus states, by pixel probes and screenshots', () => {
  it('a selected part: its neighbours and wires as they are, everything else one step fainter', async () => {
    const before = await show();
    surface.select({ kind: 'part', partId: 'battery' });
    const after = await show();
    expect(probe.emphasis({ part: 'battery' })).toBe('highlighted');
    expect(probe.emphasis({ part: 'switch' })).toBe('normal');
    expect(probe.emphasis({ part: 'caster' })).toBe('dimmed');
    expect(probe.emphasis({ wire: 'w8' })).toBe('normal');
    expect(probe.emphasis({ wire: 'w10' })).toBe('dimmed');
    expectChanged(before, after, probe.worldOf(onPart('caster')), 'the dimmed caster', 20);
    expectChanged(before, after, probe.worldOf(onPart('wheel-left')), 'the dimmed wheel');
    expectSame(before, after, { x: 55, y: 8 }, 'the switch, a neighbour');
    expectNear(after, socket('battery.plus'), rgbOf(STANDARD_PALETTE.types.power.colour), 'its connected socket, undimmed');
    await expect.element(page.elementLocator(host)).toMatchScreenshot('focus-part');
  });

  it('a selected wire: glowing, both sockets haloed, its label, and nothing dimmed', async () => {
    const before = await show();
    surface.select({ kind: 'wire', wireId: 'w8' });
    const after = await show();
    for (const id of ['battery', 'switch', 'caster', 'wheel-left', 'chassis']) expect(probe.emphasis({ part: id }), id).toBe('normal');
    expect(probe.emphasis({ wire: 'w8' })).toBe('highlighted');
    expect(probe.emphasis({ wire: 'w10' })).toBe('normal');
    expect(probe.wireLabel).toBe('power');
    const halo = (key: string): Vec2 => ({ x: socket(key).x, y: socket(key).y + PORT_MM / 2 + 1.2 });
    expectChanged(before, after, halo('switch.a'), 'a halo round the switch’s socket', 10);
    expectSame(before, after, probe.worldOf(onPart('caster')), 'the caster, not dimmed');
    await expect.element(page.elementLocator(host)).toMatchScreenshot('focus-wire');
  });

  it('a selected drive linkage, labelled turning', async () => {
    surface.select({ kind: 'wire', wireId: 'w6' });
    await show();
    expect(probe.wireLabel).toBe('turning');
    await expect.element(page.elementLocator(host)).toMatchScreenshot('focus-linkage');
  });

  it('a selected prop: ringed, with its bin', async () => {
    load(withProps, { x: 100, y: 0 });
    const before = await show();
    surface.select({ kind: 'prop', propId: 'prop-1' });
    const after = await show();
    expectChanged(before, after, { x: 190 + 50 + PROP_RING_MM / 2, y: -70 }, 'the ring just outside the box');
    expectSame(before, after, { x: 0, y: 0 }, 'the build, not dimmed');
    await expect.element(page.elementLocator(host)).toMatchScreenshot('focus-prop');
  });

  it('a part selected in Run mode keeps its focus, with no handles', async () => {
    surface.select({ kind: 'part', partId: 'motor-right' });
    surface.setMode('run');
    await show();
    expect(probe.emphasis({ part: 'caster' })).toBe('dimmed');
    expect(probe.handles().size).toBe(0);
    await expect.element(page.elementLocator(host)).toMatchScreenshot('focus-part-run');
  });
});

/** Every drawn socket's middle looks as it did: a rung covers none. */
const everySocketSame = (before: Shot, after: Shot): void => {
  for (const port of surface.scene.parts.flatMap((part) => part.ports.filter((each) => each.layer !== 'none'))) {
    expectSame(before, after, port.at, `the ${port.key} socket`);
  }
};

/** Where a part hint's ring runs below a part: past its sockets by the gap and half the ring. */
const ringBelow = (id: PlacedPartId): number => {
  const part = surface.scene.partById.get(id);
  if (!part) throw new Error(`no part ${id}`);
  return part.bounds.maxY + HINT_GAP_MM + HINT_RING_MM / 2;
};

/** The LED circuit with its LED’s plus line taken out: a ghost wire has somewhere to go. */
const unfinished = (): Blueprint => {
  const circuit = fixture('led-circuit');
  return blueprintOf({ parts: circuit.parts, wires: circuit.wires.filter((wire) => wire.id !== 'w2') }, 'Unfinished circuit');
};

describe('hint rungs, drawn over everything and clear of every socket', () => {
  it('pulses a part', async () => {
    const before = await show();
    expect(surface.showHint({ step: 'pulse-part', target: { placed: 'switch' }, line: 'The switch' })).toBe(true);
    const after = await show();
    everySocketSame(before, after);
    const below = ringBelow('switch');
    const bounds = surface.scene.partById.get('switch')?.bounds;
    const xs = [0.2, 0.35, 0.5, 0.65, 0.8].map((k) => (bounds?.minX ?? 0) + ((bounds?.maxX ?? 0) - (bounds?.minX ?? 0)) * k);
    const changed = xs.filter((x) => colourDistance(before.at(screenOf({ x, y: below })), after.at(screenOf({ x, y: below }))) > 20);
    expect(changed.length, 'the ring below the switch').toBeGreaterThan(0);
    expect(surface.selecting.shownHint?.step).toBe('pulse-part');
    await expect.element(page.elementLocator(host)).toMatchScreenshot('hint-pulse-part');
  });

  it('pulses a port on every part of a type', async () => {
    const before = await show();
    expect(surface.showHint({ step: 'pulse-port', target: { part: 'dc-motor', port: 'minus' }, line: 'The DC motor’s minus' })).toBe(true);
    const after = await show();
    everySocketSame(before, after);
    for (const key of ['motor-left.minus', 'motor-right.minus']) {
      const r = SOCKET_REACH_MM + HINT_GAP_MM + HINT_RING_MM / 2;
      const around = Array.from({ length: 12 }, (_, i) => ({ x: socket(key).x + r * Math.cos((i * Math.PI) / 6), y: socket(key).y + r * Math.sin((i * Math.PI) / 6) }));
      const changed = around.filter((at) => colourDistance(before.at(screenOf(at)), after.at(screenOf(at))) > 10);
      expect(changed.length, `the ring round ${key}`).toBeGreaterThan(3);
    }
    await expect.element(page.elementLocator(host)).toMatchScreenshot('hint-pulse-port');
  });

  it('draws a ghost wire that stops at both sockets', async () => {
    load(unfinished());
    const before = await show();
    expect(surface.showHint({ step: 'ghost-wire', from: { placed: 'switch', port: 'b' }, to: { placed: 'led', port: 'plus' }, line: 'A power line to the LED' })).toBe(true);
    const after = await show();
    const a = socket('switch.b');
    const b = socket('led.plus');
    everySocketSame(before, after);
    expectChanged(before, after, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, 'the ghost line between them', 20);
    await expect.element(page.elementLocator(host)).toMatchScreenshot('hint-ghost-wire');
  });

  it('returns false and draws nothing when nothing matches, and clears', async () => {
    const before = await show();
    surface.showHint({ step: 'pulse-part', target: { placed: 'switch' }, line: 'The switch' });
    expect(surface.showHint({ step: 'pulse-part', target: { part: 'servo-motor' }, line: 'The servo motor' })).toBe(false);
    expect(surface.selecting.shownHint).toBeUndefined();
    const after = await show();
    expectSame(before, after, { x: 55, y: 30 }, 'no ring left round the switch');
    surface.showHint({ step: 'pulse-part', target: { placed: 'switch' }, line: 'The switch' });
    surface.clearHints();
    expect(surface.selecting.shownHint).toBeUndefined();
  });

  it('pulses, so the canvas keeps drawing until the hint goes; hidden in Run mode', async () => {
    await reduceMotion(false);
    try {
      surface.showHint({ step: 'pulse-part', target: { placed: 'battery' }, line: 'The battery pack' });
      await frames(3);
      expect(surface.settled).toBe(false);
      surface.setMode('run');
      expect(surface.selecting.shownHint?.step).toBe('pulse-part');
      await settle(surface);
      surface.setMode('build');
      surface.clearHints();
      await settle(surface);
    } finally {
      await reduceMotion(true);
    }
  });
});

describe('the testing entry', () => {
  it('puts every socket, part and wire where a tap finds it', () => {
    load(fixture('led-circuit'));
    for (const id of ['battery', 'switch', 'led']) {
      const place = probe.part(id);
      expect(place?.corners).toHaveLength(4);
      expect(probe.worldOf(place?.centre.page as Vec2).x).toBeCloseTo(place?.centre.world.x as number, 6);
    }
    for (const port of surface.scene.parts.flatMap((part) => part.ports.filter((each) => each.layer === 'ports'))) {
      const place = probe.socket(port.ref);
      expect(place?.fanned).toBe(false);
      const box = surface.canvas.getBoundingClientRect();
      const hit = surface.hitAt({ x: (place?.press.page.x as number) - box.left, y: (place?.press.page.y as number) - box.top });
      expect(hit?.kind === 'port' && hit.port.key, port.key).toBe(port.key);
    }
    const wire = probe.wire('w1');
    expect(wire?.middle.world).toEqual({ x: ((wire?.from.world.x as number) + (wire?.to.world.x as number)) / 2, y: ((wire?.from.world.y as number) + (wire?.to.world.y as number)) / 2 });
    expect(probe.part('nope')).toBeUndefined();
    expect(probe.socket('battery.nope')).toBeUndefined();
    expect(probe.wire('w99')).toBeUndefined();
    probe.setView({ x: 10, y: -20 }, 0.5);
    expect(probe.view).toMatchObject({ centre: { x: 10, y: -20 }, zoom: 0.5 });
    expect(() => probeCanvas({} as never)).toThrow(TypeError);
  });
});
