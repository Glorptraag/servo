// The name-the-part card game (task 5.4, D40), in the parent view behind the parental gate (D28): the adult shows the
// child the picture of each of ten Level 1–2 parts, asks what it is called, and marks it named or not named. The round
// is kept for the child in use through their own scope (`cardGames.add`); the latest round is the one that counts.
// The child is shown pictures only: no score, praise, streak or exclamation mark (ground rule 7). The round ends on a
// neutral line with no count and no verdict per card, since the child is watching; the adult reads the result in the
// progress view (task 5.2) alone. Every control is a native button, so touch, pointer, keyboard and screen reader share one
// path (ground rule 8), and nothing is a dialog (ground rule 9). A round stopped, or left by a child switch or the
// page being hidden, keeps nothing.
import { useEffect, useId, useRef, useState } from 'react';
import type { CSSProperties, RefObject } from 'react';
import type { CardGameResult, CardMark, Content, ServoStore } from '@servo/app/store';
import type { PartRecord, PartTypeId, ProfileId } from '@servo/schema';
import { deckParts, drawCardsFrom } from './deck.ts';
import { CardPicture } from './picture.tsx';

/** Every line of the card game's system text, for the copy pass. None has an exclamation mark or praise. */
export const CARD_GAME_TEXT = {
  title: (name: string): string => `Card game: ${name}`,
  intro:
    'About two minutes, led by you. Show the child each picture and ask what the part is called, then mark whether they named it. Ten cards, from the Level 1–2 parts. The child sees only the pictures, never a result: once the round is over, read it under Progress.',
  start: 'Start a round',
  card: (n: number, of: number): string => `Card ${n} of ${of}`,
  showName: 'Show the name',
  hideName: 'Hide the name',
  named: 'Named',
  notNamed: 'Not named',
  stop: 'Stop the round',
  stopped: 'The round was stopped. Nothing was kept.',
  saving: 'Keeping the round',
  done: 'That is all the cards.',
  again: 'Play another round',
  saveFailed: 'The round could not be kept on this device.',
  saveAgain: 'Try keeping it again',
  noParts: 'This version of Servo has no Level 1–2 parts to show.',
} as const;

const TARGET: CSSProperties = { minHeight: 44, minWidth: 44, fontSize: '1rem' };
const ROW: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBlock: 8 };

const capitalise = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

const recordOf = (content: Content, part: PartTypeId): PartRecord | undefined => content.parts.find((record) => record.id === part);

const nameOf = (content: Content, part: PartTypeId): string => {
  const record = recordOf(content, part);
  return record ? capitalise(record.identity.name) : '';
};

/** A fresh seed for each round. */
const randomSeed = (): number => crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;

type Round =
  | { readonly kind: 'idle'; readonly line: string }
  | { readonly kind: 'playing'; readonly deck: readonly PartTypeId[]; readonly marks: readonly CardMark[]; readonly revealed: boolean }
  | { readonly kind: 'saving'; readonly marks: readonly CardMark[] }
  | { readonly kind: 'failed'; readonly marks: readonly CardMark[] }
  | { readonly kind: 'done' };

export interface CardGameSectionProps {
  readonly store: ServoStore;
  /** The child in use: the only profile a round is kept for. */
  readonly profile: ProfileId;
  /** The adult's name for the child, shown in the heading. */
  readonly name: string;
  /** Called once a round is kept, so the progress view can read it. */
  readonly onKept?: (result: CardGameResult) => void;
  /** Where each round's deck seed comes from. Tests pass a fixed one. */
  readonly seed?: () => number;
}

