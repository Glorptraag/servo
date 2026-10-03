// The caps on a shared link (task 5.6, review R-5.6 finding 2), in one place. A valid build can still be too big to
// open: 8,000 parts validate in under a second, then take the Simulation half a minute to make and freeze the page,
// Stop included. So a link over any cap is refused as one plain line before it is migrated, validated, drawn or run,
// and no link over them is made. The busiest content fixture, busy-workbench, has 25 parts and 43 wires; a Level 1–2
// build's link is about 1 KB. Revisit with Level 3+.

export const SHARE_LIMITS = {
  /** The fragment, as written (`#share=1.` and base64url): 32 KB of characters. */
  fragmentChars: 32 * 1024,
  /** The JSON the payload inflates to, in bytes. Inflating stops as soon as it passes this, never after. */
  documentBytes: 256 * 1024,
  /** Placed parts in the build. */
  parts: 100,
  /** Wires in the build, mounts and drive linkages included. */
  wires: 200,
} as const;
