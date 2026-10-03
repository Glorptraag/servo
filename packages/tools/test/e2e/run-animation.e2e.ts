// Task 3.5's done-when: each failure mode in the broken content fixtures is visibly distinct in a recorded Run. Each of
// the eight broken fixtures, and one working one, runs through sim-core's createSimulation with its own seed and
// inputs; its frames go to a mounted canvas as the app's run loop gives them, and two real screenshots are taken, one
// tick apart, at tick 60 (or the fixture's last). Pixel probes then find each fixture's tell where the canvas says it
// drew it: dots on every live wire and none on a dead one, tread marks that move each wheel's way or stay still, the
// held servo motor arm and its hum, the scrape marks, the drained gauge, the caster left behind, the LED's light, the
// buzzer's pulse. Last, each broken Run is compared with an honest baseline in the same camera: the same build with
// its fault fixed where one exists, or else the same build in Build mode. It must differ where its tells are drawn,
// so a Run that drew none of them fails. The screenshots are kept as references in
// __screenshots__/run-animation.e2e.ts/, one per fixture, so a change to how a Run looks shows in review.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectScreenshot } from '../../src/e2e/screenshots.ts';
import { loadFixtures } from '@servo/content/fixtures';
import type { ContentFixture } from '@servo/content/fixtures';
import { applyEdit } from '@servo/canvas';
import { serializeBlueprint } from '@servo/schema';
import type { Blueprint, PlacedPartId, Vec2, WireId } from '@servo/schema';
import type { RunFrame } from '@servo/sim-core';
import { benchContent, colourDistance, describeRgb, differingShare, frameOn, mountBench, playTo, rgbOf, settle, shoot, simulationOf } from './run-animation-bench.ts';
import type { Bench, Rgb, Shot } from './run-animation-bench.ts';

const SIZE = { width: 1180, height: 820 } as const;
const { fixtures } = loadFixtures();
const named = (name: string): ContentFixture => {
  const found = fixtures.find((fixture) => fixture.name === name);
  if (!found) throw new Error(`No content fixture '${name}'.`);
  return found;
};

const BROKEN = fixtures.filter((fixture) => fixture.name.startsWith('broken-'));
const WORKING = named('led-and-buzzer-robot');
/** The tick each Run is screenshotted at: two simulated seconds in, or the fixture's last tick. */
const tickOf = (fixture: ContentFixture): number => Math.min(fixture.ticks, 60);

const luminance = (rgb: Rgb): number => 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];

interface Recorded {
  readonly fixture: ContentFixture;
  /** One tick before `shot`. */
  readonly before: Shot;
  readonly shot: Shot;
  readonly frame: RunFrame;
  readonly treadsBefore: ReadonlyMap<PlacedPartId, number>;
  /** The camera the screenshots were taken with, so a baseline can be taken with it too. */
  readonly camera: { readonly centreX: number; readonly centreY: number; readonly zoom: number };
  /** Where the Run's drawing is at the screenshot tick, in CSS pixels: every tell, dot, dead line and scratch. */
  readonly mask: readonly Vec2[];
}

let bench: Bench;
const recorded = new Map<string, Recorded>();

beforeAll(async () => {
  bench = await mountBench(SIZE);
});

afterAll(() => bench.destroy());

const screen = (point: Vec2): Vec2 => bench.hooks.camera.worldToScreen(point);

