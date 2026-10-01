// The zoom control (packages/app/README.md, "Areas and owners"): zoom in, Fit and zoom out, beside pinch and the
// wheel on the canvas itself. Fit re-centres the build (brief Section 10); the canvas holds every zoom inside its
// limits, up to 400% (brief Section 13).
import { useShell } from './context.ts';
import { box } from './place.ts';
import { zoomInFrom, zoomOutFrom } from './zoom.ts';

const Icon = ({ d }: { readonly d: string }) => (
  <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
    <path d={d} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const ZoomControl = () => {
  const { canvas, layout } = useShell();
  return (
    <div className="shell-zoom shell-moves" data-region="zoom" role="group" aria-label="Zoom" style={box(layout.zoom)}>
      <button type="button" className="shell-zoom-button" aria-label="Zoom in" disabled={!canvas} onClick={() => canvas?.setZoom(zoomInFrom(canvas.zoom))}>
        <Icon d="M12 5v14M5 12h14" />
      </button>
      <button type="button" className="shell-zoom-button" aria-label="Fit" disabled={!canvas} onClick={() => canvas?.fit()}>
        <Icon d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />
      </button>
      <button type="button" className="shell-zoom-button" aria-label="Zoom out" disabled={!canvas} onClick={() => canvas?.setZoom(zoomOutFrom(canvas.zoom))}>
        <Icon d="M5 12h14" />
      </button>
    </div>
  );
};
