// Saving (task 4.9), in the header's Save slot. Nothing is lost (brief Section 8, principle 5): the child's build saves
// itself about a second after the last edit (`AUTOSAVE_MS`, from the canvas's `edit` event) and at once when Run is
// pressed. Save stores it at once too. What happened to the last save shows as one plain line beside the button, the
// same for both, never a dialog (ground rule 9), and the line goes once the build changes again. A stored build that
// does not load is never overwritten: the store refuses, and the line says "Not saved".
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Blueprint } from '@servo/schema';
import type { ProfileStore } from '../store/index.ts';
import { useShell } from './context.ts';

/** The status line after a save. */
export const SAVE_LINES = { saved: 'Saved', notSaved: 'Not saved' } as const;

/** How long after the last edit the build saves itself, in milliseconds. */
export const AUTOSAVE_MS = 1000;

/** An edited build waiting to be saved, and the child it belongs to. */
interface Waiting {
  readonly build: Blueprint;
  readonly child: ProfileStore;
}

export const SaveControl = () => {
  const { blueprint, child, canvas, mode } = useShell();
  const [outcome, setOutcome] = useState<{ readonly build: Blueprint; readonly line: string } | null>(null);
  const waiting = useRef<Waiting | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const store = useCallback((build: Blueprint, into: ProfileStore): void => {
    into.blueprints.save(build).then(
      () => setOutcome({ build, line: SAVE_LINES.saved }),
      (error: unknown) => {
        console.warn('Save failed.', error);
        setOutcome({ build, line: SAVE_LINES.notSaved });
      },
    );
  }, []);

  /** Saves the waiting build now, if there is one. */
  const flush = useCallback((): void => {
    clearTimeout(timer.current);
    timer.current = undefined;
    const next = waiting.current;
    waiting.current = null;
    if (next) store(next.build, next.child);
  }, [store]);

  // Each edit waits for a quiet second. An edit to another build first saves the one waiting, and so does leaving.
  useEffect(() => {
    if (!canvas || !child) return undefined;
    const off = canvas.on('edit', ({ blueprint: build }) => {
      if (waiting.current && waiting.current.build.meta.id !== build.meta.id) flush();
      waiting.current = { build, child };
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, AUTOSAVE_MS);
    });
    return () => {
      off();
      flush();
    };
  }, [canvas, child, flush]);

  // Run saves what is waiting at once, so the build that runs is the one kept.
  useEffect(() => {
    if (mode === 'run') flush();
  }, [mode, flush]);

  const save = (): void => {
    if (!blueprint || !child) return;
    if (waiting.current && waiting.current.build.meta.id !== blueprint.meta.id) flush();
    clearTimeout(timer.current);
    timer.current = undefined;
    waiting.current = null;
    store(blueprint, child);
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
