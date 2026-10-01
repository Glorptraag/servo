// The tab that tucks one edge away and brings it back. It sits on the canvas side of the edge, so it stays on screen
// when the edge is tucked. Its name is the region's, and aria-expanded says whether the region shows.
import { useShell } from './context.ts';
import { EDGE_NAMES } from './edges.ts';
import type { Edge } from './edges.ts';
import type { Hand, Orientation } from './layout.ts';
import { box } from './place.ts';

export type Side = 'top' | 'right' | 'bottom' | 'left';

const OPPOSITE: Readonly<Record<Side, Side>> = { top: 'bottom', right: 'left', bottom: 'top', left: 'right' };

/** The screen edge each region tucks into. */
export const tuckSide = (edge: Edge, orientation: Orientation, hand: Hand): Side => {
  const cardSide: Side = hand === 'right' ? 'right' : 'left';
  switch (edge) {
    case 'header':
    case 'arenaStrip':
      return 'top';
    case 'specCard':
      return cardSide;
    case 'tray':
      return orientation === 'portrait' ? 'bottom' : OPPOSITE[cardSide];
  }
};

export interface EdgeTabProps {
  readonly edge: Edge;
  /** The id of the region it shows and hides. */
  readonly controls: string;
}

export const EdgeTab = ({ edge, controls }: EdgeTabProps) => {
  const { layout, mode, tucked, setTucked } = useShell();
  const shown = layout.shown[edge];
  const side = tuckSide(edge, layout.orientation, layout.hand);
  // The chevron points the way the region will go: out to its edge, or back in.
  const points = shown ? side : OPPOSITE[side];
  return (
    <button
      type="button"
      className="shell-tab shell-moves"
      data-edge={edge}
      aria-label={EDGE_NAMES[edge]}
      aria-expanded={shown}
      aria-controls={controls}
      // The tray is out of the way in Run mode whatever its tuck state, so its tab goes too (brief Section 9).
      hidden={edge === 'tray' && mode === 'run'}
      style={box(layout.tabs[edge])}
      onClick={() => setTucked(edge, !tucked[edge])}
    >
      <svg className="shell-chevron" data-points={points} viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
        <path d="M6 15l6-6 6 6" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
};
