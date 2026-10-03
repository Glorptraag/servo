// The parental gate (D28): a short sum an adult answers before the parent view shows anything of any child. It keeps
// the view out of a young child's way; it is not a lock, and it asks for nothing personal.

export interface GateQuestion {
  /** The question as the view shows it. */
  readonly text: string;
  readonly answer: number;
}

/** A number from `low` to `high`, both included, from a random value in [0, 1). */
const between = (random: () => number, low: number, high: number): number =>
  low + Math.min(high - low, Math.floor(random() * (high - low + 1)));

/** A one-digit number times a number in the teens, for example "What is 7 × 14?". */
export const gateQuestion = (random: () => number): GateQuestion => {
  const a = between(random, 6, 9);
  const b = between(random, 12, 19);
  return { text: `What is ${a} × ${b}?`, answer: a * b };
};

/** Whether the adult's text is the answer: digits only, spaces at either end allowed. */
export const answers = (question: GateQuestion, text: string): boolean => {
  const trimmed = text.trim();
  return /^\d{1,4}$/u.test(trimmed) && Number(trimmed) === question.answer;
};