/** Loads the fixture, runs it to its tick and screenshots its last two ticks. */
const record = async (fixture: ContentFixture): Promise<Recorded> => {
  const { handle, hooks } = bench;
  if (handle.mode === 'run') handle.setMode('build');
  expect(handle.load(fixture.blueprint).ok).toBe(true);
  const built = serializeBlueprint(handle.blueprint ?? fixture.blueprint);
  handle.setMode('run');
  const simulation = await simulationOf(fixture);
  const tick = tickOf(fixture);
  // Tick 0 first, as the app's spin-up shows it, then every tick: the canvas draws only what it is given.
  handle.applyRunFrame(simulation.frame);
  for (const frame of playTo(simulation, fixture, tick - 1)) handle.applyRunFrame(frame);
  // Frame the camera on the parts where they are drawn now, and on the marks the Run left on the floor.
  await settle(bench);
  const points: Vec2[] = fixture.blueprint.parts.map((part) => hooks.run.partPoint(part.id, { x: 0, y: 0 }));
  for (const part of fixture.blueprint.parts) for (const scratch of hooks.run.marks.scratches(part.id)) points.push(...scratch);
  const padded = points.flatMap((point) => [
    { x: point.x - 70, y: point.y - 70 },
    { x: point.x + 70, y: point.y + 70 },
  ]);
  frameOn(bench, padded, SIZE);
  await settle(bench);
  const before = await shoot(hooks.canvas);
  const treadsBefore = new Map(hooks.run.state?.treads ?? []);
  const [frame] = playTo(simulation, fixture, tick);
  if (!frame) throw new Error('No frame at the screenshot tick.');
  handle.applyRunFrame(frame);
  await settle(bench);
  const shot = await shoot(hooks.canvas);
  // Task 3.8's comparison, the same on every platform: test/e2e/__screenshots__/run-animation.e2e.ts/<fixture>-run.png.
  await expectScreenshot(bench.host, `run-animation.e2e.ts/${fixture.name}-run`);
  // Run mode locks the build: an edit is refused and the blueprint is untouched.
  expect(handle.apply({ kind: 'rename', name: 'Changed in Run' })).toMatchObject({ ok: false, refusal: { code: 'edit.locked' } });
  expect(serializeBlueprint(handle.blueprint ?? fixture.blueprint)).toBe(built);
  simulation.dispose();
  const { centreX, centreY, zoom } = hooks.camera;
  const result = { fixture, before, shot, frame, treadsBefore, camera: { centreX, centreY, zoom }, mask: tellMask(fixture) };
  recorded.set(fixture.name, result);
  return result;
};

/** Every point where the Run's drawing shows now, on screen: where an honest baseline must differ from it. */
const tellMask = (fixture: ContentFixture): Vec2[] => {
  const { hooks } = bench;
  const points: Vec2[] = [];
  for (const part of fixture.blueprint.parts) {
    const tells = hooks.run.tellsOf(part.id);
    points.push(...(tells?.treads ?? []), ...(tells?.glow ?? []), ...Object.values(tells?.sounds ?? {}).flat());
    if (tells?.arm) points.push(tells.arm);
    if (tells?.charge) points.push(tells.charge.full, ...(tells.charge.empty ? [tells.charge.empty] : []));
    for (const scratch of hooks.run.marks.scratches(part.id)) points.push(...scratch);
  }
  const dots = hooks.scene.wires.flatMap((wire) => hooks.run.dots.dotsOn(wire.id).map(screen));
  const dead = hooks.scene.wires.filter((wire) => hooks.run.dots.dotsOn(wire.id).length === 0).flatMap((wire) => alongWire(wire.id, dots));
  return [...points.map(screen), ...dots, ...dead.filter((_, index) => index % 4 === 0)];
};

/** The named fault is showing at the screenshot tick. */
const expectFault = (run: Recorded, partId: PlacedPartId, failure: string): void => {
  expect(run.frame.live.get(partId)?.faults ?? [], `${partId} shows ${failure} at tick ${run.frame.tick}`).toContain(failure);
};

/** The screen points along a wire's drawn line, clear of its two sockets and of other wires' dots. */
const alongWire = (id: WireId, avoid: readonly Vec2[]): Vec2[] => {
  const ends = bench.hooks.run.endsOf(id);
  if (!ends) return [];
  const [from, to] = ends.map(screen) as [Vec2, Vec2];
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const socket = 24 * bench.hooks.camera.zoom;
  const out: Vec2[] = [];
  for (let s = socket; s <= length - socket; s += 2) {
    const point = { x: from.x + ((to.x - from.x) * s) / length, y: from.y + ((to.y - from.y) * s) / length };
    if (avoid.every((dot) => Math.hypot(dot.x - point.x, dot.y - point.y) > 14)) out.push(point);
  }
  return out;
};

/**
 * Every power line the Run says carries current has dots, drawn where the canvas says; every one that carries none has
 * no dot anywhere along it. Returns the live and dead wires, for the fixture's own checks.
 */
