// How a box from layout.ts reaches the page: every region is placed from the shell's top left by transform, so a
// move is a slide the compositor draws, and its size is set so its content never reflows while it moves.
import type { CSSProperties } from 'react';
import type { Rect } from './layout.ts';

export const box = (rect: Rect): CSSProperties => ({
  transform: `translate(${rect.x}px, ${rect.y}px)`,
  width: rect.width,
  height: rect.height,
});
