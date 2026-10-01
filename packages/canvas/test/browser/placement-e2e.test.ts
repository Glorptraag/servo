// Done-when for tasks 3.2 and 3.3: the touch path and the pointer path each build every schema valid-blueprint fixture
// whole, and give the same blueprint, byte for byte, as its commands do and as the fixture is. Every part is placed
// where the fixture has it (its mount on its mount point, its hub on its shaft, or loose at its place), then every
// power line, signal line and drive linkage a placement does not make is drawn by the same hand. Touch: tap-then-tap,
// and drags (from the tray, and from socket to socket). Pointer: click-click, and mouse drags. Crowded sockets fan out
// on the way (the bumper robot's motor shafts sit on their gearbox inputs, and its motor driver's sockets overlap their
// neighbours'). Real input through CDP (trusted touch and mouse events), in the iPad profile (vitest.config.ts).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { cdp } from 'vitest/browser';
import { serializeBlueprint } from '@servo/schema';
import type { Blueprint, Vec2 } from '@servo/schema';
import { applyEdit } from '../../src/index.ts';
import type { EditCommand, PlacementEvent } from '../../src/interface.ts';
import { partToCanvas } from '../../src/scene/geometry.ts';
import { catalogue } from '../helpers/catalogue.ts';
import { connectCommands, fixtureNames, placeCommands, planFor, startOf, wiredFixture } from '../helpers/plans.ts';
import type { Plan, PlacementStep } from '../helpers/plans.ts';
import { listen, unmountAll } from './helpers.ts';
import { clientOf, middleOf, mountWorkbench } from './placing.ts';
import type { Hand, Workbench } from './placing.ts';
import { handsOf } from './wiring-hands.ts';

interface Path {
  readonly name: string;
  readonly hand: Hand;
  readonly how: 'drag' | 'tap';
}

/**
 * A canvas smaller than the profile, zoomed out so every fixture fits. Each input waits for a drawn frame, and a
 * software GPU (SwiftShader, as on CI) draws a small canvas much faster. Forgiveness is in screen pixels, so the
 * zoom changes nothing a drop or a tap decides.
 */
const CANVAS = { width: 420, height: 320 };
const ZOOM = 0.5;
/** A software GPU on a busy machine can take a minute to mount a canvas, and minutes to build the bumper robot by hand. */
const MOUNT_MS = 120_000;
const BUILD_MS = 360_000;

const PATHS: readonly Path[] = [
  { name: 'touch, tap-then-tap', hand: 'touch', how: 'tap' },
  { name: 'touch, drags', hand: 'touch', how: 'drag' },
  { name: 'pointer, click-click', hand: 'mouse', how: 'tap' },
  { name: 'pointer, mouse drags', hand: 'mouse', how: 'drag' },
];

/** What the placements and then the connects make of each fixture when applied as commands: what every path must give. */
const expected = (plan: Plan): Blueprint => {
  let build = startOf(plan);
  for (const command of [...placeCommands(plan), ...connectCommands(plan)] as EditCommand[]) {
    const result = applyEdit(build, command, catalogue);
    if (!result.ok) throw new Error(`${plan.name}: ${result.refusal.code}`);
    build = result.blueprint;
  }
  return build;
};

/**
 * Where the hand lets go for a step. A tap lands on the mount point or shaft itself, or on the loose part's place. A
 * drag carries the part with its middle under the finger, so it lets go where the part's mount or hub is over its
 * target.
 */
