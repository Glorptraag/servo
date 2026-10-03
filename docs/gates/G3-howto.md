# Gate G3 · How to run the hands-on test

G3 asks Drew to wire the two Level 1 kit robots by hand, on a tablet (iPad, Safari) and on a laptop. Both robots must run, and the list view must drive the same build. This page is the script for that session. Mark each step's **Pass / Fail** line, and add a note for any step that felt wrong even if it passed. Feel is the point of this gate.

The page is a dev-only test bench in `packages/tools/src/gate/`, not the app. The app's part tray is task 4.2 and its Run loop is task 4.4, both after G3. Everything on the canvas is the real `@servo/canvas`, and Run is the real `@servo/sim-core`.

## The two robots

Content has one Level 1 kit, **Rolling Start**: a 2-cell battery pack, a switch, 2 DC motors, 2 large wheels, a chassis and a caster. The page reads "the two Level 1 kit robots" as the two different working robots built from that kit's parts:

| Robot | Fixture | Parts | Connections | What it does |
| --- | --- | --- | --- | --- |
| 1 | `kit-rolling-start` | 8 | 12 | The kit's own robot. The switch is in the power line, so the robot drives forward until you open the switch. |
| 2 | `level-1-roller` | 7 | 10 | The same kit without the switch. Both DC motors are wired straight to the battery pack, so it drives forward. |

The picker also offers `switch-in-the-line`. It wires the same robot as robot 1, so G3 does not need it.

Both robots start from **an empty canvas**, with the chassis in the tray. This is the faithful test because the app opens a new build with no parts, and the Rolling Start kit puts the chassis in the tray like any other part. Placing the chassis yourself is part of building the robot. "Start with: The chassis placed" is there if you want to repeat the wiring without placing the chassis again.

A connection here means any one of these:
- a part on a mount point;
- a wheel on a shaft;
- a power line.

The status line counts all three.

## Starting the page

On the laptop, from the repo root:

```
pnpm install
pnpm gate:g3
```

The command runs `pnpm art` first, then a Vite server on every network interface. It prints lines like these:

```
  Gate G3 on this laptop: http://localhost:5190/
  Gate G3 on the iPad (same Wi-Fi): http://192.168.0.103:5190/
```

If port 5190 is busy, Vite takes the next free port, and the printed addresses show which one. Leave the terminal open for the whole session. Ctrl+C stops the server.

**Laptop:** open the `localhost` address in Chrome or Safari.

**iPad:**
1. Join the iPad to the same Wi-Fi as the laptop.
2. In Safari, type the "on the iPad" address. Use the `192.168.…` or `10.…` one; a `100.…` address is Tailscale and works only if the iPad is on the tailnet.
3. Hold the iPad in landscape.
4. If macOS asks whether Node may accept incoming connections, allow it. If the iPad cannot load the page, check that the laptop's firewall allows Node.

The first load takes a few seconds while Vite prepares the pages. When it is ready, the status line at the canvas's top left reads `kit-rolling-start, Rolling Start kit, Level 1. Build mode: 0 of 8 parts placed, …`

## What is on the page

- **Header.**
  - **Robot:** which robot you are building.
  - **Start with:** an empty canvas, or the chassis already placed.
  - **Start again:** clears the canvas back to the chosen start.
- **Tray (left).** The kit's parts with their pictures, real names and how many the kit has. You can place a part three ways:
  - drag a tile onto the canvas;
  - tap the tile, then tap the canvas;
  - turn on **Place by list**, then tap a tile to get a list of every place the part can go.

  To remove a part or wire, drag it back onto the tray.
- **Canvas.** Pan by dragging empty canvas. Zoom by pinching, or with the scroll wheel on a laptop. To remove the selected part, tap its bin handle, or press Delete on a keyboard.
- **What to build (top right).** The finished robot as a list of plain steps. Open it when you need a reminder.
- **Run bar (bottom).**
  - **Run / Stop.** Space does the same on a keyboard.
  - **Fit.**
  - **Tidy wires.**
  - **List view:** opens the canvas's Parts and wires panel and moves focus into it. Press it again to close.
