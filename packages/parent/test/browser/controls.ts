// The parent view's controls, each kind once, and the three-path tests they register (ground rule 8, review R-6.4
// PAR-2), modelled on the app's (packages/app/test/browser/controls.ts, task 7.4). controls.test.tsx walks every screen
// of the view (the gate, the accounts with their builds, the rename form, the removal confirm, an open parts list, the
// link field, a card with its name hidden and shown, the closing line and a refused save) and fails for an interactive
// element no entry here claims, and for an entry with no `threePaths` test. Every test also checks that focus never
// rests on the page's body after the press (R-6.4 PAR-11). The parent page's Back to Servo link is the app's
// (packages/app/parent.html), tested there.
import { describe, expect, it } from 'vitest';
import { nameOf } from './harness.tsx';
import { PATHS, pressBy } from './input.ts';
import type { Path } from './input.ts';

const is =
  (selector: string, name?: string | RegExp) =>
  (element: Element): boolean =>
    element.matches(selector) && (name === undefined || (typeof name === 'string' ? nameOf(element) === name : name.test(nameOf(element))));

const CARD = 'section.servo-card-game';

/** Every kind of control, with how to tell one in the view. */
export const CONTROLS = {
  // The parental gate.
  'gate-answer': is('main[aria-labelledby="servo-parent-gate"] input'),
  'gate-continue': is('main[aria-labelledby="servo-parent-gate"] button[type="submit"]'),
  // The children.
  'child-switch': is('fieldset input[type="radio"][name="servo-parent-in-use"]'),
  rename: is('fieldset button', /^Rename /u),
  'rename-field': is('fieldset input[id^="servo-parent-name-"]'),
  'save-name': is('fieldset form button[type="submit"]', 'Save name'),
  'cancel-rename': is('fieldset form button[type="button"]', 'Cancel'),
  remove: is('fieldset button', /^Remove (?!profile$)/u),
  'remove-confirm': is('fieldset [role="group"] button', 'Remove profile'),
  keep: is('fieldset [role="group"] button', 'Keep profile'),
  'add-field': is('input#servo-parent-add'),
  add: is('form button[type="submit"]', 'Add'),
  // The builds: the name in links, each build's parts list and link.
  'include-name': is('section[aria-labelledby="servo-parent-builds"] input[type="checkbox"]'),
  'parts-list': is('button[aria-label^="Parts list for "]'),
  print: is('section.servo-parts-list button', 'Print'),
  'close-list': is('section.servo-parts-list button', 'Close'),
  'copy-link': is('button[aria-label^="Copy link: "]'),
  'link-field': is('section[aria-labelledby="servo-parent-builds"] input[readonly]'),
  // The card game.
  start: is(`${CARD} button`, 'Start a round'),
  'show-name': is(`${CARD} button[aria-expanded="false"]`, 'Show the name'),
  'hide-name': is(`${CARD} button[aria-expanded="true"]`, 'Hide the name'),
  named: is(`${CARD} button`, 'Named'),
  'not-named': is(`${CARD} button`, 'Not named'),
  stop: is(`${CARD} button`, 'Stop the round'),
  again: is(`${CARD} button`, 'Play another round'),
  leave: is(`${CARD} button`, 'Back to the parent view'),
  'save-again': is(`${CARD} button`, 'Try keeping it again'),
} satisfies Readonly<Record<string, (element: Element) => boolean>>;

export type ControlId = keyof typeof CONTROLS;

export const CONTROL_IDS = Object.keys(CONTROLS) as ControlId[];

/** What the walk counts as a control: everything a finger, a mouse or Tab can reach, disabled or not. */
export const INTERACTIVE = [
  'button',
  'a[href]',
  'input',
  'select',
  'textarea',
  'summary',
  '[contenteditable=""]',
  '[contenteditable="true"]',
  '[role="button"]',
  '[role="link"]',
  '[role="switch"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/** Which entries claim `element`: one, for a known control. */
export const controlsOf = (element: Element): ControlId[] => CONTROL_IDS.filter((id) => CONTROLS[id](element));

export interface PathTest<C> {
  /** A fresh view with the control showing. */
  readonly open: () => Promise<C>;
  /** The control. */
  readonly control: (context: C) => HTMLElement;
  /** How the path presses it, when it is not one press (keyboard: Enter on it focused). */
  readonly press?: (path: Path, control: HTMLElement, context: C) => Promise<void>;
  /** What the press did, the same whichever path made it. */
  readonly then: (context: C, path: Path) => Promise<void>;
  readonly timeout?: number;
}

/**
 * Watches where focus is on every frame from the press until its result is checked: true if it ever rested on the
 * page's body, where a keyboard or screen-reader user would lose their place.
 */
const watchFocus = (): (() => boolean) => {
  let fell = false;
  let frame = 0;
  const look = () => {
    if (document.activeElement === null || document.activeElement === document.body) fell = true;
    frame = requestAnimationFrame(look);
  };
  frame = requestAnimationFrame(look);
  return () => {
    cancelAnimationFrame(frame);
    look();
    cancelAnimationFrame(frame);
    return fell;
  };
};

/**
 * The three tests of one control: the same press by touch (CDP touch), by pointer (CDP mouse) and by keyboard (Tab to
 * it, then Enter or the keys `press` sends), each on a fresh view, each checking the same result, and each checking
 * focus stayed off the body. controls.test.tsx finds each call by its id in the test sources, so write the id as a
 * string literal.
 */
export const threePaths = <C,>(id: ControlId, test: PathTest<C>): void => {
  describe(`${id}: touch, pointer and keyboard`, () => {
    for (const path of PATHS) {
      it(`by ${path}`, async () => {
        const context = await test.open();
        const control = test.control(context);
        await (test.press ? test.press(path, control, context) : pressBy(path, control));
        const stop = watchFocus();
        await test.then(context, path);
        expect(stop(), 'focus rested on the page’s body after the press').toBe(false);
      }, test.timeout ?? 120_000);
    }
  });
};
