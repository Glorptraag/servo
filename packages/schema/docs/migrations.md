# Blueprint versions and migrations

Back to the [README](../README.md). The code is in `src/migrate/` (task 0.3). Ground rule 5: the blueprint is versioned from day one, with a migration path.

## The version field

- Every stored blueprint names its format in `version`, a whole number. This schema writes `BLUEPRINT_VERSION`, which is 1. The `Blueprint` type's `version` must equal it, or the package does not compile.
- Only a major change bumps it. An additive minor change (`SCHEMA_VERSION` 1.x) keeps version 1.
- Version 0 is synthetic: no app ever wrote it. It proves the path from an older format before any real blueprint is stored.

## migrateBlueprint

`migrateBlueprint(value)` brings a stored blueprint of any earlier version up to the current one, then checks its structure with `validateBlueprintShape`. It never throws. It returns `{ ok: true, value, from }`, where `from` is the version the blueprint was stored at, or `{ ok: false, issues }` in the validators' issue format.

| Stored `version` | Result |
| --- | --- |
| missing | `value.missing` at `$.version`: a document without one is never guessed at |
| not a whole number from 0 up | `value.wrong_type`, `value.not_integer` or `value.out_of_range` at `$.version` |
| 0 | migrated one step at a time to 1 |
| 1 | no step runs: the same object comes back, with `from: 1`, once it passes the structure check |
| 2 or more | `blueprint.newer_version` at `$.version` |

- **A newer version is refused, never guessed at.** An older app can meet a newer blueprint after sync. It should leave that document exactly as stored (task 5.5).
- **Issue paths point into the stored document.** If a later step, or the final structure check, refuses a document the steps made, the path points into that document and the message starts "After migrating from version 0 to version 1:". That means a bug in a step, not bad data.
- **No catalogue.** Content changes between releases, and a migration must give the same result whatever content is loaded. So it checks structure only.

**Loading a blueprint (task 4.9):**

1. `migrateBlueprint(stored)`. On a refusal, keep the stored document as it is.
2. `validateBlueprint(migrated.value, catalogue)` checks the content.
3. `canonicalizeBlueprint(…, catalogue)` gives the form `serializeBlueprint` saves.

Migration is deterministic, so running it on every load is safe. The same stored document always gives the same blueprint, id included, whether or not its migrated form is ever saved.

## Steps

`BLUEPRINT_MIGRATIONS` (`src/migrate/blueprint.ts`) lists the steps in order, and `runMigrations` (`src/migrate/runner.ts`) runs them. A step `{ from, to, migrate }`:

- reads one version, `from`, and writes `from + 1`;
- reads that version strictly, with its own reader built only from the reader kit, so later changes to the current readers never change it;
- is pure: no clock, randomness, I/O or catalogue;
- never throws, and reports every problem with a path into the document it read;
- is frozen once shipped, because stored blueprints, and the ids derived from them, depend on exactly what it writes.

## Version 0

| Version 0 | Version 1 | Change |
| --- | --- | --- |
| `version: 0` | `version: 1` | |
| `parts[].type` | `parts[].part` | renamed |
| `parts[].turns`, whole quarter turns clockwise from 0 to 3 | `parts[].rotation`, degrees clockwise | times 90 |
| `arena`, the preset id | `arena: { preset, props: [] }` | version 0 had no props |
| `meta.title` | `meta.name` | renamed |
| `meta.created`, `meta.modified`: whole milliseconds since 1970-01-01T00:00:00.000Z, up to the end of 9999 | `meta.createdAt`, `meta.updatedAt` | written as `toISOString` writes them |
| no `meta.id` | `meta.id` | derived from the document |
| no `meta.highWater` | `meta.highWater` | the highest `p<n>` and `w<n>` ids in use |

Part ids, positions and settings, the wires, `meta.level` and `meta.author` carry over as stored. Version 0 already wrote directional wires source first; the step cannot check that without a catalogue, and `validateBlueprint` refuses one that is not (`wire.reversed`). A power wire could run either way, as in version 1, and canonical form turns it.

**The derived id.** The task allowed a derivation from the content or an injected id source. The step derives:

- `meta.id` is the SHA-256 of the line `servo-blueprint-v0` followed by the stored document in `canonicalJson`. Its first 16 bytes are laid out as a UUID v4, with the version and variant bits set, in lower-case hex.
- The same stored document gives the same id on every device and every load. An injected random id would differ on each load until the migrated form was saved, and two devices would give one build two ids, which sync would then keep as two blueprints.
- It passes every check a UUID v4 passes, but it is the one blueprint id the app does not generate at random ([validation](validation.md)). SHA-256 is one-way, so the id still holds no name.
- Key order does not change it. Any change to the content does, including list order.
- Two stored documents that are exactly alike get the same id. They are the same build, so treating them as one blueprint loses nothing.
- The fixtures' ids are pinned in the tests, because changing the derivation would change the id of every migrated version 0 blueprint.
- SHA-256 is in `src/migrate/digest.ts`. It is synchronous and needs no library (Web Crypto's digest is asynchronous). It is checked against the FIPS 180-2 examples.

**The high-water marks.** Version 0 kept none, so each mark starts at the highest number in a `p<n>` or `w<n>` id in use, or 0. No id in use is given out again. A higher id deleted while the build was version 0 could be, since version 0 never recorded it.

## Fixtures

`fixtures/v0/` holds stored version 0 documents. `fixtures/v0/migrated/` holds the same builds migrated, checked against the fixture catalogue and in canonical form.

- `rolling-start`: the Rolling Start robot, with its parts in the order they were placed and two power wires written from the other end. Migrated, it is byte for byte the version 1 `rolling-start` fixture apart from its derived id.
- `light-and-motor`: a shared workbench circuit with no author. It has numbered ids with gaps, an LED a quarter turn round, a DC motor three quarter turns round, a stored default that canonical form drops, and three power wires written from the other end.

`test/migrate.test.ts` checks that each migrates, validates and round-trips byte for byte: migrate, canonicalise, serialise, parse and serialise again. `test/migrate-v0-to-v1.test.ts` tests the step on its own.

## Adding version 2

1. Bump `BLUEPRINT_VERSION` and the `Blueprint` type's `version` together, and change the types and readers.
2. Write `src/migrate/v1-to-v2.ts`. Its reader is today's version 1 structure check, copied and frozen.
3. Append the step to `BLUEPRINT_MIGRATIONS`. Never edit `v0ToV1`.
4. Add stored version 1 documents to `fixtures/v1/` with their migrated forms, and regenerate `fixtures/v0/migrated/` as version 2. Point the v0 → v1 step tests at the frozen version 1 reader.

## Open questions

1. Task 4.9 can only reach fixtures through `@servo/schema/fixtures`. Should `src/fixtures.ts` list the version 0 fixtures? It was outside this task's files.
2. `validateBlueprint` answers a version 2 blueprint with "Migrate it first", but nothing can migrate a newer version. Should that message point to `blueprint.newer_version` instead?
