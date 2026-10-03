// What the sound layer plays, as plain data (brief Section 11: sound is feedback about the machine). Machine sounds
// come one for one from a Run's `sound` events, so a recorded Run gives back the same cues; the rest come from the
// run loop (the whir as a Run spins up, the tick of each step in slow motion) and the canvas (the click of a wire that
// lands). Nothing here is music, praise or a fanfare (ground rule 7). Pure: no audio, no DOM.
import type { EditCommand } from '@servo/canvas';
import type { EventSubject, RunEvent, RunSound } from '@servo/schema';

/**
 * - `machine`: one `sound` event of the Run, as it is: a part's motor, hum, buzz, squeal or knock starting, changing
 *   or stopping (level 0). Its visual twin is the canvas's (task 3.5).
 * - `whir`: the rising whir as Run starts its one-second spin-up. Its twin is the spin-up itself: the wires light and
 *   the Run button turns to Stop.
 * - `tick`: the soft tick of one clock step in slow motion. Its twin is the Run bar's beat (task 4.4).
 * - `click`: a wire landed in a socket. Its twin is the wire's elastic settle into the socket (task 3.3).
 * - `hush`: the Run ended (Stop, or a Run that failed): every machine sound stops at once.
 */
export type SoundCue =
  | {
      readonly kind: 'machine';
      readonly tick: number;
      readonly partId: EventSubject;
      readonly sound: RunSound;
      /** 0–1; 0 means it stopped. */
      readonly level: number;
      readonly hz?: number;
    }
  | { readonly kind: 'whir' }
  | { readonly kind: 'tick'; readonly tick: number }
  | { readonly kind: 'click' }
  | { readonly kind: 'hush' };

export type MachineCue = Extract<SoundCue, { readonly kind: 'machine' }>;

/** The machine cues of some Run events: exactly one for each `sound` event, in the events' order, and none for any other. */
export const machineCuesOf = (events: readonly RunEvent[]): MachineCue[] => {
  const cues: MachineCue[] = [];
  for (const event of events) {
    if (event.kind !== 'sound') continue;
    const { sound, level, hz } = event.payload;
    cues.push({ kind: 'machine', tick: event.tick, partId: event.partId, sound, level, ...(hz === undefined ? {} : { hz }) });
  }
  return cues;
};

/** True for an edit that lands a wire: a `connect`, or a batch with one in it (the hint ladder's do-it). One click either way. */
export const landsAWire = (command: EditCommand): boolean =>
  command.kind === 'connect' || (command.kind === 'batch' && command.commands.some((single) => single.kind === 'connect'));