const expectDots = (run: Recorded): { live: WireId[]; dead: WireId[] } => {
  const { hooks } = bench;
  const live: WireId[] = [];
  const dead: WireId[] = [];
  for (const wire of hooks.scene.wires) {
    const flow = run.frame.flows.get(wire.id);
    const carrying = wire.type === 'signal' ? (flow?.signal ?? 0) > 0.01 : Math.abs(flow?.milliamps ?? 0) >= 0.1;
    (carrying ? live : dead).push(wire.id);
  }
  const allDots = hooks.scene.wires.flatMap((wire) => hooks.run.dots.dotsOn(wire.id).map(screen));
  for (const id of live) {
    const wire = hooks.scene.wires.find((candidate) => candidate.id === id);
    const fill = rgbOf(hooks.run.dots.fillOf(wire?.type ?? 'power') ?? 0);
    const dots = hooks.run.dots.dotsOn(id).map(screen);
    expect(dots.length, `${id} is live and carries dots`).toBeGreaterThan(0);
    // Dots under a socket are hidden by it, as on a wire no longer than its two sockets (a short across a pack).
    const ends = hooks.run.endsOf(id)?.map(screen) ?? [];
    const socket = 24 * hooks.camera.zoom;
    const clear = dots.filter((dot) => ends.every((end) => Math.hypot(dot.x - end.x, dot.y - end.y) > socket + 6));
    if (clear.length === 0) continue;
    const seen = clear.filter((dot) => run.shot.around(dot, 1).some((rgb) => colourDistance(rgb, fill) <= 24));
    expect(seen.length, `${id}'s dots show in the screenshot (${describeRgb(fill)})`).toBeGreaterThan(0);
  }
  for (const id of dead) {
    expect(hooks.run.dots.dotsOn(id), `${id} is dead and carries no dots`).toHaveLength(0);
    const wire = hooks.scene.wires.find((candidate) => candidate.id === id);
    const fill = rgbOf(hooks.run.dots.fillOf(wire?.type ?? 'power') ?? 0);
    const lit = alongWire(id, allDots).filter((point) => colourDistance(run.shot.at(point), fill) <= 20);
    expect(lit.map((point) => describeRgb(run.shot.at(point))), `no dot along dead ${id}`).toEqual([]);
  }
  return { live, dead };
};

/** A tread mark, an arm or a sound twin: darker than the light ground it is drawn over. */
const expectDrawn = (shot: Shot, points: readonly Vec2[], what: string, atLeast = 1, darkerThan = 150): void => {
  const dark = points.map(screen).filter((point) => shot.around(point, 1).some((rgb) => luminance(rgb) < darkerThan));
  expect(dark.length, `${what}: ${dark.length} of ${points.length} probes are drawn`).toBeGreaterThanOrEqual(atLeast);
};

const travelledBetween = (run: Recorded, partId: PlacedPartId): number =>
  (bench.hooks.run.state?.treads.get(partId) ?? 0) - (run.treadsBefore.get(partId) ?? 0);

/** Each wheel's tread marks are drawn where the canvas says, in both screenshots. */
const expectTreads = (run: Recorded, wheels: readonly PlacedPartId[]): void => {
  for (const id of wheels) {
    const tells = bench.hooks.run.tellsOf(id);
    expect(tells?.treads?.length ?? 0, `${id} has tread marks`).toBeGreaterThan(0);
    expectDrawn(run.shot, tells?.treads ?? [], `${id}'s tread marks`, Math.ceil((tells?.treads?.length ?? 0) / 2));
  }
};

/** How far a part has turned from where it was built, degrees either way. */
const turnedBy = (partId: PlacedPartId): number => {
  const built = bench.hooks.scene.partById.get(partId);
  if (!built) return 0;
  const at = bench.hooks.run.partPoint(partId, { x: 100, y: 0 });
  const origin = bench.hooks.run.partPoint(partId, { x: 0, y: 0 });
  const now = (Math.atan2(at.y - origin.y, at.x - origin.x) * 180) / Math.PI;
  return ((((now - built.placed.rotation) % 360) + 540) % 360) - 180;
};

const movedBy = (partId: PlacedPartId): number => {
  const built = bench.hooks.scene.partById.get(partId)?.placed.position;
  const now = bench.hooks.run.partPoint(partId, { x: 0, y: 0 });
  return built ? Math.hypot(now.x - built.x, now.y - built.y) : 0;
};

/** Scrape marks lie on the floor behind the body, darker than the floor beside them. */
const expectScrapes = (run: Recorded, body: PlacedPartId): void => {
  const scratches = bench.hooks.run.marks.scratches(body);
  expect(scratches.length, `${body} leaves scratches`).toBeGreaterThan(0);
  const middle = scratches[1] ?? scratches[0] ?? [];
  expect(middle.length, `${body}'s scratch has points`).toBeGreaterThan(2);
  const first = middle[0] as Vec2;
  const next = middle[Math.min(middle.length - 1, 4)] as Vec2;
  const along = { x: next.x - first.x, y: next.y - first.y };
  const length = Math.hypot(along.x, along.y) || 1;
  const across = { x: -along.y / length, y: along.x / length };
  const at = { x: (first.x + next.x) / 2, y: (first.y + next.y) / 2 };
  const mark = run.shot.at(screen(at));
  const floor = run.shot.at(screen({ x: at.x + across.x * 12, y: at.y + across.y * 12 }));
  expect(colourDistance(mark, floor), `the scrape (${describeRgb(mark)}) shows on the floor (${describeRgb(floor)})`).toBeGreaterThan(25);
};

