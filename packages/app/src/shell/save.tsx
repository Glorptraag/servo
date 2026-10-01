// Saving (task 4.9), in the header's Save slot. Nothing is lost (brief Section 8, principle 5): the build saves itself a
// quiet second after the last edit (autosave.ts), and at once when Run is pressed, when the page is hidden or left (noted
// in the journal first, autosave.ts), and when the slot goes away. An Undo, which loads the build's earlier form onto the canvas, saves like an edit. Save
// stores the build at once. One plain line beside the button, never a dialog (ground rule 9), says what the child
// needs to know: a failed save (until a save succeeds), the outcome of pressing Save, another version being kept as a
// copy (another tab's, or one a page left unsaved that the build has moved on from), or that this device is not keeping
// builds at all. A save that went as expected says nothing.
import { useEffect, useRef, useState } from 'react';
import type { Blueprint } from '@servo/schema';
import { Autosaver } from './autosave.ts';
import { useShell } from './context.ts';

/** The status lines. */
export const SAVE_LINES = {
  saved: 'Saved',
  notSaved: 'Not saved',
  keptCopy: 'A copy of the other version was kept',
  notKept: 'Builds are not being kept on this device',
} as const;

interface Line {
  readonly text: string;
  /** Shown only while this build is on the canvas; without it the line stays until another replaces it. */
  readonly for?: Blueprint;
}

export interface SaveControlProps {
  /** The app's autosave, which it waits on before closing the store. Without it the control makes its own. */
  readonly saving?: Autosaver;
}

export const SaveControl = ({ saving: given }: SaveControlProps) => {
  const { blueprint, child, canvas, mode } = useShell();
  const [own] = useState(() => new Autosaver());
  const saving = given ?? own;
  const [line, setLine] = useState<Line | null>(null);
  // Builds the canvas's edit events delivered, so a change of build that came from anything else can be told apart.
  const fromEdits = useRef(new WeakSet<Blueprint>()).current;
  const seen = useRef<Blueprint | undefined>(undefined);

  useEffect(
    () =>
      saving.subscribe((outcome) => {
        if (outcome.kind === 'failed') setLine({ text: SAVE_LINES.notSaved });
        else if (outcome.keptCopy) setLine({ text: SAVE_LINES.keptCopy });
        else if (outcome.pressed) setLine({ text: SAVE_LINES.saved, for: outcome.build });
        else setLine((current) => (current?.text === SAVE_LINES.notSaved ? null : current));
      }),
    [saving],
  );

  // Each edit waits for a quiet second; leaving saves what waits.
  useEffect(() => {
    if (!canvas || !child) return undefined;
    const off = canvas.on('edit', ({ blueprint: build }) => {
      fromEdits.add(build);
      saving.edited(build, child);
    });
    return () => {
      off();
      saving.leaving();
    };
  }, [canvas, child, saving, fromEdits]);

  // Undo loads the build's earlier form with `load`, which fires no edit: a new form of the same build saves like one.
  useEffect(() => {
    const before = seen.current;
    seen.current = blueprint;
    if (!blueprint || !before || !child || blueprint === before || fromEdits.has(blueprint)) return;
    if (blueprint.meta.id === before.meta.id) saving.edited(blueprint, child);
  }, [blueprint, child, saving, fromEdits]);

  // Run saves what waits at once, so the build that runs is the one kept.
  useEffect(() => {
    if (mode === 'run') saving.flush();
  }, [mode, saving]);

  // A hidden page may be discarded (iPadOS does), and a page being left or reloaded is gone before a save it starts can
  // finish: note what waits in the journal, then save it.
  useEffect(() => {
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') saving.leaving();
    };
    const onPageHide = (): void => saving.leaving();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [saving]);

  useEffect(() => () => own.dispose(), [own]);

  const save = (): void => {
    if (blueprint && child) saving.saveNow(blueprint, child);
  };
  const shown = !child && blueprint ? SAVE_LINES.notKept : line && (line.for === undefined || line.for === blueprint) ? line.text : null;
  return (
    <>
      <button type="button" className="shell-button" disabled={!blueprint || !child} onClick={save}>
        Save
      </button>
      <span className="shell-save-status" role="status">
        {shown}
      </span>
    </>
  );
};
