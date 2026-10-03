// Speak-it (brief Sections 10 and 12): reads exactly the words on the card through the browser's speechSynthesis,
// one utterance per line, in the order they show. Where the browser has no speechSynthesis the card has no button.

/** What speak-it needs of the browser: `window.speechSynthesis` and the utterance constructor. */
export interface SpeechPort {
  readonly synth: Pick<SpeechSynthesis, 'speak' | 'cancel'>;
  readonly Utterance: new (text: string) => SpeechSynthesisUtterance;
}

/** The page's speech, or null when the browser has none. */
export const pageSpeech = (): SpeechPort | null => {
  const scope = globalThis as { speechSynthesis?: SpeechSynthesis; SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance };
  const synth = scope.speechSynthesis;
  const Utterance = scope.SpeechSynthesisUtterance;
  return synth && Utterance ? { synth, Utterance } : null;
};

/** Natural and unhurried (brief Section 12): a little under the voice's default rate. */
export const SPEAK_RATE = 0.9;

/** The text of each element marked `data-speak` inside `root`, in document order, with its spaces as shown. */
export const spokenLines = (root: ParentNode): readonly string[] =>
  [...root.querySelectorAll('[data-speak]')]
    .map((element) => (element.textContent ?? '').replace(/\s+/g, ' ').trim())
    .filter((line) => line !== '');

/** Stops whatever is being read, then reads `lines`. */
export const speak = (speech: SpeechPort, lines: readonly string[], lang: string): void => {
  speech.synth.cancel();
  for (const line of lines) {
    const utterance = new speech.Utterance(line);
    utterance.rate = SPEAK_RATE;
    if (lang) utterance.lang = lang;
    speech.synth.speak(utterance);
  }
};
