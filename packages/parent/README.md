# @servo/parent

The adult's side of Servo: the account and child profiles, the progress view, the parts-list export and the name-the-part card game. It imports only `@servo/schema` and `@servo/app/store` (the package map), so it reaches content, and content's types, through the store. Nothing here asks the child to do anything. Phase 5 owns it: accounts 5.1, progress 5.2, export 5.3, card game 5.4. Task 0.4 owns this interface, typed in [src/index.ts](src/index.ts) with stubs that throw until their tasks land; task 5.1's has landed.

```ts
import { openStore } from '@servo/app/store';
import { progressOf } from '@servo/parent';
const store = await openStore();
const child = store.forProfile(profileId);
const progress = progressOf({ runs: await child.runs.list(), content: store.content, cardGames: await child.cardGames.list() });
```

## Public surface

| Name | Owner | What |
| --- | --- | --- |
| `mountParent(host, store)` | 5.1 | The parent view behind the parental gate: the profile list and switch, then progress, exports and the card game per child. The caller opens and closes the store. `mountParentWith(host, store, { random })` fixes the gate's questions for tests |
| `readAccounts`, `addChild`, `renameChild`, `switchChild`, `removeChild`, `nameOf`, `PARENT_TEXT` | 5.1 | The accounts model and the view's text (below) |
| `progressOf(input)` → `Progress` | 5.2 | The progress read model, a pure function of the records below |
| `partsListOf(blueprint, catalogue)` → `PartsList` | 5.3 | The printable parts list for one blueprint |
| `drawCards(content, seed)` | 5.4 | Ten Level 1–2 part types for one round of the card game |

The parent view runs as its own page of the web build, beside the child's app, because the app may not import parent. A parental gate on the way in keeps it out of a child's way (D28).

## Accounts and the profile switch (task 5.1)

In [src/accounts/](src/accounts/). There is no backend (D10), so there is no sign-up, password or server: the adult account is this device, and its children are the store's profiles, each an opaque UUID and a name the adult gives, with no email, no chat and nothing public.

- **The gate** ([gate.ts](src/accounts/gate.ts)). `mountParent` first asks a short sum ("What is 7 × 14?": one digit times a number in the teens). Until it is answered the view reads no profile and shows nothing of any child. A wrong answer gets a new question and one plain line. It keeps the view out of a young child's way; it is not a lock.
- **The model** ([model.ts](src/accounts/model.ts)), framework-free: `readAccounts(store)` gives the profiles, the child in use and that child's builds; `addChild`, `renameChild`, `switchChild` and `removeChild` make the changes. Names are tidied as the app tidies a build's name (runs of white space become one space, the ends are trimmed) and must then be 1 to 60 characters on one line; otherwise `NameRefused`.
- **The profile switch** is the store's profile in use on this device (`store.profiles.use(id)`, `store.profiles.inUse()`): the child whose builds the child's app opens, and whose builds the parent view shows. It is the only profile when the device has one; with several, it is the one the adult chose. Adding a child keeps the child in use, so a lone child's app keeps saving once a second child is added. The choice is kept in the page's localStorage under the database's name, never syncs, and is forgotten when that child is removed.
- **Isolation.** The view gives only the child in use a scope (`store.forProfile`), so it never asks the store for another child's records, and the store refuses another child's records in every scope anyway. The view has no routes and writes nothing to the address or the history, and no profile or build id reaches the page.
- **Removing a child** (D38) is confirmed inline, never in a dialog: Remove shows what goes (builds, runs and card-game results, which cannot be brought back), with Remove profile and Keep profile, and Escape keeps it. The store's `profiles.remove` deletes the records and also forgets what this device noted for the child outside the database: the builds the app's autosave journal holds (`servo.unsaved:` notes, review R-4.9 finding 12) and the choice of the child as the one in use.
- **Input paths** (ground rule 8). Every control is a native radio, button or text field, so a tap, a pointer and a keyboard (arrows move the switch, Enter submits, Escape cancels) do the same thing, and a screen reader reads the same list. Controls are at least 44 px. Changes run one at a time; anything refused is one plain line in a status region.
- **Text.** Every line is in `PARENT_TEXT` ([view.tsx](src/accounts/view.tsx)) for the copy pass: no exclamation marks, no praise. Profile names are child-entered text and stay on the screen: never in a URL, a log or a shared link (D21).

