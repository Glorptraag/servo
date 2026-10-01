// Where a wire lands (task 3.3), by the rules every input path shares: every pair of sockets in every legal schema
// fixture and the Circuit Crew kit robot, each wire dropped on its far socket at the default zoom, fanning a crowd out
// first where the rules say so. A wire lands exactly where `planWire` accepts it, and every impossible pair is refused
// with the schema's code. Around every crowd and every socket, no drop ever lands on a socket other than the one under
// it, and a drop on the wire's own source sends it back. Pure.
import { describe, expect, it } from 'vitest';
import { planWire } from '@servo/schema';
import type { Blueprint, Catalogue, Vec2 } from '@servo/schema';
import { distance } from '../../src/scene/geometry.ts';
import { buildScene } from '../../src/scene/scene.ts';
import { PORT_MM, PX_PER_MM } from '../../src/scene/units.ts';
import { crowdsOf, drawnSockets, fanFor } from '../../src/wiring/crowds.ts';
import { WIRE_REACH_PX, judgeSockets, landingAt, socketsFrom, wireEndAt } from '../../src/wiring/rules.ts';
import type { Socket } from '../../src/wiring/rules.ts';
import { catalogue, fixture } from '../helpers/catalogue.ts';
import { crewCatalogue, crewRobot } from '../helpers/circuit-crew.ts';
import { fixtureNames } from '../helpers/plans.ts';

/** A finger's reach at the default zoom and sensitivity, mm. */
const REACH = WIRE_REACH_PX / PX_PER_MM;

const builds: readonly [string, Blueprint, Catalogue][] = [
  ...fixtureNames.map((name): [string, Blueprint, Catalogue] => [name, fixture(name), catalogue]),
  ['kit-circuit-crew', crewRobot, crewCatalogue],
];

describe.each(builds)('%s: every wire dropped on every socket', (_, build, against) => {
  const scene = buildScene(build, against);
  const crowds = crowdsOf(scene);

  it('lands where planWire accepts the wire, and is refused with its code where it does not', () => {
    let landed = 0;
    let refused = 0;
    let spread = 0;
    for (const source of drawnSockets(scene)) {
      const verdicts = judgeSockets(build, against, scene, source.ref);
      const sockets = socketsFrom(scene, crowds, verdicts, source);
      const sourceMember = crowds.memberOf(source.key)?.key;
      for (const target of drawnSockets(scene)) {
        if (target.key === source.key || crowds.memberOf(target.key)?.key === sourceMember) continue;
        const plan = planWire(build, against, source.ref, target.ref);
        const label = `${source.key} → ${target.key}`;
        let landing = landingAt(target.at, sockets, REACH);
        if (landing.kind === 'spread') {
          spread += 1;
          // The crowd fans out round the drop. Lifting there again picks nothing; the hand goes to the socket.
          const crowd = crowds.crowdOf(landing.socket.port.key);
          if (!crowd) throw new Error(`${label}: no crowd to spread`);
          const around = socketsFrom(scene, crowds, verdicts, source, fanFor(scene, crowd, target.at, REACH));
          expect(landingAt(target.at, around, REACH).kind, label).toBe('none');
          const fanned = around.find((socket) => socket.port.key === target.key) as Socket;
          landing = landingAt(fanned.at, around, REACH);
        }
        if (plan.legal) {
          landed += 1;
          expect(landing.kind === 'land' && landing.socket.port.key, label).toBe(target.key);
        } else {
          refused += 1;
          expect(landing.kind, label).toBe('refuse');
          if (landing.kind !== 'refuse') continue;
          // A mated shaft and hub sit on one spot: either may refuse, each for its own reason.
          expect(crowds.memberOf(landing.socket.port.key)?.key, label).toBe(crowds.memberOf(target.key)?.key);
          const own = planWire(build, against, source.ref, landing.socket.port.ref);
          expect(!own.legal && landing.socket.code, label).toBe(!own.legal && own.code);
        }
      }
    }
    expect(landed + refused).toBeGreaterThan(0);
    if (crowds.list.length === 0) expect(spread).toBe(0);
  });

  it('never lands a wire on a socket other than the one under the drop, all round every crowd', () => {
    for (const crowd of crowds.list) {
      const middle = crowd.members.reduce((sum, member) => ({ x: sum.x + member.at.x / crowd.members.length, y: sum.y + member.at.y / crowd.members.length }), { x: 0, y: 0 });
      for (const source of drawnSockets(scene)) {
        const sockets = socketsFrom(scene, crowds, judgeSockets(build, against, scene, source.ref), source);
        for (let dx = -40; dx <= 40; dx += 4) {
          for (let dy = -40; dy <= 40; dy += 4) {
            const point: Vec2 = { x: middle.x + dx, y: middle.y + dy };
            const landing = landingAt(point, sockets, REACH);
            if (landing.kind !== 'land') continue;
            const label = `${source.key} dropped at (${point.x}, ${point.y}) on ${landing.socket.port.key}`;
            expect(landing.socket.legal, label).toBe(true);
            // Its own source too: a drop on it is never a drop on a neighbour.
            const under = sockets.filter((socket) => !socket.shadow && distance(point, socket.at) <= PORT_MM / 2);
            for (const socket of under) expect(socket.member, label).toBe(landing.socket.member);
          }
        }
      }
    }
  }, 60_000);

  it('sends a wire dropped on its own source back, wherever a neighbour would take it', () => {
    for (const source of drawnSockets(scene)) {
      const sockets = socketsFrom(scene, crowds, judgeSockets(build, against, scene, source.ref), source);
      for (let angle = 0; angle < 360; angle += 30) {
        for (const px of [0, 6, 12, 18]) {
          const radians = (angle * Math.PI) / 180;
          const point: Vec2 = { x: source.at.x + (Math.cos(radians) * px) / PX_PER_MM, y: source.at.y + (Math.sin(radians) * px) / PX_PER_MM };
          const landing = landingAt(point, sockets, REACH);
          const label = `${source.key} dropped ${px} px from its centre at ${angle}°: ${landing.kind}`;
          // On another socket's target as well, its crowd fans out or that socket refuses; never a landing.
          const others = sockets.filter((socket) => socket.member !== crowds.memberOf(source.key)?.key && !socket.shadow && distance(point, socket.at) <= PORT_MM / 2);
          expect(landing.kind, label).toBe(others.length === 0 ? 'source' : landing.kind === 'spread' ? 'spread' : 'refuse');
        }
      }
    }
  });
});

