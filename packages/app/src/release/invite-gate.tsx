// The tester invite gate (task 6.3): on a tester build's first launch on a device, a plain form asks for the invite
// code before the app opens. It is the page, not a dialog box (ground rule 9), and a wrong code is a line of text
// under the field. The words are for the adult who sets the device up.
import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { NoWebCrypto, isInviteCode, normalizeInviteCode, pageStorage, rememberCode, rememberedCode } from './invite.ts';
import './release.css';

const EMPTY = 'Enter the invite code.';
const NO_MATCH = 'That code does not match. Check it and enter it again.';
const NOT_SECURE = 'Codes can be checked only on a secure address, one that starts with https.';
const NOT_CHECKED = 'The code could not be checked. Reload the page and enter it again.';

interface InviteGateProps {
  readonly hashes: readonly string[];
  /** Called with the reduced code once it matches. */
  readonly onAccepted: (code: string) => void;
}

const InviteGate = ({ hashes, onAccepted }: InviteGateProps) => {
  const id = useId();
  const [typed, setTyped] = useState('');
  const [problem, setProblem] = useState<{ readonly text: string; readonly invalid: boolean } | null>(null);

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const code = normalizeInviteCode(typed);
    if (code === '') {
      setProblem({ text: EMPTY, invalid: true });
      return;
    }
    isInviteCode(code, hashes).then(
      (matches) => (matches ? onAccepted(code) : setProblem({ text: NO_MATCH, invalid: true })),
      (error: unknown) => setProblem({ text: error instanceof NoWebCrypto ? NOT_SECURE : NOT_CHECKED, invalid: false }),
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
 * otherwise once the form takes one. `open` mounts what the page shows (main.tsx).
 */
export const openThroughInviteGate = async (host: HTMLElement, hashes: readonly string[], open: () => void): Promise<void> => {
  const storage = pageStorage();
  const remembered = rememberedCode(storage);
  if (remembered !== undefined && (await isInviteCode(remembered, hashes).catch(() => false))) {
    open();
    return;
  }
  const root = createRoot(host);
  const accept = (code: string): void => {
    rememberCode(storage, code);
    root.unmount();
    open();
  };
  root.render(<InviteGate hashes={hashes} onAccepted={accept} />);
};
