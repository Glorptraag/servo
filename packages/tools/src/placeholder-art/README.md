# Placeholder art and the swap registry

Task 0.6. Two dev-only tools in `packages/tools`: the generator in this folder and the registry in [`../swap-registry/`](../swap-registry/). Nothing at runtime imports either. Art reaches the app as data only: SVG files and `registry.json` in `packages/content/art/generated/`, which is gitignored and rebuilt by `pnpm art`.

```
packages/content/art/
  final/        final renders, dropped in by hand as <art key>.<avif|jpeg|jpg|png|svg|webp>   (committed)
  generated/    <art key>.svg placeholders and registry.json, written by pnpm art           (gitignored)
```

## `pnpm art`

```
pnpm art [--parts <folder>] [--out <folder>] [--final <folder>]
```

| Option | Default | |
| --- | --- | --- |
| `--parts` | `packages/content/parts` | Part records: every `.json` file under it, at any depth |
| `--out` | `packages/content/art/generated` | Where the placeholders and `registry.json` go |
| `--final` | `packages/content/art/final` | Where final renders are dropped in |

Relative paths are read from the working folder. Each run:

1. Reads and validates every record with `validatePartRecord`. Any problem stops the run before anything is written, and every problem is listed with its file and JSONPath.
2. Draws one placeholder per art key (`identity.art`) and writes it to `<out>/<art key>.svg`, so `part/dc-motor` becomes `part/dc-motor.svg`.
3. Resolves every key and writes `<out>/registry.json`.

It stops with a readable message, before writing, when:
- there are no records;
- two parts share an art key but draw different placeholders (one key holds one picture);
- `--out` and `--final` overlap;
- `--out` holds files it does not write (so a wrong `--out` cannot scatter files);
- a key has two final renders.

It warns, and carries on, about files in the final folder that no key uses: a misspelt key, or a type it does not take. It never deletes anything. Delete the generated folder to clear placeholders for parts that are gone.

There are no records under `packages/content/parts/` until tasks 2.1 and 2.2, so today `pnpm art` stops and says so. To see the art now, run `pnpm art --parts packages/schema/fixtures/parts`.

## The swap registry

Every part names an art key in `identity.art`. The registry resolves each key to its final render, `final/<key>.<type>`, when one exists, and otherwise to its placeholder, `<key>.svg` in the generated folder. File types match without regard to case. Hidden files such as `.gitkeep` are ignored. A key that resolves to nothing is an error that names the key and both places it looked.

`registry.json` maps every art key, in key order, to `{ src, isPlaceholder }`. `src` is relative to the folder that holds `registry.json`, with `/` separators:

```json
{
  "part/dc-motor": { "src": "../final/part/dc-motor.png", "isPlaceholder": false },
  "part/led": { "src": "part/led.svg", "isPlaceholder": true }
}
```

The app builds its own `resolveArt(assetKey)` from this file and injects it into the canvas: look the key up, throw on a missing key, and resolve `src` against the URL `registry.json` was served from. `resolveArt` in this package is the same lookup, for tools and tests.

## The placeholder tiles

`placeholderSvg(record)` is pure: the same record gives the same bytes on every machine. It reads only `body.size`, `identity.colours` and the kinds of the record's behaviour primitives (with an actuator's mode, a switch's actuation and what a load gives). It never reads the id, name, family, level, art key, ports or text, and a test proves it. Ports are drawn by the canvas, so the tile marks none.

**View.** Every tile uses one orthographic three-quarter view (`VIEW`): turned 60° from the front towards the part's right side, and 30° above it. The right side (−y) faces the viewer, the front (+x) shows at the right of the tile, and the top shows above. Light comes from the top left. Tops are lighter and front ends (at the right of the tile) darker. The right side, which faces the viewer, shows the schema colour unchanged. Curved surfaces shade in steps. Angles use the schema's deterministic `cosSin`.

**Proportions.** The SVG's user space is millimetres as the camera sees them, with the part's origin (the centre of its footprint, at its base) at 0, 0. The `viewBox` is the part's body box as the camera sees it, plus a margin as wide as the outline. Every shape stays inside that box, so the frame depends on `body.size` alone. A canvas that projects a port's `at` with the same view lands on the same spot of the tile. `width` and `height` make the longer side 160 px (`TILE_PX`), the largest part tile in brief Section 9. The outline is 1.2% of the longer side, so tiles look alike at tray size.

**Output.** Only `<svg>`, one `<g>` and filled `<path>`s with `#rrggbb` colours. There is no text, image, gradient, filter or script. The example parts come out between 0.8 and 4.6 KB.

