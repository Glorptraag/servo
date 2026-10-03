# How the app drives the canvas and sim-core

Back to the [README](../README.md).

## Build mode

1. `openStore()` loads the content once (`store.content`) and opens the child's records. It opens even when the content has a defect; `store.contentIssues` lists it for developers.
2. `mountCanvas(host, { catalogue: content.catalogue, resolveArt: (key) => content.art.get(key), level, prefs })`, then `canvas.load(blueprint)` with a blueprint from the store. A key with no picture gives undefined, and the canvas draws a neutral tile.
3. The tray hands a tile to the canvas with `canvas.beginPlacement(part, pointer?)`, and the arena strip hands a prop from its short list of boxes and cylinders with `canvas.beginPropPlacement(prop, pointer?)`, in Build mode only (D36). Both are remove targets (`setRemoveTargets`).
4. `edit` events feed the undo history (the blueprints they carry; Undo loads the previous one with `canvas.load`) and saving through the store. `select` opens the spec card for a part. `placement` clears the pending tile.
5. Every change the app makes itself goes through `canvas.apply`: spec-card settings (`set-setting`), the header's name (`rename`), the arena strip's preset picker and Reset arena (`set-arena`, which keeps the preset and drops the child's props, D29), and the hint ladder's do-it (one `batch`). So every change to a build is an `EditCommand`, and one Undo step.

## The run loop (task 4.4)

1. **Run.** Enabled once at least one part is placed; otherwise it says why in plain words. Space and the Run button both start it. While the build is unchanged since the last Run, the app reuses that Simulation and its seed (D37). Otherwise it disposes of the old one and awaits `createSimulation({ blueprint: canvas.blueprint, catalogue, arena, seed })`, with the arena preset the blueprint names and a fresh unsigned 32-bit seed.
2. **Start.** It keeps `start = simulation.snapshot()` (tick 0), calls `canvas.setMode('run')` and passes it `simulation.frame`.
3. **Spin-up.** Tick 0 stays on screen for one wall-clock second, so the child sees the wires light before the robot moves.
4. **Clock.** A `requestAnimationFrame` driver calls `simulation.step()` at the chosen rate: 30 ticks a second, or slow motion down to 1. Each frame goes to the canvas (`applyRunFrame`), the spec card (`frame.live`), the sound layer (`sound` events) and the challenge runner. In slow motion each step also plays the tick sound and its visual twin.
5. **Controls.** A switch flip goes to `simulation.input`: from the canvas's `control` event (a tap or click on the switch, Enter with it selected, the list view), or from the spec card. Space stays Run and Stop (D42).
6. **Stop.** `simulation.record(...)` goes to `store.runs`, with the previous Run of the same challenge or blueprint as `previous` and the challenge runner's verdict. Then `simulation.restore(start)` and `canvas.setMode('build')`: the build is exactly as it was, because nothing in Run mode writes to it (ground rule 4). The Simulation is kept for the next Run, and disposed of when the build changes or the child leaves it.

Wall-clock time lives only here. sim-core never reads it, and the canvas draws whatever frame it is given.

## Shared links and replay

A shared link (task 5.6) and replay on a phone open a read-only canvas (D43). The app re-simulates the run from the blueprint, seed and inputs, and shows it. A shared link's replay has no inputs and a seed from the build (README, "Shared links"). "Keep a copy", storing the build in one of the adult's child profiles with `blueprints.copy`, waits on where that action lives: opening a link never writes into a child's store. The original is never edited.

## Challenges and hints

- A challenge is laid over the same canvas: its goal line in the header, its arena preset on the blueprint, its kit in the tray (task 4.5). A breakdown or a what-if starts from `challenge.start`, kept as the child's own with `blueprints.copy`. The runner checks the goal over the Run's frames and ticks the header when it is met; the Run goes on. Its tests replay every content fixture that names a challenge (`@servo/content/fixtures`: the blueprint, its switch presses, its ticks) and compare the goal verdict with the fixture's.
- The hint ladder (task 4.6) picks the first ladder whose trigger holds, after two Runs that miss the goal or when asked. It draws the rungs with `canvas.showHint`, narrowing type targets to the placed part concerned, and applies do-it as one `batch` of commands.
