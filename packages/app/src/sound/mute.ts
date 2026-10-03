// Whether sound is off on this device. It is the device's setting, not the child's or the build's, so it lives in
// localStorage beside the tuck states (src/shell/edges.ts), never in the store, and never syncs. Sound starts on: the
// brief gives no default, and every sound has a visual twin, so a child who turns it off loses nothing.

/** The localStorage key: "true" while sound is off. */
export const MUTED_KEY = 'servo.sound.muted';

/** True when sound was turned off on this device. Anything missing or unreadable counts as on. */
export const readMuted = (storage: Storage | null): boolean => {
  try {
    return storage?.getItem(MUTED_KEY) === 'true';
  } catch {
    return false;
  }
};

/** Keeps the setting. A storage that refuses (full, blocked, private browsing) keeps it for this visit only. */
export const writeMuted = (storage: Storage | null, muted: boolean): void => {
  try {
    storage?.setItem(MUTED_KEY, String(muted));
  } catch {
    // Nothing to do: the layer still follows the control until the page closes.
  }
};
