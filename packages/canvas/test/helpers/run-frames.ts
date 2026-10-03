// Run frames for tests, built by hand: the canvas cannot run sim-core (it reaches only its interface), so its tests
// give it frames shaped as Simulation.step gives them. packages/tools/test/e2e/run-animation.e2e.ts feeds real ones.
import type { MotionPayload, SoundPayload, ValuePayload } from '@servo/schema';
import type { LiveState, RunFrame, WireFlow } from '@servo/sim-core/interface';

export interface LiveSketch {
  readonly values?: ValuePayload;
  readonly motion?: MotionPayload;
  readonly sounds?: readonly SoundPayload[];
  readonly faults?: readonly string[];
}

export const frameOf = (tick: number, live: Readonly<Record<string, LiveSketch>>, flows: Readonly<Record<string, WireFlow>> = {}): RunFrame => ({
  tick,
  events: [],
  live: new Map(
    Object.entries(live).map(([subject, sketch]): [string, LiveState] => [
      subject,
      {
        values: sketch.values ?? {},
        ...(sketch.motion ? { motion: sketch.motion } : {}),
        sounds: sketch.sounds ?? [],
        faults: sketch.faults ?? [],
      },
    ]),
  ),
  flows: new Map(Object.entries(flows)),
});

/** The Rolling Start robot at the open floor's start pose (300, 600, heading 0), driving forward at `rpm`. */
export const rollingStartFrame = (tick: number, options: { rpm?: number; x?: number; heading?: number; pitch?: number; roll?: number; faults?: Readonly<Record<string, readonly string[]>>; milliamps?: number } = {}): RunFrame => {
  const rpm = options.rpm ?? 90;
  const milliamps = options.milliamps ?? 260;
  const faults = options.faults ?? {};
  const half = milliamps / 2;
  return frameOf(
    tick,
    {
      battery: { values: { volts: 2.9, milliamps, charge: 1 - tick * 0.001 }, faults: faults.battery ?? [] },
      caster: { faults: faults.caster ?? [] },
      chassis: {
        motion: { x: options.x ?? 300, y: 600, heading: options.heading ?? 0, pitch: options.pitch ?? 0, roll: options.roll ?? 0 },
        faults: faults.chassis ?? [],
      },
      'motor-left': { values: { volts: 2.9, milliamps: half, rpm }, sounds: rpm ? [{ sound: 'motor', level: 0.45 }] : [], faults: faults['motor-left'] ?? [] },
      'motor-right': { values: { volts: 2.9, milliamps: half, rpm }, sounds: rpm ? [{ sound: 'motor', level: 0.45 }] : [], faults: faults['motor-right'] ?? [] },
      switch: { values: { volts: 0, milliamps, closed: milliamps > 0 } },
      'wheel-left': { values: { rpm } },
      'wheel-right': { values: { rpm } },
    },
    {
      w6: { rpm },
      w7: { rpm },
      w8: { milliamps },
      w9: { milliamps: -half },
      w10: { milliamps: -half },
      w11: { milliamps: -half },
      w12: { milliamps: -half },
    },
  );
};
