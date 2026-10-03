# The store

Back to the [README](../README.md). The types are in [src/store/index.ts](../src/store/index.ts) (task 0.4). Task 4.9 implements them on Dexie over IndexedDB, in the files beside it, and task 5.5 adds sync.

- **Local-first.** Dexie over IndexedDB ([docs/stack.md](../../../docs/stack.md)). The store asks the browser to keep its data (`navigator.storage.persist()`), because Safari may evict it otherwise; sync is the real backup.
- **Content.** `openStore()` loads the content once with `loadContent()` and exposes every record that validates as `store.content`, with its types re-exported here. A content defect never stops the store opening: the defective record is left out, only builds that use it fail to load, and `store.contentIssues` lists it. The parent view reads part names, families, challenge kinds and art from `store.content`, since the package map gives it no other way to content.
- **Profiles.** Child profiles under the one adult account on the device: an opaque id, the adult's name for the profile, no email. Removing a profile deletes its blueprints, runs and card-game results, after the adult confirms in the parent view (D38). The app never deletes anything on its own.
- **Profile-scoped.** `forProfile(id)` reads and writes only that child's blueprints, runs and card games.
- **Blueprints.** CRUD keyed by `meta.id`, the only persisted build format (ground rule 5).
  - `create` gives an empty build with a fresh UUID v4 and the profile as author.
  - `copy` keeps a build from outside the profile (a challenge's `start`, a shared link's blueprint) as the child's own, under a fresh id, after migrating and validating it.
  - `save` stores canonical form and stamps `updatedAt`, only for a `meta.id` the profile already holds.
  - `duplicate` gives a fresh id; `remove` deletes.
- **Migration on load.** `load` runs the schema's `migrateBlueprint` (task 0.3), then `validateBlueprint` against the content. A document that fails comes back with its issues and stays stored, untouched: nothing is lost.
- **Run records.** They give the parent view's progress, each Run's `runNumber` (its place among the Runs of the same challenge, or of the same blueprint in the sandbox) and the previous Run that gives `fixed`.
- **Card games** (task 5.4, D40). One result per round: ten cards drawn from Level 1–2 parts, each marked named or not by the adult. `latest()` is the result that counts. The child never sees a score.
- **Sync.** Through a pluggable `SyncRemote`: an in-memory one for tests, an HTTP one disabled until a host is configured (D10, D13). With none, the store is local-only, which is also the offline path. Profiles, blueprints, runs and card games all sync.
- **Conflict rule.** When one `meta.id` changed on two devices since the last sync, the copy with the later `updatedAt` keeps the id, and the other is kept as its own blueprint with a fresh id (`keptFrom` names the original). Blueprints are never merged and never dropped. Runs and card-game results are only ever added.
- **Later.** Telemetry (task 6.2) adds its collection here, noting the interface change. Until then the parent view's telemetry fields are absent (D39).

## How task 4.9 keeps them

| File | What |
| --- | --- |
| [index.ts](../src/store/index.ts) | The contract, unchanged, and `openStore`, which opens the store for `loadContent()` |
| [open.ts](../src/store/open.ts) | `openStoreWith(content, options)`: the ServoStore for any content. Tests give it the schema's fixture catalogue |
| [database.ts](../src/store/database.ts) | The Dexie tables and their rows |
| [blueprints.ts](../src/store/blueprints.ts) | Blueprints: canonical form, migration on every read |
| [profiles.ts](../src/store/profiles.ts), [records.ts](../src/store/records.ts) | Profiles; run records and card-game results |
| [changes.ts](../src/store/changes.ts) | The changes sync will push. Sync itself is task 5.5's, in [src/sync/](../src/sync/) |

### Opening

- `openStore({ name, remote, now })` opens the IndexedDB database `name` (default `servo`), creating it on first use. It rejects only when the device's storage cannot be opened: no IndexedDB, or storage the browser blocks.
- It asks `navigator.storage.persist()` once the store is open, and only when `persisted()` says the store is not kept yet. It never waits for the answer. Some pages have no StorageManager at all (a page that is not a secure context, Node), and then it asks nothing.
- `now` stamps every time the store writes: `createdAt`, `updatedAt`, `playedAt`. Ids are random UUID v4s from `crypto.getRandomValues`, which works on a tablet reaching the app over a LAN address too.
- `close()` closes the database. The app closes it when it is destroyed.

### Tables

Dexie's versions cover the table layout only (version 2 now: task 5.5 added `sync`). A blueprint's own format version and its migrations stay in packages/schema.

