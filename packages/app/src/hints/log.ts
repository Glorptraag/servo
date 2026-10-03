// The hint steps used since the last Run that was kept (task 4.6), for the run record's `hints` (schema RunRecord,
// "A hint step used since the previous Run"), which feeds the parent view's progress (task 5.2). The ladder adds each
// step as it is shown or done; the Run bar's recorder takes them as Run is pressed and lets them go once that Run's
// record is made, so a Run stopped in its spin-up, which is not kept, leaves them for the next one.
import type { Blueprint, HintUse } from '@servo/schema';

/** What the Run bar's recorder reads (run-bar/record.ts). */
export interface HintUses {
  /** The uses waiting, in order. A part the build that runs no longer has is left out of its use (the record names only its own parts). */
  pending(blueprint: Blueprint): readonly HintUse[];
  /** The first `count` uses are in a run record now. */
  recorded(count: number): void;
}

export class HintLog implements HintUses {
  private readonly uses: HintUse[] = [];

  add(use: HintUse): void {
    this.uses.push(use);
  }

  pending(blueprint: Blueprint): readonly HintUse[] {
    const ids = new Set(blueprint.parts.map((part) => part.id));
    return this.uses.map((use) => {
      return use.partId === undefined || ids.has(use.partId) ? use : { at: use.at, step: use.step, trigger: use.trigger };
    });
  }

  recorded(count: number): void {
    this.uses.splice(0, Math.max(0, count));
  }

  /** Another challenge, or the sandbox, came onto the canvas: what was used before is not about its Runs. */
  clear(): void {
    this.uses.length = 0;
  }
}
