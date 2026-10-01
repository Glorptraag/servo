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
| [changes.ts](../src/store/changes.ts), [sync.ts](../src/store/sync.ts) | The changes sync will push, and the sync seam |

### Opening

- `openStore({ name, remote, now })` opens the IndexedDB database `name` (default `servo`), creating it on first use. It rejects only when the device's storage cannot be opened: no IndexedDB, or storage the browser blocks.
- It asks `navigator.storage.persist()` once the store is open, and only when `persisted()` says the store is not kept yet. It never waits for the answer. Some pages have no StorageManager at all (a page that is not a secure context, Node), and then it asks nothing.
- `now` stamps every time the store writes: `createdAt`, `updatedAt`, `playedAt`. Ids are random UUID v4s from `crypto.getRandomValues`, which works on a tablet reaching the app over a LAN address too.
- `close()` closes the database. The app closes it when it is destroyed.

### Tables

Dexie's versions cover the table layout only (version 1 now). A blueprint's own format version and its migrations stay in packages/schema.

| Table | Key | Holds |
| --- | --- | --- |
| `profiles` | `seq`, unique `id` | `{ id, name, createdAt }` |
| `blueprints` | `id`, the blueprint's `meta.id` | `{ id, profile, document, keptFrom? }`: `document` is the bytes `serializeBlueprint` wrote |
| `runs` | `seq`, unique `id` | `{ id, profile, blueprintId, challenge?, record }`: `record` is the RunRecord as given |
| `cardGames` | `seq`, unique `id` | `{ id, profile, result }` |
| `changes` | `seq`, unique `[collection+id]` | The changes sync will push: one per record |

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
- **`save(blueprint)`**: stamps `updatedAt` now, validates the build and stores it in canonical form under its `meta.id`. Nothing else is changed; `createdAt`, `author` and the rest are stored as given. It refuses:
  - a `meta.id` this profile does not hold (a new build comes from `create`, `copy` or `duplicate`);
  - an `author` that names another profile;
  - a build that does not validate (the issues are the rejection's `cause`);
  - an id whose stored document does not load, such as one from a newer version of Servo, so that document is never overwritten.
- **Rename** is a save with a new `meta.name`, child text of 1 to 60 characters on one line. The contract has no rename of its own. In the app the name goes through the canvas as a `rename` command, and the build saves itself or Save stores it.
- **`duplicate(id, name)`**: the stored build, loaded as `load` gives it, under a fresh `meta.id` with its own name, this profile as author, made and changed now. Its high-water marks are the original's, so no id the original ever gave out is given out again in the copy. It has no Runs, so its Runs start again from 1. The original is untouched.
- **`remove(id)`** deletes the build. Its Runs stay: they are the child's progress, and runs are only ever added.
- **`list()`**: newest `updatedAt` first, then by id. A document that does not load is still listed when its name, level and time read as this version's do (a newer version's usually do), so the child can see it is kept; one that cannot be read at all is left out of the list, and still stored.

### Run records and card games

- `runs.add(record)` validates the record against the content (`validateRunRecord`) and stores it as given. It refuses a record that does not validate, one whose `profile` names another profile, and an id already stored. A record without a `profile` is kept without one; it belongs to the profile it was added to. The blueprint it ran need not be stored.
- `runs.list(filter)` is oldest first by `startedAt`. `blueprintId` and `challenge` narrow it; `challenge: null` gives the sandbox's Runs. `runs.get(id)` gives another profile's Run as undefined.
- `cardGames.add(cards)` keeps a round stamped now, with a fresh id: at least one card, each `{ part, named }` with a part the content has. Only those two fields of each card are kept. It does not count the cards: `drawCards` (task 5.4) deals the round. `latest()` is the round played last; of two at the same moment, the one added last.

### Sync

- With no `remote`, `sync.state` is `local-only` and `sync.now()` resolves at once.
- With a remote, `sync.state` is `idle` and `sync.now()` rejects until task 5.5 syncs. The remote is never called.
- Every write records its change in the same transaction: the record's collection and id, its profile, its time, and whether it was removed. A record has one change, its latest. `pendingChanges(db)` ([changes.ts](../src/store/changes.ts)) gives them oldest first in the contract's `SyncChange` form, each with its record as stored now (a blueprint as `serializeBlueprint` wrote it, parsed), or without one when it was removed. So the changes wait for 5.5 to push them, and no second copy of a blueprint is kept for them.
- A profile's removal records the removal of the profile and of each record it owned. A refused write records nothing.

## In the app

