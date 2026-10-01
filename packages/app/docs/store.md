# The store

Back to the [README](../README.md). The types are in [src/store/index.ts](../src/store/index.ts); task 4.9 implements them and task 5.5 adds sync.

- **Local-first.** Dexie over IndexedDB ([docs/stack.md](../../../docs/stack.md)). The store asks the browser to keep its data (`navigator.storage.persist()`), because Safari may evict it otherwise; sync is the real backup.
- **Content.** `openStore()` loads and validates the content once and exposes it as `store.content`. It checks blueprints against it, and the parent view reads part names, families, challenge kinds and art from it, since the package map gives parent no other way to content.
- **Profiles.** Child profiles under the one adult account on the device: an opaque id, the adult's name for the profile, no email. Removing a profile removes its records; only an adult does that.
- **Profile-scoped.** `forProfile(id)` reads and writes only that child's blueprints and runs.
- **Blueprints.** CRUD keyed by `meta.id`. `create` gives a fresh UUID v4 and the profile as author; `save` stores canonical form and stamps `updatedAt`; `duplicate` gives a fresh id. The blueprint is the only persisted build format (ground rule 5).
- **Migration on load.** `load` runs the schema's `migrateBlueprint` (task 0.3), then `validateBlueprint` against the content. A document that fails comes back with its issues and stays stored, untouched: nothing is lost.
- **Run records.** They give the parent view's progress, each Run's `runNumber` (its place among the Runs of the same challenge, or of the same blueprint in the sandbox) and the previous Run that gives `fixed`.
- **Sync.** Through a pluggable `SyncRemote`: an in-memory one for tests, an HTTP one disabled until a host is configured (D10, D13). With none, the store is local-only, which is also the offline path.
- **Conflict rule.** When one `meta.id` changed on two devices since the last sync, the copy with the later `updatedAt` keeps the id, and the other is kept as its own blueprint with a fresh id (`keptFrom` names the original). Blueprints are never merged and never dropped.
- **Later collections.** The card game's results (task 5.4) and telemetry (task 6.2) add their collections here, each noting the interface change.
