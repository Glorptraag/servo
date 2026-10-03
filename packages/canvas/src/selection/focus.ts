// Focus states (brief Section 9): what a selection does to the rest of the canvas. Selecting a part dims everything
// not connected to it by one step, so its wires and neighbours stand out; selecting a wire highlights both its
// sockets and says what flows on it. Nothing else changes. Pure: a scene and a selection in, emphasis out.
// See docs/selection.md.
import type { PlacedPartId, WireId, WireKind } from '@servo/schema';
import type { Selection } from '../interface.ts';
import type { EmphasisRequest } from '../renderer/surface.ts';
import type { Emphasis } from '../renderer/views.ts';
import type { Scene, SceneWire } from '../scene/scene.ts';

/** Every line the scene draws or holds: power and signal lines, drive linkages and mounts. */
export const allWires = (scene: Scene): readonly SceneWire[] => [...scene.wires, ...scene.linkages];

export const wireOf = (scene: Scene, id: WireId): SceneWire | undefined => allWires(scene).find((wire) => wire.id === id);

/**
 * The parts one wire away from `id`, by any line: a power or signal line, a drive linkage, or a mount (a part on a
 * chassis is connected to it). One step only: a neighbour's own neighbours are not.
 */
export const neighboursOf = (scene: Scene, id: PlacedPartId): ReadonlySet<PlacedPartId> => {
  const near = new Set<PlacedPartId>();
  for (const wire of allWires(scene)) {
    if (wire.from.ref.part === id) near.add(wire.to.ref.part);
    if (wire.to.ref.part === id) near.add(wire.from.ref.part);
  }
  near.delete(id);
  return near;
};

/**
 * What a selection asks the renderer to show (`setEmphasis`), or null to draw everything normally: nothing selected,
 * a prop (it has its own ring), or a selection the scene no longer has.
 *
 * - A part: the part ringed; the lines on its ports and the parts at their other ends as they are; every other part
 *   and line dimmed one step (`DIM_ALPHA`).
 * - A wire: the line glowing in its colour and both its sockets haloed. Nothing is dimmed.
 */
export const focusFor = (scene: Scene, selection: Selection | null): EmphasisRequest | null => {
  if (selection?.kind === 'part') {
    if (!scene.partById.has(selection.partId)) return null;
    const near = neighboursOf(scene, selection.partId);
    const parts = new Map<PlacedPartId, Emphasis>();
    for (const part of scene.parts) {
      if (part.id === selection.partId) parts.set(part.id, 'highlighted');
      else if (!near.has(part.id)) parts.set(part.id, 'dimmed');
    }
    const wires = new Map<WireId, Emphasis>();
    for (const wire of allWires(scene)) {
      if (wire.from.ref.part !== selection.partId && wire.to.ref.part !== selection.partId) wires.set(wire.id, 'dimmed');
    }
    return { parts, wires };
  }
  if (selection?.kind === 'wire') {
    const wire = wireOf(scene, selection.wireId);
    if (!wire) return null;
    return { wires: new Map([[wire.id, 'highlighted']]), ports: new Set([wire.from.key, wire.to.key]) };
  }
  return null;
};

/**
 * What flows on a line, as its label says it beside the selected wire. One plain word, no full stop (a callout,
 * brief Section 12): power on a power line, a signal on a signal line, turning on a drive linkage (schema: "a drive
 * linkage carries turning"). A mount carries nothing; it is labelled with its real name.
 */
export const FLOW_WORDS: Readonly<Record<WireKind, string>> = {
  power: 'power',
  signal: 'signal',
  drive: 'turning',
  mount: 'mount',
};

export const flowLine = (kind: WireKind): string => FLOW_WORDS[kind];