| Table | Key | Holds |
| --- | --- | --- |
| `profiles` | `seq`, unique `id` | `{ id, name, createdAt }` |
| `blueprints` | `id`, the blueprint's `meta.id` | `{ id, profile, document, keptFrom? }`: `document` is the bytes `serializeBlueprint` wrote |
| `runs` | `seq`, unique `id` | `{ id, profile, blueprintId, challenge?, record }`: `record` is the RunRecord as given |
| `cardGames` | `seq`, unique `id` | `{ id, profile, result }` |
| `changes` | `seq`, unique `[collection+id]` | The changes sync will push: one per record |
| `sync` | `key` | `{ key, value }`: the remote's `cursor`, and under `blueprints/<id>` the version of each blueprint last synced, as `<updatedAt>#<content hash>` (task 5.5) |

- Nothing derived from a blueprint is stored beside it (ground rule 5). A list's names, levels and times are read from the documents themselves. A run's `blueprintId` and `challenge` are copied out of its record only to find it by them; records never change.
- `seq` is the order records were added in. Lists sort by their own time first, and two records with the same time keep the order they were added in.
- A document from another version of Servo, which sync may bring, is kept as it came: an older one under the id its migration gives it, a newer one under its own `meta.id`.

### Profiles

- `create(name)` and `rename(id, name)` take a name as the schema reads a blueprint's: 1 to 60 characters on one line, without spaces at either end. Anything else is refused.
- `list()` is oldest first. A profile's id is a random UUID v4, so it never carries the name.
- `remove(id)` removes the profile, its blueprints, runs and card-game results, and records each removal for sync, all in one transaction. A profile that is not there is no error: nothing changes.
- A write for a profile that is not on the device is refused, so nothing is ever kept for a removed profile. Reads for one give nothing.

### Blueprints

- **One profile at a time.** Another profile's build is treated exactly as a missing one: `load` and `duplicate` refuse it, `save` refuses its id, `remove` leaves it alone, and `list` never shows it. The refusal never says that another profile holds it.
- **`create({ name, level, arena })`**: an empty build in canonical form, made and changed now, high-water marks at 0. It is refused when it does not validate, for example an arena preset the content lacks.
- **`copy(source, name?)`**: migrated and validated against the content, then kept with a fresh `meta.id`, this profile as author, made and changed now, and `name` when given. Level, parts, wires, settings, arena and high-water marks are the source's. When it does not validate (a newer version, a part the content lacks, a bad name) its issues come back and nothing is stored. `migratedFrom` says when it came from an older version.
- **`load(id)`**: the stored document, migrated with `migrateBlueprint`, validated against the content and put in canonical form, every time it is read. Migration is deterministic, so the same document always gives the same blueprint. Loading never writes: an older document stays as it is until the child saves, and then the current version is written. A document that does not load comes back as its issues: a newer version as `blueprint.newer_version`, never a throw and never a dialog (ground rule 9); a document that is not JSON as `value.unreadable`. An id the profile does not hold rejects, since there is no document to report on.
- **`save(blueprint)`**: stamps `updatedAt` now, validates the build and stores it in canonical form under its `meta.id`. Nothing else is changed; `createdAt`, `author` and the rest are stored as given. The row decides whose build it is, not the `author` it names, so a build sync brought in is still the holding profile's to save. It refuses:
  - a `meta.id` this profile does not hold (a new build comes from `create`, `copy` or `duplicate`);
  - a build that does not validate (the issues are the rejection's `cause`);
  - an id whose stored document does not load, such as one from a newer version of Servo, so that document is never overwritten.
- **Two tabs on one build: both kept.** The `updatedAt` a save is given names the stored version the build was edited from, as `load`, `create`, `copy`, `duplicate` and `save` return it. When the stored build has changed since (another tab, or another device, saved it), the stored version is kept as its own blueprint under a fresh `meta.id`, `keptFrom` naming the build, and the save keeps the id: "latest wins, both kept", sync's conflict rule (task 5.5) applied between tabs, in one transaction. No copy is kept when the two are the same but for their times, since nothing would be lost. Each save is stamped later than the version it replaces, even when a tab's clock is behind, so a version is never mistaken for another. `keptCopyOf(saved)` ([blueprints.ts](../src/store/blueprints.ts), for the app, not part of the contract) gives the copy a save kept.
- **Rename** is a save with a new `meta.name`, child text of 1 to 60 characters on one line. The contract has no rename of its own. In the app the name goes through the canvas as a `rename` command, and the build saves itself or Save stores it.
- **`duplicate(id, name)`**: the stored build, loaded as `load` gives it, under a fresh `meta.id` with its own name, this profile as author, made and changed now. Its high-water marks are the original's, so no id the original ever gave out is given out again in the copy. It has no Runs, so its Runs start again from 1. The original is untouched.
- **`remove(id)`** deletes the build. Its Runs stay: they are the child's progress, and runs are only ever added.
- **`list()`**: newest `updatedAt` first, then by id. A document that does not load is still listed when its name, level and time read as this version's do (a newer version's usually do), so the child can see it is kept; one that cannot be read at all is left out of the list, and still stored.

