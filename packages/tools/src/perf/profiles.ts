// The budgets and the device profiles the app's performance measurement stands in for (task 6.1, docs/perf.md).
// Plain data. A profile is Chromium on this machine with its CPU slowed through CDP and, for a first visit, its network
// shaped to home Wi-Fi; the figures are stand-ins until the same page runs on the devices themselves.

export interface DeviceProfile {
  readonly name: string;
  readonly label: string;
  /** CSS pixels, device scale factor and touch, as the device's browser reports them. */
  readonly viewport: { readonly width: number; readonly height: number };
  readonly deviceScaleFactor: number;
  readonly hasTouch: boolean;
  /** Emulation.setCPUThrottlingRate. */
  readonly cpuSlowdown: number;
}

/** A 2020 iPad (A12, 4 GB) held in landscape, as the canvas harness's iPad profile, at 2× CPU slowdown. */
export const IPAD_2020: DeviceProfile = {
  name: 'ipad-2020',
  label: '2020 iPad stand-in (1180 × 820 @2×, touch, CPU 2×)',
  viewport: { width: 1180, height: 820 },
  deviceScaleFactor: 2,
  hasTouch: true,
  cpuSlowdown: 2,
};

/** A low-end Chromebook (Celeron or MediaTek class, 4 GB) at 1366 × 768, at 4× CPU slowdown. */
export const CHROMEBOOK_LOW: DeviceProfile = {
  name: 'chromebook-low',
  label: 'Low-end Chromebook stand-in (1366 × 768 @1×, touch, CPU 4×)',
  viewport: { width: 1366, height: 768 },
  deviceScaleFactor: 1,
  hasTouch: true,
  cpuSlowdown: 4,
};

export const PROFILES: readonly DeviceProfile[] = [IPAD_2020, CHROMEBOOK_LOW];

/**
 * A first visit's network: home Wi-Fi as a child's family has it, 20 Mbit/s down, 5 up, 20 ms round trip. A visit
 * after the first loads from the service worker's cache (task 5.5) and is not shaped.
 */
export const HOME_WIFI = { latency: 20, downloadThroughput: (20 * 1_000_000) / 8, uploadThroughput: (5 * 1_000_000) / 8 } as const;

export const BUDGETS = {
  /** Cold start: the app interactive (shell, tray and canvas up) within 3 s, first visit and from the cache. */
  coldStartMs: 3000,
  /** 60 fps: a frame's main-thread work, p95, within the canvas harness's 16 ms. */
  frameMs: 16,
  /** Frames delivered per second, median, allowing for a machine busy with other work (as the canvas harness). */
  minFps: 50,
} as const;

/** Display frames timed per Build gesture and per Run. */
export const FRAMES = { build: 120, run: 150 } as const;

/** Independent measurements per figure; the median is reported. */
export const RUNS = 3;
