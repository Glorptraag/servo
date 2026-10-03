// Feature flags (task 6.6): per device, every one off by default. A flag is on only when the device's localStorage
// lists it under FLAGS_KEY, a JSON list of names such as `["level-3-slot"]`; anything missing, unreadable or unknown
// is off. The app reads them once as it mounts and never writes them: an adult turns one on from the browser's
// developer tools (README, "Feature flags"). Pure apart from `deviceFlags`, which only reads.
import { pageStorage } from '../shell/edges.ts';

/** Where the flags live on the device. */
export const FLAGS_KEY = 'servo.flags';

/**
 * - `level-3-slot`: the Level 3 slot. The servo motor's angle, and no other Level 3 setting, can be changed below
 *   Level 3, a microcontroller's spec card shows its program, and in a Run each microcontroller output wired to a
 *   servo motor's signal in drives it to that servo motor's angle setting.
 */
export const FLAG_NAMES = ['level-3-slot'] as const;

export type FlagName = (typeof FLAG_NAMES)[number];

export type Flags = Readonly<Record<FlagName, boolean>>;

export const NO_FLAGS: Flags = { 'level-3-slot': false };

const isFlagName = (name: unknown): name is FlagName => FLAG_NAMES.some((known) => known === name);

/** The flags `storage` holds. A storage that is missing or throws, a value that is not a JSON list, and unknown names all count as off. */
export const readFlags = (storage: Pick<Storage, 'getItem'> | null | undefined): Flags => {
  let saved: unknown;
  try {
    saved = JSON.parse(storage?.getItem(FLAGS_KEY) ?? '[]');
  } catch {
    return NO_FLAGS;
  }
  if (!Array.isArray(saved)) return NO_FLAGS;
  const on = new Set(saved.filter(isFlagName));
  return { 'level-3-slot': on.has('level-3-slot') };
};

/** This device's flags. */
export const deviceFlags = (): Flags => readFlags(pageStorage());
