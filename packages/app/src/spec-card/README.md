# The spec card (task 4.3)

Back to the [package README](../../README.md). The card for the selected part, in the shell's `specCard` slot ([docs/shell.md](../../docs/shell.md), "The spec card"): the panel slides in while a part is selected, and the card keeps showing the last part while it slides out. Everything on it comes from the part record and the placed part (ground rule 1); no part is named in this folder.

| File | What |
| --- | --- |
| [spec-card.tsx](spec-card.tsx) | `SpecCard`, reading `useShell()`: content, level, canvas, mode, blueprint, selection |
| [model.ts](model.ts) | Pure: which layers show at a level, the title, ports, unlocked settings with their values, failure lines |
| [readouts.ts](readouts.ts) | Pure: each live value with its real unit |
| [settings.tsx](settings.tsx) | A choice as big buttons side by side; a number as a slider in the record's steps with its unit |
| [picture.tsx](picture.tsx) | The part's picture from the swap registry, or a vector placeholder from its colours and proportions (ground rule 12) |
| [speech.ts](speech.ts) | Speak-it through `speechSynthesis` |
| [frames.ts](frames.ts) | `createRunFrames()`: where the run loop hands the card each Run frame |

## What shows

In this order. Layers follow the schema's `SPEC_CARD_LAYERS`, so the level decides how much shows (brief Section 12).

| Part of the card | Shows | From |
| --- | --- | --- |
| Picture, real name (bold, first letter capitalised), speak-it | Every level | `identity.art`, `identity.name` |
| Live readouts | Run mode, for the parts that report values | `frame.live.get(partId).values` |
| Failure lines | Run mode, while the failure happens; polite live region | `frame.live.get(partId).faults` → each mode's `cardLine`, in the record's order |
| What it does | Level 1 | `card.does` |
| Needs, gives | Level 2 | `card.needs`, `card.gives` |
| Ports, each with its socket shape and colour (round red power, square yellow signal, hexagon grey mechanical) | Every level | `ports[].label`, `ports[].type` |
| Settings | Each from its own `unlockLevel` (D15: driver channels at Level 2), or earlier when the card's `unlocked` prop names it (the Level 3 slot names the servo motor's angle, task 6.6) | `settings`, the placed part's `settings` or the default |
| Spec line | Level 4 | `card.specLine` |
| Popular mechanics, with the real-world picture where the registry has one | Level 2 | `card.popularMechanics`, `card.realWorldArt` |
| Safety note | With the popular-mechanics line | `card.safetyNote` |

Nothing is cut off: every line wraps, and a card taller than the panel scrolls inside it. At the 10-inch landscape size (1180 × 820) the panel is 320 × 308 px. With macOS's system face every Level 1 card fits without scrolling, and at Level 2 the wheels fit and the rest scroll; how much fits depends on the typeface, which task 5.7 chooses, so the test reports it rather than asserting it.

## Stepping aside for a wire

While a wire is on its way by any path, a drag, tap-then-tap or a port's actions in the list view, the card steps aside (`setSpecCardAside`), so it never covers a port being wired (D66, task 7.8, R-6.4 APP-7). It listens for the canvas's `wire` event and comes back when the event clears: the wire landed, was let go, or Run began. The shell's own watch for drags on the canvas stays as it was. Pressing a socket on the canvas clears the part selection (the canvas's rule, task 3.4), so after a canvas wire the card shows again once a part is selected; a list-view wire keeps the selection, and the card comes straight back. Tested in [test/browser/spec-card-aside.test.tsx](../../test/browser/spec-card-aside.test.tsx) on all three paths with the target socket under the open card.

## Settings

A change is `canvas.apply({ kind: 'set-setting', partId, setting, value })`, so it is one Undo step, the list view follows it (rule 8), and the card shows the value the build then holds. A choice is a group of native radio buttons drawn as one row of 44 px buttons: tap, click, the arrow keys and screen readers all work it. A number is a native range input in the record's `min`, `max` and `step`, its value with the real unit beside it (`90°`, `50%`, `6 V`), 44 px tall: drag, click, arrows. A drag changes the build once, when it lets go; a refused change goes back. In Run mode the settings show but are disabled, and the canvas refuses edits anyway (ground rule 4).

