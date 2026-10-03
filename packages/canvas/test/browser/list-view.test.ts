// Done-when for task 3.6: a fixture built entirely from the list view gives a blueprint byte-identical to the same
// build placed and wired on canvas by hand. Rolling Start is built twice on one canvas: by touch, tap-then-tap (real
// input through CDP), and from the list view, its parts from `placementsFor` (the path the app's tray offers a
// keyboard) and every wire from the list view's DOM by keyboard, Enter on each button. Also: the list view's DOM
// shows itself when it takes focus, Space never activates it (D42), Enter flips a manual switch in Run mode, and a
// removal says what it left loose (D35). In the iPad profile (vitest.config.ts).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { cdp, userEvent } from 'vitest/browser';
import { canonicalJson, serializeBlueprint } from '@servo/schema';
import type { Blueprint, Vec2 } from '@servo/schema';
import type { EditCommand, ListAction } from '../../src/interface.ts';
import { fixture } from '../helpers/catalogue.ts';
import { connectCommands, placeCommands, planFor, startOf, wiredFixture } from '../helpers/plans.ts';
import type { Plan, PlacementStep } from '../helpers/plans.ts';
import { listen, unmountAll } from './helpers.ts';
import { clientOf, mountWorkbench } from './placing.ts';
import type { Workbench } from './placing.ts';
import { handsOf } from './wiring-hands.ts';

const CANVAS = { width: 420, height: 320 };
const ZOOM = 0.5;
// Five minutes: at load 200–350 with many agents running, mounting has run past two (review: list-view hook timeout).
const MOUNT_MS = 300_000;
const BUILD_MS = 360_000;

let bench: Workbench;

beforeAll(async () => {
  await cdp().send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  bench = await mountWorkbench(CANVAS);
}, MOUNT_MS);

afterAll(async () => {
  bench.unmount();
  unmountAll();
  await cdp().send('Emulation.setEmulatedMedia', { features: [] });
});

const list = (): HTMLElement => bench.surface.listDom.element;
const byKey = (key: string): HTMLButtonElement => {
  const found = list().querySelector<HTMLButtonElement>(`[data-key="${CSS.escape(key)}"]`);
  if (!found) throw new Error(`no ${key} in the list view`);
  return found;
};

/** Focus on a list-view button, then Enter, as a keyboard does. */
const enter = async (key: string): Promise<void> => {
  byKey(key).focus();
  expect(document.activeElement?.getAttribute('data-key')).toBe(key);
  await userEvent.keyboard('{Enter}');
};

/** Opens a subject's actions by keyboard, unless they are open already. */
const open = async (subject: string): Promise<void> => {
  const toggle = `toggle:${subject}`;
  if (byKey(toggle).getAttribute('aria-expanded') === 'true') return;
  await enter(toggle);
  await vi.waitFor(() => expect(byKey(toggle).getAttribute('aria-expanded')).toBe('true'));
};

const actionDoing = (actions: readonly ListAction[], command: EditCommand): ListAction | undefined =>
  actions.find((action) => action.does.kind === 'edit' && canonicalJson(action.does.command) === canonicalJson(command));

/** Where a tap places a part: on the mount point or shaft itself, or on the loose part's place. */
const tapFor = (plan: Plan, step: PlacementStep): Vec2 => {
  if (!step.attach) return clientOf(bench.surface, step.position as Vec2);
  const target = bench.surface.scene.portByKey.get(`${plan.ids.get(step.attach.onto.part)}.${step.attach.onto.port}`);
  if (!target) throw new Error(`${plan.name}: no socket for ${step.fixtureId}`);
  return clientOf(bench.surface, target.at);
};

describe('Rolling Start, built entirely from the list view and by hand on canvas', () => {
  it('gives byte-identical blueprints', async () => {
    const hands = handsOf();
    const plan = planFor('rolling-start');
    const { surface } = bench;
    const edits = listen(surface, 'edit');

    // By hand: touch, tap-then-tap.
    expect(surface.load(startOf(plan)).ok).toBe(true);
    Object.assign(surface.camera, { centreX: 0, centreY: 0, zoom: ZOOM });
    for (const [index, step] of plan.steps.entries()) {
      surface.beginPlacement(step.part);
      await hands.tap('touch', tapFor(plan, step));
      await vi.waitFor(() => expect(edits.length).toBe(index + 1), { timeout: 30_000, interval: 10 });
    }
    for (const command of connectCommands(plan)) await hands.wire(surface, 'touch', 'tap', command.from, command.to);
    const byHand = serializeBlueprint(surface.blueprint as Blueprint);
    const handCommands = edits.splice(0).map((edit) => edit.command);
    expect(handCommands).toEqual([...placeCommands(plan), ...connectCommands(plan)]);

    // From the list view: each part where the tray's list-view path puts it, then each wire by keyboard.
    expect(surface.load(startOf(plan)).ok).toBe(true);
    const placements = placeCommands(plan);
    for (const [index, step] of plan.steps.entries()) {
      const actions = surface.listView.placementsFor(step.part);
      const action = step.attach ? actionDoing(actions, placements[index] as EditCommand) : actions.find((candidate) => candidate.id === `place:${step.part}:free`);
      expect(action, step.fixtureId).toBeDefined();
      expect(surface.listView.perform(action as ListAction)).toBe(true);
    }
    for (const command of connectCommands(plan)) {
      const from = `${command.from.part}.${command.from.port}`;
      const before = edits.length;
      await open(`port:${from}`);
      await enter(`action:connect:${from}:${command.to.part}.${command.to.port}`);
      await vi.waitFor(() => expect(edits.length).toBe(before + 1));
      expect(edits.at(-1)?.command).toEqual(command);
      // Focus stays in the list, on the port's button, ready for the next wire.
      expect(document.activeElement?.getAttribute('data-key')).toBe(`toggle:port:${from}`);
    }
    const fromList = serializeBlueprint(surface.blueprint as Blueprint);

    expect(fromList).toBe(byHand);
    expect(fromList).toBe(serializeBlueprint(wiredFixture(plan, false)));
    // The wires came by the same commands; the chassis by the free spot rather than a tap at the same place.
    expect(edits.slice(plan.steps.length).map((edit) => edit.command)).toEqual(handCommands.slice(plan.steps.length));
    expect(surface.listView.wires.map((wire) => wire.description)).toContain('power line from 2-cell battery pack plus (+) to switch side A');
  }, BUILD_MS);
});

