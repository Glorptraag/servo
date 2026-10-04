// Every word the access options show or say: real words, plain and short, no praise, no exclamation marks (ground
// rule 7). Each option has a name and one line saying what it does.
import type { AccessOption } from './prefs.ts';

export const ACCESS_TEXT = {
  heading: 'Display and reading',
  options: {
    highContrast: { name: 'High contrast', line: 'Stronger colours and darker edges.' },
    dyslexiaType: { name: 'Dyslexia-friendly type', line: 'A clearer typeface with more space between letters and lines.' },
    leftHanded: { name: 'Left-handed layout', line: 'The part tray and the spec card swap sides.' },
    readAloud: { name: 'Read aloud', line: 'Tap any words to hear them, even with Sound off.' },
  } satisfies Record<AccessOption, { readonly name: string; readonly line: string }>,
} as const;
