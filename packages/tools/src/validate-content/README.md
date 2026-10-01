# Content validator

`pnpm validate-content <path>...` checks content records against the schema and against the terminology lists. It is task 0.5. Every content task runs it before it is done (ground rule 14).

```sh
pnpm validate-content packages/content                      # everything in content
pnpm validate-content packages/content/parts/level-1        # one folder
pnpm validate-content packages/content/kits/rolling-start.json
pnpm -w validate-content parts                              # from inside packages/content
```

| Option | Meaning |
| --- | --- |
| `<path>...` | One or more record files, or folders searched for `.json` records. Relative paths start from the folder the command was typed in. |
| `--catalogue <folder>` | The parts, arenas and kits that kits, challenges, blueprints and run records are checked against. See [The catalogue](#the-catalogue). |
| `--terminology <folder>` | The folder that holds `components.json` and `banned.json`. Default: `packages/content/terminology`. |
| `-h`, `--help` | Prints the usage. |

The exit status is 0 when every record passes and 1 when there are issues. It is 2 when the command is misused: no path, an unknown option, a path that does not exist, a folder with no `.json` files, or an option folder that does not exist.

## Output

One line per issue gives the file, the code, the JSONPath and a message:

```text
kits/rolling-start.json: ref.unknown_part_type at $.parts[0].part: No part record has the id 'battery-pack'.
parts/no-port-type.json: value.missing at $.ports[0].type: Missing 'type'.
parts/sparky.json: terminology.not_real_name at $.identity.name: 'Sparky' contains no real component name. A part's name is built on a real name from the components list.
note: Catalogue: 14 part records, 3 arena presets and 2 kits from @servo/schema/fixtures, because packages/content holds no part records.
validate-content: 3 records checked, 3 issues in 3 files.
```

- Issues in the terminology files come first, then the records' issues, file by file in walk order.
- `note:` lines then say what the run could not check, such as a missing terminology list, and where the catalogue came from. Notes never fail a run.
- The last line is the summary.
- Paths inside the folder the command was typed in are shown relative to it, and other paths in full.

## Records and their kinds

A folder is walked recursively in name order. The walk skips these:
- `node_modules`;
- folders whose names start with `.`;
- any `terminology` folder, which holds lists, not records;
- `package.json` and `tsconfig*.json`;
- symbolic links.

Every other `.json` file is one record, and a file named on the command line is always read.

The nearest record folder above a file gives its kind. For a file in the repository, only folders below its root count, so a checkout under a folder called `parts` changes nothing. For a file outside it, every folder in its path counts.

| Folder | Kind | Schema validator |
| --- | --- | --- |
| `parts/` | part record | `validatePartRecord` |
| `arenas/` | arena preset | `validateArenaPreset` |
| `kits/` | kit | `validateKit`, with the catalogue |
| `challenges/` | challenge | `validateChallenge`, with the catalogue |
| `blueprints/` (for example `fixtures/blueprints/`) | blueprint | `validateBlueprint`, with the catalogue |
| `run-records/` | run record | `validateRunRecord`, with the catalogue |

So `packages/content/parts/level-1/dc-motor.json` is a part record and `packages/schema/fixtures/kits/valid/rolling-start.json` is a kit.

A file below no record folder gets the shape check: it is the kind whose fields it has.

| Kind | Fields that only this kind has at the top level |
| --- | --- |
| part record | `identity`, `body`, `ports`, `needs`, `behaviour`, `failureModes`, `card` |
| arena preset | `walls`, `zones`, `lines`, `ramps` |
| kit | `tray` |
| challenge | `title`, `goalLine`, `introduces` |
| blueprint | `wires`, `meta` |
| run record | `blueprintId`, `seed`, `tickRate`, `runNumber`, `inputs`, `faults`, `fixed` |

A file with the fields of no kind, or of more than one, is refused as `file.unknown_kind`. A folder always wins over the fields, so a kit put in `parts/` is refused by the part validator, with every field it gets wrong.

## What is checked

1. **The schema.** Each record goes through its kind's validator from `@servo/schema`. Their issues are passed through unchanged, with the schema's codes, paths and messages ([validation.md](../../../schema/docs/validation.md)). The schema refuses exclamation marks and badly formed text in every system-text field.
2. **Banned words and lone glosses.** The banned list and the glosses are checked against every system-text field of the record:
   - **Part record:** `identity.name`, `ports[].label`, `settings[].label`, `settings[].options[].label`, `failureModes[].teachingNote`, `cardLine` and `hint`, and `card.does`, `needs`, `gives`, `popularMechanics`, `specLine` and `safetyNote`.
   - **Arena preset and kit:** `name`.
   - **Challenge:** `title`, `goalLine`, `hints[].steps[].line`, and the name of its starting blueprint, `start.meta.name`.
   - **Blueprint:** `meta.name`.
   - **Run record:** nothing, because sim-core makes it.

   These are exactly the fields the schema reads as system text, plus blueprint names, and a test keeps the two equal. In the app, a blueprint's name is the child's own text, so voice rules do not apply. A content blueprint's name is authored, though, and children see it, so the terminology lists apply to it.
3. **Part names.** A part record's `identity.name` is checked against the components list. See [Part names](#part-names).
4. **Ids.** No two records of the same kind may share an `id`. Only records that pass the schema claim their id, because only they can enter a catalogue.

## The catalogue

Kits, challenges, blueprints and run records name parts, arenas and kits, and the schema checks those names against a catalogue. The catalogue is built only when one of these records is checked. Its source is always given in a note.

- **By default**, it is built from every part record, arena preset and kit in `packages/content`, found by the same walk and rules as above. Only records that validate are taken. Kits are checked against the folder's own parts and arenas, and the first record wins when two share an id. A record that is left out gets a note, unless it is also being checked, because then its issues are already shown.
- **While `packages/content` holds no part record files**, the default falls back to the schema's examples in `@servo/schema/fixtures`: 14 part records, 3 arena presets and 2 kits. So schema fixtures check cleanly before task 2.1 lands. The note says so.
- **`--catalogue <folder>`** builds it from that folder in the same way, with no fallback. Use `--catalogue packages/schema/fixtures` to check the schema fixtures once content exists. Its invalid kit fixture is left out with a note.

## Terminology format

The lists live in `packages/content/terminology/`. Task 2.5 authors them, and the app may read them later. There are two JSON files. A missing file is an empty list, and an empty list turns its checks off, with a note. Unknown fields are refused, as in the schema.

`components.json` holds the real component names, with the plain-language glosses that may sit beside them (brief Section 12):

```json
{
  "components": [
    { "name": "DC motor" },
    { "name": "chassis", "glosses": ["frame"] },
    { "name": "microcontroller", "glosses": ["brain"] }
  ]
}
```

- `name` is the real name as it reads mid-sentence, in its own case. `glosses` is optional.
- List the base name only (`battery pack`, `wheel`). Qualifiers such as `2-cell` or `large` sit beside it in a part's name.

`banned.json` holds the banned words and phrases, each with its reason, and an allow-list:

```json
{
  "banned": [
    { "phrase": "points", "reason": "Servo keeps no score (ground rule 7, D22)." },
    { "phrase": "brain-y bit", "reason": "A character-style name: say microcontroller (brief Section 12)." }
  ],
  "allowed": ["mount point", "mount points"]
}
```

- `reason` ends the message, so write it as a sentence.
- `allowed` is optional.
- Exclamation marks need no entry, because the schema refuses them everywhere (`text.exclamation`).

Every name, gloss, phrase and reason must be one line with no spaces at either end, and every name, gloss and phrase must hold at least one word. Anything else is refused as `terminology.bad_file`, and so are:
- an entry listed twice;
- a banned phrase that is also allowed, a real name or a gloss, because it could never be refused.

A malformed entry is left out of the run, and the rest of its file is still used.

### Matching

- A **word** is a run of letters and digits. Spaces, hyphens, apostrophes and punctuation only separate words. Words compare without case, accents or full-width forms, so `brain-y bit`, `Brain-Y bit` and `brain y bit` match the same entry.
- A banned word or phrase matches **whole words** only. `points` matches `Points` and `points,`, but not `checkpoints`.
- A banned word inside an **allowed phrase, a real name or a gloss** is not refused (D22). `mount points` passes, while `Score points on the mount points` is refused for its first `points`.
- There is one issue per banned entry per field. The message quotes the text as written.

### Glosses

A gloss explains a real name and never replaces it (brief Section 12). So in system text, a gloss passes only when its real name is in the same field, matched as whole words in any case:
- `Loose: the chassis (frame) drags on the floor.` passes.
- `Loose: the frame drags on the floor.` is refused as `terminology.gloss_alone`.
- A gloss listed for several components passes beside any of their real names.
- Words inside a real name, an allowed phrase or a banned phrase are not a gloss's use. The `motor` in `servo motor` is part of the real name, and a banned phrase reports its own words.
- There is one issue per gloss per field.

### Part names

When the components list names at least one component, a part's `identity.name` must:

1. contain a listed real name as whole words. Qualifier words may stand beside it, as in `large wheel` and `1-cell battery pack`. A name with none is refused as `terminology.not_real_name`, such as `Sparky` or `zappy wire`. A gloss in place of the real name, such as `frame`, is also refused as `terminology.gloss_alone`, as in any system text;
2. write that real name exactly as listed, with the same case, spaces and hyphens. `Dc motor`, `DC-motor` and `led` are refused as `terminology.name_form`;
3. have no capitalised word outside the real name. Names read mid-sentence, so `Sparky the DC motor` and `Large wheel` are refused as `terminology.proper_name`. All-capital marks such as `AA` pass.

## Issue codes

Schema codes are listed in [validation.md](../../../schema/docs/validation.md). The validator adds these:

| Code | Meaning |
| --- | --- |
| `file.unreadable` | The file could not be read. |
| `file.bad_json` | The file is not valid JSON. |
| `file.unknown_kind` | The file is in no record folder, and its fields match no kind of record or more than one. |
| `content.duplicate_id` | Another record of the same kind already uses this id. |
| `terminology.banned` | System text uses a word or phrase on the banned list. |
| `terminology.gloss_alone` | System text uses a plain-language gloss without its real name in the same field. |
| `terminology.not_real_name` | A part's name contains no real component name from the components list. |
| `terminology.name_form` | A part's name writes a real component name differently from the list: another case, spacing or hyphen. |
| `terminology.proper_name` | A part's name has a capitalised word outside its real name, which reads as a character's name. |
| `terminology.bad_file` | A terminology file is not valid JSON or does not follow the terminology format. |

## From code

`@servo/tools` exports these:
- `validateContent(options)`, which returns `{ files, issues, notes }` and never throws on bad content;
- `loadTerminology(folder)`;
- `runValidateContent(argv, environment)`, the command itself with its folders and output passed in;
- `CONTENT_ISSUE_CODES`.

`main.ts` is the entry that `pnpm validate-content` runs with Node 24+, with no build step.

Tests are in `packages/tools/test/validate-content*.test.ts`. Their lists in `packages/tools/test/validate-content/terminology/` are modelled on CLAUDE.md's terminology. They are test data, not the real lists.

## Decisions and open questions

The validator takes these conservative readings, for review:

1. A content blueprint's `meta.name` gets the terminology lists, though the schema treats blueprint names as child text.
2. Part names must contain a listed real name and have no capitalised word outside it (`terminology.proper_name`). This is how a character-style name is caught beyond the banned list.
3. A gloss must sit beside its real name in the same field (orchestrator ruling on brief Section 12). The schema's example parts were reworded to match: `frame` alone became `chassis (frame)` on card lines and `chassis` in hints and teaching notes.
4. Run records are checked against the schema only, so that fixture folders check cleanly. They are not content.