const releaseFor = (bench: Workbench, plan: Plan, step: PlacementStep, how: 'drag' | 'tap'): Vec2 => {
  if (!step.attach) return clientOf(bench.surface, step.position as Vec2);
  const onto = `${plan.ids.get(step.attach.onto.part)}.${step.attach.onto.port}`;
  const target = bench.surface.scene.portByKey.get(onto);
  if (!target) throw new Error(`${plan.name}: no socket ${onto} on the canvas`);
  if (how === 'tap') return clientOf(bench.surface, target.at);
  const spec = catalogue.parts.get(step.part)?.ports.find((port) => port.id === step.attach?.port);
  if (!spec || spec.type !== 'mechanical') throw new Error(`${plan.name}: ${step.part} has no ${step.attach.port}`);
  const offset = partToCanvas({ x: 0, y: 0, rotation: 0, mirrored: false }, spec.at);
  return clientOf(bench.surface, { x: target.at.x - offset.x, y: target.at.y - offset.y });
};

let bench: Workbench;
const built = new Map<string, Map<string, string>>();

beforeAll(async () => {
  // Reduced motion makes fades and slides instant, so the canvas draws only when something changes.
  await cdp().send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  bench = await mountWorkbench(CANVAS);
  bench.surface.setRemoveTargets([bench.tray]);
}, MOUNT_MS);

afterAll(async () => {
  bench.unmount();
  unmountAll();
  await cdp().send('Emulation.setEmulatedMedia', { features: [] });
});

describe.each(PATHS)('$name', (path) => {
  for (const name of fixtureNames) {
    it(`builds ${name} whole: places every part, then draws every wire`, async () => {
      const hands = handsOf();
      const plan = planFor(name);
      const { surface } = bench;
      expect(surface.load(startOf(plan)).ok).toBe(true);
      Object.assign(surface.camera, { centreX: 0, centreY: 0, zoom: ZOOM });
      const edits = listen(surface, 'edit');
      const placements = listen(surface, 'placement');
      bench.pointerTypes();
      for (const [index, step] of plan.steps.entries()) {
        const release = releaseFor(bench, plan, step, path.how);
        if (path.how === 'drag') {
          // The tray hands the finger or the mouse that pressed its tile to the canvas.
          bench.tile(step.part, 'drag');
          await hands.drag(path.hand, middleOf(bench.tray), release);
        } else {
          // The tray's tap is the app's: it calls beginPlacement with no pointer. The tap on the canvas is real.
          surface.beginPlacement(step.part);
          await hands.tap(path.hand, release);
        }
        // The next step aims at what this one placed.
        await vi.waitFor(() => expect(edits.length).toBe(index + 1), { timeout: 30_000, interval: 10 });
      }
      expect(placements).toEqual(plan.steps.map((step): PlacementEvent => ({ kind: 'part', part: step.part, placed: true })));
      const connects = connectCommands(plan);
      for (const command of connects) {
        const before = edits.length;
        await hands.wire(surface, path.hand, path.how, command.from, command.to);
        expect(edits.slice(before).map((edit) => edit.command), `${command.from.part}.${command.from.port} to ${command.to.part}.${command.to.port}`).toEqual([command]);
      }
      expect(edits.map((edit) => edit.command.kind)).toEqual([...plan.steps.map(() => 'place-part'), ...connects.map(() => 'connect')]);
      expect(new Set(bench.pointerTypes())).toEqual(new Set([path.hand]));
      const bytes = serializeBlueprint(surface.blueprint as Blueprint);
      expect(bytes).toBe(serializeBlueprint(expected(plan)));
      // The fixture itself, its ids mapped onto the ones the hand's commands claimed (settings are the spec card's).
      expect(bytes).toBe(serializeBlueprint(wiredFixture(plan, false)));
      const byPath = built.get(name) ?? new Map<string, string>();
      byPath.set(path.name, bytes);
      built.set(name, byPath);
    }, BUILD_MS);
  }
});

describe('the touch path and the pointer path', () => {
  it('give byte-identical whole blueprints for every fixture', () => {
    expect([...built.keys()].sort()).toEqual([...fixtureNames].sort());
    for (const [name, byPath] of built) {
      expect(byPath.size, name).toBe(PATHS.length);
      const [first, ...rest] = [...byPath.values()];
      for (const bytes of rest) expect(bytes, name).toBe(first);
    }
  });
});