describe('the list view’s DOM', () => {
  it('sits beside the canvas, hidden until it takes focus, then shows over the canvas with every action a button', async () => {
    const { surface } = bench;
    surface.canvas.tabIndex = 0;
    surface.canvas.focus();
    expect(surface.load(fixture('rolling-start')).ok).toBe(true);
    await vi.waitFor(() => expect(list().hasAttribute('data-open')).toBe(false));
    expect(list().parentElement).toBe(surface.canvas.parentElement);
    expect(list().getAttribute('aria-label')).toBe('Parts and wires');
    expect(list().getBoundingClientRect().width).toBeLessThanOrEqual(1);
    const texts = [...list().querySelectorAll('li > span')].map((line) => line.textContent);
    expect(texts).toContain('DC motor 1, mounted on chassis left motor mount, plus (+) connected to switch side B, minus (−) connected to 2-cell battery pack minus (−), shaft connected to large wheel 1 hub');
    await open('part:switch');
    expect(list().hasAttribute('data-open')).toBe(true);
    expect(list().getBoundingClientRect().width).toBeGreaterThan(200);
    const buttons = [...list().querySelectorAll<HTMLButtonElement>('li[data-subject="part:switch"] > ul button')].map((button) => button.textContent);
    expect(buttons).toContain('Move switch to chassis middle deck');
    expect(buttons).toContain('Remove switch and its 3 wires');
    surface.canvas.tabIndex = 0;
    surface.canvas.focus();
    await vi.waitFor(() => expect(list().hasAttribute('data-open')).toBe(false));
    expect(list().getBoundingClientRect().width).toBeLessThanOrEqual(1);
  });

  it('acts on Enter and never on Space, which stays the app’s Run and Stop (D42)', async () => {
    const { surface } = bench;
    expect(surface.load(fixture('rolling-start')).ok).toBe(true);
    const edits = listen(surface, 'edit');
    await open('part:switch');
    byKey('action:turn:switch:clockwise').focus();
    await userEvent.keyboard(' ');
    expect(edits).toEqual([]);
    await enter('action:turn:switch:clockwise');
    await vi.waitFor(() => expect(edits.map((edit) => edit.command)).toEqual([{ kind: 'rotate-part', partId: 'switch', rotation: 90 }]));
    expect(list().querySelector('[role="status"]')?.textContent).toBe('Turned switch. Switch is loose now');
  });

  it('says what a removal left loose (D35)', async () => {
    const { surface } = bench;
    expect(surface.load(fixture('rolling-start')).ok).toBe(true);
    await open('part:motor-left');
    await enter('action:remove:motor-left');
    await vi.waitFor(() => expect(surface.blueprint?.parts.some((part) => part.id === 'motor-left')).toBe(false));
    const status = list().querySelector('[role="status"]')?.textContent ?? '';
    expect(status).toBe('Removed DC motor 1. Large wheel 1 is loose now');
    expect(document.activeElement && list().contains(document.activeElement)).toBe(true);
  });

  it('in Run mode lists switch flips at once, and Enter flips the switch: control, no edit (D42)', async () => {
    const { surface } = bench;
    expect(surface.load(fixture('rolling-start')).ok).toBe(true);
    const controls = listen(surface, 'control');
    const edits = listen(surface, 'edit');
    surface.setMode('run');
    try {
      expect(list().querySelector('[data-key^="toggle:"]')).toBeNull();
      expect(byKey('action:flip:switch').textContent).toBe('Open switch');
      await enter('action:flip:switch');
      await vi.waitFor(() => expect(controls.map((event) => event.input)).toEqual([{ partId: 'switch', kind: 'switch', closed: false }]));
      expect(byKey('action:flip:switch').textContent).toBe('Close switch');
      expect(document.activeElement?.getAttribute('data-key')).toBe('action:flip:switch');
      await userEvent.keyboard(' ');
      expect(controls).toHaveLength(1);
      expect(edits).toEqual([]);
    } finally {
      surface.setMode('build');
    }
  });
});