## Live readouts

The run loop (task 4.4) gives App.tsx every frame it gives the canvas. App.tsx pushes into the `RunFrames` it makes every third tick, and every tick where a switch or a fault changes (`readoutFrameDue`, task 6.1, [docs/perf.md](../../../../docs/perf.md)), and `runFrames.clear()` on Stop. The card renders again only when its part's values or faults changed. In Run mode the card shows `frame.live` for its part: exactly the fold of the RunEvents so far, which is the run record's value at that tick. Each row keeps the exact value in `data-value`; the text rounds it for reading:

| Value | Label | Shown |
| --- | --- | --- |
| `volts` | Voltage | `2.9 V` (one decimal) |
| `milliamps` | Current | `131 mA` |
| `charge` (0–1) | Charge | `98%` |
| `rpm` | Speed | `95 rpm`, `−95 rpm` turning the other way |
| `angle` | Angle | `90°` |
| `light` (0–1) | Light | `50%` |
| `signal` (0–1) | Signal | `100%` |
| `closed` | Switch | `Closed` or `Open` |

Negative values use a real minus sign; a value that rounds to zero reads `0.0 V`, never `−0.0 V`.

## Speak-it

One 44 px button beside the name, "Read aloud" to a screen reader. It reads the text of every element marked `data-speak`, in the order they show, one utterance per line, at rate 0.9, in the page's language: the name, readouts (label, then value), failure lines, the text layers, each port, each setting's name and the option or value chosen, the popular-mechanics line and the safety note. Unchosen options and the button itself are not read. Pressed again it starts again. Where the browser has no `speechSynthesis`, there is no button.

## Tests

- **Unit, Node** ([test/spec-card/](../../test/spec-card/)). Every Level 1–2 part's layers at Levels 1 and 2; settings by level, with values and defaults; units; failure lines in order. Readout text. Every content fixture run on the real sim-core: at every tick, every part's readouts equal the fold of the run record's value events.
- **Browser, Chromium** ([test/browser/spec-card.test.tsx](../../test/browser/spec-card.test.tsx)). The real shell at 1180 × 820 with the real content and a stand-in canvas that applies commands with the canvas's `applyEdit`. Every Level 1–2 card at Levels 1 and 2: its words, ports and settings, the panel 320 × 308, nothing past the card's sides, clipped, ellipsed or clamped, the last line reachable; which cards fit without scrolling is printed. Settings by mouse, finger (CDP touch) and arrow keys, one `set-setting` each, the card following Undo; locked in Run; the servo motor's angle slider at Level 3 by arrow key and by drag, one change on release. Readouts on the card equal to the run record's values for every part at every tick of switch-in-the-line; the failure line of broken-missing-return-wire while it happens, and no dialog. Speak-it's lines, rate and restart; readouts and failure lines read in Run; no button without speech.

## Decisions and open questions

Taken conservatively, for Drew and the orchestrator:

1. Ports show at every level: Section 4 and 9 of the brief list them on the card, Section 12's layer table does not give them a level.
2. The safety note shows with the popular-mechanics line (Level 2), where the card points at real things; at Level 1 the card points at no real kit. Drew may want it at every level.
3. Live readouts show at every level, with units, as brief Section 9 has them in Run; Section 10 says units come in at Level 3+. Rounding: volts to one decimal, the rest whole numbers, 0–1 fractions as percent.
4. A motor coasting with an open circuit reads its back-EMF, for example `−0.6 V` (R-1.3). The card shows what the run record says; whether a child should see a negative voltage there is for Drew.
5. One speak-it button for the whole card, not one per line (Section 12 says every line of system text has one). Units are read as written (`V`, `mA`, `rpm`).
6. Failure lines show only in Run, while the failure lasts.
7. The labels `Voltage`, `Current`, `Charge`, `Speed`, `Angle`, `Light`, `Signal`, `Switch`, `Closed`, `Open` and `Read aloud` are app text, not content.
8. Not built: flipping a switch from the card in Run (docs/run-loop.md mentions it; the canvas's tap, Enter and list view already do it).
