// The parts-list export in the parent view (task 5.3), behind the parental gate (D28): each build of the child in use
// has a Parts list button, which opens that build's list in place, never in a dialog. Print uses the browser's own
// print with a print stylesheet that prints the list alone. Every control is a native button, so touch, pointer and
// keyboard take the same path, and the list itself is a table and plain lists a screen reader reads in order.
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import type { BlueprintSummary, ServoStore } from '@servo/app/store';
import { PART_FAMILIES } from '@servo/schema';
import type { BlueprintId, ProfileId } from '@servo/schema';
import type { PartsList } from '../index.ts';
import { partsListFrom } from './parts-list.ts';

/** Every line of the export's own system text, for the copy pass. None has an exclamation mark or praise (ground rule 7). */
export const EXPORT_TEXT = {
  open: 'Parts list',
  openFor: (build: string): string => `Parts list for ${build}`,
  title: (build: string): string => `Parts list: ${build}`,
  intro: 'Every part this build uses, by its real name, so you can get the real parts and build it together.',
  parts: 'Parts',
  part: 'Part',
  family: 'Family',
  quantity: 'Quantity',
  wiring: 'Wiring',
  wiringIntro: 'One line for each connection, as it is made in a real kit. Make them in this order.',
  realKit: 'For a real kit',
  noWiring: 'Nothing is connected yet.',
  safety: 'Adult supervision',
  print: 'Print',
  close: 'Close',
  loading: 'Loading',
  failed: 'This build could not be opened, so its parts list could not be made.',
} as const;

const TARGET: CSSProperties = { minHeight: 44, minWidth: 44, fontSize: '1rem' };
const ROW: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBlock: 8 };

/**
 * On paper, while a list is open, only the list shows, without its buttons: everything that neither holds the list nor
 * is in it takes no room, so no blank pages print. With no list open the page prints as it is.
 */
export const PRINT_CSS = `@media print {
  body:has(.servo-parts-list) :not(:has(.servo-parts-list)):not(.servo-parts-list):not(.servo-parts-list *) { display: none; }
  .servo-parts-list .servo-no-print { display: none; }
  .servo-parts-list table { border-collapse: collapse; }
  .servo-parts-list th, .servo-parts-list td { border: 1px solid #000; padding: 4px 8px; text-align: left; }
}`;

const familyLabel = new Map<string, string>(PART_FAMILIES.map((family) => [family.id, family.label]));

const capitalise = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

type Shown =
  | { readonly build: BlueprintId; readonly state: 'loading' }
  | { readonly build: BlueprintId; readonly state: 'ready'; readonly list: PartsList }
  | { readonly build: BlueprintId; readonly state: 'failed' };

export interface PartsListExportProps {
  readonly store: ServoStore;
  /** The child in use: the only profile whose builds are read. */
  readonly profile: ProfileId;
  readonly builds: readonly BlueprintSummary[];
  /** The line that names a build in the list. */
  readonly describe: (build: BlueprintSummary) => string;
}

/** The child's builds, each with its Parts list button, and the list that is open, if any. */
export const PartsListExport = ({ store, profile, builds, describe }: PartsListExportProps) => {
  const [shown, setShown] = useState<Shown | undefined>(undefined);
  const openers = useRef(new Map<BlueprintId, HTMLButtonElement>());
  const request = useRef(0);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const open = (build: BlueprintId) => {
    const ticket = (request.current += 1);
    setShown({ build, state: 'loading' });
    void store
      .forProfile(profile)
      .blueprints.load(build)
      .then((load): Shown => (load.ok ? { build, state: 'ready', list: partsListFrom(load.blueprint, store.content.catalogue) } : { build, state: 'failed' }))
      .catch((): Shown => ({ build, state: 'failed' }))
      .then((next) => {
        if (live.current && request.current === ticket) setShown(next);
      });
  };
  const close = () => {
    const build = shown?.build;
    request.current += 1;
    setShown(undefined);
    if (build) openers.current.get(build)?.focus();
  };

  const visible = shown && builds.some((build) => build.id === shown.build) ? shown : undefined;
  return (
    <>
      <ul>
        {builds.map((build) => (
          <li key={build.id} style={ROW}>
            <span>{describe(build)}</span>
            <button
              ref={(button) => {
                if (button) openers.current.set(build.id, button);
                else openers.current.delete(build.id);
              }}
              type="button"
              aria-label={EXPORT_TEXT.openFor(build.name)}
              aria-expanded={visible?.build === build.id}
              onClick={() => open(build.id)}
              style={TARGET}
            >
              {EXPORT_TEXT.open}
            </button>
          </li>
        ))}
      </ul>
      {visible?.state === 'ready' && <PartsListPanel list={visible.list} onClose={close} />}
      {visible && visible.state !== 'ready' && (
        <p role="status">{visible.state === 'loading' ? EXPORT_TEXT.loading : EXPORT_TEXT.failed}</p>
      )}
    </>
  );
};

export interface PartsListPanelProps {
  readonly list: PartsList;
  readonly onClose: () => void;
}

/** One build's printable parts list. Focus moves to its heading when it opens; Escape closes it. */
export const PartsListPanel = ({ list, onClose }: PartsListPanelProps) => {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [list]);
  const escape = (event: KeyboardEvent) => {
    if (event.key === 'Escape') onClose();
  };
  return (
    <section className="servo-parts-list" aria-labelledby="servo-parts-list-title" onKeyDown={escape}>
      <style href="servo-parts-list-print" precedence="default">
        {PRINT_CSS}
      </style>
      <h3 id="servo-parts-list-title" ref={heading} tabIndex={-1}>
        {EXPORT_TEXT.title(list.blueprint.name)}
      </h3>
      <p>{EXPORT_TEXT.intro}</p>
      <table>
        <caption style={{ textAlign: 'left' }}>{EXPORT_TEXT.parts}</caption>
        <thead>
          <tr>
            <th scope="col">{EXPORT_TEXT.part}</th>
            <th scope="col">{EXPORT_TEXT.family}</th>
            <th scope="col">{EXPORT_TEXT.quantity}</th>
          </tr>
        </thead>
        <tbody>
          {list.parts.map((entry) => (
            <tr key={entry.part}>
              <th scope="row">{capitalise(entry.name)}</th>
              <td>{familyLabel.get(entry.family) ?? entry.family}</td>
              <td>{entry.quantity}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h4>{EXPORT_TEXT.wiring}</h4>
      {list.wiring.length === 0 ? (
        <p>{EXPORT_TEXT.noWiring}</p>
      ) : (
        <>
          <p>{EXPORT_TEXT.wiringIntro}</p>
          <ol>
            {list.wiring.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ol>
        </>
      )}
      {list.realKit.length > 0 && (
        <>
          <h4>{EXPORT_TEXT.realKit}</h4>
          <ul className="servo-real-kit">
            {list.realKit.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </>
      )}
      {list.safetyNotes.length > 0 && (
        <>
          <h4>{EXPORT_TEXT.safety}</h4>
          <ul>
            {list.safetyNotes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </>
      )}
      <div className="servo-no-print">
        <div style={ROW}>
          <button type="button" onClick={() => window.print()} style={TARGET}>
            {EXPORT_TEXT.print}
          </button>
          <button type="button" onClick={onClose} style={TARGET}>
            {EXPORT_TEXT.close}
          </button>
        </div>
      </div>
    </section>
  );
};
