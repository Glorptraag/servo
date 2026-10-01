import { describe, expect, it } from 'vitest';
import { arenaPoseOf, makeCatalogue } from '@servo/schema';
import type { Blueprint } from '@servo/schema';
import { arenaToCanvas, layArena } from '../src/scene/arena.ts';
import { buildScene } from '../src/scene/scene.ts';
import type { Scene, ScenePart } from '../src/scene/scene.ts';
import { arenas, catalogue, fixture, parts } from './helpers/catalogue.ts';

describe('the arena on the canvas', () => {
  it('lays the start pose on the robot’s root, as a Run starts it (geometry.md)', () => {
    const blueprint = fixture('rolling-start');
    const scene = buildScene(blueprint, catalogue);
    const arena = layArena(blueprint, catalogue, scene);
    expect(arena).toBeDefined();
    if (!arena) return;
    const start = arena.preset.start;
    const atRoot = arenaToCanvas(arena.matrix, start);
    expect(atRoot.x).toBeCloseTo(0, 9);
    expect(atRoot.y).toBeCloseTo(0, 9);
  });

  it('inverts arenaPoseOf, for any root turn and start heading', () => {
    const blueprint = fixture('rolling-start');
    const base = buildScene(blueprint, catalogue);
    const chassis = base.partById.get('chassis') as ScenePart;
    for (const rotation of [0, 90, 135, 270]) {
      for (const heading of [0, 30, 180, 300]) {
        const root = { ...chassis, placed: { ...chassis.placed, position: { x: 12, y: -40 }, rotation } };
        const scene: Scene = { ...base, partById: new Map([['chassis', root]]) };
        const preset = { ...arenas[0], start: { x: 300, y: 600, heading } } as (typeof arenas)[number];
        const shifted = makeCatalogue({ parts: [...parts], arenas: [preset] });
        const arena = layArena({ ...blueprint, arena: { preset: preset.id, props: [] } }, shifted, scene);
        if (!arena) throw new Error('no arena');
        for (const point of [{ x: 0, y: 0 }, { x: 150, y: -60 }, { x: -320, y: 410 }]) {
          const pose = arenaPoseOf(preset.start, { x: 12, y: -40, rotation }, { ...point, rotation: 0 });
          const back = arenaToCanvas(arena.matrix, pose);
          expect(back.x).toBeCloseTo(point.x, 6);
          expect(back.y).toBeCloseTo(point.y, 6);
        }
      }
    }
  });

  it('uses the canvas origin when no part holds another', () => {
    const blueprint = fixture('led-circuit');
    const arena = layArena(blueprint, catalogue, buildScene(blueprint, catalogue));
    if (!arena) throw new Error('no arena');
    const origin = arenaToCanvas(arena.matrix, arena.preset.start);
    expect(origin.x).toBeCloseTo(0, 9);
    expect(origin.y).toBeCloseTo(0, 9);
  });

  it('lists the preset’s props and the child’s, by id', () => {
    const blueprint = fixture('bumper-robot');
    const arena = layArena(blueprint, catalogue, buildScene(blueprint, catalogue));
    expect(arena?.props.map((prop) => prop.id)).toEqual(['box', 'cone']);
  });

  it('is absent when the catalogue has no such arena', () => {
    const blueprint: Blueprint = fixture('rolling-start');
    const withoutArenas = makeCatalogue({ parts: [...parts] });
    expect(layArena(blueprint, withoutArenas, buildScene(blueprint, withoutArenas))).toBeUndefined();
    expect(layArena(undefined, catalogue, buildScene(undefined, catalogue))).toBeUndefined();
  });
});
