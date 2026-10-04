// The parent view's first screen (task 5.1): the parental gate (D28), then the children on this device with the
// profile switch, adding, renaming and removing a child, and the builds of the child in use, each with its parts list
// (task 5.3, ../export/) and a "Copy link" that shares it read-only with another adult (task 5.6, D21: the build's name
// only when ticked), then that child's progress (task 5.2, ../progress/) and the card game (task 5.4, ../card-game/).
// Every control is a native button, radio, checkbox or text field, so touch, pointer, keyboard and screen reader each have the same path. Nothing is a dialog: a
// removal is confirmed inline, and anything that goes wrong is one plain line. The view has no routes and writes nothing
// to the address, so no address can open one child's records, and no profile id reaches the page. The data note (task
// 6.2) closes the view.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, FormEvent, KeyboardEvent, RefObject } from 'react';
import type { Profile, ServoStore } from '@servo/app/store';
import { answers, gateQuestion } from './gate.ts';
import { ChoiceNotKept, NameRefused, addChild, readAccounts, removeChild, renameChild, shareLinkFor, switchChild } from './model.ts';
import type { Accounts } from './model.ts';
import { CardGameSection } from '../card-game/index.ts';
import { DataNote } from './data-note.tsx';
import { PartsListExport } from '../export/index.ts';
import { ProgressSection } from '../progress/index.ts';

/** Every line of system text, for the copy pass. None has an exclamation mark or praise (ground rule 7). */
export const PARENT_TEXT = {
  gateTitle: 'For adults',
  gateIntro: 'Answer this to open the parent view.',
  gateAnswer: 'Answer',
  gateContinue: 'Continue',
  gateWrong: 'That is not the answer. Here is another question.',
  title: 'Parent view',
  intro: 'The children who use Servo on this device. A profile has no email, no chat and nothing public.',
  children: 'Children',
  switchLegend: 'Who is using Servo on this device',
  noneInUse: 'No one is chosen, so builds are not being kept. Choose who is using Servo on this device.',
  rename: 'Rename',
  newName: 'New name',
  saveName: 'Save name',
  cancel: 'Cancel',
  remove: 'Remove',
  removeConfirm: 'Remove profile',
  keep: 'Keep profile',
  addLabel: 'Add a child',
  add: 'Add',
  builds: 'Builds',
  noBuilds: 'No builds yet.',
  shareIntro:
    'A link lets another adult watch a build on their own device. It cannot change the build, and never holds a child’s profile. The build’s name is included only if you tick the box below.',
  includeName: 'Include the build’s name in links',
  copyLink: 'Copy link',
  copied: 'Link copied.',
  copyByHand: 'This device did not copy the link. Copy it from the field.',
  link: 'Link',
  shareFailed: 'That build cannot be shared, so no link was made.',
  loading: 'Loading',
  noSwitch: 'This device cannot keep who is using Servo, so the switch did not change.',
  failed: 'That could not be done. Nothing was changed.',
} as const;

const removeWarning = (name: string): string =>
  `Remove ${name} from this device? Their builds, Runs, card-game results and events are deleted too, and cannot be brought back.`;

/** Big enough to tap. */
const TARGET: CSSProperties = { minHeight: 44, minWidth: 44, fontSize: '1rem' };
const ROW: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBlock: 8 };

const levelText = (level: number): string => `Level ${level}`;

const dateText = (at: string): string => {
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { dateStyle: 'medium' });
};

export interface ParentViewProps {
  readonly store: ServoStore;
  /** Where the gate's questions come from. Tests pass a fixed one. */
  readonly random: () => number;
}

export const ParentView = ({ store, random }: ParentViewProps) => {
  const [open, setOpen] = useState(false);
  // Whether the page has been hidden: when the gate asks again, focus goes to its field, never to the page's body.
  const [closed, setClosed] = useState(false);
  // A parent page left open must not let a child in later (R-5.1 Q4): once the page is hidden, the view closes, and
  // when it is shown again the gate asks a new question.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== 'hidden') return;
      setOpen(false);
      setClosed(true);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);
  return open ? <AccountsView store={store} /> : <Gate random={random} focus={closed} onPass={() => setOpen(true)} />;
};

interface GateProps {
  readonly random: () => number;
  /** Focus the answer field as the gate shows: it has just taken the place of the view, which held the focus. */
  readonly focus: boolean;
  readonly onPass: () => void;
}