- **Status line (top left).** It shows the robot, the mode and the counts. In Run mode it shows any part's simulated fault in the part record's own words, for example `DC motor 1: No complete circuit: the shaft stays still.` There are no dialogs. After Stop, it says whether the build came back exactly as it was before Run.

## Steps, robot 1: `kit-rolling-start`

Do steps 1–10 on the iPad by touch, then again on the laptop with a mouse or trackpad. On the laptop, use click-then-click at least once where the iPad used tap-then-tap.

**1. Start.** Choose Robot `kit-rolling-start`, Start with `An empty canvas`, and press Start again. The canvas is empty and Run is greyed out. The status line says `0 of 8 parts placed` and `Place a part from the tray to run the build.`
- Pass / Fail: ____

**2. Place the parts.** Use a drag for some parts and tap-then-tap for others:
- Drag the chassis to the middle of the canvas.
- Put the 2-cell battery pack on the rear deck.
- Put the switch on the front deck.
- Put one DC motor on each motor mount (left and right).
- Put the caster on the caster mount.
- Put one large wheel on each DC motor's shaft.

While a part is dragged, grey rings show where it can go. A part snaps when it comes close, and one let go in empty space slides to a free spot. The status line reaches `8 of 8 parts placed, 7 of 12 connections made`.
- Pass / Fail: ____

**3. First wire attempt.** Touch the battery pack's red plus (+) socket, drag to the switch's side A socket, and lift.
- Before you lift, the wire's end should snap and glow on the socket within about a finger's width.
- On lift, the wire settles in and both sockets fill.
- Try it once by drag, then remove the wire (tap it, then its bin) and make it again by tap-then-tap: tap plus (+), then tap side A.
- Pass / Fail: ____

**4. Wrong-type drop.** Drag from the battery pack's minus (−) socket, which is red, and lift it on a DC motor's grey shaft socket, or on a large wheel's hub. The shaft and hub sit together.

What you should see:
- the wire's end is pushed away from the grey socket and springs back;
- the red sockets that would take the wire glow;
- nothing is added: no wire, no text, no dialog, and the status line's connection count does not change.

Try it by tap-then-tap too: tap minus (−), then tap the grey socket. The wire reaches for the grey socket, is pushed away and keeps waiting. Tap empty canvas to let it go.
- Pass / Fail: ____

**5. Finish the wiring.** Make these power lines:
- each DC motor's plus (+) to the switch's side B;
- the battery pack's minus (−) to each DC motor's minus (−).

The status line reaches `8 of 8 parts placed, 12 of 12 connections made`.
- Pass / Fail: ____

**6. Tidy wires.** Press Tidy wires. The wires re-route around the parts' bodies, with no wire hidden under a part. The status line's counts do not change. Then press Fit: the whole robot shows.
- Pass / Fail: ____

**7. Run.** Press Run.
- For one second the wires light: red dots move along the power lines and the robot stays still. Then the wheels turn and the robot drives forward across the floor.
- The status line says `Run mode. No part shows a fault.`, and the clock counts up.
- The tray is hidden.
- If the robot leaves the view, press Fit.
- Tap the switch: it opens and the robot stops. Tap it again: it closes and the robot drives on.
- Pass / Fail: ____

**8. Stop.** Press Stop.
- The robot is back where you built it, the canvas is in Build mode and the tray is back.
- The status line says `Stopped: the build is exactly as it was before Run.`
- Press Run again: the Run starts from the same place.
- Press Stop.
- Pass / Fail: ____

**9. A simulated fault.** Remove the wire from the battery pack's minus (−) to one DC motor. Tap the wire, then tap its bin. Press Run.
- That motor's wheel stays still, its wire carries no dots, and the robot turns.
- The status line says `DC motor N: No complete circuit: the shaft stays still.` (N is 1 or 2). Other parts may show a fault line too. There is no dialog.
- Press Stop and put the wire back.
- Pass / Fail: ____

