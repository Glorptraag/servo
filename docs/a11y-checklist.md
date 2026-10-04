# Accessibility checklist (task 5.7)

The manual half of the accessibility pass. The automated half is `packages/app/test/browser/a11y.test.tsx`: axe-core finds no WCAG 2.2 A or AA violation on the build, the spec card, Home, a Run and a challenge's hint step, with each access option and with all of them, nor on Settings, the parental gate and the invite form. What axe cannot judge is below: a person with the device in hand.

The bar (brief Section 13): WCAG 2.2 AA for everything that is not the canvas, and a documented equivalent path for every canvas action. The access options are on Home, under "Display and reading", and on the Settings page (`/settings`).

## How to fill it in

Run `pnpm dev` (or open a tester release). Use the Level 1 roller (`level-1-roller` fixture) or any build with a battery pack, a switch and a DC motor. Write Pass or Fail on each line, and a note for each Fail. Every item starts from a fresh page with every option off unless it says otherwise.

## 1. Screen reader on iPad (VoiceOver, Safari, iPadOS 17 or newer)

| # | Check | Pass/Fail | Note |
| --- | --- | --- | --- |
| 1.1 | Swiping through the page reads the header, Part tray, Spec card, Arena strip and Run bar as named regions, in that order or close to it. | | |
| 1.2 | Every header control is read with a name: Home, the hint button, Sound (with on or off), Save, the build's name. | | |
| 1.3 | The canvas's list view is reachable, reads each part and wire ("DC motor, connected to battery pack power out"), and its Actions open by double-tap. | | |
| 1.4 | Selecting a part from the list view brings the spec card; its name, lines and ports read in order; the Read aloud button speaks the card. | | |
| 1.5 | A setting on the spec card (a choice or a slider) changes by swipe up and down, and the new value is read. | | |
| 1.6 | Run and Stop are read and work by double-tap; a disabled Run reads its plain reason. | | |
| 1.7 | Home opens, reads its heading, builds and challenges; Back to the build closes it and focus returns to Home. | | |
| 1.8 | Each switch under "Display and reading" reads its name, its description and on or off, and turns by double-tap. | | |
| 1.9 | Goal met, Save's line and a hint's line are read when they appear, without moving focus. | | |
| 1.10 | The parental gate (Home, For adults) reads its heading, its question, the answer field's label and Continue; a wrong answer's line is read. | | |
| 1.11 | In a challenge, the hint button reads its name, and each hint step's line is read as it shows. | | |
| 1.12 | Double-tapping a tray tile opens the list of places it can go (not a waiting tile), and double-tapping a choice there places the part; double-tapping Box or Post in the arena strip puts it on the floor at once. Both take the screen-reader path, which the app picks for a click with no pointer behind it (`detail` 0); only Chromium's Enter is checked by tests (review R-6.4 APP-6). If a double-tap gives a waiting tile instead, write Fail. | | |

## 2. Screen reader on a laptop (VoiceOver with Safari on macOS, or NVDA with Chrome or Firefox on Windows)

| # | Check | Pass/Fail | Note |
| --- | --- | --- | --- |
| 2.1 | The landmarks and headings lists show the regions and Home's headings with their names. | | |
| 2.2 | Items 1.2 to 1.9 again, by keyboard with the screen reader on. | | |
| 2.3 | The tray's tiles read their part names, and placing one from the keyboard is announced by the list view. | | |
| 2.4 | Nothing is read twice or read when hidden: a tucked panel and a closed Home are silent. | | |

## 3. Keyboard only (no mouse, no screen reader)

| # | Check | Pass/Fail | Note |
| --- | --- | --- | --- |
| 3.1 | Tab reaches every control in the header, tray, spec card, arena strip, Run bar, zoom control and the panel tabs, in a sensible order, with nothing skipped and no trap. | | |
| 3.2 | The focus ring is visible on every control, never hidden behind a panel, with every option off and with high contrast. | | |
| 3.3 | Space is Run and Stop anywhere except in a text field, a switch or a radio button; Enter presses a focused button. | | |
| 3.4 | Escape closes Home and the list view; focus goes back to where it was. | | |
| 3.5 | Every canvas action (place, wire, move, rotate, remove, set, select) can be done from the list view by keyboard alone. | | |
| 3.6 | Each "Display and reading" switch turns with Space, on Home and on Settings. | | |
| 3.7 | The parental gate is answered and passed by keyboard alone, with a visible focus ring. | | |
| 3.8 | The hint button is reached and pressed by keyboard; each press shows the next step. | | |

