// The chrome's themes (task 5.7): which theme and typeface a page's root carries, from the access options. The shell
// sets them from its canvas prefs; the release pages set them here. See theme.css and the README, "Accessibility".
import type { AccessPrefs } from '../a11y/prefs.ts';
import './theme.css';

export type Contrast = 'standard' | 'high';
export type Typeface = 'standard' | 'dyslexia-friendly';

export interface ThemeAttributes {
  readonly 'data-contrast': Contrast;
  readonly 'data-typeface': Typeface;
}

export const themeAttributes = ({ highContrast, typeface }: { readonly highContrast: boolean; readonly typeface: Typeface }): ThemeAttributes => ({
  'data-contrast': highContrast ? 'high' : 'standard',
  'data-typeface': typeface,
});

export const accessTheme = (access: AccessPrefs): ThemeAttributes =>
  themeAttributes({ highContrast: access.highContrast, typeface: access.dyslexiaType ? 'dyslexia-friendly' : 'standard' });
