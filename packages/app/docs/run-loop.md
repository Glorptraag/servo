# How the app drives the canvas and sim-core

Back to the [README](../README.md).

## Build mode

1. `openStore()` loads and validates the content once (`store.content`) and opens the child's records.
2. `mountCanvas(host, { catalogue: content.catalogue, resolveArt: (key) => content.art.get(key), level, prefs })`, then `canvas.load(blueprint)` with a blueprint from the store.
3. The tray hands a tile to the canvas with `canvas.beginPlacement(part, pointer?)` and is the canvas's remove target (`setRemoveTarget`).
4. `edit` events feed the undo history (the blueprints they carry; Undo loads the previous one with `canvas.load`) and saving through the store. `select` opens the spec card.
5. Every change the app makes itself goes through `canvas.apply`: spec-card settings (`set-setting`), the header's name (`rename`), the arena strip (`set-arena`), and the hint ladder's do-it (one `batch`). So every change to a build is an `EditCommand`.

## The run loop (task 4.4)

1. **Run.** Enabled once at least one part is placed; otherwise it says why in plain words. The app awaits `createSimulation({ blueprint: canvas.blueprint, catalogue, arena, seed })` with the arena preset the blueprint names and a fresh unsigned 32-bit seed.
2. **Start.** It keeps `start = simulation.snapshot()` (tick 0), calls `canvas.setMode('run')` and passes it `simulation.frame`.
3. **Spin-up.** Tick 0 stays on screen for one wall-clock second, so the child sees the wires light before the robot moves.
4. **Clock.** A `requestAnimationFrame` driver calls `simulation.step()` at the chosen rate: 30 ticks a second, or slow motion down to 1. Each frame goes to the canvas (`applyRunFrame`), the spec card (`frame.live`), the sound layer (`sound` events) and the challenge runner. In slow motion each step also plays the tick sound and its visual twin.
5. **Controls.** A switch flip, from the canvas's `control` event or the spec card, goes to `simulation.input`.
6. **Stop.** `simulation.record(...)` goes to `store.runs`, with the previous Run of the same challenge or blueprint as `previous` and the challenge runner's verdict. Then `simulation.restore(start)` and `canvas.setMode('build')`: the build is exactly as it was, because nothing in Run mode writes to it (ground rule 4).

Wall-clock time lives only here. sim-core never reads it, and the canvas draws whatever frame it is given.

## Challenges and hints

- A challenge is laid over the same canvas: its goal line in the header, its arena preset on the blueprint, its kit in the tray (task 4.5). The runner checks the goal over the Run's frames and ticks the header when it is met; the Run goes on.
- The hint ladder (task 4.6) picks the first ladder whose trigger holds, after two Runs that miss the goal or when asked. It draws the rungs with `canvas.showHint`, narrowing type targets to the placed part concerned, and applies do-it as one `batch` of commands.
