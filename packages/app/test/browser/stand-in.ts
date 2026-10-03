// A stand-in for the canvas, for the store's browser tests and their test page: it keeps the build it is given and
// renames it as the canvas's `rename` command does, firing `edit` as the canvas would. The real canvas refuses
// edits until task 3.2.
import type { CanvasEventMap, CanvasHandle, CanvasMode, EditCommand, EditResult, ListView, Selection } from '@servo/canvas';
import type { Blueprint, ValidationResult } from '@servo/schema';

/** A stand-in for the canvas: it keeps the build it is given, and renames it as the canvas's `rename` command does. */
export class StandInCanvas implements CanvasHandle {
  mode: CanvasMode = 'build';
  blueprint: Blueprint | undefined;
  selection: Selection | null = null;
  zoom = 1;
  readonly applied: EditCommand[] = [];
  private readonly listeners = new Map<keyof CanvasEventMap, Set<(event: never) => void>>();

  get listView(): ListView {
    throw new Error('not in the stand-in');
  }
  load(blueprint: Blueprint): ValidationResult<Blueprint> {
    this.blueprint = blueprint;
    return { ok: true, value: blueprint };
  }
  apply(command: EditCommand): EditResult {
    this.applied.push(command);
    if (command.kind !== 'rename' || !this.blueprint) return { ok: false, refusal: { code: 'edit.no_build', message: 'not in the stand-in' } };
    const blueprint = { ...this.blueprint, meta: { ...this.blueprint.meta, name: command.name } };
    this.blueprint = blueprint;
    for (const listener of this.listeners.get('edit') ?? []) (listener as (event: CanvasEventMap['edit']) => void)({ command, blueprint });
    return { ok: true, blueprint };
  }
  beginPlacement(): void {}
  beginPropPlacement(): void {}
  cancelPlacement(): void {}
  setRemoveTargets(): void {}
  select(): void {}
  setMode(mode: CanvasMode): void {
    this.mode = mode;
  }
  applyRunFrame(): void {}
  showHint(): boolean {
    return false;
  }
  clearHints(): void {}
  fit(): void {}
  setZoom(zoom: number): void {
    this.zoom = zoom;
  }
  tidyWires(): void {}
  setSafeArea(): void {}
  setLevel(): void {}
  setPrefs(): void {}
  on<K extends keyof CanvasEventMap>(type: K, listener: (event: CanvasEventMap[K]) => void): () => void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener as (event: never) => void);
    this.listeners.set(type, set);
    return () => set.delete(listener as (event: never) => void);
  }
  destroy(): void {}
}