**Forms.** The first rule a record's primitives meet decides what is drawn. Rules use the closed primitive vocabulary, never a part's identity, so a new record gets a picture without a code change (ground rule 1). Shapes fill the body box in its true proportions, in shades of the main colour, with the accent colour where the table says. There are no faces, eyes or characters (ground rule 7).

| Rule | Form | Drawn as | Example parts |
| --- | --- | --- | --- |
| `wheel` | `wheel` | A tyre round a hub (accent) on the face the camera sees. The axle is the box side that differs from the other two | large wheel |
| `support` | `ball-caster` | A ball under a round housing (accent) and a mounting plate | caster |
| `actuator` speed | `motor-can` | A can along the box's longest side, with an end cap (accent) at the far end and a bearing ring at the near end | DC motor |
| `actuator` position | `servo-case` | A tall case with mounting ears, a boss and a horn (accent) | servo motor |
| `program`, `driver` or `regulator` | `circuit-board` | A board with two header strips (accent) and a dark chip | microcontroller, motor driver |
| `source` | `battery-cells` | Round cells lying in a holder (accent), each cell as wide as the pack is tall, with a band (accent) at one end | 2-cell and 1-cell battery packs |
| `switch`, contact | `bumper` | A switch body with a bar (accent) across its front | bumper switch |
| `switch`, manual | `slide-switch` | A switch body with a dark slot and a knob (accent) | switch |
| `load` giving light | `led` | A domed lens on a rim (accent) | LED |
| `load` giving sound | `buzzer` | A round case with a seal (accent) and a sound hole on top | buzzer |
| `ratio` | `gear-housing` | A housing with a gear (accent) on the side the camera sees | gearbox |
| no primitives, height at most a tenth of its footprint | `plate` | A plate with slots (accent) through it | chassis |
| anything else | `block` | A block under a lid (accent) | none yet |

## Exports (`@servo/tools`)

| Export | What it does |
| --- | --- |
| `placeholderSvg(record)`, `tileFrame(record)`, `TILE_PX`, `VIEW` | The tile and its frame |
| `formOf(record)`, `FORMS` | Which form a record gets |
| `generateArt(options)`, `runArt(args, cwd, output)`, `parseArtArgs`, `DEFAULT_ART_OPTIONS`, `ART_USAGE` | `pnpm art`; `main.ts` is its entry |
| `resolveRegistry(input)` | Pure resolution of keys against lists of files |
| `buildRegistry(folders)`, `listFiles`, `writeRegistry`, `registryJson`, `REGISTRY_FILE` | The same against the disk |
| `resolveArt(registry, key)`, `placeholderPath(key)`, `FINAL_EXTENSIONS`, `ArtError` | Lookup, layout and the error every tool throws: a summary line and one line per problem |

## Tests

- `test/placeholder-art.test.ts` covers the following:
  - one tile per example part, compared byte for byte with `test/placeholder-art.snapshots/`;
  - valid SVG, under 6 KB;
  - the frame against an independent projection, and twice the size drawing the same tile at twice the scale;
  - every form staying inside its tile however its box is stretched;
  - light from the top left;
  - colours only from the schema colours;
  - nothing read beyond size, colours and behaviour.
- `test/swap-registry.test.ts` covers resolution, fallback, the errors and `pnpm art` end to end on temp folders.

After a deliberate change to the art, look at the new tiles and update the snapshots with `pnpm --filter @servo/tools exec vitest run -u`.

## Notes for the canvas

- **Mirrored mount points.** A part on a mirrored mount point is its mirror image ([geometry.md](../../../schema/docs/geometry.md)). Every form is symmetric side to side and places its details by the camera, so the mirror image draws the same tile. Flipping the image would put the light on the wrong side.
- **Rotation.** Turning a tile's image would turn its light and view with it. A part turned on the canvas needs a tile drawn from another side, which this generator does not make yet (question 3 below).

## Decisions and open questions

1. The registry covers `identity.art`, one key per part. `card.realWorldArt` is also a swap-registry key, but it is a photo that no placeholder can stand for, so it is left out. Is it the registry's job, and what shows until a photo arrives?
2. Final render types are `avif`, `jpeg`, `jpg`, `png`, `svg` and `webp`. The format and background are open under D6.
3. There is one view. If the canvas draws turned parts with art, the generator could draw the four quarter-turn views from the same records. Nothing asks for that yet.
4. Tiles keep the body's real proportions, so a flat chassis makes a wide tile. How the tray and canvas fit tiles into 96–160 px is for them to decide.
5. `pnpm art` stops while there are no part records, rather than writing an empty registry.
