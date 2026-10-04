// The access options (task 5.7) on the parent view (task 7.5, R-6.4 PAR-3, R-5.7 Q2): this device's high contrast,
// dyslexia-friendly type, left-handed layout and read-aloud, the same options the child's app follows, read from the
// app's store module. The view takes the chrome's theme (`release-page`, as Settings does) and read-aloud's scope; the
// left-handed layout mirrors it, each row of controls and each line of text to the right edge, as the app's tray and
// spec card swap sides.
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { AccessStore, ReadAloudScope, accessTheme, pageStorage } from '@servo/app/store';
import type { AccessPrefs, ReadAloudScopeProps, ThemeAttributes } from '@servo/app/store';

/** The class of the view's root, which carries the theme and the hand. */
export const PARENT_ROOT = 'servo-parent';

/** A row of controls: the left-handed layout moves it to the right edge. */
export const ROW_CLASS = 'servo-parent-row';

/**
 * What the theme's tokens do not reach: the view's native buttons and fields take the high-contrast edges and the
 * dyslexia-friendly face, and the left-handed layout mirrors the rows and lines. Order in each row is kept, so Tab
 * and a screen reader read it as before.
 */
export const PARENT_ACCESS_CSS = `
.${PARENT_ROOT}[data-hand='left'] { text-align: right; }
.${PARENT_ROOT}[data-hand='left'] .${ROW_CLASS} { justify-content: flex-end; }
.${PARENT_ROOT}[data-hand='left'] :is(ul, ol) { list-style-position: inside; padding-inline-start: 0; }
.${PARENT_ROOT}[data-contrast='high'] :is(button, input, fieldset) { border: 2px solid var(--shell-line); }
.${PARENT_ROOT}[data-contrast='high'] :is(button, input) { background: var(--shell-panel); color: var(--shell-ink); }
.${PARENT_ROOT}[data-typeface='dyslexia-friendly'] :is(button, input) { font-family: inherit; }
`;

export type Hand = 'left' | 'right';

/** Everything the options set on an element: the theme and the hand. */
export type AccessAttributes = ThemeAttributes & { readonly 'data-hand': Hand };

export const accessAttributes = (prefs: AccessPrefs): AccessAttributes => ({ ...accessTheme(prefs), 'data-hand': prefs.leftHanded ? 'left' : 'right' });

/** Sets the options' attributes on `element`, as the parent page does on its body so the whole page follows them. */
export const applyAccess = (element: HTMLElement, prefs: AccessPrefs): void => {
  for (const [name, value] of Object.entries(accessAttributes(prefs))) element.setAttribute(name, value);
};

/** The device's options, kept in its localStorage and followed across its pages, unless the caller passes some. */
export const useAccess = (given: AccessStore | undefined): { readonly access: AccessStore; readonly prefs: AccessPrefs } => {
  const [own] = useState(() => new AccessStore(given ? null : pageStorage()));
  const access = given ?? own;
  useEffect(() => (given ? undefined : own.follow(window)), [given, own]);
  const prefs = useSyncExternalStore(access.subscribe, () => access.prefs);
  return { access, prefs };
};

export interface ParentAccessProps {
  readonly access?: AccessStore;
  /** Read-aloud's speech. Default the browser's. */
  readonly speech?: ReadAloudScopeProps['speech'];
  readonly children?: ReactNode;
}

/** The view's root: the theme, the hand and read-aloud round everything in it, the gate included. */
export const ParentAccess = ({ access: given, speech, children }: ParentAccessProps) => {
  const { access, prefs } = useAccess(given);
  return (
    <ReadAloudScope store={access} speech={speech}>
      <style href="servo-parent-access" precedence="default">
        {PARENT_ACCESS_CSS}
      </style>
      <div className={`release-page ${PARENT_ROOT}`} {...accessAttributes(prefs)}>
        {children}
      </div>
    </ReadAloudScope>
  );
};
