// The app's controls, each kind once, and the three-path tests they register (ground rule 8, review R-6.4 APP-1 to
// APP-4). controls.test.tsx walks every screen (Home, Build, Run, Settings, the parental gate, the invite form) and
// fails for an interactive element no entry here claims, and for an entry with no `threePaths` test: so a new
// control fails until it has a touch, a pointer and a keyboard test. A kind with many members (the tray's tiles, the
// access switches, the props, Home's builds and challenges) presses every member on each path (R-7.4 F3). The canvas's list view is the canvas package's
// own (its tests in packages/canvas), and the Level 3 slot's controls show only behind a flag (ground rule 10).
import { describe, it } from 'vitest';
import { PATHS, pressBy } from './input.ts';
import type { Path } from './input.ts';

/** Its accessible name as the tests read it: the label, or else the text. */
export const nameOf = (element: Element): string => (element.getAttribute('aria-label') ?? element.textContent ?? '').trim();

const inside = (element: Element, selector: string): boolean => element.closest(selector) !== null;

const is =
  (selector: string, name?: string) =>
  (element: Element): boolean =>
    element.matches(selector) && (name === undefined || nameOf(element) === name);

/** Every kind of control, with how to tell one in the page. */
export const CONTROLS = {
  // The header.
  home: is('[data-region="header"] button.shell-button[aria-expanded]', 'Home'),
  'blueprint-name': is('button.shell-blueprint-name'),
  'blueprint-name-field': is('input.shell-blueprint-name-input'),
  'hint-button': is('button.hint-button'),
  sound: is('button.sound-control'),
  save: is('[data-region="header"] button.shell-button', 'Save'),
  // The edges' tabs and the zoom control.
  'edge-tab': is('button.shell-tab'),
  'zoom-in': is('.shell-zoom button', 'Zoom in'),
  fit: is('.shell-zoom button', 'Fit'),
  'tidy-wires': is('.shell-zoom button', 'Tidy wires'),
  'zoom-out': is('.shell-zoom button', 'Zoom out'),
  // The tray, its places list and the Parts Library.
  'tray-tile': is('button.tray-tile'),
  'places-choice': is('dialog.tray-places button.tray-place'),
  'places-close': is('dialog.tray-places button:not(.tray-place)', 'Close'),
  library: is('button.tray-library'),
  'library-filter': is('dialog.library input[type="radio"]'),
  'library-close': is('dialog.library button', 'Close'),
  // The spec card.
  'read-aloud': is('button.spec-card-speak'),
  'card-choice': is('.spec-card-setting input[type="radio"]'),
  // The arena strip.
  'arena-preset': is('.arena-strip button.arena-strip-button:not(.arena-strip-prop)'),
  'arena-prop': is('.arena-strip button.arena-strip-prop'),
  // The Run bar.
  'run-toggle': is('button.run-bar-toggle'),
  slower: is('button.run-bar-step', 'Slower'),
  faster: is('button.run-bar-step', 'Faster'),
  undo: is('button.run-bar-button', 'Undo'),
  'reset-arena': is('button.run-bar-reset'),
  // Home.
  'home-back': is('.servo-home .home-top button'),
  'home-new-build': (element) => is('.servo-home button.home-choice')(element) && !inside(element, 'ul'),
  'home-saved-build': (element) => is('.servo-home button.home-choice')(element) && inside(element, 'ul') && !inside(element, '.home-level'),
  'home-challenge': (element) => is('.servo-home button.home-choice')(element) && inside(element, '.home-level'),
  'access-switch': is('[data-region="access"] input[role="switch"]'),
  'for-adults': is('a.home-parent-link'),
  // The parent page's gate (packages/parent, served as the app's parent.html).
  'parent-back': is('a.parent-back'),
  'gate-answer': is('main[aria-labelledby="servo-parent-gate"] input'),
  'gate-continue': is('main[aria-labelledby="servo-parent-gate"] button[type="submit"]'),
  // The tester build's invite form.
  'invite-code': is('input.release-input'),
  'invite-submit': is('button.release-button'),
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
  '[role="slider"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/** Owned by the canvas package and tested there: its list view and the canvas itself. */
export const NOT_THE_APPS = '.servo-list-view, [data-region="stage"] canvas';

/** Which entries claim `element`: one, for a known control. */
export const controlsOf = (element: Element): ControlId[] => CONTROL_IDS.filter((id) => CONTROLS[id](element));

export interface PathTest<C> {
  /** A fresh page with the control showing. */
  readonly open: () => Promise<C>;
  /** The control. */
  readonly control: (context: C) => HTMLElement;
  /** How the path presses it, when it is not one press (keyboard: Enter on it focused). */
  readonly press?: (path: Path, control: HTMLElement, context: C) => Promise<void>;
  /** What the press did, the same whichever path made it. */
  readonly then: (context: C, path: Path) => Promise<void>;
  /** Undoes what `open` set up. */
  readonly close?: (context: C) => void | Promise<void>;
  /** For a kind with many members, each pressed in turn: longer than the browser project's two minutes. */
  readonly timeout?: number;
}

/**
 * The three tests of one control: the same press by touch (CDP touch), by pointer (CDP mouse) and by keyboard (Enter
 * or the keys `press` sends), each on a fresh page, each checking the same result. controls.test.tsx finds each
 * call by its id in the test sources, so write the id as a string literal.
 */
export const threePaths = <C,>(id: ControlId, test: PathTest<C>): void => {
  describe(`${id}: touch, pointer and keyboard`, () => {
    for (const path of PATHS) {
      it(`by ${path}`, async () => {
        const context = await test.open();
        try {
          const control = test.control(context);
          await (test.press ? test.press(path, control, context) : pressBy(path, control));
          await test.then(context, path);
        } finally {
          await test.close?.(context);
        }
      }, test.timeout);
    }
  });
};
