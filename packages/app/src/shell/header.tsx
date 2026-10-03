// The header's contents (brief Section 9): Home, the kit and level name, the challenge goal in one line with the
// hint button beside it, the blueprint's name, and Save. The kit, level and name come from data, and a tap on the
// name renames the build (name.tsx); the rest are slots that later tasks fill.
import type { ReactNode } from 'react';
import { LEVELS } from '@servo/schema';
import { useShell } from './context.ts';
import { BlueprintName } from './name.tsx';

export interface HeaderSlots {
  /** Home. */
  readonly home?: ReactNode;
  /** Task 4.5: the challenge's goal line, ticked when met. Empty in the sandbox. */
  readonly goal?: ReactNode;
  /** Task 4.6: the hint button beside the goal. */
  readonly hints?: ReactNode;
  /** Task 4.10: the sound control. */
  readonly sound?: ReactNode;
  /** Task 4.9: Save. */
  readonly save?: ReactNode;
}

export const HeaderContents = ({ home, goal, hints, sound, save }: HeaderSlots) => {
  const { kit, level } = useShell();
  const levelName = LEVELS.find((info) => info.level === level)?.label;
  return (
    <>
      <div className="shell-header-slot">{home}</div>
      <p className="shell-kit">
        {kit ? <span className="shell-kit-name">{kit.name}</span> : null}
        <span className="shell-level">{levelName ? `Level ${level} · ${levelName}` : `Level ${level}`}</span>
      </p>
      <div className="shell-goal">{goal}</div>
      <div className="shell-header-slot">{hints}</div>
      <BlueprintName />
      <div className="shell-header-slot">{sound}</div>
      <div className="shell-header-slot">{save}</div>
    </>
  );
};