const Gate = ({ random, focus, onPass }: GateProps) => {
  const field = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    if (focus) field.current?.focus();
  }, [focus]);
  const [question, setQuestion] = useState(() => gateQuestion(random));
  const [text, setText] = useState('');
  const [wrong, setWrong] = useState(false);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (answers(question, text)) {
      onPass();
      return;
    }
    setQuestion(gateQuestion(random));
    setText('');
    setWrong(true);
  };
  return (
    <main aria-labelledby="servo-parent-gate">
      <h1 id="servo-parent-gate">{PARENT_TEXT.gateTitle}</h1>
      <p>{PARENT_TEXT.gateIntro}</p>
      <form onSubmit={submit} className="servo-parent-row" style={ROW}>
        <label>
          {question.text} <span>{PARENT_TEXT.gateAnswer}</span>{' '}
          <input
            ref={field}
            value={text}
            onChange={(event) => setText(event.target.value)}
            inputMode="numeric"
            autoComplete="off"
            style={TARGET}
          />
        </label>
        <button type="submit" style={TARGET}>
          {PARENT_TEXT.gateContinue}
        </button>
      </form>
      <p role="status">{wrong ? PARENT_TEXT.gateWrong : ''}</p>
    </main>
  );
};

type Editing = { readonly kind: 'rename' | 'remove'; readonly profile: Profile } | undefined;

const lineFor = (error: unknown): string => (error instanceof NameRefused || error instanceof ChoiceNotKept ? error.message : PARENT_TEXT.failed);

