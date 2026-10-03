// The Parts Library (brief Section 9, task 4.2): the tray's Library button opens the whole catalogue as a large
// overlay, on one shelf per family, with a family filter and a domain filter. Before Level 3 the library is
// browse-only (brief Section 9): its cards are pictures and words, with nothing to drag or place. Pulling a part from
// the library onto the canvas is a Level 3 feature, so it is not built here (ground rule 10).
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Domain, PartFamily } from '@servo/schema';
import { useShell } from '../shell/index.ts';
import { TilePicture } from '../tray/picture.tsx';
import { ALL, NO_FILTER, domainLabel, domainOptions, familyOptions, libraryShelves } from './catalogue.ts';
import type { FilterOption, LibraryFilter } from './catalogue.ts';
import './library.css';

export const LIBRARY_TITLE = 'Parts Library';

export interface LibraryProps {
  /** False closes the overlay and keeps it closed: in Run mode, or while the tray is tucked. */
  readonly available: boolean;
}

/** The Library button, and the overlay it opens. */
export const Library = ({ available }: LibraryProps) => {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);
  useEffect(() => {
    if (!available) setOpen(false);
  }, [available]);
  // Focus goes back to the Library button once the overlay is gone, never to the page.
  useEffect(() => {
    if (open || !refocus.current) return;
    refocus.current = false;
    button.current?.focus();
  }, [open]);
  const close = (): void => {
    refocus.current = true;
    setOpen(false);
  };
  return (
    <>
      <button ref={button} type="button" className="shell-button tray-library" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        Library
      </button>
      {open ? <LibraryOverlay onClose={close} /> : null}
    </>
  );
};

interface ChoiceProps<T extends string> {
  readonly legend: string;
  readonly allLabel: string;
  readonly options: readonly FilterOption<T>[];
  readonly value: T | typeof ALL;
  readonly onChange: (value: T | typeof ALL) => void;
}

/** One filter: native radio buttons drawn as chips, so the keyboard and screen readers get a radio group. */
const Choice = <T extends string>({ legend, allLabel, options, value, onChange }: ChoiceProps<T>) => {
  const name = useId();
  const all: FilterOption<T | typeof ALL> = { id: ALL, label: allLabel };
  return (
    <fieldset className="library-filter">
      <legend>{legend}</legend>
      {[all, ...options].map((option) => (
        <label key={option.id} className="library-chip">
          <input type="radio" name={name} value={option.id} checked={value === option.id} onChange={() => onChange(option.id)} />
          <span>{option.label}</span>
        </label>
      ))}
    </fieldset>
  );
};

const partsCount = (count: number): string => (count === 1 ? '1 part' : `${count} parts`);

export const LibraryOverlay = ({ onClose }: { readonly onClose: () => void }) => {
  const { content } = useShell();
  const ref = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const [filter, setFilter] = useState<LibraryFilter>(NO_FILTER);
  const families = useMemo(() => familyOptions(content.parts), [content]);
  const domains = useMemo(() => domainOptions(content.parts), [content]);
  const shelves = useMemo(() => libraryShelves(content.parts, filter, content.art), [content, filter]);
  const count = shelves.reduce((sum, shelf) => sum + shelf.cards.length, 0);
  const closing = useRef(onClose);
  closing.current = onClose;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    dialog.showModal();
    // Escape closes it the same way as Close, whether or not the browser then fires `close`.
    const cancelled = (event: Event): void => {
      event.preventDefault();
      closing.current();
    };
    const closed = (): void => closing.current();
    dialog.addEventListener('cancel', cancelled);
    dialog.addEventListener('close', closed);
    return () => {
      dialog.removeEventListener('cancel', cancelled);
      dialog.removeEventListener('close', closed);
      dialog.close();
    };
  }, []);

  return (
    <dialog ref={ref} className="library" aria-labelledby={headingId}>
      <header className="library-head">
        <h2 id={headingId}>{LIBRARY_TITLE}</h2>
        <button type="button" className="shell-button" onClick={() => closing.current()}>
          Close
        </button>
      </header>
      <div className="library-filters">
        <Choice<PartFamily>
          legend="Family"
          allLabel="All families"
          options={families}
          value={filter.family}
          onChange={(family) => setFilter((current) => ({ ...current, family }))}
        />
        <Choice<Domain>
          legend="Domain"
          allLabel="All domains"
          options={domains}
          value={filter.domain}
          onChange={(domain) => setFilter((current) => ({ ...current, domain }))}
        />
      </div>
      <p className="library-count" role="status">
        {count > 0 ? partsCount(count) : 'No parts in this family and domain'}
      </p>
      <div className="library-shelves">
        {shelves.map((shelf) => (
          <section key={shelf.family} className="library-shelf" aria-labelledby={`${headingId}-${shelf.family}`} data-family={shelf.family}>
            <h3 id={`${headingId}-${shelf.family}`}>{shelf.label}</h3>
            <ul>
              {shelf.cards.map((card) => (
                <li key={card.part} className="library-card" data-part={card.part}>
                  <TilePicture tile={card} />
                  <span className="library-name">{card.title}</span>
                  <span className="library-about">{card.domains.map(domainLabel).join(', ')}</span>
                  <span className="library-about">{`Level ${card.level}`}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </dialog>
  );
};
