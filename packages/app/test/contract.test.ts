// The flows the app's README documents, written against the package interfaces only. They are type-checked with
// the package, so an interface change that breaks them fails `pnpm typecheck`. They run once the stubs are replaced.
import { describe, expect, it } from 'vitest';
import { applyEdit, mountCanvas } from '@servo/canvas';
import type { CanvasHandle, EditCommand } from '@servo/canvas';
import { loadContent } from '@servo/content';
import type { Blueprint, Catalogue } from '@servo/schema';
import { createSimulation } from '@servo/sim-core';
import type { Simulation } from '@servo/sim-core';
import { mountApp } from '../src/index.ts';
import { openStore } from '../src/store/index.ts';
import type { ProfileStore } from '../src/store/index.ts';

/** Build → Run → Stop, as docs/run-loop.md describes it. */
const runOnce = async (canvas: CanvasHandle, child: ProfileStore, seed: number): Promise<void> => {
  const { content } = loadContent();
  const blueprint = canvas.blueprint;
  const arena = blueprint ? content.catalogue.arenas?.get(blueprint.arena.preset) : undefined;
  if (!blueprint || !arena) return;
  const simulation: Simulation = await createSimulation({ blueprint, catalogue: content.catalogue, arena, seed });
  const start = simulation.snapshot();
  canvas.setMode('run');
  canvas.applyRunFrame(simulation.frame);
  const off = canvas.on('control', ({ input }) => simulation.input(input));
  canvas.applyRunFrame(simulation.step());
  off();
  const previous = (await child.runs.list({ blueprintId: blueprint.meta.id })).at(-1);
  const times = { startedAt: '2026-10-01T09:00:00.000Z', endedAt: '2026-10-01T09:00:05.000Z' };
  await child.runs.add(simulation.record({ id: crypto.randomUUID(), ...times, runNumber: 1, hints: [], ...(previous ? { previous } : {}) }));
  simulation.restore(start);
  canvas.setMode('build');
};

/** The hint ladder's do-it: a motor placed straight onto a mount point, as one undo step. */
const doIt: EditCommand = {
  kind: 'batch',
  commands: [{ kind: 'place-part', part: 'dc-motor', attach: { port: 'mount', onto: { part: 'p1', port: 'motor-left' } } }],
};

describe('the contracts the app builds against', () => {
  it('has typed stubs that refuse until their tasks land', async () => {
    const host = {} as HTMLElement;
    // Task 3.1 has landed: mountCanvas draws in a browser, and packages/canvas tests it there.
    expect(mountCanvas).toBeTypeOf('function');
    expect(() => applyEdit({} as Blueprint, doIt, {} as Catalogue)).toThrow(/tasks 3\.2 and 3\.3/);
    await expect(createSimulation({ blueprint: {} as Blueprint, catalogue: {} as Catalogue, arena: {} as never, seed: 1 })).rejects.toThrow(/task 1\.5/);
    await expect(openStore()).rejects.toThrow(/task 4\.9/);
    await expect(mountApp(host)).rejects.toThrow(/task 4\.1/);
    expect(runOnce).toBeTypeOf('function');
  });
});
