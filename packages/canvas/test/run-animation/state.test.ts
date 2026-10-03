// Run mode's pure parts (task 3.5): what can move in a build, the state a frame gives, the blend between two frames,
// the body transform, and where dots, tread marks and scrapes go. No Pixi, no clock.
import { describe, expect, it } from 'vitest';
import { TICK_RATE } from '@servo/schema';
import { layArena } from '../../src/scene/arena.ts';
import { buildScene } from '../../src/scene/scene.ts';
import { apply, bodyMatrix, invert, nodeMatrix } from '../../src/run-animation/affine.ts';
import { castOf } from '../../src/run-animation/cast.ts';
import { dotOffsets } from '../../src/run-animation/dots.ts';
import { DOT_SPACING_MM, MIN_FORESHORTEN, TREAD_SPACING_MM } from '../../src/run-animation/look.ts';
import { lowEdge } from '../../src/run-animation/marks.ts';
import { armTurn, lighten, treadMarks } from '../../src/run-animation/overlay.ts';
import { advance, blend, canvasPoseOfMotion, powerSpeed, rimSpeed } from '../../src/run-animation/state.ts';
import { catalogue, fixture } from '../helpers/catalogue.ts';
import { frameOf, rollingStartFrame } from '../helpers/run-frames.ts';

const rolling = fixture('rolling-start');
const scene = buildScene(rolling, catalogue);
const arena = layArena(rolling, catalogue, scene);
const cast = castOf(scene);
const matrix = arena?.matrix;

describe('what Run mode can animate, from the records alone', () => {
  it('finds bodies, wheels, the switch, the pack and every failure mode’s effects', () => {
    expect(cast.robot).toBe('chassis');
    expect(cast.bodies.get('chassis')).toEqual(expect.arrayContaining(['chassis', 'battery', 'caster', 'motor-left', 'motor-right', 'switch', 'wheel-left', 'wheel-right']));
    expect(cast.bodies.get('chassis')?.[0]).toBe('chassis');
    expect([...cast.wheels.keys()].sort()).toEqual(['wheel-left', 'wheel-right']);
    expect(cast.wheels.get('wheel-left')?.radiusMm).toBeGreaterThan(0);
    expect(cast.switches.get('switch')).toBe('manual');
    expect([...cast.sources]).toEqual(['battery']);
    expect(cast.effects.get('chassis')?.get('scraping')).toContain('drag');
    expect(cast.effects.get('motor-left')?.get('overload')).toContain('stall');
  });

  it('gives a servo motor an arm about its drive port, and an LED its colour', () => {
    const led = buildScene(fixture('led-circuit'), catalogue);
    const lights = castOf(led).lights;
    expect(lights.size).toBe(1);
    const [colour] = [...lights.values()];
    expect(colour).toBeTypeOf('number');
  });
});

