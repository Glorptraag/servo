# @servo/parent

The adult's side of Servo: the account and child profiles, the progress view, the parts-list export and the name-the-part card game. It imports only `@servo/schema` and `@servo/app/store` (the package map), so it reaches content, and content's types, through the store. Nothing here asks the child to do anything. Phase 5 owns it: accounts 5.1, progress 5.2, export 5.3, card game 5.4. Task 0.4 owns this interface, typed in [src/index.ts](src/index.ts) with stubs that throw until their tasks land; all four have landed. Its tests also read `@servo/content` (a dev dependency) for the kit fixtures; its source does not.

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
| `progressOf(input)` → `Progress`, `readProgress(store, profile)`, `PROGRESS_TEXT` | 5.2 | The progress read model, a pure function of the records below; reading it for one child through the store; the view's text |
| `partsListOf(blueprint, catalogue)` → `PartsList`, `UnknownPart`, `LIST_TEXT`, `EXPORT_TEXT` | 5.3 | The printable parts list for one blueprint, and its text (below) |
| `drawCards(content, seed)`, `DECK_SIZE`, `CARD_GAME_TEXT` | 5.4 | Ten Level 1–2 part types for one round of the card game, in the order to show them; the game's text (below) |

The parent view runs as its own page of the web build, beside the child's app, because the app may not import parent. A parental gate on the way in keeps it out of a child's way (D28). Home's "For adults" link opens it (D91, below).

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

## Progress (task 5.2)

In [src/progress/](src/progress/). One child's figures, derived from their run records and card-game rounds each time the view opens: never stored, never shown to the child, and nothing for the child to do (brief Section 7).

- **The model** ([model.ts](src/progress/model.ts)), pure: `progressOf({ runs, content, cardGames })`. Every figure names the records it came from (run ids and `startedAt` times), so it can be checked against them.

| Figure | Read from | Rule |
| --- | --- | --- |
| Parts met | Each Run's `blueprint` | Each part type in the blueprint of any Run, once, from the first Run that had it, in the order met |
| Unscripted builds passed | Runs with a `challenge` whose kind in `store.content` is `unscripted-build`, and `goal.met` | The first passing Run per challenge, with its `runNumber` (the pass-rate measure counts a pass within 3 Runs) |
| Faults fixed | Each Run's `faults`, `ticks` and `blueprint`, in its series | Below. Per fault: the Run that fixed it, the Runs from the first showing to the fix (both counted) and the time between their `startedAt` |
| Time in the sandbox | Task 6.2's telemetry | Absent until that telemetry exists (D39); the view says "Not measured yet." |
| Parts named | The card-game rounds | The latest round (D40): the one played last, of two at one moment the later in the list |

- **Runs left out.** A Run of 0 ticks counts in no figure. The app keeps none (task 4.4), but an older store may hold one, and it showed nothing.
- **Series.** A Run belongs to its challenge's Runs, or to its build's Runs in the sandbox: the series the app numbers it in (`runNumber`) and links it to for `fixed`. A challenge's series spans the builds it was started from.
- **Faults fixed** (D31, with the defaults of D75, D76 and D96). A fault is a failure mode on one placed part. In each series, oldest Run first:
  1. A Run that shows the fault opens it, or keeps it open. Time-to-fix starts at the first Run that showed it. The latest Run that showed it gives the build a fix is compared with and the tick it showed at (`firstTick`).
  2. A later Run that does not show it and whose `ticks` run past that tick settles it (D96). A Run that stopped at or before that tick settles nothing.
  3. Settled, it counts as fixed only when that Run's build differs from the latest showing build on the faulted part (added, removed, another type, a setting changed) or on a wire on one of its ports (D75). A move is no change. A change to any other part, such as the battery pack that fed it, does not count (D76). Otherwise it went with no fix and is not counted.
  4. Once settled, a later showing is a new fault.

  `differsOn` reads a change exactly as sim-core's `fixed` does (packages/sim-core/src/recorder/changes.ts), and the tests check the two agree on every pair. The model reads `faults` rather than `fixed` because `fixed` looks back one Run only: it would count a Run that stopped before the fault's tick, and miss the fix after it. A `fixed` entry whose earlier Run is not among the child's records is not counted, since its tick cannot be checked.
