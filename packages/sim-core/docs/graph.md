# The wired graph

Back to the [README](../README.md). Task 1.1. `src/graph/` turns a blueprint into the wired graph that the solvers read every tick.

The graph is internal to sim-core. The package entry exports only the [interface](../src/interface.ts) and `createSimulation`, so the solvers import the graph by relative path:

```ts
// In packages/sim-core/src, for example from src/electrical/:
import { buildGraph, liveAt } from '../graph/index.ts';

const graph = buildGraph(blueprint, catalogue);
const live = liveAt(graph, { switches: { 'switch/contacts': false } }); // LiveNets
```

## The two arguments

- `blueprint` is a version 1 blueprint: one that `migrateBlueprint` has brought up to date. In a Run it is the canonical copy that `createSimulation` makes, so the graph never holds the caller's own objects.
- `catalogue` is the schema's `makeCatalogue` result, and must hold every part record the blueprint uses. sim-core never imports packages/content (the package map), so `createSimulation`'s caller passes the catalogue in. If the catalogue holds `arenas`, the blueprint's arena is checked as well.

`buildGraph` checks its input with the schema's validators, in this order: the blueprint's structure, then each part record the blueprint uses, then the whole blueprint against the catalogue.

- Schema-invalid input throws a `GraphInputError`. Its `subject` says what was refused, and its `issues` are the validator's named reasons: a code, a JSONPath and a message.
- Legal-but-wrong builds build like any other: a reversed motor, a short, a switch across the pack, a servo motor with no signal. Their failure on Run is the lesson.

## What the graph holds

| Field | What | Read by |
| --- | --- | --- |
| `parts` | Each placed part, with its blueprint entry and its record. Its `ports` are bound to nets and links, its `primitives` are bound to the power elements they make, and its `placement` comes from `placeParts`. A primitive's other ports (a shaft, a hub, a signal in) resolve through `ports`, by the ids the primitive names | every solver |
| `nets` | Power ports joined by power wires alone, with the wires inside each. A net is named by its first port | electrical |
| `sources` | Batteries, and the outputs of motor-driver channels and regulators. Each has `pos` and `neg` nets (its polarity). An output also has the `feeder` supply that must have power, and a driver channel has the `control` that stops it | electrical |
| `switches` | Each switch's two terminal nets: a join that the control state opens and closes, never baked into a net | electrical |
| `uses` | Everything that takes power: loads, actuators, programs, and the supplies of drivers and regulators | electrical, behaviour |
| `controls` | The schema's `controlsOf`, unchanged | electrical, tick loop |
| `liveTable` | The live nets at every setting of the controls, when there are at most `LIVE_TABLE_CONTROLS` (6) of them | electrical |
| `signals` | Signal lines, signal out → signal in | behaviour, program |
| `drives` | Drive linkages, drive-out → drive-in. `carried` is the driven part's frame on the shaft (`carriedPlacement`) | mechanical |
| `mounts` | Mounts, mount → mount point. `local` is the part's frame on its host (`mountPlacement`), mirrored on a mirrored mount point | mechanical |
| `root`, `pushes` | The schema's `robotRoot` and `drivePushes` | mechanical |

Net, source, switch, use and control numbers are indices into these lists.

- Nets are in the order of their first port: part id, then port id, as `comparePortRefs` orders them.
- Sources, switches, uses and controls are in part id order, then the record's primitive order. They are the elements the schema's circuit rules build (`wired.ts`).
- Links are in wire id order.

## Live nets

`liveAt(graph, state)` gives a `LiveNets`: the power graph at one setting of the controls. It is not the interface's `LiveState`, which is one part's live values in a `RunFrame`. `liveAt` reads a `ControlState` the way `wiredNeeds` does: a control left out sits at rest, a switch is closed only when its value is `true`, and a channel is at stop only when its command is 0.

- **`nodes`:** closed switches join nets. Each net names its node by the lowest net index among those joined.
- **`sources`:** whether each source gives power.
  - A battery always gives power.
  - An output gives power once a closed path through a source giving power, outside its own part, joins the two nets of its feeder. A driver channel at stop gives none.
  - This is the schema's rule for powering through a motor driver or regulator, grown until nothing changes.
- **`nets`:** whether each net is live. A net is live when a closed path through a source giving power runs through it, so it traces back to both the + and the − of that source.
  - A source whose two ends are one node, because a bare wire or a closed switch joins them, closes its own path. Its net is live, and that is a short.

Live describes the wiring, not the voltages. A part whose two supply nets are both live may still get no current. For example, a motor wired between two separately powered loops lies on no closed path. The schema's power need (`wiredNeeds`) is the stricter test, and the electrical solver works out the currents.

## Kept consistent with the schema

- **Reused as they are:** `validateBlueprint`, `validatePartRecord`, `checkPortPair`, `resolvePort`, `controlsOf`, `placeParts`, `robotRoot`, `drivePushes`, `mountPlacement`, `carriedPlacement` and `comparePortRefs`.
- **Rebuilt in sim-core, because the schema keeps them internal:** union-find over nets, blocks (biconnected components), and the output rule. `src/graph/topology.ts` and `src/graph/live.ts` follow `wired.ts`, over net numbers instead of port keys.
- **Checked against the schema** by `test/graph-live.test.ts`, on 400 random circuits at 1,200 control states:
  - the sources giving power, against `wiredNeeds`' power verdicts for motor drivers and microcontrollers;
  - the live nets, against a brute-force search of every closed path;
  - that search, against `wiredNeeds`' power and loop verdicts.

## Cost and determinism

- The builder uses no clock, randomness, DOM or Node API. It needs no trigonometry: every transform is a quarter turn from the schema's geometry.
- The same blueprint and catalogue always give the same graph, whatever order the parts and wires are listed in. A test checks this.
- Measured once on an M1 Max under Node 26:
  - building a fixture graph takes 0.2–2 ms, and a build of 10 switches and 40 DC motors takes 3.5 ms;
  - the builder never runs the schema's control search (`wiredNeeds`).
- `liveAt` looks the state up in the table when there are up to 6 controls. A Level 1–2 kit has at most 4.
  - Above 6 controls, `liveAt` works the state out instead, which takes about 0.1 ms.
  - A caller that ticks can keep the answer until a control changes.
  - Every answer is frozen, because the table shares one answer among every tick that asks for it. The graph is read-only: no solver writes into it.

## Notes for the solver tasks

- **Task 1.2:** `wiredNeeds(graph.blueprint, graph.catalogue, state)` judges `open` and `shorted`, as [runs.md](runs.md#faults) sets out.
  - Its control search can take 818 ms on a pathological build (review N14). Cache its result per control state, or run it outside the tick.
  - For `low`, `high` and `reversed`, apply the short and feeder steps of the rule as well as `explainByControls` (review N10).
- **Task 1.3:** the graph does not apply settings. `parts.get(id).placed.settings` holds the child's values.
- **Task 1.5:** `createSimulation` rejects with a `SimulationSetupError` for invalid input. A `GraphInputError` maps onto it with the same `issues`.

## Fixtures

`fixtures/graph/` holds a hand-made expectation for each of eight builds from `@servo/schema/fixtures`: the seven valid blueprints, and `light-and-motor` as migrated from version 0.

Each expectation lists:
- the nets, sources, switches, uses and controls;
- the live nets at every setting of the controls;
- the links, and the mounts with their transforms;
- every part's placement, the root and the pushes.

`test/graph.test.ts` compares each graph with its expectation.
