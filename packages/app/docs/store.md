# The store

Back to the [README](../README.md). The types are in [src/store/index.ts](../src/store/index.ts); task 4.9 implements them and task 5.5 adds sync.

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