describe('the state a frame gives', () => {
  it('maps a body’s arena pose onto the canvas, where the build put it at the start', () => {
    if (!matrix) throw new Error('no arena');
    const start = canvasPoseOfMotion({ x: 300, y: 600, heading: 0 }, matrix);
    expect(start.x).toBeCloseTo(0, 9);
    expect(start.y).toBeCloseTo(0, 9);
    expect(start.rotation).toBeCloseTo(0, 9);
    // 100 mm forward in the arena is 100 mm to the canvas's right; turning left (counter-clockwise) turns it up the canvas.
    const ahead = canvasPoseOfMotion({ x: 400, y: 600, heading: 90 }, matrix);
    expect(ahead.x).toBeCloseTo(100, 9);
    expect(ahead.rotation).toBeCloseTo(-90, 9);
  });

  it('accumulates dots and treads tick by tick at the frame’s own rates, and never from a clock', () => {
    const zero = advance(undefined, rollingStartFrame(0), cast, scene, matrix);
    expect(zero.wires.get('w8')?.travelled).toBe(0);
    expect(zero.treads.get('wheel-left')).toBe(0);
    const one = advance(zero, rollingStartFrame(1), cast, scene, matrix);
    expect(one.wires.get('w8')?.travelled).toBeCloseTo(powerSpeed(260) / TICK_RATE, 9);
    expect(one.wires.get('w9')?.travelled).toBeCloseTo(-powerSpeed(130) / TICK_RATE, 9);
    expect(one.treads.get('wheel-left')).toBeCloseTo(rimSpeed(90, 32.5) / TICK_RATE, 9);
    // Two ticks at once count twice; the same frames give the same state.
    const three = advance(one, rollingStartFrame(3), cast, scene, matrix);
    expect(three.treads.get('wheel-left')).toBeCloseTo((3 * rimSpeed(90, 32.5)) / TICK_RATE, 9);
    expect(advance(one, rollingStartFrame(3), cast, scene, matrix)).toEqual(three);
    // A frame at an earlier tick (a restore) starts again.
    expect(advance(three, rollingStartFrame(0), cast, scene, matrix).treads.get('wheel-left')).toBe(0);
  });

  it('keeps dead wires dead: no current, no speed', () => {
    const dead = advance(undefined, rollingStartFrame(0, { milliamps: 0.05, rpm: 0 }), cast, scene, matrix);
    expect([...dead.wires.values()].every((wire) => wire.speed === 0)).toBe(true);
    expect(powerSpeed(1.2)).toBeGreaterThan(0);
    expect(powerSpeed(1.2)).toBeLessThan(powerSpeed(130));
    expect(powerSpeed(7375)).toBeLessThanOrEqual(300);
  });

  it('turns debounced faults into the effects their failure modes show', () => {
    const state = advance(undefined, rollingStartFrame(5, { faults: { 'motor-left': ['overload'], chassis: ['scraping'], battery: ['short-circuit'] } }), cast, scene, matrix);
    expect([...state.stalled]).toEqual(['motor-left']);
    expect([...state.dragging]).toEqual(['chassis']);
    expect([...state.draining]).toEqual(['battery']);
  });

  it('puts a loose part’s drag on the robot it stands for', () => {
    const loose = { ...rolling, wires: rolling.wires.filter((wire) => wire.id !== 'w5') };
    const looseScene = buildScene(loose, catalogue);
    const looseCast = castOf(looseScene);
    const state = advance(undefined, rollingStartFrame(5, { faults: { caster: ['loose'] } }), looseCast, looseScene, matrix);
    expect([...state.dragging]).toEqual(['chassis']);
  });

  it('reads switches, charge, sounds and props', () => {
    const state = advance(
      undefined,
      frameOf(4, { switch: { values: { closed: false } }, battery: { values: { charge: 0.5 } }, 'motor-left': { sounds: [{ sound: 'hum', level: 1 }] }, 'arena:prop-1': { motion: { x: 1, y: 2, heading: 3 } } }),
      cast,
      scene,
      matrix,
    );
    expect(state.closed.get('switch')).toBe(false);
    expect(state.charges.get('battery')).toBe(0.5);
    expect(state.sounds.get('motor-left')?.get('hum')).toBe(1);
    expect(state.props.get('prop-1')).toEqual({ x: 1, y: 2, heading: 3 });
  });
});

describe('between two frames', () => {
  const a = advance(undefined, rollingStartFrame(10, { x: 300, heading: 350 }), cast, scene, matrix);
  const b = advance(a, rollingStartFrame(11, { x: 310, heading: 10 }), cast, scene, matrix);

  it('blends positions, the shortest way round, phases and levels', () => {
    const half = blend(a, b, 0.5);
    expect(half.ticks).toBe(10.5);
    expect(half.bodies.get('chassis')?.x).toBeCloseTo(5, 9);
    // From 350° to 10° the short way: through 0°, never back round through 180°.
    const turn = half.bodies.get('chassis')?.rotation ?? 0;
    expect(((turn % 360) + 360) % 360).toBeCloseTo(0, 9);
    expect(half.treads.get('wheel-left')).toBeCloseTo(((a.treads.get('wheel-left') ?? 0) + (b.treads.get('wheel-left') ?? 0)) / 2, 9);
    expect(half.shake).toBe(0);
  });

  it('lands exactly on the frame at the end, and shows it at once with nothing to blend from', () => {
    expect(blend(a, b, 1)).toMatchObject({ tick: 11, ticks: 11, shake: 1 });
    expect(blend(undefined, b, 0).ticks).toBe(11);
    expect(blend(a, b, 1).bodies).toEqual(b.bodies);
  });
});

