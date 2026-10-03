// The data note (task 6.2): one screen at the foot of the parent view, behind the gate, saying what Servo keeps, where,
// for how long and how to delete it. Its words are docs/data-note.md, which the store hands over (`DATA_NOTE`), drawn
// as plain headings, paragraphs and lists, so a screen reader reads it in order. It has no controls.
import type { ReactNode } from 'react';
import { noteBlocks } from '@servo/app/store';
import type { NoteSpan } from '@servo/app/store';

const spans = (parts: readonly NoteSpan[]): ReactNode[] =>
  parts.map((part, index) => (part.code ? <code key={index}>{part.text}</code> : part.text));

export const DataNote = () => {
  const blocks = noteBlocks();
  return (
    <section aria-labelledby="servo-parent-data-note">
      {blocks.map((block, index) => {
        if (block.kind === 'heading') {
          // The note's own title is a section of the parent view, so its headings sit one level below the view's.
          return block.level === 1 ? (
            <h2 key={index} id="servo-parent-data-note">
              {spans(block.spans)}
            </h2>
          ) : (
            <h3 key={index}>{spans(block.spans)}</h3>
          );
        }
        if (block.kind === 'paragraph') return <p key={index}>{spans(block.spans)}</p>;
        return (
          <ul key={index}>
            {block.items.map((item, at) => (
              <li key={at}>{spans(item)}</li>
            ))}
          </ul>
        );
      })}
    </section>
  );
};