**10. The list view.**

How to drive it:
- **On the laptop:** use the keyboard. Tab to the List view button and press Enter. Tab moves through the panel and Enter does an action.
- **On the iPad:** turn on VoiceOver (Settings › Accessibility › VoiceOver, or triple-click the top button if that shortcut is set). Swipe right to move and double-tap to act.

The panel shows only while focus is in it. Without VoiceOver or a keyboard, a plain tap can close it. Note it if that happens, but the list view is the keyboard and screen-reader path.

Then build the robot from the list view:
1. Press Start again.
2. Turn on **Place by list** at the top of the tray. On the laptop, pressing Enter on a tile does the same.
3. Choose each tile in turn and pick where it goes. Each place reads like `Place switch on chassis front deck`.
4. For the wheels, choose the DC motor's shaft.
5. Open **List view**. Under each part's port, choose Actions, then `Connect to <part>, <port>`, for every power line in step 5.
6. Press Run with Space, or the Run button. In Run mode, the switch's actions offer `Open switch` and `Close switch`, and choosing one stops or starts the robot.
7. Press Stop.

Pass when:
- the status line reached `8 of 8 parts placed, 12 of 12 connections made`;
- the robot ran as in step 7.

Every action's words should use the parts' real names, with no exclamation marks.
- Pass / Fail: ____

## Steps, robot 2: `level-1-roller`

Choose Robot `level-1-roller`. Then repeat the steps on the iPad and the laptop with these changes:

**1. Start.** Empty canvas. The status line says `0 of 7 parts placed`.
- Pass / Fail: ____

**2. Place the parts.** Use the same places as robot 1, but leave the switch in the tray. The status line reaches `7 of 7 parts placed, 6 of 10 connections made`.
- Pass / Fail: ____

**3. First wire attempt.** Battery pack plus (+) to a DC motor's plus (+), by drag and by tap-then-tap, as in robot 1.
- Pass / Fail: ____

**4. Wrong-type drop.** The same as robot 1: a red socket's wire is let go on a grey shaft or hub, and is refused with the colour cue only.
- Pass / Fail: ____

**5. Finish the wiring.** Wire the battery pack's plus (+) to the other DC motor's plus (+). Then wire the battery pack's minus (−) to each DC motor's minus (−). The status line reaches `7 of 7 parts placed, 10 of 10 connections made`.
- Pass / Fail: ____

**6. Tidy wires,** then Fit, as in robot 1.
- Pass / Fail: ____

**7. Run.** After the one-second spin-up, the robot drives forward. It has no switch, so nothing stops it but Stop. The status line says `No part shows a fault.`
- Pass / Fail: ____

**8. Stop.** The build is back in Build mode, exactly as it was. The status line says so.
- Pass / Fail: ____

**9. The list view.** Build robot 2 again from Place by list and the List view panel, as in robot 1 step 10. Then Run and Stop.
- Pass / Fail: ____

## Gate verdict

| Check | iPad | Laptop |
| --- | --- | --- |
| Robot 1 wired by hand and runs | ____ | ____ |
| Robot 2 wired by hand and runs | ____ | ____ |
| Wrong-type drop refused with the colour cue only | ____ | ____ |
| Stop restores the build exactly | ____ | ____ |
| List view builds and runs the same robot | ____ | ____ |

G3 passes when every cell passes. Anything that felt wrong, even in a passing step, goes in the notes below. It becomes a canvas fix task before G4.

Notes:

## For the orchestrator

- Automated check: `pnpm gate:g3:test` serves this page with its own Vite config and opens it in Chromium in the iPad profile. By mouse, it places all 8 parts of `kit-rolling-start` from the tray onto their mount points and shafts, and checks that a wrong-type drop changes nothing. It then draws the 5 power lines and checks that the build has the fixture's 12 connections. Last, it presses Run, checks that the robot moves with no fault, presses Stop and checks the build bytes are unchanged.
- The page lives in `packages/tools/src/gate/` and touches no product package.
