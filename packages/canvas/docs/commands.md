# The command layer

Back to the [README](../README.md). The types are in [src/interface.ts](../src/interface.ts).

Ground rule 8 asks for a touch path, a pointer path and a list-view path for every canvas action. All three only ever emit an `EditCommand`, and one pure function applies it: `applyEdit(blueprint, command, catalogue)`. So the same steps give byte-identical blueprints on every path, which is task 3.6's acceptance and the e2e harness's parity check (task 3.8).

## What `applyEdit` promises

- A blueprint `validateBlueprint` accepts goes in, and one it accepts comes out, in canonical form (`canonicalizeBlueprint`).
- New ids come from `claimPartId` and `claimWireId`, which raise `meta.highWater`, so the same commands give the same ids. Ids are never reused.
- Wires go through `planWire`: it refuses impossible drops with the schema's `wire.*` codes and `mount.cycle`, and gives the stored orientation. Legal-but-wrong wiring is always accepted, because its failure on Run is the lesson.
- It is pure. It never reads the clock (`meta.updatedAt` is stamped by the store on save), never changes its input, and never throws, except the RangeError the id claims give once ids run out.

## The commands

| Command | Effect | Refused with |
| --- | --- | --- |
| `place-part` | A new part with the next `p<n>` id. `position` comes from the input path, already snapped; omitted (the list view, the hint ladder's do-it), the placement rule (task 3.2) picks the free spot. `mount` lands it on a mount point, which then decides where it sits | `ref.unknown_part_type`, the mount's `wire.*` codes |
| `move-part`, `rotate-part` | Parts fixed to it or carried by it follow. A part that is mounted, or carried on another part's shaft, comes off it in the same step, because the mount or shaft decides where it sits | `ref.unknown_placed_part` |
| `remove-part` | The part and every wire on its ports. Parts mounted on it, or carried by it, stay where they are, loose | `ref.unknown_placed_part` |
| `connect` | A power line, signal line or drive linkage between two ports, in either order, with the next `w<n>` id | `wire.*`, `ref.*`; `edit.wrong_command` for a mount pair |
| `disconnect` | Removes a power line, signal line or drive linkage | `edit.unknown_wire`; `edit.wrong_command` for a mount |
| `mount` | Fixes a placed part by its mount port onto a mount point, and moves it, with everything fixed to it or carried by it, to where the mount puts it (`mountPlacement`, `canvasPoseOf`). A mount already on that port is replaced | `wire.*`, `mount.cycle`, `port.wrong_kind` |
| `unmount` | Takes the part off the mount on that port; it stays where it is | `edit.unknown_wire` |
| `set-setting` | Checked as `validateBlueprint` checks settings. No value, or the default, goes back to the default | `ref.unknown_setting`, `setting.*`, `ref.unknown_option` |
| `set-arena` | Replaces the arena: the preset picker, props dragged in, Reset arena | `ref.unknown_arena`, `arena.outside`, `id.duplicate` |
| `rename` | The blueprint's name: child text, 1–60 characters on one line | `value.bad_format` |
| `batch` | Single commands in order, all or nothing: one `edit` event, one undo step. The hint ladder's do-it is one batch | the first refusal, with its `index` |

The handle adds two refusals of its own: `edit.locked` in Run mode and `edit.no_build` before the first `load`.

## Where the input paths differ

- Forgiveness is in screen pixels (a mount point within 48 px, a port within 32 px), so it depends on zoom and belongs to the input path. The path resolves the target, and the command names it; `applyEdit` places exactly where it is told.
- The setting's unlock level is the input path's concern too: the spec card and the list view offer only settings unlocked at the child's level.
- An impossible drop shows as a colour cue at the socket and the right colour glowing, never as text to the child. The list view offers only legal actions, so it never meets one.

## Undo

The app keeps the blueprint each `edit` event carries. Undo loads the previous one with `canvas.load`, which fires no `edit`.
