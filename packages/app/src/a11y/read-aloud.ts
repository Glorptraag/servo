// Read-aloud on all system text (brief Sections 12 and 13), behind one option. It reuses the spec card's speak-it
// (src/spec-card/speech.ts): the same speechSynthesis port, the same unhurried rate, and only the words on screen.
// While it is on, inside the element it follows:
// - a tap or click on any words reads them: a control's name, or the line, heading or list item tapped;
// - keyboard focus on a control reads its name;
// - a status line (`role="status"` or `aria-live`) that changes reads its new words, queued after anything being read.
// The canvas is left out: its list view speaks through the screen reader (packages/canvas, task 3.6).
import { SPEAK_RATE, speak } from '../spec-card/speech.ts';
import type { SpeechPort } from '../spec-card/speech.ts';

/** What a tap reads: the nearest of these round the words tapped. */
const SPEAKABLE = [
  '[data-speak]',
  'button',
  'a[href]',
  'label',
  'legend',
  'summary',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'li',
  'dt',
  'dd',
  'output',
  'figcaption',
  '[role="status"]',
].join(',');

/** Status lines: what reads when its words change. */
const LIVE = '[role="status"], [aria-live="polite"], [aria-live="assertive"]';

/** Where read-aloud never reads: the canvas, which has its own path. */
const SKIP = '.shell-canvas-host';

/** A tap and the focus it brings read the same words once. */
const REPEAT_MS = 600;

const tidy = (text: string | null | undefined): string => (text ?? '').replace(/\s+/g, ' ').trim();

/** The words a screen reader would give `element` as its name, near enough for read-aloud. */
export const wordsOf = (element: Element): string => {
  const label = tidy(element.getAttribute('aria-label'));
  if (label) return label;
  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy) {
    const words = tidy(
      labelledBy
        .split(/\s+/)
        .map((id) => element.ownerDocument.getElementById(id)?.textContent ?? '')
        .join(' '),
    );
    if (words) return words;
  }
  if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) {
    const labelled = tidy([...(element.labels ?? [])].map(shownText).join(' '));
    if (labelled) return labelled;
  }
  return shownText(element);
};

/** The words shown in `node`, a space between elements, leaving out what is hidden from screen readers. */
const shownText = (node: Node): string => {
  const pieces: string[] = [];
  const walk = (at: Node): void => {
    if (at.nodeType === Node.TEXT_NODE) {
      pieces.push(at.textContent ?? '');
      return;
    }
    if (!(at instanceof Element) || at.getAttribute('aria-hidden') === 'true' || at.hasAttribute('hidden')) return;
    for (const child of at.childNodes) walk(child);
  };
  walk(node);
  return tidy(pieces.join(' '));
};

/** What a switch is set to, said after its name. */
const STATE_WORDS = { on: 'on', off: 'off' } as const;

/** A switch's name and state: a checkbox's ticked state, or `aria-checked`. Its name alone for anything else. */
export const spokenName = (element: Element): string => {
  const name = wordsOf(element);
  if (element.getAttribute('role') !== 'switch' || !name) return name;
  const on = element instanceof HTMLInputElement ? element.checked : element.getAttribute('aria-checked') === 'true';
  return `${name}, ${on ? STATE_WORDS.on : STATE_WORDS.off}`;
};

/** The words a tap on `target` reads, or '' for none: in the canvas, or nothing speakable round it. */
export const tappedWords = (target: EventTarget | null, scope: Element): string => {
  if (!(target instanceof Element) || !scope.contains(target) || target.closest(SKIP)) return '';
  // A tick box or radio button is read from its own click, which comes after its label's and after it has changed.
  if (target instanceof HTMLInputElement) return spokenName(target);
  const found = target.closest(SPEAKABLE);
  if (found instanceof HTMLLabelElement && found.control instanceof HTMLInputElement && (found.control.type === 'checkbox' || found.control.type === 'radio')) return '';
  if (found && scope.contains(found)) return spokenName(found);
  return '';
};

/** Reads `text` after whatever is being read, at speak-it's rate. */
const queue = (speech: SpeechPort, text: string, lang: string): void => {
  const utterance = new speech.Utterance(text);
  utterance.rate = SPEAK_RATE;
  if (lang) utterance.lang = lang;
  speech.synth.speak(utterance);
};

export interface ReadAloudOptions {
  readonly speech: SpeechPort;
  /** True while the option is on; asked at each event, so turning it off stops it at once. */
  readonly isOn: () => boolean;
  /** The words' language: the page's `lang`. */
  readonly lang?: () => string;
  /** The time, for telling a repeat apart. */
  readonly now?: () => number;
}

/** Reads aloud within `scope` while `isOn()`. Returns the function that stops it. */
export const followReadAloud = (scope: HTMLElement, { speech, isOn, lang = () => scope.ownerDocument.documentElement.lang, now = () => Date.now() }: ReadAloudOptions): (() => void) => {
  let last = { text: '', at: -Infinity };
  const say = (text: string): void => {
    if (!text || !isOn()) return;
    const at = now();
    if (text === last.text && at - last.at < REPEAT_MS) return;
    last = { text, at };
    speak(speech, [text], lang());
  };

  // A native listener on the scope runs before React's, which sit on the root above it: the spec card's own speak-it
  // button then cancels this and reads the whole card, as it always has.
  const onClick = (event: MouseEvent): void => say(tappedWords(event.target, scope));
  const onFocus = (event: FocusEvent): void => {
    const target = event.target;
    if (!(target instanceof Element) || target.closest(SKIP) || !target.matches(':focus-visible')) return;
    say(spokenName(target));
  };
  scope.addEventListener('click', onClick);
  scope.addEventListener('focusin', onFocus);

  const heard = new WeakMap<Element, string>();
  const observer = new MutationObserver((mutations) => {
    if (!isOn()) return;
    const changed = new Set<Element>();
    for (const mutation of mutations) {
      const node = mutation.target;
      const element = node instanceof Element ? node : node.parentElement;
      const live = element?.closest(LIVE);
      if (live && scope.contains(live) && !live.closest(SKIP)) changed.add(live);
    }
    for (const live of changed) {
      const text = shownText(live);
      if (heard.get(live) === text) continue;
      heard.set(live, text);
      if (text) queue(speech, text, lang());
    }
  });
  observer.observe(scope, { subtree: true, childList: true, characterData: true });

  return () => {
    scope.removeEventListener('click', onClick);
    scope.removeEventListener('focusin', onFocus);
    observer.disconnect();
  };
};