describe('the free end of a wire under a finger', () => {
  const build = fixture('motor-off-pin');
  const scene = buildScene(build, catalogue);
  const crowds = crowdsOf(scene);
  const port = (key: string) => {
    const found = scene.portByKey.get(key);
    if (!found) throw new Error(`no socket ${key}`);
    return found;
  };
  const from = (key: string): Socket[] => socketsFrom(scene, crowds, judgeSockets(build, catalogue, scene, port(key).ref), port(key));

  it('snaps onto a socket that takes the wire within 32 px, and not beyond', () => {
    const sockets = from('battery.plus');
    const motor = port('motor.minus').at;
    const near = { x: motor.x - 30 / PX_PER_MM, y: motor.y };
    const far = { x: motor.x - 34 / PX_PER_MM, y: motor.y };
    expect(wireEndAt(near, sockets, REACH, port('battery.plus').at)).toEqual({ end: motor, target: expect.objectContaining({ port: port('motor.minus') }) });
    expect(wireEndAt(far, sockets, REACH, port('battery.plus').at)).toEqual({ end: far });
  });

  it('is pushed out of reach of a socket that refuses the wire', () => {
    const sockets = from('battery.plus');
    const signal = port('servo.signal').at;
    const over = { x: signal.x + 2, y: signal.y + 1 };
    const pushed = wireEndAt(over, sockets, REACH, port('battery.plus').at);
    expect(pushed.pushedBy?.port.key).toBe('servo.signal');
    expect(distance(pushed.end, signal)).toBeCloseTo(REACH, 9);
    expect(pushed.target).toBeUndefined();
    // Right on the socket's centre, it is pushed back the way the wire came.
    const centred = wireEndAt(signal, sockets, REACH, port('battery.plus').at);
    expect(distance(centred.end, signal)).toBeCloseTo(REACH, 9);
    expect(distance(centred.end, port('battery.plus').at)).toBeLessThan(distance(signal, port('battery.plus').at));
  });
});
