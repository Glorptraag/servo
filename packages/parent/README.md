# @servo/parent

The adult's side of Servo: the account and child profiles, the progress view, the parts-list export and the name-the-part card game. It imports only `@servo/schema` and `@servo/app/store` (the package map), so it reaches content through `store.content` and never through content, sim-core or canvas. Nothing here asks the child to do anything. Phase 5 owns it: accounts 5.1, progress 5.2, export 5.3, card game 5.4. Task 0.4 owns this interface.

```ts
import { openStore } from '@servo/app/store';
const store = await openStore();
const runs = await store.forProfile(profileId).runs.list();
```

## Public surface (planned)

| Name | Owner | What |
| --- | --- | --- |
| `mountParent(host, store)` | 5.1 | The parent view: the profile list and switch, then progress, exports and the card game per child |
| `progressOf(input)` → `Progress` | 5.2 | The progress read model, a pure function of the records below |
| `partsListOf(blueprint, catalogue)` → `PartsList` | 5.3 | The printable parts list for one blueprint |
| `drawCards(parts, seed)` | 5.4 | A deck for the card game |

The parent view runs as its own page of the web build, beside the child's app: the package map lets parent import the store but not the app, and the app may not import parent.

## The progress read model (task 5.2)

Derived for one child whenever the view opens. Never stored, never shown to the child.

| Field | Read from | Rule |
| --- | --- | --- |
| Parts met | Run records' `blueprint` | Each part type in the blueprint of any of the child's Runs, from the first such Run |
| Unscripted builds passed | Run records with a `challenge` whose kind is `unscripted-build` (from `store.content`) and `goal.met` | The first passing Run per challenge, with its `runNumber`: the pass-rate measure counts a pass within 3 Runs |
| Faults fixed | Run records' `faults` and `fixed` | Per fault: the Run that fixed it, how many Runs it took, and the time from the first Run that showed it (the fault-fixing measure) |
| Time in the sandbox | Task 6.2's telemetry | Total sandbox session time |
| Session start mode | Task 6.2's telemetry | Sandbox or challenge, per session: the sandbox-return measure |
| Parts named | Task 5.4's card-game results | The latest result per child |

Each figure must reconcile to the run records (task 5.2's acceptance). Until task 6.2 lands, its two fields are absent rather than zero.

## The parts-list export (task 5.3)

One line per part type, once, with its real name, family and quantity, then a wiring summary in plain words, and the `safetyNote` of any part that has one. The app's chassis mirrors its right-hand motor mount, so two motors wired alike drive forward (D23). A real kit does not, so the wiring summary must say which motor's leads to cross (D27).

## The card game (task 5.4)

A two-minute game the adult leads. It shows a part's picture (from the art registry in `store.content`), and the adult marks it named or not named. It draws only Level 1–2 parts and records one result per child through the store; task 5.4 adds that collection to the store's interface.

## Privacy

- Every query goes through `store.forProfile(id)`, so no view shows one child another child's records.
- Profiles have no email and no public face. Nothing leaves the device unless sync is configured (D10, D13).
- The parent view explains in one screen what is stored (`docs/data-note.md`, task 6.2).
