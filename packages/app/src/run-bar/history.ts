// The Run bar's Undo (task 4.4, docs/run-loop.md "Build mode" step 4): the builds the canvas's `edit` events carry,
// newest last. Undo loads the one before with the shell's `load`, which fires no edit; Save hears the new form of the
// build as it hears an edit (src/shell/save.tsx). Framework-free and pure: it only keeps blueprints.
import type { Blueprint } from '@servo/schema';

/** How many steps back Undo reaches. Older steps are dropped. */
export const UNDO_STEPS = 100;

export class UndoHistory {
  private readonly limit: number;
  private readonly past: Blueprint[] = [];
  private now: Blueprint | undefined;

  constructor(limit = UNDO_STEPS) {
    this.limit = limit;
  }

  /** The build as the history last saw it on the canvas. */
  get current(): Blueprint | undefined {
    return this.now;
  }

  /** How many Undo steps there are. */
  get size(): number {
    return this.past.length;
  }

  /** An edit changed the build to `next`: the build before it becomes one Undo step. */
  edited(next: Blueprint): void {
    if (this.now) this.past.push(this.now);
    if (this.past.length > this.limit) this.past.splice(0, this.past.length - this.limit);
    this.now = next;
  }

  /**
   * A build was loaded onto the canvas by something other than an edit or Undo. Another build (another `meta.id`)
   * starts the history again; another form of the same build is one Undo step, as an edit is.
   */
  loaded(build: Blueprint): void {
    if (this.now && this.now.meta.id === build.meta.id) {
      this.edited(build);
      return;
    }
    this.past.length = 0;
    this.now = build;
  }

  /** Takes one step back: the build to load, or undefined when there is none. */
  undo(): Blueprint | undefined {
    const previous = this.past.pop();
    if (previous) this.now = previous;
    return previous;
  }

  /** The build the canvas holds after an Undo's load (its canonical form). */
  settle(build: Blueprint): void {
    this.now = build;
  }
}