## 4. Zoom to 200%, and text spacing

| # | Check | Pass/Fail | Note |
| --- | --- | --- | --- |
| 4.1 | At 200% browser zoom on a laptop (1280 px wide window), no text is cut off and no control is lost; panels scroll inside themselves rather than the page. | | |
| 4.2 | At 200%, Home and Settings read in one column with no sideways scrolling. | | |
| 4.3 | With the dyslexia-friendly type on at 200%, the header, the Run bar and the spec card still show every control. | | |
| 4.4 | The canvas zooms to 400% with its own zoom control and pinch. | | |

## 5. High contrast

| # | Check | Pass/Fail | Note |
| --- | --- | --- | --- |
| 5.1 | Turning it on from Home changes the chrome at once to black on white, with black edges on panels and buttons, and the canvas to its high-contrast palette. | | |
| 5.2 | On the canvas, power, signal and mechanical lines are still told apart by style alone (solid, dashed, thick grey) and sockets by shape (round, square, hexagon), in a greyscale screenshot. | | |
| 5.3 | On the spec card, each port's socket shape and colour match the canvas's. | | |
| 5.4 | Disabled controls (Run with nothing placed, the arena strip in Run) still read as disabled and their words are legible. | | |
| 5.5 | It survives a reload and shows on the Settings page too. | | |
| 5.6 | The hint button and its line are legible and their focus ring visible. | | |

## 6. Left-handed layout

| # | Check | Pass/Fail | Note |
| --- | --- | --- | --- |
| 6.1 | Turning it on moves the part tray to the right and the spec card to the left, at once, in landscape. | | |
| 6.2 | The panel tabs move with them and still tuck and bring back their panels. | | |
| 6.3 | The canvas's handles (rotate, bin) on a selected part are on the other side. | | |
| 6.4 | Dragging a tile from the tray onto the canvas and back to the tray to remove it works with the tray on the right. | | |
| 6.5 | In portrait, the tray stays along the bottom and the spec card moves to the left. | | |
| 6.6 | It survives a reload. | | |

## 7. Read aloud

| # | Check | Pass/Fail | Note |
| --- | --- | --- | --- |
| 7.1 | With it off, nothing is read except by the spec card's own Read aloud button. | | |
| 7.2 | With it on, tapping the level name, the goal line, a Home heading or a button reads exactly the words shown, in a calm, unhurried voice. | | |
| 7.3 | Tapping a switch reads its name and on or off. | | |
| 7.4 | Goal met, Save's line and a hint's line are read as they appear. | | |
| 7.5 | Tapping on the canvas reads nothing (the canvas speaks through the list view). | | |
| 7.6 | Turning it off stops a line being read. | | |
| 7.7 | On iPad with VoiceOver on as well, the two do not talk over each other badly enough to confuse. | | |
| 7.8 | With Sound off in the header, read-aloud still reads (it is an access aid, independent of Sound), and its switch's line says "even with Sound off". | | |
| 7.9 | Typing a new name for the build reads nothing aloud. | | |

## 8. Dyslexia-friendly type

| # | Check | Pass/Fail | Note |
| --- | --- | --- | --- |
| 8.1 | Turning it on changes the face and spacing of the header, tray, spec card, Run bar, Home, the hint button and its line, and the canvas's labels and list view at once. | | |
| 8.2 | The face shown on the iPad and on the laptop is acceptable for a 6 to 8 year old early reader (note which face each device used). | | |
| 8.3 | No line of the Level 1 and 2 spec cards is cut off; a long card scrolls inside its panel. | | |

## 9. Words

| # | Check | Pass/Fail | Note |
| --- | --- | --- | --- |
| 9.1 | No new words use exclamation marks, praise, a character voice or a mascot name (ground rule 7). | | |
| 9.2 | The option names and their lines ("Tap any words to hear them, even with Sound off." included) ("Display and reading", "High contrast", "Dyslexia-friendly type", "Left-handed layout", "Read aloud") are words Drew is happy with. | | |

## Sign-off

Devices and versions used:

- iPad: ______________________ iPadOS ______ Safari ______
- Laptop: ____________________ OS ______ Browser ______ Screen reader ______

Every line above is Pass, or each Fail has an accepted note.

Signed: ______________________ (Drew Douglas)   Date: ______________
