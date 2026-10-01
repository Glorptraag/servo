# @servo/schema

The v1 types, validators, wiring rules, geometry and canonical form that every other package builds on. It is owned by task 0.2; migrations arrive with task 0.3 in `src/migrate/`. It depends on no other package and no library, and freezes at v1 when Phase 0 closes.

```ts
import { validateBlueprint, planWire, drivePushes, serializeBlueprint, makeCatalogue } from '@servo/schema';
import { exampleParts, validBlueprints } from '@servo/schema/fixtures'; // test data, from src/fixtures.ts
```

## Versioning

- `SCHEMA_VERSION` is `'1.0'`. A minor bump is additive: a new part family, primitive, need kind or optional field. Valid data stays valid.
- A major bump changes `Blueprint.version` and needs a migration.
- The eleventh part family (D4) is one entry in `PART_FAMILIES` (`src/types/taxonomy.ts`) plus a minor bump.

## What it exports

| Area | Main exports | Details |
| --- | --- | --- |
| Types | `PartRecord`, `PortSpec`, `Primitive`, `Need`, `FailureMode`, `Setting`, `Blueprint`, `Wire`, `Mount`, `ArenaPreset`, `ArenaRef`, `Kit`, `Challenge`, `Goal`, `RunRecord`, `RunEvent` | [parts](docs/parts.md), [documents](docs/documents.md) |
| Vocabulary | `PART_FAMILIES`, `DOMAINS`, `LEVELS`, `PRIMITIVE_KINDS`, `UNMET`, `EFFECTS`, `SPEC_CARD_LAYERS`, `PORT_TYPE_STYLE` | [parts](docs/parts.md) |
| Validators | `validatePartRecord`, `validateArenaPreset`, `validateKit`, `validateBlueprint`, `validateBlueprintShape`, `validateChallenge`, `validateRunRecord`, `makeCatalogue` | [validation](docs/validation.md) |
| Wiring (ground rule 3) | `checkPortPair`, `planWire`, `judgeWire`, `SOCKET_CAPACITY` | [wiring](docs/wiring.md) |
| Geometry | `placeParts`, `drivePushes`, `robotRoot`, `mountPlacement`, `canvasPoseOf`, `arenaPoseOf`, `cosSin` | [geometry](docs/geometry.md) |
| Needs judged as wired | `wiredNeeds` | [parts](docs/parts.md) |
| Canonical form and ids | `serializeBlueprint`, `canonicalizeBlueprint`, `canonicalJson`, `claimPartId`, `claimWireId` | [documents](docs/documents.md) |
| Versions and migrations | `migrateBlueprint`, `MigrationResult` | [migrations](docs/migrations.md) |

## In brief

- **Validators never throw.** Each returns `{ ok: true, value }` or every issue found, as a stable code, a JSONPath and a plain message (`ISSUE_CODES`).
- **Behaviour is data.** A part's behaviour is a list of primitives from a closed vocabulary that sim-core implements once. Failure modes name a need, the way it goes unmet and the effects a child sees. Every Level 1–2 part maps onto it ([parts](docs/parts.md)).
- **Wiring.** Impossible drops are refused at the socket. Legal-but-wrong wiring is accepted, because its failure is the lesson.
- **Turning.** Positive speed is right-handed about a drive's axis, and a mirrored mount point flips the sense. So a robot whose two motors are wired alike drives forward, and one with a swapped motor spins.
- **Control never makes faults.** Needs are judged as wired, with every switch closed and every driver channel at full forward. A switch the child opens is a run input, and a motor the driver stops is just stopped.
- **Deterministic maths.** Angles that feed a Run use `cosSin`, which gives the same bits on every engine.
- **Same build, same bytes.** Canonical form and claimed ids give the same build the same bytes from canvas or list view. Ids are never reused.
- **Measures.** Run records feed the pass-rate and fault-fixing measures; session start mode and time in the sandbox come from task 6.2's telemetry.

## Fixtures

`fixtures/` holds the JSON and `src/fixtures.ts` the manifest:

- 14 example part records, 3 arenas, 2 valid kits and 1 invalid kit;
- 7 valid blueprints in canonical form, each labelled with the motion its geometry gives;
- 23 invalid blueprints, each refused for exactly one recorded reason;
- 4 challenges and 1 run record.

`pnpm --filter schema test` runs them.

Decisions and open questions are in [docs/decisions.md](docs/decisions.md).