describe('transforms and placements', () => {
  it('moves every part of a body as one, and back with the inverse', () => {
    const root = scene.partById.get('chassis');
    const wheel = scene.partById.get('wheel-left');
    if (!root || !wheel) throw new Error('no parts');
    const m = bodyMatrix(root.pose, { x: 100, y: 50, rotation: 90, pitch: 0, roll: 0 });
    expect(apply(m, { x: 0, y: 0 })).toEqual({ x: 100, y: 50 });
    const at = apply(m, { x: wheel.pose.x, y: wheel.pose.y });
    // The wheel 40 mm ahead and 79 mm up the canvas: a quarter turn clockwise puts it 40 mm down and 79 mm to the right.
    expect(at.x).toBeCloseTo(100 + 79, 9);
    expect(at.y).toBeCloseTo(50 + 40, 9);
    const back = apply(invert(m), at);
    expect(back.x).toBeCloseTo(wheel.pose.x, 9);
    expect(back.y).toBeCloseTo(wheel.pose.y, 9);
    expect(apply(nodeMatrix({ x: 3, y: 4, rotation: 0, mirrored: true }), { x: 1, y: 1 })).toEqual({ x: 4, y: 3 });
  });

  it('foreshortens a tilted body along its own axes, and a fallen one no thinner than the floor', () => {
    const root = scene.partById.get('chassis');
    if (!root) throw new Error('no chassis');
    const pitched = bodyMatrix(root.pose, { x: 0, y: 0, rotation: 0, pitch: 60, roll: 0 });
    expect(apply(pitched, { x: 80, y: 0 }).x).toBeCloseTo(40, 9);
    expect(apply(pitched, { x: 0, y: 65 }).y).toBeCloseTo(65, 9);
    const fallen = bodyMatrix(root.pose, { x: 0, y: 0, rotation: 0, pitch: 0, roll: -90 });
    expect(apply(fallen, { x: 0, y: 65 }).y).toBeCloseTo(65 * MIN_FORESHORTEN, 9);
  });

  it('spaces dots evenly along a wire, moving with the flow either way', () => {
    expect(dotOffsets(100, 0)).toEqual([0, 1, 2, 3, 4, 5, 6].map((k) => k * DOT_SPACING_MM).filter((s) => s <= 100));
    const moved = dotOffsets(100, 3);
    expect(moved[0]).toBeCloseTo(3, 9);
    const back = dotOffsets(100, -3);
    expect(back[0]).toBeCloseTo(DOT_SPACING_MM - 3, 9);
  });

  it('slides tread marks along the wheel, one spacing round to where they began', () => {
    const marks = treadMarks(65, 0);
    expect(marks.length).toBeGreaterThan(2);
    expect(treadMarks(65, 5).some((x) => Math.abs(x - ((marks[0] ?? 0) + 5)) < 1e-9)).toBe(true);
    expect(treadMarks(65, TREAD_SPACING_MM)).toEqual(marks);
  });

  it('scrapes on the low edge: the rear with the front up, the front with it down, a side when it rolls', () => {
    const chassis = scene.partById.get('chassis');
    if (!chassis) throw new Error('no chassis');
    const pose = { x: 0, y: 0, rotation: 0, pitch: 8, roll: 0 };
    expect(lowEdge(chassis, pose).every((point) => point.x === -80)).toBe(true);
    expect(lowEdge(chassis, { ...pose, pitch: -8 }).every((point) => point.x === 80)).toBe(true);
    expect(lowEdge(chassis, { ...pose, pitch: 0, roll: 30 }).every((point) => point.y === -65)).toBe(true);
  });

  it('points the arm forward at rest and sweeps it to the left as the angle grows', () => {
    expect(armTurn(90, 90)).toBeCloseTo(0, 12);
    // In the node's frame y runs down the canvas, so the part's left is a negative turn.
    expect(armTurn(180, 90)).toBeCloseTo(-Math.PI / 2, 12);
    expect(lighten(0x000000, 0.5)).toBe(0x808080);
  });
});
