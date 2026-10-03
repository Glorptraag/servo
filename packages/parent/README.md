# @servo/parent

The adult's side of Servo: the account and child profiles, the progress view, the parts-list export and the name-the-part card game. It imports only `@servo/schema` and `@servo/app/store` (the package map), so it reaches content, and content's types, through the store. Nothing here asks the child to do anything. Phase 5 owns it: accounts 5.1, progress 5.2, export 5.3, card game 5.4. Task 0.4 owns this interface, typed in [src/index.ts](src/index.ts) with stubs that throw until their tasks land; tasks 5.1 and 5.3 have landed. Its tests also read `@servo/content` (a dev dependency) for the kit fixtures; its source does not.

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
| `partsListOf(blueprint, catalogue)` → `PartsList`, `UnknownPart`, `LIST_TEXT`, `EXPORT_TEXT` | 5.3 | The printable parts list for one blueprint, and its text (below) |
| `drawCards(content, seed)` | 5.4 | Ten Level 1–2 part types for one round of the card game |

The parent view runs as its own page of the web build, beside the child's app, because the app may not import parent. A parental gate on the way in keeps it out of a child's way (D28).

## Accounts and the profile switch (task 5.1)

In [src/accounts/](src/accounts/). There is no backend (D10), so there is no sign-up, password or server: the adult account is this device, and its children are the store's profiles, each an opaque UUID and a name the adult gives, with no email, no chat and nothing public.

