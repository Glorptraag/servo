// The shell with the real Save and autosave, on a real store named in the address (?store=<name>), opening as the app
// does: builds a page left unsaved are saved first (the journal), then the one profile's newest build opens. The canvas
// is the stand-in, since the real one refuses edits until task 3.2, so the page offers the edit a test needs:
// `servoTest.rename(name)`. store.test.tsx edits through it, then reloads or closes the page at once.
import { createRoot } from 'react-dom/client';
import { Autosaver, SaveControl, Shell, recoverUnsaved } from '../../src/shell/index.ts';
import { openStore } from '../../src/store/index.ts';
import { StandInCanvas } from './stand-in.ts';

declare global {
  interface Window {
    servoTest?: { readonly rename: (name: string) => void };
  }
}

const host = document.getElementById('app');
const name = new URLSearchParams(location.search).get('store');
if (!host || !name) throw new Error('The save test page needs an element with the id "app" and ?store=<database name>.');

const store = await openStore({ name });
const journal = { storage: localStorage, scope: name };
await recoverUnsaved(store, journal);
const [profile] = await store.profiles.list();
if (!profile) throw new Error('The save test page needs a profile in the store.');
const child = store.forProfile(profile.id);
const [newest] = await child.blueprints.list();
const loaded = newest ? await child.blueprints.load(newest.id) : undefined;
if (!loaded?.ok) throw new Error('The save test page needs a build that loads.');

const canvas = new StandInCanvas();
const saving = new Autosaver(journal);
window.servoTest = {
  rename: (next) => {
    const done = canvas.apply({ kind: 'rename', name: next });
    if (!done.ok) throw new Error(done.refusal.message);
  },
};
createRoot(host).render(
  <Shell
    content={store.content}
    level={1}
    storage={null}
    slots={{ save: <SaveControl saving={saving} /> }}
    mountCanvas={() => canvas}
    child={child}
    start={loaded.blueprint}
  />,
);
