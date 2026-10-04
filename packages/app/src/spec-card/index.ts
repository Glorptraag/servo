// The spec card (task 4.3). See README.md beside this file.
export { SpecCard } from './spec-card.tsx';
export type { SpecCardProps } from './spec-card.tsx';
export { READOUT_EVERY_TICKS, READOUT_PACE_FROM_RATE, createRunFrames, followRun, readoutFrameDue } from './frames.ts';
export type { RunLoopState } from './frames.ts';
export type { RunFrames } from './frames.ts';
export { cardModel, failureNotes, layerShows, settingValue, titleOf, withUnit } from './model.ts';
export type { CardModel, CardPort, CardSetting, CardText, UnlockedSetting } from './model.ts';
export { READOUT_SPECS, SWITCH_WORDS, formatReadout, readoutsOf } from './readouts.ts';
export type { Readout, ReadoutKey } from './readouts.ts';
export { SPEAK_RATE, pageSpeech, speak, spokenLines } from './speech.ts';
export type { SpeechPort } from './speech.ts';
export { PICTURE_PX } from './picture.tsx';
