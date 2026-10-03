// The progress view (task 5.2), in the parent view behind the parental gate (D28): the child in use's parts met,
// unscripted builds passed, faults fixed, time in the sandbox and the latest card-game round, read from their records
// each time it opens. It only reads: there is nothing for the child to do and nothing to press, so touch, pointer,
// keyboard and screen reader all meet the same headings and plain lists. Plain counts, times and real part names; no
// score, praise or exclamation mark (ground rule 7). Child text (a profile's name) stays on the screen.
import { useEffect, useId, useState } from 'react';
import type { CSSProperties } from 'react';
import type { Content, ServoStore } from '@servo/app/store';
import type { FailureModeId, PartTypeId, ProfileId } from '@servo/schema';
import type { FaultFixed, Progress } from '../index.ts';
import { readProgress } from './load.ts';
import type { ProgressRead } from './load.ts';

/** Every line of the progress view's system text, for the copy pass. None has an exclamation mark or praise. */
export const PROGRESS_TEXT = {
  title: (name: string): string => `Progress: ${name}`,
  intro: 'Read from the Runs on this device. The child does nothing for it and never sees it.',
  runs: (count: number): string => (count === 1 ? 'Read from 1 Run.' : `Read from ${count} Runs.`),
  partsMet: 'Parts met',
  partMet: (name: string, date: string): string => `${name}, first used ${date}`,
  unscripted: 'Unscripted builds passed',
  passed: (title: string, run: number, date: string): string => `${title}: passed on Run ${run}, ${date}`,
  faultsFixed: 'Faults fixed',
  faultsIntro:
    'A fault counts as fixed when a later Run, with a change to that part, its ports or its wires, runs past the moment the fault first showed without it.',
  fixed: (runs: number, duration: string): string => `Fixed in ${runs} Runs and ${duration}, counted from the Run that first showed it.`,
  sandbox: 'Time in the sandbox',
  sandboxAbsent: 'Not measured yet.',
  cardGame: 'Parts named',
  named: (named: number, of: number, date: string): string => `${named} of ${of} parts named in the card game, ${date}.`,
  noRound: 'No card game played yet.',
  none: 'None yet.',
  unknownPart: 'A part this version of Servo does not have',
  unknownChallenge: 'A challenge this version of Servo does not have',
  loading: 'Loading',
  failed: 'Progress could not be read on this device.',
} as const;

const LIST: CSSProperties = { marginBlock: 8, lineHeight: 1.5 };

const capitalise = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

export const dateText = (at: string): string => {
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { dateStyle: 'medium' });
};

const plural = (count: number, one: string): string => `${count} ${one}${count === 1 ? '' : 's'}`;

/** A span of time in plain words, to the minute: "under a minute", "4 minutes", "1 hour 5 minutes", "2 days 3 hours". */
export const durationText = (ms: number): string => {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  if (minutes < 1) return 'under a minute';
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  if (days > 0) return hours > 0 ? `${plural(days, 'day')} ${plural(hours, 'hour')}` : plural(days, 'day');
  if (hours > 0) return rest > 0 ? `${plural(hours, 'hour')} ${plural(rest, 'minute')}` : plural(hours, 'hour');
  return plural(rest, 'minute');
};

const partName = (content: Content, part: PartTypeId): string => {
  const record = content.parts.find((candidate) => candidate.id === part);
  return record ? capitalise(record.identity.name) : PROGRESS_TEXT.unknownPart;
};

const failureLine = (content: Content, part: PartTypeId, failure: FailureModeId): string =>
  content.parts.find((candidate) => candidate.id === part)?.failureModes.find((mode) => mode.id === failure)?.cardLine ?? '';

/** One fixed fault as a line: the part's real name, its spec card's line for the fault, and how long the fix took. */
export const faultText = (content: Content, fault: FaultFixed): string => {
  const line = failureLine(content, fault.part, fault.failure);
  const took = PROGRESS_TEXT.fixed(fault.runs, durationText(Date.parse(fault.fixedAt) - Date.parse(fault.firstSeen)));
  return [`${partName(content, fault.part)}.`, line, took].filter((text) => text !== '').join(' ');
};

