// What each slot shows until the task that owns it fills it: real words only, and nothing that works yet. Home and
// Save are disabled buttons, the Run bar a disabled Run (brief Section 9: Run is enabled only once a part is
// placed), and the panels show their own names. The goal line, the hint button and the sound control stay empty.
import type { ShellSlots } from './shell.tsx';

export const PLACEHOLDER_SLOTS: ShellSlots = {
  home: (
    <button type="button" className="shell-button" disabled>
      Home
    </button>
  ),
  save: (
    <button type="button" className="shell-button" disabled>
      Save
    </button>
  ),
  tray: <p className="shell-placeholder">Part tray</p>,
  specCard: <p className="shell-placeholder">Spec card</p>,
  arenaStrip: <p className="shell-placeholder">Arena strip</p>,
  runBar: (
    <button type="button" className="shell-button" disabled>
      Run
    </button>
  ),
};
