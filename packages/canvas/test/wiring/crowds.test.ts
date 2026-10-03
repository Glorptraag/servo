// Crowded sockets (task 3.3, review R-3.1 finding 2): which sockets crowd, and where a crowd fans out so each socket
// has a 44 px target of its own at the default zoom. On the two Level 2 builds whose sockets overlap (the bumper
// robot and the Circuit Crew kit robot), and on the builds where none do. Pure. See docs/wiring.md.
import { describe, expect, it } from 'vitest';
import type { Blueprint, Catalogue, Vec2 } from '@servo/schema';
import { distance } from '../../src/scene/geometry.ts';
import { buildScene } from '../../src/scene/scene.ts';
import type { Scene } from '../../src/scene/scene.ts';
import { PORT_MM, PX_PER_MM } from '../../src/scene/units.ts';
import { FAN_RADIUS_STEPS, FAN_SPACING_MM, crowdsOf, drawnSockets, fanFor, fanRadius, spreadAngles } from '../../src/wiring/crowds.ts';
import type { Crowd, CrowdMember } from '../../src/wiring/crowds.ts';
import { WIRE_REACH_PX } from '../../src/wiring/rules.ts';
import { catalogue, fixture } from '../helpers/catalogue.ts';
import { crewCatalogue, crewRobot } from '../helpers/circuit-crew.ts';
import { fixtureNames } from '../helpers/plans.ts';

/** A finger's reach at the default zoom and sensitivity, mm. */
const REACH_MM = WIRE_REACH_PX / PX_PER_MM;

const keysOf = (crowd: Crowd): string[] => crowd.members.flatMap((member) => member.ports.map((port) => port.key)).sort();

/** The fan the canvas opens round `centre` at the default zoom and sensitivity. */
const fanAt = (scene: Scene, crowd: Crowd, centre: Vec2): ReadonlyMap<string, Vec2> => fanFor(scene, crowd, centre, REACH_MM);

const builds: readonly [string, Blueprint, Catalogue][] = [
  ['the bumper robot', fixture('bumper-robot'), catalogue],
  ['the Circuit Crew kit robot', crewRobot, crewCatalogue],
];

describe('which sockets crowd', () => {
  it('finds none where every socket has room: Rolling Start, the LED circuit and the other schema fixtures', () => {
    for (const name of fixtureNames.filter((each) => each !== 'bumper-robot')) {
      expect(crowdsOf(buildScene(fixture(name), catalogue)).list, name).toEqual([]);
    }
  });

  it('finds the bumper robot’s crowds round the motor driver and the servo motor’s arm', () => {
    const crowds = crowdsOf(buildScene(fixture('bumper-robot'), catalogue));
    expect(crowds.list.map(keysOf)).toEqual([
      ['bumper.a', 'bumper.b', 'servo.arm'],
      ['driver.a-plus', 'driver.minus', 'motor-left.minus'],
      ['driver.b-minus', 'driver.in-a', 'motor-right.minus'],
      ['driver.in-b', 'driver.plus', 'servo.minus'],
    ]);
  });

  it('finds the Circuit Crew kit robot’s crowds, 5.6 px and 18.6 px apart', () => {
    const crowds = crowdsOf(buildScene(crewRobot, crewCatalogue));
    expect(crowds.list.map(keysOf)).toEqual([
      ['buzzer.minus', 'driver.minus'],
      ['driver.in-a', 'switch.b'],
      ['driver.in-b', 'led.minus'],
      ['driver.plus', 'led.plus'],
    ]);
  });

  it('counts a shaft and the hub on it as one member, so a mated pair never crowds itself', () => {
    const crowds = crowdsOf(buildScene(fixture('rolling-start'), catalogue));
    expect(crowds.memberOf('wheel-left.hub')?.ports.map((port) => port.key).sort()).toEqual(['motor-left.shaft', 'wheel-left.hub']);
    expect(crowds.crowdOf('wheel-left.hub')).toBeUndefined();
  });

  it('crowds a free shaft and the free gearbox input on it: they sit on one spot until a linkage joins them', () => {
    const robot = fixture('bumper-robot');
    const loose = { ...robot, wires: robot.wires.filter((wire) => wire.id !== 'w10') };
    const crowd = crowdsOf(buildScene(loose, catalogue)).crowdOf('motor-left.shaft');
    expect(crowd && keysOf(crowd)).toEqual(['gear-left.input', 'motor-left.shaft']);
  });
});

