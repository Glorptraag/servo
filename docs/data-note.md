# What Servo keeps

Servo keeps each child's builds, Runs and card-game results so they can carry on where they left off. Besides those, it notes four kinds of event, to check whether Servo works: whether children pass the unscripted builds, which hints they needed, whether they come back to build on their own, how they fix faults, and whether they build the real kit. Nothing else is noted.

## The events

- `session-start`, each time Servo opens for a child: `mode`, the sandbox, or a challenge when one is chosen before the first Run.
- `run`, a Run of a challenge, once it is kept: `challenge`, which one; `runNumber`, how many Runs of it so far; `goalMet`, whether it met the goal.
- `hint`, a hint step shown or done: `challenge`, which one; `step`, which step of the hint ladder.
- `export`, in this parent view: `what`, a parts list made or a link made.

Each event also keeps the time it happened and which child it is about.

## What is never kept

No names, no text the child or you type, no build or its name, no device details. Nothing is used for advertising or sold.

## Where and for how long

The events are kept on this device only, beside the child's builds, and are never sent anywhere. The events stay until the child's profile is removed.

## How to delete it

Remove the child under Children above. Their builds, Runs, card-game results and events are all deleted. Clearing this site's data in the browser deletes everything Servo keeps on this device.
