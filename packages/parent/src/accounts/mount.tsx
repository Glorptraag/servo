// Mounts the parent view (task 5.1) in a host element on its own page of the web build. The page opens the store and
// passes it in; the view never closes it.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { ServoStore } from '@servo/app/store';
import type { ParentHandle } from '../index.ts';
import { ParentView } from './view.tsx';

export interface ParentOptions {
  /** Where the parental gate's questions come from (D28). Default `Math.random`; tests pass a fixed one. */
  readonly random?: () => number;
}

export const mountParentWith = (host: HTMLElement, store: ServoStore, options: ParentOptions = {}): ParentHandle => {
  const root = createRoot(host);
  root.render(
    <StrictMode>
      <ParentView store={store} random={options.random ?? Math.random} />
    </StrictMode>,
  );
  return { destroy: () => root.unmount() };
};
