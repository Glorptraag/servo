// The sound layer (task 4.10). See the README, "Sound".
export { landsAWire, machineCuesOf } from './cues.ts';
export type { MachineCue, SoundCue } from './cues.ts';
export { SOUND_TEXT, SoundControl } from './control.tsx';
export type { SoundControlProps } from './control.tsx';
export { SoundLayer } from './layer.ts';
export type { AudioSink, EditSource, RunSource, SoundLayerOptions } from './layer.ts';
export { MUTED_KEY, readMuted, writeMuted } from './mute.ts';
export { WebAudioSink } from './synth.ts';
export type { MakeContext } from './synth.ts';
