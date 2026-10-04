// The element read-aloud follows (read-aloud.ts), round the shell or a page. It lays nothing out of its own
// (display: contents), so the shell still fills its host.
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { pageSpeech } from '../spec-card/speech.ts';
import type { SpeechPort } from '../spec-card/speech.ts';
import type { AccessStore } from './prefs.ts';
import { followReadAloud } from './read-aloud.ts';
import './a11y.css';

export interface ReadAloudScopeProps {
  readonly store: AccessStore;
  /** The browser's speech; none where it has no speechSynthesis, and read-aloud then does nothing. */
  readonly speech?: SpeechPort | null;
  readonly children?: ReactNode;
}

export const ReadAloudScope = ({ store, speech = pageSpeech(), children }: ReadAloudScopeProps) => {
  const scope = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = scope.current;
    if (!element || !speech) return undefined;
    return followReadAloud(element, { speech, isOn: () => store.prefs.readAloud });
  }, [store, speech]);
  // Turning read-aloud off stops whatever it was reading.
  useEffect(
    () =>
      store.subscribe(() => {
        if (!store.prefs.readAloud) speech?.synth.cancel();
      }),
    [store, speech],
  );
  return (
    <div ref={scope} className="a11y-scope">
      {children}
    </div>
  );
};