describe('each broken fixture in Run mode shows its own tell', () => {
  it('broken-reversed-motor: the right wheel turns backwards, so the robot spins on the spot', async () => {
    const run = await record(named('broken-reversed-motor'));
    expectFault(run, 'motor-right', 'reversed');
    const { dead } = expectDots(run);
    expect(dead).toEqual([]);
    expectTreads(run, ['wheel-left', 'wheel-right']);
    // The tread marks move opposite ways between the two screenshots: forward on the left, backward on the right.
    expect(travelledBetween(run, 'wheel-left')).toBeGreaterThan(1);
    expect(travelledBetween(run, 'wheel-right')).toBeLessThan(-1);
    expect(Math.abs(turnedBy('chassis')), 'the robot has turned').toBeGreaterThan(45);
    expect(movedBy('chassis'), 'on the spot').toBeLessThan(120);
  });

  it('broken-missing-return-wire: the left motor has no current and its wheel stays still, so the robot turns', async () => {
    const run = await record(named('broken-missing-return-wire'));
    expectFault(run, 'motor-left', 'no-circuit');
    const { dead } = expectDots(run);
    expect(dead.length, 'the left motor’s line is dead').toBeGreaterThan(0);
    expectTreads(run, ['wheel-left', 'wheel-right']);
    expect(travelledBetween(run, 'wheel-left')).toBe(0);
    expect(travelledBetween(run, 'wheel-right')).toBeGreaterThan(1);
    expect(Math.abs(turnedBy('chassis')), 'the robot has turned').toBeGreaterThan(20);
  });

  it('broken-servo-without-signal: the servo motor’s arm holds at rest and it hums', async () => {
    const run = await record(named('broken-servo-without-signal'));
    expectFault(run, 'servo', 'no-signal');
    expectDots(run);
    expect(run.frame.live.get('servo')?.values.angle).toBe(90);
    const tells = bench.hooks.run.tellsOf('servo');
    expect(tells?.arm, 'the arm is drawn').toBeDefined();
    const arm = run.shot.at(screen(tells?.arm ?? { x: 0, y: 0 }));
    expect(luminance(arm), `the arm (${describeRgb(arm)}) is drawn in white`).toBeGreaterThan(225);
    // The arm has not moved between the two screenshots.
    expect(colourDistance(run.before.at(screen(tells?.arm ?? { x: 0, y: 0 })), arm)).toBeLessThanOrEqual(8);
    expectDrawn(run.shot, tells?.sounds?.hum ?? [], 'the hum’s visual twin');
    expect(tells?.sounds?.buzz, 'no buzz').toBeUndefined();
  });

  it('broken-underpowered-pack: a trickle reaches the motor driver and nothing reaches the motors', async () => {
    const run = await record(named('broken-underpowered-pack'));
    expectFault(run, 'driver', 'low-voltage');
    const { live, dead } = expectDots(run);
    expect(live.length, 'the pack still feeds the driver').toBeGreaterThan(0);
    expect(dead.length, 'the motors’ lines are dead').toBeGreaterThanOrEqual(4);
    expectTreads(run, ['wheel-left', 'wheel-right']);
    expect(travelledBetween(run, 'wheel-left')).toBe(0);
    expect(travelledBetween(run, 'wheel-right')).toBe(0);
    expect(movedBy('chassis'), 'the robot stays put').toBeLessThan(0.5);
  });

  it('broken-chassis-on-the-floor: the chassis drags and scrapes the floor behind it', async () => {
    const run = await record(named('broken-chassis-on-the-floor'));
    expectFault(run, 'chassis', 'scraping');
    expectDots(run);
    expectScrapes(run, 'chassis');
    expect(movedBy('chassis'), 'the robot creeps forward').toBeGreaterThan(50);
  });

  it('broken-short-circuit: current races round the wire across the pack, nothing else moves, and the pack drains', async () => {
    const run = await record(named('broken-short-circuit'));
    expectFault(run, 'battery', 'short-circuit');
    const { live } = expectDots(run);
    expect(live, 'only the short carries current').toHaveLength(1);
    const charge = bench.hooks.run.state?.charges.get('battery') ?? 1;
    expect(charge).toBeLessThan(0.95);
    const gauge = bench.hooks.run.tellsOf('battery')?.charge;
    expect(gauge?.empty, 'the gauge shows the drain').toBeDefined();
    const full = run.shot.at(screen(gauge?.full ?? { x: 0, y: 0 }));
    const empty = run.shot.at(screen(gauge?.empty ?? { x: 0, y: 0 }));
    expect(colourDistance(full, empty), `the gauge's fill (${describeRgb(full)}) and its empty end (${describeRgb(empty)})`).toBeGreaterThan(80);
    // The drain shows in the power colour: the short's fault (`shows: drain`) turns the pack's gauge red.
    const power = rgbOf(bench.hooks.run.dots.colourOf('power') ?? 0);
    expect(colourDistance(full, power), `the gauge fills in the power colour (${describeRgb(full)}, not ${describeRgb(power)})`).toBeLessThanOrEqual(40);
    expect(movedBy('chassis'), 'the robot stays put').toBeLessThan(0.5);
  });

  it('broken-wrong-type-wire: the refused power line is not in the build, and the build before it runs', async () => {
    const fixture = named('broken-wrong-type-wire');
    const run = await record(fixture);
    const refused = fixture.expect.refused;
    expect(refused).toBeDefined();
    const joins = fixture.blueprint.wires.some(
      (wire) =>
        [wire.from, wire.to].some((end) => end.part === refused?.from.part && end.port === refused.from.port) &&
        [wire.from, wire.to].some((end) => end.part === refused?.to.part && end.port === refused.to.port),
    );
    expect(joins, 'no wire joins the battery pack’s plus to the motor driver’s signal in').toBe(false);
    expect([...run.frame.live.values()].flatMap((live) => live.faults)).toEqual([]);
    const { dead } = expectDots(run);
    expect(dead).toEqual([]);
    expectDrawn(run.shot, bench.hooks.run.tellsOf('motor')?.sounds?.motor ?? [], 'the motor’s visual twin', 1, 200);
  });

  it('broken-loose-caster: the caster stays behind where it was put, and the chassis drags', async () => {
    const run = await record(named('broken-loose-caster'));
    expectFault(run, 'caster', 'loose');
    expectDots(run);
    expect(movedBy('caster'), 'the caster stays where it was put').toBeLessThan(1);
    expect(movedBy('chassis'), 'the robot drives away from it').toBeGreaterThan(100);
    const caster = run.shot.at(screen(bench.hooks.run.partPoint('caster', { x: 0, y: 0 })));
    const floor = run.shot.at(screen(bench.hooks.run.partPoint('caster', { x: 0, y: 70 })));
    expect(colourDistance(caster, floor), `the caster (${describeRgb(caster)}) lies on the floor (${describeRgb(floor)})`).toBeGreaterThan(20);
    expectScrapes(run, 'chassis');
  });
});

