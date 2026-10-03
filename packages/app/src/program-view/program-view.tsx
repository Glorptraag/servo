// The placeholder program view (task 6.6): with the Level 3 slot on, it sits under the spec card of a selected brain
// (a part with a `program` primitive) and lists that brain's rules as plain lines. Read-only: a rule changes when the
// setting it follows changes on the other part's spec card, by that card's touch, pointer and keyboard paths and the
// canvas's list view. Everything shown comes from the part records and the build (ground rule 1).
import { useId } from 'react';
import type { PartRecord, PortId } from '@servo/schema';
import { useShell } from '../shell/index.ts';
import { withUnit } from '../spec-card/model.ts';
import { programsOf } from './rules.ts';
import type { AngleRule } from './rules.ts';
import './program-view.css';

/** `Angle` mid-sentence: `angle`. A label that starts with two capitals (an acronym) stays as written. */
const midSentence = (text: string): string =>
  text.length > 1 && text[1] === text[1]?.toLowerCase() ? text.charAt(0).toLowerCase() + text.slice(1) : text;

const portLabel = (record: PartRecord, port: PortId): string => record.ports.find((each) => each.id === port)?.label ?? port;

export const PROGRAM_LINES = {
  heading: 'Program',
  runs: (name: string) => `Runs while the ${name} has power.`,
  none: 'No output is wired to a part it can set.',
} as const;

const RuleLine = ({ rule, brain }: { readonly rule: AngleRule; readonly brain: PartRecord }) => {
  const { content, blueprint } = useShell();
  const placed = blueprint?.parts.find((part) => part.id === rule.part);
  const record = placed && content.catalogue.parts.get(placed.part);
  const name = record?.identity.name ?? rule.part;
  return (
    <li className="program-view-rule" data-output={rule.output} data-part={rule.part} data-level={String(rule.level)}>
      Always set {portLabel(brain, rule.output)} to the <strong>{name}</strong>’s {midSentence(rule.setting.label)},{' '}
      {withUnit(rule.value, rule.setting.unit)}.
    </li>
  );
};

export const ProgramView = () => {
  const { content, blueprint, selection } = useShell();
  const headingId = useId();
  const partId = selection?.kind === 'part' ? selection.partId : undefined;
  const placed = partId === undefined ? undefined : blueprint?.parts.find((part) => part.id === partId);
  const record = placed && content.catalogue.parts.get(placed.part);
  if (!blueprint || !placed || !record) return null;
  const programs = programsOf(blueprint, content.catalogue).filter((program) => program.partId === placed.id);
  if (programs.length === 0) return null;
  const rules = programs.flatMap((program) => program.rules);
  return (
    <section className="program-view" aria-labelledby={headingId} data-part={placed.id}>
      <h3 id={headingId} className="program-view-heading">
        {PROGRAM_LINES.heading}
      </h3>
      <p className="program-view-line">{PROGRAM_LINES.runs(record.identity.name)}</p>
      {rules.length > 0 ? (
        <ol className="program-view-rules">
          {rules.map((rule) => (
            <RuleLine key={rule.output} rule={rule} brain={record} />
          ))}
        </ol>
      ) : (
        <p className="program-view-line">{PROGRAM_LINES.none}</p>
      )}
    </section>
  );
};