- `mountApp` opens the store with `options.store`. When the device's storage cannot be opened, the app still opens and the child can build; nothing is saved, and the content comes from `loadContent()`.
- **The first run.** On a device with no profile, the app makes one: "Builder 1", under a random UUID, with no email and nothing personal. The parent view (task 5.1) lets the adult rename it or add others. Two tabs opening at once take turns (Web Locks), so a device never gets two first profiles.
- Until the profile switch (task 5.1) and Home (task 4.5) choose them, the app opens for the one profile on the device, with its newest build that loads. When none loads, it starts an empty sandbox build, "Build 1", at the child's level on the plain floor (`open-floor`), so the child always has a build to work on and there is always something to save. With several profiles, before the profile switch exists, none is in use and nothing is saved. A child never sees another child's builds.
- The slots reach the child's records as `useShell().child` ([shell.md](shell.md)). The Run loop (task 4.4) adds Runs there, and Home (task 4.5) lists, loads, creates and copies builds there, putting the one it opens on the canvas with `useShell().load`.
- **Autosave** ([src/shell/save.tsx](../src/shell/save.tsx)). Nothing is lost (brief Section 8, principle 5): the build saves itself about a second after the last edit (`AUTOSAVE_MS`, 1000 ms after the canvas's last `edit` event), and at once when Run is pressed (`setMode('run')`). An edit to another build first saves the one still waiting, and so does the Save slot leaving the page. A stored build that does not load is never overwritten: the store refuses.
- **Save** stores the build on the canvas at once, and leaves nothing waiting. It is there to press with a build on the canvas and a profile in use. What happened to the last save, by either way, shows as one plain line beside it, `Saved` or `Not saved`, never a dialog, and the line goes once the build changes again. The canvas keeps its build as it is, so a save never counts as a change to the build (D37).
- **The blueprint's name** ([src/shell/name.tsx](../src/shell/name.tsx)) is a button in the header that turns into a text field. Enter or leaving the field applies `rename` through `canvas.apply`, so the new name is an edit with its own Undo step, saved like any other; Escape keeps the old name. Runs of white space become one space and the ends are trimmed; a name that is then empty or over 60 characters is dropped. Renaming is for Build mode. Until task 3.2's `canvas.apply` lands, the real canvas refuses the command and the name stays.

## Tests

`pnpm --filter @servo/app test` runs them with the rest of the app's tests.

- **Unit, in Node on fake-indexeddb** ([test/store/](../test/store/)). Each round trip compares bytes: every content fixture blueprint against the content, and every schema valid blueprint against the schema's fixture catalogue, is kept, loaded, saved and loaded again with the stored bytes checked at each step; each also loads back byte for byte when stored under its own id, as sync leaves it. Also: canonical form whatever order a build arrives in; both version 0 fixtures migrated on every load, the stored document left as it was, and saved as version 1; a newer version refused by name and never overwritten; an unreadable document; create, copy, duplicate (fresh id, same high-water marks), rename (1 to 60 characters on one line) and remove; profile isolation, with each operation tried on another profile's records; profile removal and its cascade; Runs and card games; the sync seam and the recorded changes; a content defect; and `openStore` rejecting with no IndexedDB.
- **Browser, in Chromium on its real IndexedDB** ([test/browser/store.test.tsx](../test/browser/store.test.tsx)). Save, autosave and the name with a stand-in canvas and a real store: saving; autosave a quiet second after the last edit, at once on Run, at once for the waiting build when another is edited, and never after Save; a failed save, by either way, as one line and no dialog; a stored build that does not load left as it is; renaming through the canvas then saving. Then the real app ([test/browser/store-page.html](../test/browser/store-page.html), the app as `main.tsx` starts it, on a database named in the address): on its first run, in two tabs at once, it makes one "Builder 1" with an empty "Build 1", and Save writes to it; after a real reload of the page, which starts every module again, the page reads back from IndexedDB what it wrote before the reload, and makes nothing twice.

## Decisions and open questions

Taken here, conservatively, for Drew and the orchestrator:

1. Rename is a save with a new `meta.name`: the contract has no rename. In the app it goes through the canvas's `rename` command, then Save.
2. Autosave (orchestrator, 2026-10-01, brief principle 5): a quiet second after the last edit, and at once on Run. Save stays.
3. The first run (orchestrator, 2026-10-01): the app makes "Builder 1" on a device with no profile. Taken here: when the profile has no build that loads, the app starts an empty "Build 1" on the plain floor, so Save and autosave have a build in the web build before Home (task 4.5). With several profiles, before task 5.1's switch, none is in use.
4. Status lines: `Saved` and `Not saved`, plain, for the copy pass (task 6.5).
5. `save` refuses to overwrite a stored document that does not load (a newer version, or one using a part the content lacks), so it is kept as it is.
6. `save` keeps `author` as given, refusing only another profile; it does not add an author that is missing.
7. Removing a build keeps its Runs, as the child's progress.
8. `list()` shows a build that does not load when its name, level and time can be read; one that cannot be read is left out, and still stored.
9. `load` of an id the profile does not hold rejects: no issue code fits a missing document.
10. The changes for sync are kept as references to the records, read when they are pushed, so no copy of a blueprint is kept twice.
11. With a remote given, `sync.now()` rejects until task 5.5.
12. A card-game round needs at least one card, of parts the content has; the store does not require ten.
13. On Firefox, `persist()` asks the person at the screen for permission. The store asks only while the store is not yet kept.
14. Space is Run and Stop (D42). The Run loop (task 4.4) should leave Space alone while the child types in the name field.