### Tests

`pnpm --filter @servo/parent test` runs both projects ([vitest.config.ts](vitest.config.ts)):

- **Unit, in Node on fake-indexeddb** ([test/accounts/](test/accounts/)): names; the gate's sums and answers; adding, renaming and switching; the switch showing only the chosen child's builds; switching refused for a child not on the device; every read and write of one child's builds, Runs and card games refused in another child's scope (negative tests); removal of a child with their records and journal notes, and no one else's; a store of another name never sharing the choice; a page with no localStorage.
- **Browser, in Chromium on real IndexedDB and localStorage** ([test/browser/](test/browser/)): the gate showing no child and reading no profile until answered; the switch by pointer, by touch (CDP touch events) and by keyboard, each showing only that child's builds and setting the child in use, with no id on the page and nothing written to the address or history; adding, renaming (Enter saves, Escape keeps) and a refused name as a line; removal confirmed inline, kept by Keep profile, and then removing the child's builds and journal notes but not Sam's or another database's.

### Decisions and open questions (task 5.1)

Taken conservatively, for Drew and the orchestrator:

1. The profile switch lives in the parent view, behind the gate, and is one choice: the child in use on this device is the child the parent view shows. There is no child-facing profile picker. Should a child be able to pick their own profile on Home instead, or should the parent view look at one child while another stays in use?
2. The gate is D28's default: one digit times a number in the teens. A child near 12 may answer it.
3. An app page already open keeps the child it opened with until it is opened again; the switch takes effect on the app's next opening.
4. With several children and none chosen (only reachable when a device's localStorage is cleared or blocked), the app builds unsaved with its line, as before; the parent view says no one is chosen.
5. The parent view lists the child-in-use's builds (name, level, date) as the base for the exports (task 5.3); progress (5.2) and the card game (5.4) add their sections beside it.
6. Interface changes outside this package (listed for review): `Profiles.inUse()` and `Profiles.use(id)` in `@servo/app/store`; `profiles.remove` also clears the child's journal notes and in-use choice (packages/app/src/store/device.ts); the app opens the profile in use (packages/app/src/index.ts).

## The progress read model (task 5.2)

Derived for one child whenever the view opens. Never stored, never shown to the child.

| Field | Read from | Rule |
| --- | --- | --- |
| Parts met | Run records' `blueprint` | Each part type in the blueprint of any of the child's Runs, from the first such Run |
| Unscripted builds passed | Run records with a `challenge` whose kind is `unscripted-build` (from `store.content`) and `goal.met` | The first passing Run per challenge, with its `runNumber`: the pass-rate measure counts a pass within 3 Runs |
| Faults fixed | Run records' `faults` and `fixed` | Per fault: the Run that fixed it, how many Runs it took, and the time from the first Run that showed it (the fault-fixing measure) |
| Time in the sandbox | Task 6.2's telemetry | Absent until that telemetry exists (D39) |
| Parts named | The store's card-game results | The latest round per child (D40) |

Each figure must reconcile to the run records (task 5.2's acceptance). Session start mode is a success measure Drew reads from telemetry, not a field of the parent view (D39).

## The parts-list export (task 5.3)

One line per part type, once, with its real name, family and quantity, then a wiring summary in plain words, and the `safetyNote` of any part that has one. The app's chassis mirrors its right-hand motor mount, so two motors wired alike drive forward (D23). A real kit does not, so the wiring summary must say which motor's leads to cross (D27).

## The card game (task 5.4)

A two-minute game the adult leads (D40). It shows ten cards drawn from the Level 1–2 parts, each a part's picture from the art registry in `store.content`, and the adult marks each named or not named. `child.cardGames.add(marks)` keeps the round; the latest round counts. The adult sees the result, and the child never sees a score.

## Privacy

- Every query goes through `store.forProfile(id)`, so no view shows one child another child's records.
- Removing a profile deletes its builds, runs and card-game results, after the adult confirms (D38).
- Profiles have no email and no public face. Nothing leaves the device unless sync is configured (D10, D13).
- The parent view explains in one screen what is stored (`docs/data-note.md`, task 6.2).
