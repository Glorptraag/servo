// What the shell shares with the parts later tasks put in its slots: the content, the canvas, the mode, the build,
// the tuck states and the prefs. Slot components read it with useShell(). See docs/shell.md.
import { createContext, useContext } from 'react';
import type { CanvasHandle, CanvasMode, CanvasPrefs } from '@servo/canvas';
import type { Content } from '@servo/content';
import type { Blueprint, Kit, Level, ValidationResult } from '@servo/schema';
import type { Edge, Tucked } from './edges.ts';
import type { ShellLayout } from './layout.ts';

export interface ShellApi {
  /** Every content record that validates: parts, arenas, kits, challenges, art. */
  readonly content: Content;
  /** The child's level. */
  readonly level: Level;
  /** The kit in the tray, when there is one. */
  readonly kit: Kit | undefined;
  /** The canvas, once it is mounted just after the shell's first render; null before. */
  readonly canvas: CanvasHandle | null;
  readonly mode: CanvasMode;
  /**
   * Switches the canvas and the layout together: in Run mode the tray slides out, and Stop brings it back as the
   * child left it (brief Section 9). The run loop (task 4.4) calls this, not `canvas.setMode`.
   */
  setMode(mode: CanvasMode): void;
  /** The build on the canvas, as `load` and every `edit` leave it. Undefined until the first load. */
  readonly blueprint: Blueprint | undefined;
  /** Loads a build onto the canvas (`canvas.load`) so the header follows it. Throws before the canvas is mounted. */
  load(blueprint: Blueprint): ValidationResult<Blueprint>;
  /** Which edges the child has tucked away. They persist on this device. */
  readonly tucked: Tucked;
  setTucked(edge: Edge, tucked: boolean): void;
  /**
   * True while the spec card steps aside so that it never covers a port the child is wiring. The shell steps it aside
   * while a finger or pointer drags on the canvas, wire drags included; `setSpecCardAside(true)` keeps it aside as
   * well, for wiring by tap-then-tap once the canvas reports it (tasks 3.3 and 4.3), until `setSpecCardAside(false)`.
   */
  readonly specCardAside: boolean;
  setSpecCardAside(aside: boolean): void;
  /** Where every region is now. */
  readonly layout: ShellLayout;
  /** The canvas's prefs, which the shell keeps; `leftHanded` also mirrors the tray and the spec card. */
  readonly prefs: CanvasPrefs;
  setPrefs(prefs: CanvasPrefs): void;
}

export const ShellContext = createContext<ShellApi | null>(null);

/** The shell, for a component in one of its slots. */
export const useShell = (): ShellApi => {
  const shell = useContext(ShellContext);
  if (!shell) throw new Error('useShell is only for components inside the shell.');
  return shell;
};