### The app's openings

[open.ts](../src/store/open.ts) has two more for the app's first run, which are not part of the contract. Each is one read-write transaction, which IndexedDB runs one at a time across tabs, so two tabs opening at once never make two of anything, with or without Web Locks:
- `profilesForOpening(store, name)`: the device's profiles, making one named `name` when there are none;
- `buildForOpening(store, profile, init)`: the profile's newest build that loads and is not a kept copy, or a new empty one from `init` when none does. A kept copy is the version that lost its build's id, so it opens only when nothing else loads;
- `replayForOpening(store, profile, note)`: a build a page of the app left unsaved (the journal, below), replayed by the project's rule, the latest wins and both are kept. Versions are compared by their content, the canonical bytes but for the id and the time (`contentHashOf`, a 53-bit hash, then the bytes themselves):
  - the same as the stored build at its id, or as a copy kept from it: nothing to do, so a note whose own save landed as its page went is never stored twice;
  - edited from the version stored now: the note is the newer, and saves at its id, as a save does;
  - the stored build moved on since the note's base (another tab saved it): whichever was changed last keeps the id, the note's last edit (`editedAt`, by the autosaver's clock) against the stored `updatedAt`, so the outcome is the one the live path gives when the note's own save lands. A later note saves at the id and the stored version is kept as its own blueprint, `keptFrom` naming the build; otherwise the stored build stays and the note is kept so, dated by its last edit. A tie goes to the stored build;
  - the stored build does not load: the note is kept as a copy of it. A note whose build was removed meanwhile is kept as a build of its own.

### Run records and card games

- `runs.add(record)` validates the record against the content (`validateRunRecord`) and stores it as given. It refuses a record that does not validate, one whose `profile` names another profile, and an id already stored. A record without a `profile` is kept without one; it belongs to the profile it was added to. The blueprint it ran need not be stored.
- `runs.list(filter)` is oldest first by `startedAt`. `blueprintId` and `challenge` narrow it; `challenge: null` gives the sandbox's Runs. `runs.get(id)` gives another profile's Run as undefined.
- `cardGames.add(cards)` keeps a round stamped now, with a fresh id: at least one card, each `{ part, named }` with a part the content has. Only those two fields of each card are kept. It does not count the cards: `drawCards` (task 5.4) deals the round. `latest()` is the round played last; of two at the same moment, the one added last.

### Sync

- With no `remote`, `sync.state` is `local-only` and `sync.now()` resolves at once.
- With a remote, task 5.5's sync ([src/sync/](../src/sync/)) pulls, applies the conflict rule and pushes these changes: when, how and the rule in full are in the [README](../README.md), "Offline and sync".
- Every write records its change in the same transaction: the record's collection and id, its profile, its time, and whether it was removed. A record has one change, its latest. `pendingChanges(db)` ([changes.ts](../src/store/changes.ts)) gives them oldest first in the contract's `SyncChange` form, each with its record as stored now (a blueprint as `serializeBlueprint` wrote it, parsed), or without one when it was removed. So the changes wait for sync to push them, and no second copy of a blueprint is kept for them.
- A profile's removal records the removal of the profile and of each record it owned. A refused write records nothing.
- `pendingChanges` reads each record when it is called, so a pushed change carries the record as it is then. A stored document that is not JSON goes as its text.

## In the app

- `mountApp` opens the store with `options.store`, replays any builds a page of the app left noted in the journal (below), then opens a build.
- **The first run.** On a device with no profile, the app makes one: "Builder 1", under a random UUID, with no email and nothing personal. The parent view (task 5.1) lets the adult rename it or add others. Until the profile switch (task 5.1) and Home (task 4.5) choose them, the app opens for the one profile, with its newest build that loads and is not a kept copy, or a new empty "Build 1" at the child's level on the plain floor (`open-floor`) when none does. Both are the store's openings above, so two tabs opening at once make one of each. A child never sees another child's builds.
- **A device that keeps nothing.** When the device's storage cannot be opened (site data blocked, as on some managed classroom devices), or opening a build in it fails (a quota error), or several profiles are there before the profile switch exists, the child still builds: on an empty "Build 1" kept only in the page, with the content from `loadContent()`. Save is not there to press, and the line says "Builds are not being kept on this device".
- The slots reach the child's records as `useShell().child` ([shell.md](shell.md)). The Run loop (task 4.4) adds Runs there, and Home (task 4.5) lists, loads, creates and copies builds there, putting the one it opens on the canvas with `useShell().load`.
- **Autosave** ([src/shell/autosave.ts](../src/shell/autosave.ts), [save.tsx](../src/shell/save.tsx)). Nothing is lost (brief Section 8, principle 5):
  - the build saves itself about a second after the last edit (`AUTOSAVE_MS`, 1000 ms after the canvas's last `edit` event), and at once when Run is pressed (`setMode('run')`), when the page is hidden (`visibilitychange`), when it is left or reloaded (`pagehide`), and when the Save slot goes away;
  - an Undo, which puts the build's earlier form back with `load` and so fires no `edit`, saves like an edit: any new form of the same `meta.id` on the canvas does;
  - an edit to another build first saves the one still waiting;
  - saves run one after another, each from the version this tab last saw stored, so the conflict rule above keeps another tab's version as a copy;
  - a save that fails stays waiting and is tried again, 2 s later, then 4 s and so on up to 30 s, until it saves;
  - a stored build that does not load is never overwritten: the store refuses, and the line says so.
- **The journal.** A page that is reloaded or closed is gone before an IndexedDB save it starts can finish. So as the page is hidden or left, the app first notes each build still waiting or saving in localStorage (one item per build, under `servo.unsaved:`, the database's name and the page), which writes at once: the build, the stored version it was edited from, when it was last edited (by the autosaver's clock, which tests fix) and a hash of its content. Then it saves. A note goes once its build is saved. The next time the app opens, the autosaver's `recover` replays each note left behind with `replayForOpening` (above), before the app opens a build: one already stored is only forgotten; one edited from the version stored now saves to its build; one the stored build has moved on from is weighed by its last edit: the later of the two keeps the id and opens, the other is kept as a copy, and the line says a copy was kept. A note whose profile is gone goes with it (D38); a note that cannot be replayed now stays for next time. This is the one place a build waits outside the store, in its own format (ground rule 5), and only between an edit and its save.
- **`destroy()`** unmounts the app, which saves what waits, and closes the store only once every save it started has settled.
- **Save** stores the build on the canvas at once, as its latest edit left it, and leaves nothing waiting. It is there to press with a build on the canvas and a profile in use. The canvas keeps its build as it is, so a save never counts as a change to the build (D37).
- **The line** beside Save, one plain line, never a dialog, says only what the child needs: "Not saved" while a save is failing, until one succeeds; "Saved" after Save is pressed, until the build changes; "A copy of the other version was kept" when another tab's version was kept, or a version a page left unsaved that the build had moved on from; and "Builds are not being kept on this device". A save that went as expected says nothing, so a screen reader is not told "Saved" after every pause.
- **The blueprint's name** ([src/shell/name.tsx](../src/shell/name.tsx)) is a button in the header that turns into a text field. Enter or leaving the field applies `rename` through `canvas.apply`, so the new name is an edit with its own Undo step, saved like any other; Escape keeps the old name. Runs of white space become one space and the ends are trimmed; a name that is then empty or over 60 characters is dropped. Renaming is for Build mode. Until task 3.2's `canvas.apply` lands, the real canvas refuses the command and the name stays.

## Tests

`pnpm --filter @servo/app test` runs them with the rest of the app's tests.

- **Unit, in Node on fake-indexeddb** ([test/store/](../test/store/)). Each round trip compares bytes: every content fixture blueprint against the content, and every schema valid blueprint against the schema's fixture catalogue, is kept, loaded, saved and loaded again with the stored bytes checked at each step; each also loads back byte for byte when stored under its own id, as sync leaves it. Also: canonical form whatever order a build arrives in; both version 0 fixtures migrated on every load, the stored document left as it was, and saved as version 1; a newer version refused by name and never overwritten; an unreadable document; create, copy, duplicate (fresh id, same high-water marks), rename (1 to 60 characters on one line) and remove; profile isolation, with each operation tried on another profile's records; profile removal and its cascade; Runs and card games; the sync seam and the recorded changes; a content defect; and `openStore` rejecting with no IndexedDB. Two tabs, as two connections to one database ([tabs.test.ts](../test/store/tabs.test.ts)): both versions kept, no copy when nothing would be lost, saves stamped later even with a clock behind, and one first profile and build from two openings at once. Autosave and the journal ([autosave.test.ts](../test/store/autosave.test.ts)): every save settled before the store closes, notes written at once and forgotten once saved, a failed save kept and saved later, and each way a left note is replayed: with no conflict it saves to its build; the reviewer's sequence (A edits and is closed at once, B saves later, A opens again) keeps B's build at the id, opens it, keeps A's edit as a copy and tells the line; and a note whose own save had landed is only forgotten, with or without B's later save, so nothing is stored twice.
- **Browser, in Chromium on its real IndexedDB** ([test/browser/store.test.tsx](../test/browser/store.test.tsx)). Save, autosave and the name with a stand-in canvas and a real store: saving; autosave a quiet second after the last edit with no line, at once on Run, at once for the waiting build when another is edited, and never after Save; a failed save tried again until it saves; an Undo by `load` saved; a failed save, by either way, as one line and no dialog; a stored build that does not load left as it is; renaming through the canvas then saving; two tabs on one build, both kept and the line saying so. Then an edit kept when its page is reloaded at once, and when it is closed at once; and the reviewer's sequence across pages, where B's later save stays at the id and opens, A's unsaved edit is kept once as a copy, and a line says so ([save-page.html](../test/browser/save-page.html), the Save slot on a stand-in canvas and a real store). Then the real app ([test/browser/store-page.html](../test/browser/store-page.html), the app as `main.tsx` starts it, on a database named in the address): on its first run, in two tabs at once, it makes one "Builder 1" with an empty "Build 1", and Save writes to it; after a real reload of the page, which starts every module again, the page reads back from IndexedDB what it wrote before the reload, and makes nothing twice. And with IndexedDB's `open` throwing, or every write throwing a quota error, the child still has a build and the line.

## Decisions and open questions

Taken here, conservatively, for Drew and the orchestrator:

1. Rename is a save with a new `meta.name`: the contract has no rename. In the app it goes through the canvas's `rename` command, then saves like any edit.
2. Autosave (orchestrator, 2026-10-01, brief principle 5): a quiet second after the last edit, and at once on Run; also at once when the page is hidden or left, through the journal (review R-4.9). Save stays.
3. The first run (orchestrator, 2026-10-01): the app makes "Builder 1" on a device with no profile. Taken here: when the profile has no build that loads, the app starts an empty "Build 1" on the plain floor. With several profiles, before task 5.1's switch, none is in use and the child builds unsaved, with the line.
4. Status lines, for the copy pass (task 6.5): "Not saved", "Saved", "A copy of the other version was kept", "Builds are not being kept on this device". "Saved" only after Save is pressed (review R-4.9 Question 5, its default).
5. `save` refuses to overwrite a stored document that does not load (a newer version, or one using a part the content lacks), so it is kept as it is.
6. `save` keeps `author` as given, and the row, not the author, decides whose build it is (review R-4.9, its note for task 5.5).
7. Removing a build keeps its Runs, as the child's progress (review R-4.9 Question 4, for Drew).
8. `list()` shows a build that does not load when its name, level and time can be read; one that cannot be read is left out, and still stored.
9. `load` of an id the profile does not hold rejects: no issue code fits a missing document.
10. The changes for sync are kept as references to the records, read when they are pushed, so no copy of a blueprint is kept twice.
11. With a remote given, `sync.now()` rejected until task 5.5, which now syncs through it.
12. A card-game round needs at least one card, of parts the content has; the store does not require ten.
13. On Firefox, `persist()` asks the person at the screen for permission. The store asks only while the store is not yet kept (review R-4.9 Question 3, for Drew: ask from the parent view instead).
14. Space is Run and Stop (D42). The Run loop (task 4.4) should leave Space alone while the child types in the name field.
15. Two tabs on one build keep both versions, the later save keeping the id (orchestrator, review R-4.9 finding 2 and Question 1's default). When both tabs keep editing, each save that crosses the other's keeps a copy.
16. A device that keeps nothing still builds, unsaved, with one line (orchestrator, review R-4.9 finding 3 and Question 2's default).
17. Builds noted as a page is hidden or left wait in localStorage until saved: the one place a build waits outside the store (review R-4.9 finding 1).
18. Not queued here, since this task may not run `pharao.py`: decisions 3, 7, 13 and 15 are for the orchestrator to add to the decision queue (review R-4.9 finding 9).
19. A note a page left unsaved, met at the next opening by another tab's save of its build, is weighed by when it was last edited: the later of the two keeps the id and opens, and the other is kept as a copy, in both orders, as the live path does (orchestrator, review R-4.9 findings 10 and 13 and their Questions 1). Versions are the same when they differ only in their id and time, so a copy is never kept of a version already kept.