describe('a working fixture in Run mode', () => {
  it('led-and-buzzer-robot: every line live, the LED lit and the buzzer pulsing, with no fault', async () => {
    const run = await record(WORKING);
    expect([...run.frame.live.values()].flatMap((live) => live.faults)).toEqual([]);
    const { dead } = expectDots(run);
    expect(dead).toEqual([]);
    const glow = bench.hooks.run.tellsOf('led')?.glow ?? [];
    const lit = glow.map(screen).filter((point) => {
      const [r, g] = run.shot.at(point);
      return r - g > 25;
    });
    expect(lit.length, 'the LED’s light shows round it').toBeGreaterThanOrEqual(3);
    expectDrawn(run.shot, bench.hooks.run.tellsOf('buzzer')?.sounds?.buzz ?? [], 'the buzzer’s pulse', 3);
    expectTreads(run, ['wheel-left', 'wheel-right']);
    expect(travelledBetween(run, 'wheel-left')).toBeGreaterThan(1);
    expect(travelledBetween(run, 'wheel-right')).toBeGreaterThan(1);
    // A pack with no fault that shows `drain` keeps a dark gauge, not the power colour.
    const gauge = bench.hooks.run.tellsOf('battery')?.charge?.full;
    expect(gauge).toBeDefined();
    const fill = run.shot.at(screen(gauge ?? { x: 0, y: 0 }));
    expect(luminance(fill), `the gauge (${describeRgb(fill)}) is dark`).toBeLessThan(90);
  });
});

