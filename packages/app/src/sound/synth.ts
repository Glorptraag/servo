// The sounds themselves, made with Web Audio as they play: no audio files. Each is a plain machine noise (brief
// Section 11), never a tune, a jingle or a fanfare (ground rule 7). The AudioContext is made at the child's first
// gesture after the page opens, as browsers' autoplay rules ask, and only while sound is on; turning sound off stops
// every voice and suspends it. What is played comes from the Run's own numbers: a motor's level is its speed
// (|rpm| ÷ no-load rpm, packages/sim-core/docs/behaviour.md) and a buzzer's pitch is its part record's `hz`.
import { SPIN_UP_MS } from '../run-bar/run-loop.ts';
import type { MachineCue, SoundCue } from './cues.ts';
import type { AudioSink } from './layer.ts';

/** How quickly a playing sound follows a new level, in seconds: smooth at 30 ticks a second, with no zipper noise. */
const FOLLOW_S = 0.02;

/** How long a stopped sound takes to fade, in seconds. */
const FADE_S = 0.06;

/** The loudness of everything together. Each sound's own gain is set against it. */
const MASTER_GAIN = 0.8;

/** A buzzer whose record gives no pitch sounds at this. */
const BUZZ_HZ = 440;

/** A sound that plays while its level is above 0: a turning motor, a stalled one's hum, a buzzer, a slipping wheel. */
type Held = Exclude<MachineCue['sound'], 'knock'>;

interface Shape {
  readonly wave: OscillatorType;
  /** Pitch at a level, in hertz. */
  hz(level: number, cue: MachineCue): number;
  /** Lowpass corner at a level, in hertz. */
  corner(level: number): number;
  /** Gain at a level. */
  gain(level: number): number;
}

/**
 * - motor: a whirr that rises in pitch and loudness with the shaft's speed.
 * - hum: a low, steady electrical hum, the sound of a stalled motor or a servo motor holding with no signal.
 * - buzz: the buzzer's own tone, at its record's pitch.
 * - squeal: a thin high whine, louder the more the wheel slips.
 */
const HELD: Readonly<Record<Held, Shape>> = {
  motor: { wave: 'sawtooth', hz: (level) => 55 + 165 * level, corner: (level) => 400 + 1200 * level, gain: (level) => 0.08 * level },
  hum: { wave: 'square', hz: () => 98, corner: () => 260, gain: (level) => 0.07 * level },
  buzz: { wave: 'square', hz: (_level, cue) => cue.hz ?? BUZZ_HZ, corner: () => 3200, gain: (level) => 0.035 * level },
  squeal: { wave: 'sine', hz: (level) => 1400 + 600 * level, corner: () => 4000, gain: (level) => 0.04 * level },
};

interface Voice {
  readonly oscillator: OscillatorNode;
  readonly filter: BiquadFilterNode;
  readonly gain: GainNode;
}

const keyOf = (cue: MachineCue): string => `${cue.partId} ${cue.sound}`;

const isHeld = (cue: MachineCue): cue is MachineCue & { readonly sound: Held } => cue.sound !== 'knock';

/** Makes the page's AudioContext, or none where the page has no Web Audio. */
export type MakeContext = () => AudioContext | null;

const pageContext: MakeContext = () => (typeof AudioContext === 'undefined' ? null : new AudioContext());

export class WebAudioSink implements AudioSink {
  private readonly make: MakeContext;
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private mutedNow = false;
  private unlocked = false;
  private closed = false;
  /** Every held sound playing in the Run now, at its latest level, heard or not. */
  private readonly held = new Map<string, MachineCue & { readonly sound: Held }>();
  private readonly voices = new Map<string, Voice>();

  constructor(make: MakeContext = pageContext) {
    this.make = make;
  }

  play(cue: SoundCue): void {
    if (this.closed) return;
    switch (cue.kind) {
      case 'machine':
        if (isHeld(cue)) {
          if (cue.level > 0) this.held.set(keyOf(cue), cue);
          else this.held.delete(keyOf(cue));
          this.voice(cue);
        } else if (cue.level > 0) {
          this.knock(cue.level);
        }
        return;
      case 'hush':
        this.held.clear();
        this.silence();
        return;
      case 'whir':
        this.whir();
        return;
      case 'tick':
        this.blip('sine', 1800, 0.04, 0.04);
        return;
      case 'click':
        this.blip('triangle', 2600, 0.06, 0.025);
        return;
    }
  }

  setMuted(muted: boolean): void {
    this.mutedNow = muted;
    if (muted) {
      this.silence();
      void this.context?.suspend().catch(() => undefined);
      return;
    }
    this.resume();
  }

  unlock(): void {
    this.unlocked = true;
    this.resume();
  }

  /** Opens the audio when it may, and brings in every held sound the Run is making now. */
  private resume(): void {
    if (this.open()) for (const cue of this.held.values()) this.voice(cue);
  }

