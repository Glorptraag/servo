// The sound layer (task 4.10): it listens to the run loop and the canvas and hands each cue to an audio sink. One
// `sound` event of a Run is one machine cue, as it happens, so a recorded Run's sound events and the cues it played
// are the same list (test/sound/). The whir plays as a Run starts its spin-up, a soft tick with each step at 5 ticks a
// second or fewer, a click as a wire lands, and every machine sound stops when the Run ends. Cues go to the sink while
// sound is off too, so a motor already turning is heard at its speed the moment sound comes back on; the sink stays
// silent meanwhile. Framework-free; the sink is injected, so tests need no audio.
import type { CanvasHandle } from '@servo/canvas';
import { isSlowMotion } from '../run-bar/run-loop.ts';
import type { RunListener, RunState } from '../run-bar/run-loop.ts';
import { landsAWire, machineCuesOf } from './cues.ts';
import type { SoundCue } from './cues.ts';
import { readMuted, writeMuted } from './mute.ts';

/** Where cues are heard: Web Audio in the app (synth.ts), a list in tests. */
export interface AudioSink {
  /** Plays one cue now. Called while sound is off as well, so the sink always knows which machine sounds are playing. */
  play(cue: SoundCue): void;
  /** Sound off (true) or on. Off is silent at once; on brings back the machine sounds playing now. */
  setMuted(muted: boolean): void;
  /** The child touched, clicked or pressed a key: the page may start audio now (the browser's autoplay rules). */
  unlock(): void;
  /** Stops every sound and frees the audio. */
  close(): void;
}

/** The run loop as the layer hears it (src/run-bar/run-loop.ts). */
export interface RunSource {
  subscribe(listener: RunListener): () => void;
}

/** The canvas as the layer hears it: its `edit` events. */
export type EditSource = Pick<CanvasHandle, 'on'>;

export interface SoundLayerOptions {
  readonly sink: AudioSink;
  /** Where the sound setting persists on this device; null keeps it for this visit only. */
  readonly storage: Storage | null;
}

/** The events that count as a user gesture for the browser's autoplay rules. */
const GESTURES = ['pointerdown', 'pointerup', 'touchend', 'keydown', 'click'] as const;

const isPlaying = (state: RunState): boolean => state.phase === 'spin-up' || state.phase === 'running';

export class SoundLayer {
  private readonly sink: AudioSink;
  private readonly storage: Storage | null;
  private mutedNow: boolean;
  private readonly listeners = new Set<() => void>();
  private offRun: (() => void) | undefined;
  private offEdit: (() => void) | undefined;
  /** A Run is in its spin-up or running. */
  private playing = false;

  constructor(options: SoundLayerOptions) {
    this.sink = options.sink;
    this.storage = options.storage;
    this.mutedNow = readMuted(this.storage);
    this.sink.setMuted(this.mutedNow);
  }

  get muted(): boolean {
    return this.mutedNow;
  }

  /** Turns sound off or on, and keeps the setting on this device. */
  setMuted(muted: boolean): void {
    if (muted === this.mutedNow) return;
    this.mutedNow = muted;
    writeMuted(this.storage, muted);
    this.sink.setMuted(muted);
    for (const listener of [...this.listeners]) listener();
  }

  toggle(): void {
    this.setMuted(!this.mutedNow);
  }

  /** Calls back whenever sound is turned off or on. Shaped for React's useSyncExternalStore. */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Listens to this run loop, or to none. A Run still sounding from the last loop stops. */
  follow(run: RunSource | null): void {
    this.offRun?.();
    this.offRun = undefined;
    this.end();
    if (run) this.offRun = run.subscribe((state, frame) => this.heard(state, frame));
  }

  /** Listens to this canvas's edits for wires landing, or to none. */
  hear(canvas: EditSource | null): void {
    this.offEdit?.();
    this.offEdit = canvas?.on('edit', (event) => {
      if (landsAWire(event.command)) this.sink.play({ kind: 'click' });
    });
  }

  /** Lets the sink start audio at the child's first gesture in `view`. Returns the undo. */
  attach(view: Window): () => void {
    const unlock = (): void => this.sink.unlock();
    for (const type of GESTURES) view.addEventListener(type, unlock, { capture: true, passive: true });
    return () => {
      for (const type of GESTURES) view.removeEventListener(type, unlock, { capture: true });
    };
  }

  /** Stops listening and frees the audio. */
  dispose(): void {
    this.follow(null);
    this.hear(null);
    this.listeners.clear();
    this.sink.close();
  }

  private heard(state: RunState, frame: Parameters<RunListener>[1]): void {
    if (!frame) {
      const playing = isPlaying(state);
      if (playing && !this.playing) this.sink.play({ kind: 'whir' });
      if (!playing) this.end();
      this.playing = playing;
      return;
    }
    if (frame.tick > 0 && isSlowMotion(state.rate)) this.sink.play({ kind: 'tick', tick: frame.tick });
    for (const cue of machineCuesOf(frame.events)) this.sink.play(cue);
  }

  private end(): void {
    if (this.playing) this.sink.play({ kind: 'hush' });
    this.playing = false;
  }
}
