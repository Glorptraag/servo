// The access options (task 5.7): high contrast, dyslexia-friendly type, the left-handed mirror and read-aloud. See the
// README, "Accessibility".
export { ACCESS_KEY, ACCESS_OPTIONS, AccessStore, DEFAULT_ACCESS, canvasPrefsFor, readAccess, writeAccess } from './prefs.ts';
export type { AccessOption, AccessPrefs } from './prefs.ts';
export { followReadAloud, spokenName, tappedWords, wordsOf } from './read-aloud.ts';
export type { ReadAloudOptions } from './read-aloud.ts';
export { ReadAloudScope } from './scope.tsx';
export type { ReadAloudScopeProps } from './scope.tsx';
export { AccessSettings } from './settings.tsx';
export type { AccessSettingsProps } from './settings.tsx';
export { ACCESS_TEXT } from './text.ts';
