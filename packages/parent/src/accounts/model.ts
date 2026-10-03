// The adult account and child profiles (task 5.1), framework-free so it is tested in Node. There is no sign-up, no
// password and no server (D10): the adult account is this device, and its children are the store's profiles, each an
// opaque id and a name the adult gives, with no email, no chat and nothing public. The profile switch chooses the
// child in use on this device, whose builds the child's app opens; the parent view shows that child's records only.
import type { BlueprintSummary, Profile, ServoStore } from '@servo/app/store';
import type { ProfileId } from '@servo/schema';

/** What the parent view shows. */
export interface Accounts {
  /** Every child on this device, oldest first. Names only reach the screen, never a URL or a log (D21). */
  readonly profiles: readonly Profile[];
  /** The child in use on this device: the one the switch chose, or the only one. */
  readonly current?: Profile;
  /** The current child's builds, read through that child's scope alone. Empty with no current child. */
  readonly builds: readonly BlueprintSummary[];
}

/** The longest name the store keeps, in characters. */
export const NAME_MAX = 60;

/**
 * The adult's text as a profile name, as the store keeps one: runs of white space become one space and the ends are
 * trimmed. Undefined when that leaves nothing, more than `NAME_MAX` characters, or a control character.
 */
export const nameOf = (text: string): string | undefined => {
  const name = text.replace(/\s+/gu, ' ').trim();
  const length = [...name].length;
  return length >= 1 && length <= NAME_MAX && !/\p{Cc}/u.test(name) ? name : undefined;
};

/** Thrown for a name the store would not keep, so the view can say so in its line. */
export class NameRefused extends Error {
  constructor() {
    super(`A name is 1 to ${NAME_MAX} characters.`);
    this.name = 'NameRefused';
  }
}

/** Thrown when this device cannot keep who is in use, so a child is not added: the child in use would be lost. */
export class ChoiceNotKept extends Error {
  constructor(cause?: unknown) {
    super('This device cannot keep who is using Servo, so another child cannot be added.', { cause });
    this.name = 'ChoiceNotKept';
  }
}

const checked = (text: string): string => {
  const name = nameOf(text);
  if (name === undefined) throw new NameRefused();
  return name;
};

/** Reads the profiles, the child in use and that child's builds. Only the child in use is ever given a scope. */
export const readAccounts = async (store: ServoStore): Promise<Accounts> => {
  const profiles = await store.profiles.list();
  const current = await store.profiles.inUse();
  if (!current) return { profiles, builds: [] };
  const builds = await store.forProfile(current.id).blueprints.list();
  return { profiles, current, builds };
};

/**
 * Adds a child. The child already in use stays in use: with one profile it was in use only as the only one, so it is
 * chosen first, and the device keeps building as that child until the adult switches.
 */
export const addChild = async (store: ServoStore, text: string): Promise<Profile> => {
  const name = checked(text);
  const current = await store.profiles.inUse();
  if (current) {
    // A page that cannot keep the choice would leave no one in use once a second child is added (R-5.1 finding 3).
    await store.profiles.use(current.id).catch((error: unknown) => {
      throw new ChoiceNotKept(error);
    });
  }
  return store.profiles.create(name);
};

export const renameChild = async (store: ServoStore, id: ProfileId, text: string): Promise<Profile> => store.profiles.rename(id, checked(text));

/** The profile switch: the child in use on this device from now on. Refuses a profile that is not on the device. */
export const switchChild = (store: ServoStore, id: ProfileId): Promise<Profile> => store.profiles.use(id);

/**
 * Removes a child with their builds, runs and card-game results, and what this device noted for them (D38). The view
 * calls it only once the adult has confirmed.
 */
export const removeChild = (store: ServoStore, id: ProfileId): Promise<void> => store.profiles.remove(id);