const AccountsView = ({ store }: { readonly store: ServoStore }) => {
  const [accounts, setAccounts] = useState<Accounts | undefined>(undefined);
  const [editing, setEditing] = useState<Editing>(undefined);
  const [line, setLine] = useState('');
  // D21: off each time the view opens.
  const [includeName, setIncludeName] = useState(false);
  const [shown, setShown] = useState<{ readonly id: string; readonly url: string } | undefined>(undefined);
  // Each card-game round kept reads progress again, so it shows the latest round.
  const [rounds, setRounds] = useState(0);
  // While a card-game round is on, from Start to its closing line, the round has the page to itself: the child is
  // watching, so no count, verdict or part name may be on screen (R-6.4 PAR-1, D40).
  const [inRound, setInRound] = useState(false);
  const live = useRef(true);
  // The gate's Continue, which held the focus, is gone: focus goes to the loading line, then to the view's title.
  const loadingRef = useRef<HTMLParagraphElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const loaded = accounts !== undefined;
  useLayoutEffect(() => {
    (loaded ? titleRef : loadingRef).current?.focus();
  }, [loaded]);
  const switchRef = useRef<HTMLFieldSetElement>(null);
  const addRef = useRef<HTMLInputElement>(null);
  // After a removal the focused row is gone: focus moves to the child in use, or the first child, or adding one. It
  // moves in the same commit that takes the row away, so it never rests on the page's body (R-6.4 PAR-2).
  const removing = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    const gone = removing.current;
    if (gone === undefined || accounts?.profiles.some((profile) => profile.id === gone)) return;
    removing.current = undefined;
    const active = document.activeElement;
    if (active !== null && active !== document.body) return;
    const radios = switchRef.current?.querySelectorAll<HTMLInputElement>('input[type="radio"]');
    const target = [...(radios ?? [])].find((radio) => radio.checked) ?? radios?.[0] ?? addRef.current;
    target?.focus();
  }, [accounts]);

  const refresh = useCallback(async () => {
    const next = await readAccounts(store);
    if (live.current) setAccounts(next);
  }, [store]);

  useEffect(() => {
    live.current = true;
    refresh().catch(() => {
      if (live.current) setLine(PARENT_TEXT.failed);
    });
    return () => {
      live.current = false;
    };
  }, [refresh]);

  /**
   * Runs changes one after another, each followed by a fresh read, so the screen is always what the store holds.
   * Controls stay enabled meanwhile, so focus stays where the adult left it.
   */
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const act = (change: () => Promise<unknown>, failure: (error: unknown) => string = lineFor): Promise<boolean> => {
    const run = chain.current.then(async () => {
      if (live.current) setLine('');
      let done = true;
      try {
        await change();
      } catch (error) {
        done = false;
        if (live.current) setLine(failure(error));
      }
      await refresh().catch(() => undefined);
      return done;
    });
    chain.current = run;
    return run;
  };

  /** Makes the link and puts it on the clipboard; where the device will not, shows it in a field to copy by hand. */
  const copyLink = async (id: string): Promise<void> => {
    setLine('');
    setShown(undefined);
    let url: string;
    try {
      url = await shareLinkFor(store, id, includeName);
    } catch {
      if (live.current) setLine(PARENT_TEXT.shareFailed);
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      if (live.current) setLine(PARENT_TEXT.copied);
    } catch {
      if (!live.current) return;
      setShown({ id, url });
      setLine(PARENT_TEXT.copyByHand);
    }
  };

  if (!accounts)
    return (
      <p ref={loadingRef} role="status" tabIndex={-1}>
        {PARENT_TEXT.loading}
      </p>
    );
  const { profiles, current, builds } = accounts;

  return (
    <main aria-labelledby="servo-parent-title">
      <h1 id="servo-parent-title" ref={titleRef} tabIndex={-1}>
        {PARENT_TEXT.title}
      </h1>
      <p hidden={inRound}>{PARENT_TEXT.intro}</p>

      <section aria-labelledby="servo-parent-children" hidden={inRound}>
        <h2 id="servo-parent-children">{PARENT_TEXT.children}</h2>
        {profiles.length > 0 && (
          <fieldset ref={switchRef}>
            <legend>{PARENT_TEXT.switchLegend}</legend>
            {!current && <p>{PARENT_TEXT.noneInUse}</p>}
            {profiles.map((profile, index) => (
              <ChildRow
                key={profile.id}
                index={index}
                profile={profile}
                inUse={profile.id === current?.id}
                editing={editing?.profile.id === profile.id ? editing.kind : undefined}
                onSwitch={() => void act(() => switchChild(store, profile.id), () => PARENT_TEXT.noSwitch)}
                onEdit={(kind) => setEditing(kind ? { kind, profile } : undefined)}
                onRename={(name) =>
                  void act(() => renameChild(store, profile.id, name)).then((done) => {
                    if (done) setEditing(undefined);
                  })
                }
                onRemove={() => {
                  setEditing(undefined);
                  removing.current = profile.id;
                  void act(() => removeChild(store, profile.id)).then((done) => {
                    if (!done) removing.current = undefined;
                  });
                }}
              />
            ))}
          </fieldset>
        )}
        <AddChild inputRef={addRef} onAdd={(name) => act(() => addChild(store, name))} />
      </section>

      {current && (
        <section aria-labelledby="servo-parent-builds" hidden={inRound}>
          <h2 id="servo-parent-builds">
            {PARENT_TEXT.builds}: {current.name}
          </h2>
          {builds.length === 0 ? (
            <p>{PARENT_TEXT.noBuilds}</p>
          ) : (
            <>
              <p>{PARENT_TEXT.shareIntro}</p>
              <label className="servo-parent-row" style={ROW}>
                <input type="checkbox" checked={includeName} onChange={(event) => setIncludeName(event.target.checked)} style={TARGET} />
                {PARENT_TEXT.includeName}
              </label>
              <PartsListExport
                key={current.id}
                store={store}
                profile={current.id}
                builds={builds}
                describe={(build) => `${build.name}, ${levelText(build.level)}, ${dateText(build.updatedAt)}`}
                actions={(build) => (
                  <>
                    <button type="button" aria-label={`${PARENT_TEXT.copyLink}: ${build.name}`} onClick={() => void copyLink(build.id)} style={TARGET}>
                      {PARENT_TEXT.copyLink}
                    </button>
                    {shown?.id === build.id && (
                      <label className="servo-parent-row" style={{ ...ROW, marginBlock: 0 }}>
                        {PARENT_TEXT.link}{' '}
                        <input readOnly value={shown.url} autoFocus onFocus={(event) => event.target.select()} style={TARGET} />
                      </label>
                    )}
                  </>
                )}
              />
            </>
          )}
        </section>
      )}

      {current && (
        <div hidden={inRound}>
          <ProgressSection key={`${current.id} ${rounds}`} store={store} profile={current.id} name={current.name} />
        </div>
      )}

      {current && (
        <CardGameSection
          key={current.id}
          store={store}
          profile={current.id}
          name={current.name}
          onKept={() => setRounds((count) => count + 1)}
          onActive={setInRound}
        />
      )}

      <DataNote hidden={inRound} />

      <p role="status">{line}</p>
    </main>
  );
};

