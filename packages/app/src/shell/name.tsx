// The blueprint's name in the header (task 4.9). A tap turns it into a text field. Enter, or leaving the field, renames
// the build through the canvas (`rename`), so the new name is an edit like any other, with its own Undo step, and Save
// stores it. Escape keeps the old name, and so does a name that is empty or too long once its spaces are tidied. The
// name is the child's own text: 1 to 60 characters on one line. Renaming is for Build mode.
import { useEffect, useRef, useState } from 'react';
import { useShell } from './context.ts';

/** The child's text as a name: each run of white space becomes one space, and the ends are trimmed. */
export const tidyName = (text: string): string => text.replace(/\s+/gu, ' ').trim();

const fits = (name: string): boolean => {
  const length = [...name].length;
  return length >= 1 && length <= 60;
};

export const BlueprintName = () => {
  const { blueprint, canvas, mode } = useShell();
  const [draft, setDraft] = useState<string | null>(null);
  // Escape leaves the field as Enter does, but keeps the old name.
  const cancelled = useRef(false);
  const editable = canvas !== null && mode === 'build';
  useEffect(() => {
    if (!editable) setDraft(null);
  }, [editable]);
  if (!blueprint) return null;
  const name = blueprint.meta.name;

  // The field is left once, by blur, however the child leaves it, so a name is never applied twice.
  const leave = (): void => {
    const keep = !cancelled.current;
    cancelled.current = false;
    if (draft === null) return;
    setDraft(null);
    const next = tidyName(draft);
    if (!keep || !canvas || next === name || !fits(next)) return;
    try {
      canvas.apply({ kind: 'rename', name: next });
    } catch (error) {
      console.warn('Rename failed.', error);
    }
  };

  if (draft === null) {
    return (
      <button type="button" className="shell-blueprint-name" aria-label={`Rename ${name}`} disabled={!editable} onClick={() => setDraft(name)}>
        {name}
      </button>
    );
  }
  return (
    <input
      className="shell-blueprint-name-input"
      aria-label="Blueprint name"
      value={draft}
      maxLength={60}
      enterKeyHint="done"
      autoFocus
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Escape') cancelled.current = true;
        if (event.key === 'Enter' || event.key === 'Escape') event.currentTarget.blur();
      }}
      onBlur={leave}
    />
  );
};