/** The card game for the child in use. The caller remounts it for another child, which drops a round under way. */
export const CardGameSection = ({ store, profile, name, onKept, seed = randomSeed }: CardGameSectionProps) => {
  const [round, setRound] = useState<Round>({ kind: 'idle', line: '' });
  const ids = useId();
  const live = useRef(true);
  const startRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLHeadingElement>(null);
  const doneRef = useRef<HTMLParagraphElement>(null);
  const retryRef = useRef<HTMLButtonElement>(null);
  const content = store.content;

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  // Focus follows the round: to each card's heading as it is shown, to the closing line when kept, to Try keeping it
  // again when the store refused it, back to Start when stopped.
  const cardIndex = round.kind === 'playing' ? round.marks.length : -1;
  const started = useRef(false);
  useEffect(() => {
    if (round.kind === 'playing') cardRef.current?.focus();
    else if (round.kind === 'done') doneRef.current?.focus();
    else if (round.kind === 'failed') retryRef.current?.focus();
    else if (round.kind === 'idle' && started.current) startRef.current?.focus();
  }, [round.kind, cardIndex]);

  const keep = (marks: readonly CardMark[]): void => {
    setRound({ kind: 'saving', marks });
    store
      .forProfile(profile)
      .cardGames.add(marks)
      .then(
        (result) => {
          if (!live.current) return;
          setRound({ kind: 'done' });
          onKept?.(result);
        },
        () => {
          if (live.current) setRound({ kind: 'failed', marks });
        },
      );
  };

  const start = (): void => {
    started.current = true;
    setRound({ kind: 'playing', deck: drawCardsFrom(content, seed()), marks: [], revealed: false });
  };

  const mark = (named: boolean): void => {
    if (round.kind !== 'playing') return;
    const part = round.deck[round.marks.length];
    if (part === undefined) return;
    const marks = [...round.marks, { part, named }];
    if (marks.length === round.deck.length) keep(marks);
    else setRound({ ...round, marks, revealed: false });
  };

  const canPlay = deckParts(content).length > 0;

  return (
    <section aria-labelledby={`${ids}-title`} className="servo-card-game">
      <h2 id={`${ids}-title`}>{CARD_GAME_TEXT.title(name)}</h2>
      <p>{CARD_GAME_TEXT.intro}</p>

      {round.kind === 'idle' &&
        (canPlay ? (
          <div style={ROW}>
            <button ref={startRef} type="button" onClick={start} style={TARGET}>
              {CARD_GAME_TEXT.start}
            </button>
          </div>
        ) : (
          <p>{CARD_GAME_TEXT.noParts}</p>
        ))}

      {round.kind === 'playing' && (
        <Card
          key={round.marks.length}
          ids={ids}
          content={content}
          part={round.deck[round.marks.length] as PartTypeId}
          n={round.marks.length + 1}
          of={round.deck.length}
          revealed={round.revealed}
          headingRef={cardRef}
          onReveal={() => setRound({ ...round, revealed: !round.revealed })}
          onMark={mark}
          onStop={() => setRound({ kind: 'idle', line: CARD_GAME_TEXT.stopped })}
        />
      )}

      {round.kind === 'failed' && (
        <div style={ROW}>
          <button ref={retryRef} type="button" onClick={() => keep(round.marks)} style={TARGET}>
            {CARD_GAME_TEXT.saveAgain}
          </button>
        </div>
      )}

      {round.kind === 'done' && (
        <>
          <p ref={doneRef} tabIndex={-1}>
            {CARD_GAME_TEXT.done}
          </p>
          <div style={ROW}>
            <button type="button" onClick={start} style={TARGET}>
              {CARD_GAME_TEXT.again}
            </button>
          </div>
        </>
      )}

      <p role="status">
        {round.kind === 'idle'
          ? round.line
          : round.kind === 'saving'
            ? CARD_GAME_TEXT.saving
            : round.kind === 'failed'
              ? CARD_GAME_TEXT.saveFailed
              : ''}
      </p>
    </section>
  );
};

interface CardProps {
  readonly ids: string;
  readonly content: Content;
  readonly part: PartTypeId;
  readonly n: number;
  readonly of: number;
  readonly revealed: boolean;
  readonly headingRef: RefObject<HTMLHeadingElement | null>;
  readonly onReveal: () => void;
  readonly onMark: (named: boolean) => void;
  readonly onStop: () => void;
}

/** One card: its picture, the name hidden until the adult shows it, and the two marks. */
const Card = ({ ids, content, part, n, of, revealed, headingRef, onReveal, onMark, onStop }: CardProps) => {
  const record = recordOf(content, part);
  const nameId = `${ids}-name`;
  return (
    <div role="group" aria-labelledby={`${ids}-card`}>
      <h3 id={`${ids}-card`} ref={headingRef} tabIndex={-1}>
        {CARD_GAME_TEXT.card(n, of)}
      </h3>
      {record && <CardPicture record={record} art={content.art} />}
      <div style={ROW}>
        <button type="button" aria-expanded={revealed} aria-controls={nameId} onClick={onReveal} style={TARGET}>
          {revealed ? CARD_GAME_TEXT.hideName : CARD_GAME_TEXT.showName}
        </button>
        <p id={nameId} hidden={!revealed} style={{ margin: 0 }}>
          {nameOf(content, part)}
        </p>
      </div>
      <div style={ROW}>
        <button type="button" onClick={() => onMark(true)} style={TARGET}>
          {CARD_GAME_TEXT.named}
        </button>
        <button type="button" onClick={() => onMark(false)} style={TARGET}>
          {CARD_GAME_TEXT.notNamed}
        </button>
        <button type="button" onClick={onStop} style={TARGET}>
          {CARD_GAME_TEXT.stop}
        </button>
      </div>
    </div>
  );
};