- **The gate** ([gate.ts](src/accounts/gate.ts)). `mountParent` first asks a short sum ("What is 7 × 14?": one digit times a number in the teens). Until it is answered the view reads no profile and shows nothing of any child. A wrong answer gets a new question and one plain line. Once the page is hidden (`visibilitychange`), the view closes, so when it is shown again the gate asks a new question (R-5.1 Q4). It keeps the view out of a young child's way; it is not a lock.
- **The model** ([model.ts](src/accounts/model.ts)), framework-free: `readAccounts(store)` gives the profiles, the child in use and that child's builds; `addChild`, `renameChild`, `switchChild` and `removeChild` make the changes. Names are tidied as the app tidies a build's name (runs of white space become one space, the ends are trimmed) and must then be 1 to 60 characters on one line; otherwise `NameRefused`.
- **The profile switch** is the store's profile in use on this device (`store.profiles.use(id)`, `store.profiles.inUse()`): the child whose builds the child's app opens, and whose builds the parent view shows. It is the only profile when the device has one; with several, it is the one the adult chose. Adding a child keeps the child in use, so a lone child's app keeps saving once a second child is added; a page that cannot keep the choice refuses a second child (`ChoiceNotKept`) rather than leave no one in use. An app page already open follows the switch: it saves what waits to the child who made it, then opens for the child in use now (packages/app/docs/store.md, "Following the profile switch"). The choice is kept in the page's localStorage under the database's name, never syncs, and is forgotten when that child is removed.
- **Isolation.** The view gives only the child in use a scope (`store.forProfile`), so it never asks the store for another child's records, and the store refuses another child's records in every scope anyway. The view has no routes and writes nothing to the address or the history, and no profile or build id reaches the page.
- **Removing a child** (D38) is confirmed inline, never in a dialog: Remove shows what goes (builds, runs and card-game results, which cannot be brought back), with Remove profile and Keep profile, and Escape keeps it. The group is described by that warning. Focus returns to the button that opened a rename or a removal, and after a removal it moves to the child in use. The store's `profiles.remove` deletes the records and also forgets what this device noted for the child outside the database: the builds the app's autosave journal holds (`servo.unsaved:` notes, review R-4.9 finding 12) and the choice of the child as the one in use.
- **Input paths** (ground rule 8). Every control is a native radio, button or text field, so a tap, a pointer and a keyboard (arrows move the switch, Enter submits, Escape cancels) do the same thing, and a screen reader reads the same list. Controls are at least 44 px. Changes run one at a time; anything refused is one plain line in a status region.
- **Shared links** (task 5.6, [packages/app/README.md](../app/README.md#shared-links)). Each of the child in use's builds has **Copy link**, behind the gate, in its row after 5.3's Parts list (through `PartsListExport`'s `actions` slot): `shareLinkFor(store, buildId, includeName)` reads the build through that child's scope alone (another child's build is refused, `ShareRefused`) and makes a read-only link with `shareLinkOf` from `@servo/app/store`. The link holds the build and nothing of any child. One checkbox, "Include the build's name in links", starts unticked every time the view opens (D21); unticked, the link says "Shared build". The link goes on the clipboard; where the device will not copy it (no permission, not a secure context), it shows in a read-only field, focused and selected, to copy by hand. Each is a native button, checkbox or field: pointer, touch, keyboard and screen reader alike.
- **Text.** Every line is in `PARENT_TEXT` ([view.tsx](src/accounts/view.tsx)) for the copy pass: no exclamation marks, no praise. Profile names are child-entered text and stay on the screen: never in a URL, a log or a shared link (D21).

### Tests

`pnpm --filter @servo/parent test` runs both projects ([vitest.config.ts](vitest.config.ts)):

- **Unit, in Node on fake-indexeddb** ([test/accounts/](test/accounts/)): names; the gate's sums and answers; adding, renaming and switching; the switch showing only the chosen child's builds; switching refused for a child not on the device; every read and write of one child's builds, Runs and card games refused in another child's scope (negative tests); removal of a child with their records and journal notes, and no one else's; a store of another name never sharing the choice; a page with no localStorage.
- **Shared links**: in Node ([test/accounts/share.test.ts](test/accounts/share.test.ts)), a link's payload, inflated by hand, holds no profile id or name and the build's name only when asked, and another child's build gets no link; in Chromium ([test/browser/share.test.tsx](test/browser/share.test.tsx)), Copy link is behind the gate, copies by pointer, touch and keyboard, the option starts unticked and is ticked by keyboard, a device that will not copy shows the link in a field, and the address never changes.
- **Browser, in Chromium on real IndexedDB and localStorage** ([test/browser/](test/browser/)): the gate showing no child and reading no profile until answered, and asked again after the page is hidden and shown; the switch by pointer, by touch (CDP touch events) and by keyboard, each showing only that child's builds and setting the child in use, with no id on the page and nothing written to the address or history; adding, renaming (Enter saves, Escape keeps) and a refused name as a line; removal confirmed inline, kept by Keep profile, and then removing the child's builds and journal notes but not Sam's or another database's; focus after each. Two pages ([follow.test.tsx](test/browser/follow.test.tsx)): the parent view here and the real child's app in a frame ([app-page.html](test/browser/app-page.html)). An edit made just before a switch is saved under the child who made it, the app follows to the new child and its edits are theirs, and an edit made just before that child is removed goes with them: no build lands under the wrong child.

### Decisions and open questions (task 5.1)

Taken conservatively, for Drew and the orchestrator:

1. The profile switch lives in the parent view, behind the gate, and is one choice: the child in use on this device is the child the parent view shows. There is no child-facing profile picker. Should a child be able to pick their own profile on Home instead, or should the parent view look at one child while another stays in use?
2. The gate is D28's default: one digit times a number in the teens. A child near 12 may answer it.
3. An app page already open follows the switch at once (R-5.1 finding 1). A build made while no one was in use is not kept when a child is then chosen: it was never any child's.
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

In [src/export/](src/export/). Every name, family, port label and note comes from the part records (ground rule 1): nothing in the export knows a part by its id.

- **The model** ([parts-list.ts](src/export/parts-list.ts)), pure: `partsListOf(blueprint, catalogue)`.
  - **Parts.** Each part type once, in `PART_FAMILIES` order and then by name, with how many the build uses.
  - **Wiring.** One line per wire, as a real kit makes it, in build order: mounts, mechanical linkages, power lines, then signal lines, each group sorted by its text. These are the page's only steps. A line names each end by the part's real name and the port's label, with the line's colour, for example `Power line (red): 2-cell battery pack, plus (+) to switch, side A`. When a build has more than one part of a type, each is told apart by the mount point it is fixed to (`DC motor (left motor mount)`), or else by a number in id order (`large wheel 1`). Placed-part ids never appear.
  - **Real-kit notes** (`realKit`). Explanations, never steps: which marked lines already cross which leads ("Do not swap them again"), why, what is left unconnected, an adult note, and what to do if the real robot drives backward.
  - **Safety notes.** Each part's `card.safetyNote`, once each.
  - **Unknown parts.** A blueprint that names a part type or port the catalogue does not have is refused with `UnknownPart` rather than listed short.
  - **Text.** Every line template is in `LIST_TEXT`; the view's own text is in `EXPORT_TEXT`.
- **Crossed leads (D27).** The connection lines cross a pair of leads where the real kit needs it to turn as the app does, and mark each such line `(crossed for a real kit)`:
  - a speed actuator that turns the other way when its supply is reversed (`whenReversed: 'reverses'`, a DC motor), when the app shows it as a mirror image (D23, composed through its hosts by `placeParts`) or a choice setting bound to its `reverse` has it turn backwards, but not both, since the two cancel;
  - a motor-driver channel with no signal wired, whose choice setting bound to `command` runs it backwards: its output leads are crossed. A channel set to stop has no lines to its outputs, and a note says so.

  A part on a mirrored mount whose turning does not hang on its leads, such as Circuit Crew's switch on the right inner motor mount, is wired as the app shows.
- **The view** ([view.tsx](src/export/view.tsx)). Behind the gate, each build of the child in use has a Parts list button, which loads that build through the child's own scope and opens its list in place, never in a dialog. Focus moves to the list's heading, and Close or Escape returns it to the button. The list has these parts, in order:
  - a table of parts (name, family, quantity);
  - the connections as a numbered list;
  - the real-kit notes as their own unnumbered list under "For a real kit";
  - the safety notes.

  A screen reader reads it in that order. Print calls the browser's print. While a list is open, a print stylesheet removes everything else and the list's buttons from the printed page, so no blank pages print. With no list open, the page prints as it is. Switching child closes the list. A build that cannot be loaded is one plain line.

### Tests

- **Unit** ([test/export/](test/export/)), on the live content and its fixtures:
  - every part type is listed once, with the name and family from its record and the build's quantity, in family order;
  - one connection line per wire, with only the DC motor on the right motor mount crossed;
  - real-kit notes that never ask for a lead to be crossed or swapped;
  - safety notes, once each;
  - no placed-part id, exclamation mark or banned phrase;
  - the same list whatever order the parts and wires come in;
  - unknown parts and ports refused.

  [kit-model.ts](test/export/kit-model.ts) holds two models. One reads the blueprint as the app runs it. The other walks the printed connection lines in order on a real kit, with mirrored mounts undone and no settings. The walk tests check these cases:
  - both kits drive both motors forward;
  - a DC motor set to Backward, crossed and turning as in the app;
  - the reversed-motor build set to Backward, forward with nothing crossed;
  - Backward on a mirrored mount, cancelling;
  - busy-workbench's motor driver on Backward;
  - a channel on Stop.

  In every case the real kit's motors turn as the app's do. One more test swaps the marked leads a second time and shows the walk catches the spin.
- **Browser** ([test/browser/export.test.tsx](test/browser/export.test.tsx)):
  - offered only behind the gate, and only for the child in use;
  - opened and closed by pointer, by touch (CDP touch events) and by keyboard (Enter, Space, Tab, Escape), with focus to the heading and back to the button;
  - the real-kit notes outside the numbered list;
  - Print calls the browser's print;
  - with print media emulated, only the list shows, without its buttons, and the rest takes no room;
  - the whole page prints again once the list is closed;
  - closed on a child switch;
  - a build that cannot be loaded gives one line.

### Decisions and open questions (task 5.3)

1. **The crossing on paper (R-5.3 Q1, default (b)).** The connection lines are the real kit's, with the crossed lines marked. The notes say the marked lines already swap the leads and must not be swapped again. They sit in their own unnumbered list after the connections.
2. **Settings that a real part does not have** are matched by crossing leads. A DC motor's Direction set to Backward crosses that motor; with a mirrored mount the two cancel. A motor-driver channel set to Backward crosses its outputs (R-5.3 Q3, default yes). A channel set to Stop has nothing connected to its outputs, with a note. When a signal is wired to a channel, its setting is ignored, as in the app.
3. **A servo motor on a mirrored mount is not mentioned** (R-5.3 Q2, default). Crossing its leads is no fix.
4. **Real motors' polarity is unconfirmed** (R-5.3 Q4, default). The last note reads: "If the real robot drives backward where the app's drives forward, swap the two leads of every DC motor." Confirm the convention once the real kit is chosen.
5. **Parts of one type** are told apart by mount point, or else by number in id order.
6. **The list shows the build's name**, which is child text. It reaches the screen and paper only, never a URL or a log (D21).
7. **Interface and changes outside src/export/:**
   - `PartsList` gains `realKit`, and `wiring` now holds connection lines only;
   - `src/index.ts` binds `partsListOf` and exports `UnknownPart`, `LIST_TEXT` and `EXPORT_TEXT`;
   - `src/accounts/view.tsx` lists builds through `PartsListExport`;
   - `test/contract.test.ts` no longer expects the 5.3 stub to throw;
   - `package.json` and `pnpm-lock.yaml` add `@servo/content` as a dev dependency, for the tests' fixtures only.

## The card game (task 5.4)

A two-minute game the adult leads (D40). It shows ten cards drawn from the Level 1–2 parts, each a part's picture from the art registry in `store.content`, and the adult marks each named or not named. `child.cardGames.add(marks)` keeps the round; the latest round counts. The adult sees the result, and the child never sees a score.

## Privacy

- Every query goes through `store.forProfile(id)`, so no view shows one child another child's records.
- Removing a profile deletes its builds, runs and card-game results, after the adult confirms (D38).
- Profiles have no email and no public face. Nothing leaves the device unless sync is configured (D10, D13).
- The parent view explains in one screen what is stored (`docs/data-note.md`, task 6.2).
