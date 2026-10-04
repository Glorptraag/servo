// Mounts the parent view (task 5.1) in a host element on its own page of the web build. The page opens the store and
// passes it in; the view never closes it. The view follows this device's access options (task 7.5, ./access.tsx).
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { AccessStore, ReadAloudScopeProps, ServoStore } from '@servo/app/store';
import type { ParentHandle } from '../index.ts';
import { ParentAccess } from './access.tsx';
import { ParentView } from './view.tsx';

export interface ParentOptions {
  /** Where the parental gate's questions come from (D28). Default `Math.random`; tests pass a fixed one. */
  readonly random?: () => number;
  /** The access options. Default this device's, kept in its localStorage and followed across its pages. */
  readonly access?: AccessStore;
  /** Read-aloud's speech. Default the browser's; none where it has no speechSynthesis. */
  readonly speech?: ReadAloudScopeProps['speech'];
}

export const mountParentWith = (host: HTMLElement, store: ServoStore, options: ParentOptions = {}): ParentHandle => {
  const root = createRoot(host);
  root.render(
    <StrictMode>
      <ParentAccess access={options.access} speech={options.speech}>
        <ParentView store={store} random={options.random ?? Math.random} />
      </ParentAccess>
    </StrictMode>,
  );
  return { destroy: () => root.unmount() };
};
