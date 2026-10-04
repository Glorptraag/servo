// The parent view's data note (task 6.2): what Servo keeps, where, for how long and how to delete it, in one screen.
// The text is docs/data-note.md, word for word: a package may not import a file outside itself, so it is copied here,
// and test/telemetry/emitters.test.ts fails when the two differ, or when the note and the event registry (events.ts)
// disagree. The note is plain words for the adult, with no code names (R-6.2 F4): the test pairs each kind and field
// with the words that describe it. `noteBlocks` reads the few kinds of Markdown it uses, for the parent view to draw.

/** docs/data-note.md, exactly. */
export const DATA_NOTE = `# What Servo keeps

Servo keeps each child's builds, Runs and card-game results so they can carry on where they left off. Besides those, it notes a few events, to check whether Servo works: whether children pass the unscripted builds, which hints they needed, whether they come back to build on their own, how they fix faults, and whether they build the real kit. Nothing else is noted.

## The events

Servo notes these events, each with only what is listed beside it:

- each time Servo opens for a child: whether they build on their own or take a challenge.
- each Run of a challenge: which challenge, how many times the child has run it, and whether the robot met the goal.
- each hint shown or done: which challenge, and which step of the hint ladder it was.
- each time a parts list or a link to a build is made in this parent view: which of the two was made.

Each event also keeps the time it happened and which child it is about.

## What is never kept

No names, no text the child or you type, no build or its name, no device details. Nothing is used for advertising or sold.

## Where and for how long

The events are kept on this device only, beside the child's builds, and are never sent anywhere. The events stay until the child's profile is removed.

## How to delete it

Remove the child under Children above. Their builds, Runs, card-game results and events are all deleted. Clearing this site's data in the browser deletes everything Servo keeps on this device.
`;

/** A run of text: plain, or a code span (an event or field name). */
export type NoteSpan = { readonly text: string; readonly code?: true };

export type NoteBlock =
  | { readonly kind: 'heading'; readonly level: 1 | 2; readonly spans: readonly NoteSpan[] }
  | { readonly kind: 'paragraph'; readonly spans: readonly NoteSpan[] }
  | { readonly kind: 'list'; readonly items: readonly (readonly NoteSpan[])[] };

const spansOf = (text: string): readonly NoteSpan[] =>
  text
    .split('`')
    .map((part, index): NoteSpan => (index % 2 === 1 ? { text: part, code: true } : { text: part }))
    .filter((span) => span.text !== '');

/** The note's blocks: `#` and `##` headings, `- ` list items, and paragraphs of the lines between blank lines. */
export const noteBlocks = (note: string = DATA_NOTE): readonly NoteBlock[] => {
  const blocks: NoteBlock[] = [];
  let paragraph: string[] = [];
  let items: (readonly NoteSpan[])[] = [];
  const close = (): void => {
    if (paragraph.length > 0) blocks.push({ kind: 'paragraph', spans: spansOf(paragraph.join(' ')) });
    if (items.length > 0) blocks.push({ kind: 'list', items });
    paragraph = [];
    items = [];
  };
  for (const line of note.split('\n').map((text) => text.trim())) {
    const heading = /^(#{1,2}) (.*)$/.exec(line);
    if (line === '') close();
    else if (heading) {
      close();
      blocks.push({ kind: 'heading', level: heading[1] === '#' ? 1 : 2, spans: spansOf(heading[2] ?? '') });
    } else if (line.startsWith('- ')) {
      if (paragraph.length > 0) close();
      items.push(spansOf(line.slice(2)));
    } else {
      if (items.length > 0) close();
      paragraph.push(line);
    }
  }
  close();
  return blocks;
};