export interface ProgressSectionProps {
  readonly store: ServoStore;
  /** The child in use: the only profile whose records are read. */
  readonly profile: ProfileId;
  /** The adult's name for the child, shown in the heading. */
  readonly name: string;
}

type State = { readonly kind: 'loading' } | { readonly kind: 'read'; readonly read: ProgressRead | undefined } | { readonly kind: 'failed' };

/** The child in use's progress, read once as it opens. The caller remounts it for another child. */
export const ProgressSection = ({ store, profile, name }: ProgressSectionProps) => {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const titleId = useId();
  useEffect(() => {
    let live = true;
    readProgress(store, profile).then(
      (read) => live && setState({ kind: 'read', read }),
      () => live && setState({ kind: 'failed' }),
    );
    return () => {
      live = false;
    };
  }, [store, profile]);

  return (
    <section aria-labelledby={titleId} className="servo-progress">
      <h2 id={titleId}>{PROGRESS_TEXT.title(name)}</h2>
      <p>{PROGRESS_TEXT.intro}</p>
      {state.kind === 'loading' ? (
        <p role="status">{PROGRESS_TEXT.loading}</p>
      ) : state.kind === 'failed' || !state.read ? (
        <p role="status">{PROGRESS_TEXT.failed}</p>
      ) : (
        <Figures content={store.content} progress={state.read.progress} runs={state.read.runs} />
      )}
    </section>
  );
};

const Figures = ({ content, progress, runs }: { readonly content: Content; readonly progress: Progress; readonly runs: number }) => {
  const ids = useId();
  const challengeTitle = (id: string): string => content.challenges.find((challenge) => challenge.id === id)?.title ?? PROGRESS_TEXT.unknownChallenge;
  const heading = (key: string, text: string, count?: number) => (
    <h3 id={`${ids}-${key}`}>{count === undefined ? text : `${text}: ${count}`}</h3>
  );
  return (
    <>
      <p>{PROGRESS_TEXT.runs(runs)}</p>

      {heading('parts', PROGRESS_TEXT.partsMet, progress.partsMet.length)}
      {progress.partsMet.length === 0 ? (
        <p>{PROGRESS_TEXT.none}</p>
      ) : (
        <ul aria-labelledby={`${ids}-parts`} style={LIST}>
          {progress.partsMet.map((met) => (
            <li key={met.part}>{PROGRESS_TEXT.partMet(partName(content, met.part), dateText(met.at))}</li>
          ))}
        </ul>
      )}

      {heading('unscripted', PROGRESS_TEXT.unscripted, progress.unscriptedBuildsPassed.length)}
      {progress.unscriptedBuildsPassed.length === 0 ? (
        <p>{PROGRESS_TEXT.none}</p>
      ) : (
        <ul aria-labelledby={`${ids}-unscripted`} style={LIST}>
          {progress.unscriptedBuildsPassed.map((pass) => (
            <li key={pass.challenge}>{PROGRESS_TEXT.passed(challengeTitle(pass.challenge), pass.runNumber, dateText(pass.at))}</li>
          ))}
        </ul>
      )}

      {heading('faults', PROGRESS_TEXT.faultsFixed, progress.faultsFixed.length)}
      <p>{PROGRESS_TEXT.faultsIntro}</p>
      {progress.faultsFixed.length === 0 ? (
        <p>{PROGRESS_TEXT.none}</p>
      ) : (
        <ul aria-labelledby={`${ids}-faults`} style={LIST}>
          {progress.faultsFixed.map((fault) => (
            <li key={`${fault.fixedBy} ${fault.partId} ${fault.failure}`}>{faultText(content, fault)}</li>
          ))}
        </ul>
      )}

      {heading('sandbox', PROGRESS_TEXT.sandbox)}
      <p>{progress.timeInSandboxMs === undefined ? PROGRESS_TEXT.sandboxAbsent : durationText(progress.timeInSandboxMs)}</p>

      {heading('named', PROGRESS_TEXT.cardGame)}
      <p>
        {progress.partsNamed
          ? PROGRESS_TEXT.named(progress.partsNamed.named, progress.partsNamed.of, dateText(progress.partsNamed.playedAt))
          : PROGRESS_TEXT.noRound}
      </p>
    </>
  );
};
