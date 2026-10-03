// The hint rungs the canvas draws (brief Section 10: pulse the part → pulse the port → draw a ghost wire; the last
// rung, do it, is the app's `batch`). Hints are drawn, not said: the step's line is the list view's text twin, never
// drawn. Pure: a scene and a step in, what to draw out. See docs/selection.md.
import { checkPortPair } from '@servo/schema';
import type { PartTarget, PortTarget } from '@servo/schema';
import type { DrawnHintStep } from '../interface.ts';
import type { Scene, ScenePart, ScenePort } from '../scene/scene.ts';

/** What one rung draws, resolved against the scene now. */
export interface HintTargets {
  /** pulse-part: the parts to ring. */
  readonly parts: readonly ScenePart[];
  /** pulse-port: the sockets to ring. */
  readonly ports: readonly ScenePort[];
  /** ghost-wire: each pair of sockets a ghost line joins. */
  readonly wires: readonly (readonly [ScenePort, ScenePort])[];
}

const NOTHING: HintTargets = { parts: [], ports: [], wires: [] };

/** A target by placed id names that part; by type, every placed part of that type. */
export const partsMatching = (scene: Scene, target: PartTarget): ScenePart[] =>
  scene.parts.filter((part) => ('placed' in target ? part.id === target.placed : part.placed.part === target.part));

/** The drawn sockets a port target names: on every part it matches. A port with no socket on the canvas matches nothing. */
export const portsMatching = (scene: Scene, target: PortTarget): ScenePort[] =>
  partsMatching(scene, target).flatMap((part) => part.ports.filter((port) => port.ref.port === target.port && port.layer !== 'none'));

/**
 * The parts, sockets or ghost lines a step draws. A ghost wire joins every pair of matching sockets that a wire could
 * join (the schema's `checkPortPair`), so a target by type draws one line per part of that type.
 */
export const hintTargets = (scene: Scene, step: DrawnHintStep): HintTargets => {
  switch (step.step) {
    case 'pulse-part':
      return { ...NOTHING, parts: partsMatching(scene, step.target) };
    case 'pulse-port':
      return { ...NOTHING, ports: portsMatching(scene, step.target) };
    case 'ghost-wire': {
      const ends = portsMatching(scene, step.to);
      const wires = portsMatching(scene, step.from).flatMap((from) =>
        ends.filter((to) => to.ref.part !== from.ref.part && checkPortPair(from.spec, to.spec).legal).map((to) => [from, to] as const),
      );
      return { ...NOTHING, wires };
    }
    default:
      return NOTHING;
  }
};

export const drawsAnything = (targets: HintTargets): boolean => targets.parts.length + targets.ports.length + targets.wires.length > 0;
