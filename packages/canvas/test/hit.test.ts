import { describe, expect, it } from 'vitest';
import { hitTest } from '../src/scene/hit.ts';
import { buildScene } from '../src/scene/scene.ts';
import type { SceneWire } from '../src/scene/scene.ts';
import { catalogue, fixture } from './helpers/catalogue.ts';

describe('what lies under a point', () => {
  const scene = buildScene(fixture('rolling-start'), catalogue);

  it('is nothing on the empty workbench', () => {
    expect(hitTest(scene, { x: 400, y: 400 })).toBeNull();
  });

  it('finds a socket before the part it is on', () => {
    const plus = scene.portByKey.get('battery.plus');
    if (!plus) throw new Error('no battery plus');
    const hit = hitTest(scene, plus.at);
    expect(hit?.kind).toBe('port');
    expect(hit?.kind === 'port' && hit.port.key).toBe('battery.plus');
  });

  it('finds a wire away from its ends', () => {
    // Battery pack plus to switch a: three quarters of the way along it is clear of every socket.
    const wire = scene.wires.find((candidate) => candidate.id === 'w8') as SceneWire;
    const along = { x: wire.from.at.x + 0.75 * (wire.to.at.x - wire.from.at.x), y: wire.from.at.y + 0.75 * (wire.to.at.y - wire.from.at.y) };
    const hit = hitTest(scene, along);
    expect(hit?.kind === 'wire' && hit.wire.id).toBe('w8');
  });

  it('finds a part above the chassis, and the chassis where nothing is on it', () => {
    const motor = scene.partById.get('motor-left');
    if (!motor) throw new Error('no motor');
    const onMotor = hitTest(scene, { x: motor.pose.x - 5, y: motor.pose.y });
    expect(onMotor?.kind === 'part' && onMotor.part.id).toBe('motor-left');
    const onChassis = hitTest(scene, { x: -45, y: 40 });
    expect(onChassis?.kind === 'part' && onChassis.part.id).toBe('chassis');
  });
});