interface ChildRowProps {
  readonly index: number;
  readonly profile: Profile;
  readonly inUse: boolean;
  readonly editing: 'rename' | 'remove' | undefined;
  readonly onSwitch: () => void;
  readonly onEdit: (kind: 'rename' | 'remove' | undefined) => void;
  readonly onRename: (name: string) => void;
  readonly onRemove: () => void;
}

const ChildRow = ({ index, profile, inUse, editing, onSwitch, onEdit, onRename, onRemove }: ChildRowProps) => {
  const [name, setName] = useState(profile.name);
  const inputId = `servo-parent-name-${index}`;
  const warningId = `servo-parent-remove-${index}`;
  const renameButton = useRef<HTMLButtonElement>(null);
  const removeButton = useRef<HTMLButtonElement>(null);
  // When a rename or a removal ends without the row going, focus goes back to the button that started it.
  const was = useRef(editing);
  useLayoutEffect(() => {
    if (was.current === 'rename' && editing === undefined) renameButton.current?.focus();
    if (was.current === 'remove' && editing === undefined) removeButton.current?.focus();
    was.current = editing;
  }, [editing]);
  const rename = (event: FormEvent) => {
    event.preventDefault();
    onRename(name);
  };
  const escape = (event: KeyboardEvent) => {
    if (event.key === 'Escape') onEdit(undefined);
  };

  return (
    <div className="servo-parent-row" style={ROW}>
      <label className="servo-parent-row" style={{ ...ROW, marginBlock: 0 }}>
        <input type="radio" name="servo-parent-in-use" checked={inUse} onChange={onSwitch} style={TARGET} />
        {profile.name}
      </label>
      {editing === 'rename' ? (
        <form onSubmit={rename} onKeyDown={escape} className="servo-parent-row" style={{ ...ROW, marginBlock: 0 }}>
          <label htmlFor={inputId}>{PARENT_TEXT.newName}</label>
          <input id={inputId} value={name} onChange={(event) => setName(event.target.value)} autoFocus autoComplete="off" style={TARGET} />
          <button type="submit" style={TARGET}>
            {PARENT_TEXT.saveName}
          </button>
          <button type="button" onClick={() => onEdit(undefined)} style={TARGET}>
            {PARENT_TEXT.cancel}
          </button>
        </form>
      ) : editing === 'remove' ? (
        <div
          role="group"
          aria-label={`${PARENT_TEXT.remove} ${profile.name}`}
          aria-describedby={warningId}
          onKeyDown={escape}
          className="servo-parent-row" style={{ ...ROW, marginBlock: 0 }}
        >
          <p id={warningId}>{removeWarning(profile.name)}</p>
          <button type="button" onClick={onRemove} style={TARGET}>
            {PARENT_TEXT.removeConfirm}
          </button>
          <button type="button" onClick={() => onEdit(undefined)} autoFocus style={TARGET}>
            {PARENT_TEXT.keep}
          </button>
        </div>
      ) : (
        <>
          <button
            ref={renameButton}
            type="button"
            aria-label={`${PARENT_TEXT.rename} ${profile.name}`}
            onClick={() => {
              setName(profile.name);
              onEdit('rename');
            }}
            style={TARGET}
          >
            {PARENT_TEXT.rename}
          </button>
          <button ref={removeButton} type="button" aria-label={`${PARENT_TEXT.remove} ${profile.name}`} onClick={() => onEdit('remove')} style={TARGET}>
            {PARENT_TEXT.remove}
          </button>
        </>
      )}
    </div>
  );
};

interface AddChildProps {
  readonly inputRef: RefObject<HTMLInputElement | null>;
  readonly onAdd: (name: string) => Promise<boolean>;
}

const AddChild = ({ inputRef, onAdd }: AddChildProps) => {
  const [name, setName] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void onAdd(name).then((done) => {
      if (done) setName('');
    });
  };
  return (
    <form onSubmit={submit} className="servo-parent-row" style={ROW}>
      <label htmlFor="servo-parent-add">{PARENT_TEXT.addLabel}</label>
      <input ref={inputRef} id="servo-parent-add" value={name} onChange={(event) => setName(event.target.value)} autoComplete="off" style={TARGET} />
      <button type="submit" style={TARGET}>
        {PARENT_TEXT.add}
      </button>
    </form>
  );
};