/** Mounts the caster the fixture left loose: the one change that fixes it. */
const mountCaster = (blueprint: Blueprint): Blueprint => {
  const result = applyEdit(blueprint, { kind: 'mount', partId: 'caster', port: 'mount', onto: { part: 'chassis', port: 'caster' } }, benchContent().catalogue);
  if (!result.ok) throw new Error(`Cannot mount the caster: ${result.refusal.message}`);
  return result.blueprint;
};

/**
 * Each broken fixture's honest baseline: the same robot with its fault fixed, where the content has that build
 * (Rolling Start with every wire right, the motor driver robot on a 2-cell pack, the geared robot with its caster) or
 * one edit makes it (the caster mounted). The servo motor's missing signal cannot be fixed at Levels 1–2 (no part gives
 * a signal, D41), and the wrong-type wire's build is already the fixed one, so theirs is the same build in Build mode.
 */
const FIXED: Readonly<Record<string, () => Blueprint | 'build-mode'>> = {
  'broken-reversed-motor': () => named('kit-rolling-start').blueprint,
  'broken-missing-return-wire': () => named('kit-rolling-start').blueprint,
  'broken-short-circuit': () => named('kit-rolling-start').blueprint,
  'broken-underpowered-pack': () => named('motor-driver-robot').blueprint,
  'broken-chassis-on-the-floor': () => named('geared-robot').blueprint,
  'broken-loose-caster': () => mountCaster(named('broken-loose-caster').blueprint),
  'broken-servo-without-signal': () => 'build-mode',
  'broken-wrong-type-wire': () => 'build-mode',
};

/** The baseline's screenshot, in the broken Run's camera, at the same tick: run with no inputs, or in Build mode. */
const baselineShot = async (run: Recorded): Promise<Shot> => {
  const { handle, hooks } = bench;
  const fixed = FIXED[run.fixture.name]?.();
  if (!fixed) throw new Error(`No baseline for ${run.fixture.name}.`);
  if (handle.mode === 'run') handle.setMode('build');
  const blueprint = fixed === 'build-mode' ? run.fixture.blueprint : fixed;
  expect(handle.load(blueprint).ok).toBe(true);
  if (fixed !== 'build-mode') {
    handle.setMode('run');
    const baseline: ContentFixture = { ...run.fixture, blueprint, inputs: [] };
    const simulation = await simulationOf(baseline);
    handle.applyRunFrame(simulation.frame);
    for (const frame of playTo(simulation, baseline, run.frame.tick)) handle.applyRunFrame(frame);
    simulation.dispose();
  }
  Object.assign(hooks.camera, run.camera);
  hooks.requestFrame();
  await settle(bench);
  return shoot(hooks.canvas);
};

describe('every broken Run differs from its fault fixed', () => {
  for (const fixture of BROKEN) {
    it(fixture.name, async () => {
      const run = recorded.get(fixture.name);
      expect(run, `${fixture.name} was recorded`).toBeDefined();
      if (!run) return;
      const baseline = await baselineShot(run);
      // Where the Run drew its tells, the baseline shows something else: a Run that drew none of them would match it.
      const differing = run.mask.filter((point) => colourDistance(run.shot.at(point), baseline.at(point)) > 24);
      expect(run.mask.length, 'the Run drew something to compare').toBeGreaterThan(5);
      expect(differing.length / run.mask.length, `${differing.length} of ${run.mask.length} tell points differ from the baseline`).toBeGreaterThanOrEqual(0.25);
    });
  }
});

describe('Stop', () => {
  it('Stop returns to the build exactly as it was', async () => {
    const fixture = named('broken-reversed-motor');
    const { handle } = bench;
    if (handle.mode === 'run') handle.setMode('build');
    handle.load(fixture.blueprint);
    handle.setMode('build');
    await settle(bench);
    const before = await shoot(bench.hooks.canvas);
    handle.setMode('run');
    const simulation = await simulationOf(fixture);
    handle.applyRunFrame(simulation.frame);
    for (const frame of playTo(simulation, fixture, 30)) handle.applyRunFrame(frame);
    await settle(bench);
    simulation.dispose();
    handle.setMode('build');
    await settle(bench);
    const after = await shoot(bench.hooks.canvas);
    expect(differingShare(before, after, 2, 8)).toBe(0);
  });
});
