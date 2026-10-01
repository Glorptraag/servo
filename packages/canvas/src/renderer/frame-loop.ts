// Draws on demand. A frame is requested when something changes (the view, the build, an image arriving, a fade
// under way) and none is drawn while the canvas rests: no idle animation (brief Section 11), and no battery spent
// on a still picture.

export class FrameLoop {
  private readonly frame: (now: number) => boolean;
  private handle: number | undefined;
  private stopped = false;

  /** `frame` draws one frame and says whether another is needed (a fade still running). */
  constructor(frame: (now: number) => boolean) {
    this.frame = frame;
  }

  request(): void {
    if (this.stopped || this.handle !== undefined) return;
    this.handle = requestAnimationFrame((now) => {
      this.handle = undefined;
      if (this.stopped) return;
      if (this.frame(now)) this.request();
    });
  }

  get pending(): boolean {
    return this.handle !== undefined;
  }

  stop(): void {
    this.stopped = true;
    if (this.handle !== undefined) cancelAnimationFrame(this.handle);
    this.handle = undefined;
  }
}

/** A value easing towards a target over a fixed time (UI motion is 120–200 ms, brief Section 11). */
export class Fade {
  private from: number;
  private to: number;
  private start = 0;
  private duration = 0;
  value: number;

  constructor(value: number) {
    this.value = value;
    this.from = value;
    this.to = value;
  }

  get target(): number {
    return this.to;
  }

  get moving(): boolean {
    return this.value !== this.to;
  }

  /** Starts towards `to`; `now` is the frame clock. A zero duration jumps there. */
  toward(to: number, duration: number, now: number): void {
    if (to === this.to && this.moving) return;
    this.from = this.value;
    this.to = to;
    this.start = now;
    this.duration = duration;
    if (duration <= 0) this.value = to;
  }

  /** Advances to `now`; true while still moving. */
  step(now: number): boolean {
    if (!this.moving) return false;
    const t = this.duration <= 0 ? 1 : Math.min(1, Math.max(0, (now - this.start) / this.duration));
    // Ease out: quick to respond, gentle to settle.
    const eased = 1 - (1 - t) * (1 - t);
    this.value = t >= 1 ? this.to : this.from + (this.to - this.from) * eased;
    return this.moving;
  }
}