describe.each(builds)('fanning out %s', (_, build, against) => {
  const scene = buildScene(build, against);
  const crowds = crowdsOf(scene);

  it('gives every crowded socket a 44 px target of its own, close by, wherever a press or a wire end opens the fan', () => {
    expect(crowds.list.length).toBeGreaterThan(0);
    for (const crowd of crowds.list) {
      const centres = [...crowd.members.map((member) => member.at), crowd.members.reduce((sum, member) => ({ x: sum.x + member.at.x / crowd.members.length, y: sum.y + member.at.y / crowd.members.length }), { x: 0, y: 0 })];
      for (const centre of centres) {
        const places = fanAt(scene, crowd, centre);
        for (const member of crowd.members) {
          const place = places.get(member.key) as Vec2;
          const label = `${crowd.id} round (${centre.x.toFixed(1)}, ${centre.y.toFixed(1)}): ${member.key}`;
          // A socket and a gap from every other fanned socket: no target overlaps another (fanned sockets are drawn
          // above the rest and take presses first).
          for (const other of crowd.members) if (other !== member) expect(distance(place, places.get(other.key) as Vec2), label).toBeGreaterThanOrEqual(FAN_SPACING_MM - 1e-9);
          // Out of a finger's reach from the centre, so the lift or press that opened it picks nothing, and close by.
          expect(distance(place, centre), label).toBeGreaterThan(REACH_MM);
          expect(distance(place, centre), label).toBeLessThanOrEqual(Math.max(fanRadius(REACH_MM), FAN_SPACING_MM / (2 * Math.sin(Math.PI / crowd.members.length))) + FAN_RADIUS_STEPS * (PORT_MM / 4) + 1e-9);
        }
      }
    }
  });

  it('keeps fanned sockets clear of every other socket where there is room near by', () => {
    // The LED circuit's battery pack stands alone on the workbench: its two sockets, fanned as if crowded.
    const roomy = buildScene(fixture('led-circuit'), catalogue);
    const members = ['battery.plus', 'battery.minus'].map((key) => crowdsOf(roomy).memberOf(key) as CrowdMember);
    const places = fanFor(roomy, { id: 'battery.plus', members }, { x: -110, y: 0 }, REACH_MM);
    for (const place of places.values()) {
      for (const port of drawnSockets(roomy)) expect(distance(place, port.at), port.key).toBeGreaterThanOrEqual(PORT_MM - 1e-9);
    }
  });

  it('fans out the same way every time', () => {
    for (const crowd of crowds.list) {
      const first = fanAt(scene, crowd, crowd.members[0]?.at as Vec2);
      expect([...fanAt(scene, crowd, crowd.members[0]?.at as Vec2)]).toEqual([...first]);
    }
  });
});

describe('spreadAngles', () => {
  const gapOf = (angles: readonly number[]): number => {
    const sorted = [...angles].sort((a, b) => a - b);
    return Math.min(...sorted.map((angle, k) => (k === 0 ? (sorted[0] as number) + 2 * Math.PI - (sorted.at(-1) as number) : angle - (sorted[k - 1] as number))));
  };

  it('keeps angles that are far enough apart where they are', () => {
    expect(spreadAngles([0, Math.PI / 2, Math.PI], 0.5)).toEqual([0, Math.PI / 2, Math.PI]);
  });

  it('pushes close angles apart evenly about where they were, keeping their order', () => {
    const [a, b] = spreadAngles([1, 1.1], 1) as [number, number];
    expect(b - a).toBeCloseTo(1, 9);
    expect((a + b) / 2).toBeCloseTo(1.05, 9);
    expect(a).toBeLessThan(b);
  });

  it('spaces them evenly round the circle when there is no room to spare, across the cut at 0', () => {
    const angles = spreadAngles([6.2, 0.05, 0.1, 6.25], Math.PI / 2);
    expect(gapOf(angles)).toBeCloseTo(Math.PI / 2, 9);
  });

  it('meets the gap for every crowd size the fan uses', () => {
    for (let n = 2; n <= 8; n++) {
      const preferred = Array.from({ length: n }, (_, k) => 0.3 + 0.01 * k);
      const gap = (2 * Math.PI) / n - 0.01;
      expect(gapOf(spreadAngles(preferred, gap)), `${n}`).toBeGreaterThanOrEqual(gap - 1e-9);
    }
  });
});
