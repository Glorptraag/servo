// Random UUID v4s for the ids the store gives out: blueprints, profiles and card-game rounds. getRandomValues works
// in every context the app runs in; randomUUID needs a secure one, which a tablet on a LAN address is not.

const hex = (byte: number): string => byte.toString(16).padStart(2, '0');

/** A random UUID v4 in lower-case hex, as the schema reads opaque ids. */
export const uuidV4 = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const text = [...bytes].map(hex).join('');
  return `${text.slice(0, 8)}-${text.slice(8, 12)}-${text.slice(12, 16)}-${text.slice(16, 20)}-${text.slice(20)}`;
};