- **Reading it** ([load.ts](src/progress/load.ts)): `readProgress(store, profile)` reads the child's Runs and rounds through `store.forProfile(profile)` only, and gives nothing for a profile not on the device. Runs a sync left behind for a profile removed elsewhere (R-5.5) show under no one: the scope reads only that profile's rows, and a record whose own `profile` names another is left out too.
- **The view** ([view.tsx](src/progress/view.tsx)). Behind the gate, after the builds, a "Progress: name" section for the child in use only, remounted when the switch changes child and read again whenever the gate opens the view (so after the page was hidden). Headings with the counts, then plain lists: each part met by its real name and the date; each unscripted pass by the challenge's title, its Run number and date; each fixed fault by the part's real name, its spec card's line for that fault, and "Fixed in n Runs and time". It has nothing to press, so touch, pointer, keyboard and screen reader meet the same headings and lists; the profile switch beside it is 5.1's. No id, score, praise or exclamation mark; every line is in `PROGRESS_TEXT`.

### The parent page (D91)

- **The page.** `packages/app/parent.html` is the web build's second page (`vite.config.ts` lists both as inputs). Its module script imports [src/page/main.ts](src/page/main.ts), which opens the store and mounts the parent view; where the device keeps no store it shows one line. A "Back to Servo" link returns to the app.
- **The link.** Home's named spot (packages/app/src/challenges/home.tsx) holds a plain "For adults" link to `parent.html`, passed in by App.tsx. The app imports nothing of parent: the page is reached only by the link, and its gate asks first (D28), and again after the page is hidden (5.1).
- **Offline.** The service worker opens a navigation to `parent.html` on its own cached page, and every other page on `index.html` as before; the cache's version hashes both pages' text.

### Tests

- **Unit** ([test/progress/](test/progress/)):
  - [fixtures.test.ts](test/progress/fixtures.test.ts), the acceptance: every content fixture is run through sim-core as the app records it, alone, then followed by a Run with each faulted part taken out; every fixture is then run in turn as one child; and the schema's stored run record is read. [reconcile.ts](test/progress/reconcile.ts) holds every figure up against the records, without the model's code, and checks each fix sim-core's `fixed` states between two Runs in a row is counted.
  - [model.test.ts](test/progress/model.test.ts): each rule on hand-written records (a fault fixed; gone with no change; a change to another part; a move; a short Run, then a long one; a fault shown again; a fault settled then shown again; series kept apart), 0-tick Runs, order, unscripted passes, the latest round, and a real pass of cross and stop judged by the app's goal judge.
  - [load.test.ts](test/progress/load.test.ts): on fake-indexeddb, one child's figures and none of another's; no figures for a profile not on the device; a record naming another profile left out.
- **Browser** ([test/browser/progress.test.tsx](test/browser/progress.test.tsx)): nothing before the gate; only the child in use, with no id and no exclamation mark; the switch followed by pointer, touch and keyboard; read again after the page is hidden and the gate answered.
- **In packages/app**: Home's link ([challenges.test.tsx](../app/test/browser/challenges.test.tsx)); the worker's pages ([test/offline/pages.test.ts](../app/test/offline/pages.test.ts)); and the built app offline opening `parent.html` at its gate ([offline.test.ts](../app/test/browser/offline.test.ts)).

### Decisions and open questions (task 5.2)

1. **D96's tick.** A later Run settles a fault only when its `ticks` are past (`>`) the tick the fault showed at in the latest Run that showed it.
2. **A fault that went with no change** to its part is not counted, and is settled; if it shows again, it is a new fault.
3. **Time-to-fix** runs from the first showing Run's `startedAt` to the fixing Run's `startedAt`. Every figure's time is a Run's `startedAt`.
4. **Time in the sandbox** stays absent (D39), though sandbox Runs' `startedAt` and `endedAt` could give a lower bound (R-4.5 suggests it). Should the view show that before task 6.2?
5. **Breakdowns' named faults** (D48, `namedFaultsShown`) are not marked apart: a breakdown's fix is counted like any other fault.
6. **The tester invite gate** (task 6.3) guards `index.html` only. `parent.html` cannot use it, since parent may import only `@servo/app/store`. Should the parent page ask for the invite code too?
7. **Changes outside src/progress/:** `src/index.ts` binds `progressOf` and exports `readProgress` and `PROGRESS_TEXT`, with the `FaultFixed` comments brought up to the rule; `src/accounts/view.tsx` adds the section; `src/page/main.ts` is new; `test/contract.test.ts`; `package.json` and `pnpm-lock.yaml` add `@servo/sim-core` as a dev dependency, for the tests' Runs only. In packages/app: `parent.html`, `vite.config.ts`, App.tsx's Home link, `CHALLENGE_TEXT.forAdults` and `PARENT_PAGE`, one CSS rule, the service worker's page choice and the offline plugin's version hash.

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

