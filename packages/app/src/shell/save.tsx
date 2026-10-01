// Save, in the header (task 4.9): stores the build on the canvas in the child's profile (`useShell().child`). What
// happened shows as one plain line beside the button, never a dialog (ground rule 9), and the line goes once the build
// changes again. Save is there to press whenever there is a build on the canvas and a profile to keep it in.
import { useState } from 'react';
import type { Blueprint } from '@servo/schema';
import { useShell } from './context.ts';

/** The status line after a save. */
export const SAVE_LINES = { saved: 'Saved', notSaved: 'Not saved' } as const;

export const SaveControl = () => {
  const { blueprint, child } = useShell();
  const [outcome, setOutcome] = useState<{ readonly build: Blueprint; readonly line: string } | null>(null);
  const save = (): void => {
    if (!blueprint || !child) return;
    const build = blueprint;
    child.blueprints.save(build).then(
      () => setOutcome({ build, line: SAVE_LINES.saved }),
      (error: unknown) => {
        console.warn('Save failed.', error);
        setOutcome({ build, line: SAVE_LINES.notSaved });
      },
    );
  };
  return (
    <>
      <button type="button" className="shell-button" disabled={!blueprint || !child} onClick={save}>
        Save
      </button>
      <span className="shell-save-status" role="status">
        {outcome !== null && outcome.build === blueprint ? outcome.line : null}
      </span>
    </>
  );
};