  close(): void {
    this.closed = true;
    this.held.clear();
    this.silence();
    void this.context?.close().catch(() => undefined);
    this.context = null;
    this.master = null;
  }

  /** The running context while sound is on and the child has made a gesture; null otherwise. */
  private open(): AudioContext | null {
    if (this.closed || this.mutedNow || !this.unlocked) return null;
    if (!this.context) {
      try {
        this.context = this.make();
      } catch (error) {
        console.warn('Sound could not start on this device.', error);
        this.context = null;
      }
      if (!this.context) return null;
      this.master = this.context.createGain();
      this.master.gain.value = MASTER_GAIN;
      this.master.connect(this.context.destination);
    }
    if (this.context.state !== 'running') void this.context.resume().catch(() => undefined);
    return this.context;
  }

  /** The context and its output when a sound may be heard now. */
  private out(): { readonly context: AudioContext; readonly master: GainNode } | null {
    if (this.mutedNow || !this.context || !this.master) return null;
    return { context: this.context, master: this.master };
  }

  /** Starts, changes or stops one part's held sound to match its cue. */
  private voice(cue: MachineCue & { readonly sound: Held }): void {
    const key = keyOf(cue);
    const found = this.voices.get(key);
    const out = this.out();
    if (!out) return;
    const { context, master } = out;
    const now = context.currentTime;
    if (cue.level <= 0) {
      if (found) this.stop(key, found, now);
      return;
    }
    const shape = HELD[cue.sound];
    const level = Math.min(1, cue.level);
    let voice = found;
    if (!voice) {
      const oscillator = context.createOscillator();
      const filter = context.createBiquadFilter();
      const gain = context.createGain();
      oscillator.type = shape.wave;
      oscillator.frequency.value = shape.hz(level, cue);
      filter.type = 'lowpass';
      filter.frequency.value = shape.corner(level);
      gain.gain.value = 0;
      oscillator.connect(filter).connect(gain).connect(master);
      oscillator.start(now);
      voice = { oscillator, filter, gain };
      this.voices.set(key, voice);
    }
    voice.oscillator.frequency.setTargetAtTime(shape.hz(level, cue), now, FOLLOW_S);
    voice.filter.frequency.setTargetAtTime(shape.corner(level), now, FOLLOW_S);
    voice.gain.gain.setTargetAtTime(shape.gain(level), now, FOLLOW_S);
  }

  private stop(key: string, voice: Voice, now: number): void {
    this.voices.delete(key);
    voice.gain.gain.setTargetAtTime(0, now, FADE_S / 3);
    voice.oscillator.stop(now + FADE_S);
    voice.oscillator.onended = () => voice.gain.disconnect();
  }

  /** Stops every held sound now. */
  private silence(): void {
    const now = this.context?.currentTime ?? 0;
    for (const [key, voice] of [...this.voices]) this.stop(key, voice, now);
  }

  /** A hollow knock: a short low tone that drops in pitch as it dies, louder for a harder hit. */
  private knock(level: number): void {
    const out = this.out();
    if (!out) return;
    const { context, master } = out;
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(170, now);
    oscillator.frequency.exponentialRampToValueAtTime(70, now + 0.15);
    gain.gain.setValueAtTime(0.3 * Math.min(1, level), now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    oscillator.connect(gain).connect(master);
    oscillator.start(now);
    oscillator.stop(now + 0.2);
    oscillator.onended = () => gain.disconnect();
  }

  /** The rising whir of the spin-up: a motor sound climbing in pitch over its one second, then fading as the Run starts. */
  private whir(): void {
    const out = this.out();
    if (!out) return;
    const { context, master } = out;
    const now = context.currentTime;
    const span = SPIN_UP_MS / 1000;
    const oscillator = context.createOscillator();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    oscillator.type = 'sawtooth';
    oscillator.frequency.setValueAtTime(50, now);
    oscillator.frequency.linearRampToValueAtTime(220, now + span);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(300, now);
    filter.frequency.linearRampToValueAtTime(1500, now + span);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.06, now + span * 0.8);
    gain.gain.linearRampToValueAtTime(0, now + span + 0.1);
    oscillator.connect(filter).connect(gain).connect(master);
    oscillator.start(now);
    oscillator.stop(now + span + 0.15);
    oscillator.onended = () => gain.disconnect();
  }

  /** A very short tone: the soft tick of a slow-motion step, the click of a wire landing. */
  private blip(wave: OscillatorType, hz: number, peak: number, seconds: number): void {
    const out = this.out();
    if (!out) return;
    const { context, master } = out;
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = wave;
    oscillator.frequency.value = hz;
    gain.gain.setValueAtTime(peak, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + seconds);
    oscillator.connect(gain).connect(master);
    oscillator.start(now);
    oscillator.stop(now + seconds + 0.01);
    oscillator.onended = () => gain.disconnect();
  }
}
