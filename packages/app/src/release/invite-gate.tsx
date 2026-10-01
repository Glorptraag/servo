// The tester invite gate (task 6.3): on a tester build's first launch on a device, a plain form asks for the invite
// code before the app opens. It is the page, not a dialog box (ground rule 9), and a wrong code is a line of text
// under the field. The words are for the adult who sets the device up.
import { useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { NoWebCrypto, normalizeInviteCode } from './invite-code.ts';
import { isInviteCode, pageStorage, rememberCode, rememberedCode } from './invite.ts';
import './release.css';

export const EMPTY = 'Enter the invite code.';
export const NO_MATCH = 'That code does not match. Check it and enter it again.';
export const NOT_SECURE = 'Codes can be checked only on a secure address, one that starts with https.';
export const NOT_CHECKED = 'The code could not be checked. Reload the page and enter it again.';

interface InviteGateProps {
  readonly hashes: readonly string[];
  /** Called once, with the reduced code, when it matches. */
  readonly onAccepted: (code: string) => void;
}

const InviteGate = ({ hashes, onAccepted }: InviteGateProps) => {
  const id = useId();
  const [typed, setTyped] = useState('');
  const [problem, setProblem] = useState<{ readonly text: string; readonly invalid: boolean } | null>(null);
  // A submit while a code is being checked, or after one matched, does nothing: a double tap opens the app once.
  const checking = useRef(false);

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (checking.current) return;
    const code = normalizeInviteCode(typed);
    if (code === '') {
      setProblem({ text: EMPTY, invalid: true });
      return;
    }
    checking.current = true;
    const refuse = (text: string, invalid: boolean): void => {
      checking.current = false;
      setProblem({ text, invalid });
    };
    isInviteCode(code, hashes).then(
      (matches) => (matches ? onAccepted(code) : refuse(NO_MATCH, true)),
      (error: unknown) => refuse(error instanceof NoWebCrypto ? NOT_SECURE : NOT_CHECKED, false),
    );
  };

  return (
    <main className="release-page">
      <form className="release-panel" aria-labelledby={`${id}-title`} noValidate onSubmit={submit}>
        <h1 id={`${id}-title`}>Servo tester build</h1>
        <p>Enter the invite code you were given. This device remembers it, so you enter it once.</p>
        <label className="release-label" htmlFor={`${id}-code`}>
          Invite code
        </label>
        <input
          id={`${id}-code`}
          className="release-input"
          name="code"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          autoComplete="off"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={problem?.invalid ?? false}
          aria-describedby={`${id}-problem`}
        />
        <p id={`${id}-problem`} className="release-problem" aria-live="polite">
          {problem?.text}
        </p>
        <button type="submit" className="release-button">
          Open Servo
        </button>
      </form>
    </main>
  );
};

/**
 * Opens a tester build behind the invite gate: at once when this device remembers a code that is one of `hashes`,
 * otherwise once the form takes one. `open` runs once, and mounts what the page shows.
 */
export const openThroughInviteGate = async (host: HTMLElement, hashes: readonly string[], open: () => void): Promise<void> => {
  const storage = pageStorage();
  const remembered = rememberedCode(storage);
  if (remembered !== undefined && (await isInviteCode(remembered, hashes).catch(() => false))) {
    open();
    return;
  }
  const root = createRoot(host);
  let opened = false;
  const accept = (code: string): void => {
    if (opened) return;
    opened = true;
    rememberCode(storage, code);
    root.unmount();
    open();
  };
  root.render(<InviteGate hashes={hashes} onAccepted={accept} />);
};