The Level 2 check of brief Section 14: a child at the end of Level 2 names 8 of 10 kit parts from a picture, in a two-minute game an adult leads (D40). In [src/card-game/](src/card-game/).

- **The deck** ([deck.ts](src/card-game/deck.ts)), pure: `drawCards(content, seed)` takes the part records whose `identity.level` is 1 or 2, in id order, shuffles them with a seeded generator and deals ten, no repeats. The same content and seed give the same deck. With fewer than ten such parts it deals them all; with none, none. Nothing knows a part by its id (ground rule 1). The view seeds each round from `crypto.getRandomValues`.
- **The pictures** ([picture.tsx](src/card-game/picture.tsx)) come from `store.content.art` by the record's art key, as the spec card's do; with no picture there yet, a vector placeholder drawn from the record's colours and proportions (ground rule 12).
- **A round** ([view.tsx](src/card-game/view.tsx)). Behind the gate, a "Card game: name" section for the child in use, after progress. Start a round shows "Card 1 of 10" and the picture. The part's name is hidden until the adult presses Show the name (a disclosure button, `aria-expanded`), so a child who reads cannot read the answer off the screen. The adult marks Named or Not named, and the next card follows. After the tenth mark the round is kept through the child's own scope, `store.forProfile(id).cardGames.add(marks)`, in the order shown. The adult then sees a plain summary: "n of 10 parts named." and each part's real name, named or not named. Progress (5.2) is read again, so it shows the latest round, which is the one that counts (D40).
- **Nothing kept part way.** Stop the round, a child switch, or the page being hidden (the gate closes the view) drops a round under way, and nothing is stored. A round the store refuses is one plain line, with Try keeping it again.
- **Rule 7.** No score, points, praise, streak or exclamation mark; the child sees only pictures and "Card n of 10". The summary is for the adult. Every line is in `CARD_GAME_TEXT`.
- **Input paths** (ground rule 8). Every control is a native button of at least 44 px, so a tap, a pointer, a keyboard (Tab, Enter, Space) and a screen reader take the same path. Focus moves to each card's heading as it is shown, to the summary's heading when the round is kept, and back to Start a round when one is stopped. Nothing is a dialog (ground rule 9).
- **Records.** No new store table: rounds are `CardGameResult`s in the store's `cardGames` table (packages/app/docs/store.md). Removing a child removes their rounds (5.1, D38).

### Tests

- **Unit** ([test/card-game/deck.test.ts](test/card-game/deck.test.ts)), on the live content: ten distinct Level 1–2 parts for 50 seeds; the same seed the same deck, different seeds shuffled, every Level 1–2 part drawn over many rounds; a Level 3 part never drawn; fewer than ten parts, and none; odd seeds. On fake-indexeddb: a round kept for one child alone, the latest read by `progressOf`, and gone when the child is removed.
- **Browser** ([test/browser/card-game.test.tsx](test/browser/card-game.test.tsx)), in Chromium: nothing before the gate, and only the child in use; a whole round marked by pointer, touch (CDP touch events) and keyboard (Enter and Space), with each name hidden until shown, focus on each card's heading, the stored marks matching the cards shown, all Level 1–2, nothing kept for the other child, progress updated, and no id or exclamation mark on the page; a stopped round and a round left by a child switch keep nothing.

### Decisions and open questions (task 5.4)

1. **Which parts.** Every part record introduced at Level 1 or 2 (14 today, ten dealt), as D40 and the task say. The brief says "kit parts": should the deck be only the parts in the Level 1–2 kits, or only parts the child has met?
2. **No timer.** "Two minutes" is how long a round takes, not a clock on the screen: a visible countdown would press the child. Should there be one?
3. **The name is hidden until shown**, so the check is not given away to a child who reads. Should the adult's name line show at once instead?
4. **A round stopped part way keeps nothing**: a partial round is not the check's ten cards. Should it be kept?
5. **The summary shows at once on the same screen**, after the tenth card. A child looking on can see it; it is a plain line with no praise. Should it sit behind a further press?
6. **Changes outside src/card-game/:** `src/index.ts` binds `drawCards` and exports `DECK_SIZE` and `CARD_GAME_TEXT`; `src/accounts/view.tsx` adds the section and reads progress again after each round; `test/contract.test.ts` no longer expects the 5.4 stub to throw.

## Privacy

- Every query goes through `store.forProfile(id)`, so no view shows one child another child's records.
- Removing a profile deletes its builds, runs and card-game results, after the adult confirms (D38).
- Profiles have no email and no public face. Nothing leaves the device unless sync is configured (D10, D13).
- The parent view explains in one screen what is stored (`docs/data-note.md`, task 6.2).
