/// <reference lib="dom" />
// Gate G3's hands-on page (dev only, `pnpm gate:g3`): the real canvas with a tray of one Level 1 kit robot's parts, a
// Run and Stop that drive sim-core through its interface, Fit, Tidy wires, the list view, and one status line. It is
// not the app's tray (task 4.2) or run loop (task 4.4): only what Drew needs to wire the Level 1 kit robots by hand on
// a tablet and a laptop. Every name on it comes from the content records (ground rules 1 and 7). How Drew uses
// it: docs/gates/G3-howto.md.
import { applyEdit, mountCanvas } from '@servo/canvas';
import type { CanvasHandle, CanvasPrefs, ListAction } from '@servo/canvas';
import { probeCanvas } from '@servo/canvas/testing';
import type { CanvasProbe } from '@servo/canvas/testing';
import { loadContent } from '@servo/content';
import type { Content } from '@servo/content';
import { loadFixtures } from '@servo/content/fixtures';
import { TICK_RATE, serializeBlueprint } from '@servo/schema';
import type { Blueprint, PartTypeId } from '@servo/schema';
import type { RunFrame } from '@servo/sim-core';
import { emptyBuild, gateRobots } from './robots.ts';
import type { GateRobot } from './robots.ts';
import { GateRun } from './run.ts';
import type { RunPhase } from './run.ts';

const PREFS: CanvasPrefs = { dragSensitivity: 1, leftHanded: false, highContrast: false, typeface: 'standard' };

/** A press on a tray tile that moves this far (CSS px, over the drag sensitivity) is a drag; less is a tap. */
const DRAG_START_PX = 8;

/** What the canvas starts with. Empty is the faithful test: the app opens a new build with no parts, and the kit's tray holds the chassis. */
export type StartState = 'empty' | 'chassis';

/** What the page offers a test, on `window.servoGate`. */
export interface Gate {
  readonly content: Content;
  readonly robots: readonly GateRobot[];
  readonly robot: GateRobot;
  readonly start: StartState;
  readonly handle: CanvasHandle;
  readonly probe: CanvasProbe;
  readonly run: GateRun;
  /** The status line's words, as a screen reader hears them. */
  readonly status: string;
  choose(name: string, start?: StartState): void;
}

declare global {
  interface Window {
    servoGate?: Gate;
  }
}

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] => {
  const made = Object.assign(document.createElement(tag), props);
  made.append(...children);
  return made;
};

const required = <T extends Element>(root: ParentNode, selector: string): T => {
  const found = root.querySelector<T>(selector);
  if (!found) throw new Error(`The gate page has no ${selector}.`);
  return found;
};

/** Starts the page in `root` (index.html's layout). Resolves once the canvas's renderer is up. */
export const startGate = async (root: HTMLElement): Promise<Gate> => {
  const { content, issues } = loadContent();
  if (issues.length > 0) console.warn('Content has issues:', issues);
  const robots = gateRobots(content, loadFixtures().fixtures);
  const first = robots[0];
  if (!first) throw new Error('No Level 1 fixture robot with a Level 1 kit in the content.');

  const picker = required<HTMLSelectElement>(root, '#robot');
  const startPicker = required<HTMLSelectElement>(root, '#start');
  const about = required<HTMLElement>(root, '#about');
  const steps = required<HTMLOListElement>(root, '#steps');
  const tray = required<HTMLElement>(root, '#tray');
  const tiles = required<HTMLElement>(root, '#tiles');
  const places = required<HTMLElement>(root, '#places');
  const said = required<HTMLElement>(root, '#said');
  const byList = required<HTMLButtonElement>(root, '#by-list');
  const host = required<HTMLElement>(root, '#canvas');
  const runButton = required<HTMLButtonElement>(root, '#run');
  const statusLine = required<HTMLElement>(root, '#status');
  const clock = required<HTMLElement>(root, '#clock');

  const handle = mountCanvas(host, { catalogue: content.catalogue, resolveArt: (key) => content.art.get(key), level: first.fixture.blueprint.meta.level, prefs: PREFS });
  const probe = probeCanvas(handle);
  handle.setRemoveTargets([tray]);

  let robot = first;
  let start: StartState = 'empty';
  let note = '';
  let problem = '';

  const run = new GateRun({
    canvas: handle,
    catalogue: content.catalogue,
    seed: first.fixture.seed,
    onChange: (phase, frame, why) => {
      if (why) problem = why;
      show(phase, frame);
    },
  });

  // ---------------------------------------------------------------------------------------------------------
  // The status line: the robot, the mode and any simulated fault, in plain words. Never a dialog (ground rule 9).

  /** The list view's name for a placed part, with its twin's number: `DC motor 1`. */
  const partName = (id: string): string => {
    const listed = handle.listView.parts.find((part) => part.partId === id);
    return listed ? (listed.description.split(',')[0] ?? listed.name) : id;
  };

  const faultsOf = (frame: RunFrame): string[] => {
    const build = handle.blueprint;
    const lines: string[] = [];
    for (const [subject, live] of frame.live) {
      const placed = build?.parts.find((part) => part.id === subject);
      const record = placed && content.catalogue.parts.get(placed.part);
      for (const id of live.faults) {
        const line = record?.failureModes.find((mode) => mode.id === id)?.cardLine ?? id;
        const name = partName(subject);
        lines.push(`${name.charAt(0).toUpperCase()}${name.slice(1)}: ${line.endsWith('.') ? line : `${line}.`}`);
      }
    }
    return lines;
  };

  let spoken = '';
  const say = (words: string): void => {
    if (words === spoken) return;
    spoken = words;
    statusLine.textContent = words;
  };

  const show = (phase: RunPhase, frame?: RunFrame): void => {
    const build = handle.blueprint;
    const target = robot.fixture.blueprint;
    const head = `${robot.fixture.name}, ${robot.kit.name} kit, Level ${target.meta.level}.`;
    const placedParts = build?.parts.length ?? 0;
    runButton.textContent = phase === 'build' || phase === 'failed' ? 'Run' : 'Stop';
    runButton.setAttribute('aria-pressed', String(phase !== 'build' && phase !== 'failed'));
    runButton.disabled = placedParts === 0 && (phase === 'build' || phase === 'failed');
    root.dataset.mode = phase;
    clock.textContent = frame ? `${(frame.tick / TICK_RATE).toFixed(1)} s` : '';
    switch (phase) {
      case 'build':
      case 'failed': {
        const counts = `Build mode: ${placedParts} of ${target.parts.length} parts placed, ${build?.wires.length ?? 0} of ${plural(target.wires.length, 'connection', 'connections')} made.`;
        const reason = placedParts === 0 ? ' Place a part from the tray to run the build.' : '';
        const failed = phase === 'failed' ? ` ${problem} The build is as it was.` : '';
        say(`${head} ${counts}${reason}${failed}${note ? ` ${note}` : ''}`);
        return;
      }
      case 'loading':
        say(`${head} Getting the Run ready.`);
        return;
      case 'spin-up':
      case 'running': {
        const faults = frame ? faultsOf(frame) : [];
        say(`${head} Run mode. ${faults.length === 0 ? 'No part shows a fault.' : faults.join(' ')}`);
        return;
      }
    }
  };

  // ---------------------------------------------------------------------------------------------------------
  // Run and Stop: the Run button, and Space (D42), which the list view leaves to the app.

  const toggleRun = (): void => {
    if (run.phase === 'build' || run.phase === 'failed') {
      const build = handle.blueprint;
      if (!build || build.parts.length === 0) return;
      handle.cancelPlacement();
      closePlaces();
      note = '';
      void run.run();
    } else {
      run.stop();
      const after = handle.blueprint;
      note =
        after && serializeBlueprint(after) === run.startedFrom
          ? 'Stopped: the build is exactly as it was before Run.'
          : 'Stopped: the build is not as it was before Run.';
      show('build');
    }
  };

  runButton.addEventListener('click', toggleRun);
  const typing = (target: EventTarget | null): boolean => target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement;
  window.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== ' ' || typing(event.target)) return;
      event.preventDefault();
      if (!event.repeat) toggleRun();
    },
    true,
  );
  window.addEventListener(
    'keyup',
    (event) => {
      if (event.key === ' ' && !typing(event.target)) event.preventDefault();
    },
    true,
  );

  required<HTMLButtonElement>(root, '#fit').addEventListener('click', () => handle.fit());
  required<HTMLButtonElement>(root, '#tidy').addEventListener('click', () => {
    if (handle.mode === 'build') handle.tidyWires();
  });

  // The list view shows while focus is in it (packages/canvas/docs/surface.md). This button puts focus there, or
  // takes it out again.
  const listToggle = required<HTMLButtonElement>(root, '#list');
  const listView = (): HTMLElement | null => host.querySelector<HTMLElement>('.servo-list-view');
  let listWasOpen = false;
  listToggle.addEventListener('pointerdown', () => {
    listWasOpen = listView()?.hasAttribute('data-open') ?? false;
  });
  listToggle.addEventListener('click', (event) => {
    const panel = listView();
    if (!panel) return;
    const open = event.detail === 0 ? panel.hasAttribute('data-open') : listWasOpen;
    if (open) listToggle.focus();
    else panel.querySelector<HTMLElement>('h2')?.focus();
  });

  // ---------------------------------------------------------------------------------------------------------
  // The tray: the kit's parts as tiles, from content records only. Drag a tile onto the canvas, or tap it and then
  // tap the canvas, both through the canvas's beginPlacement. With "Place by list" on, or from the keyboard, a tile
  // lists the places the list view offers for it instead (`placementsFor`), the tray's path for screen readers.

  let pressed: { part: PartTypeId; pointerId: number; x: number; y: number; handed: boolean } | undefined;
  let waiting: PartTypeId | undefined;

  const mark = (): void => {
    for (const tile of tiles.querySelectorAll<HTMLButtonElement>('button[data-part]')) tile.setAttribute('aria-pressed', String(tile.dataset.part === waiting));
  };

  handle.on('placement', () => {
    waiting = undefined;
    mark();
  });
  handle.on('edit', () => show(run.phase));

  const closePlaces = (): void => {
    places.replaceChildren();
    places.hidden = true;
  };

  const offerPlaces = (part: PartTypeId, name: string): void => {
    if (handle.mode !== 'build') return;
    handle.cancelPlacement();
    const actions = handle.listView.placementsFor(part);
    const list = element('ul');
    for (const action of actions) {
      const button = element('button', { type: 'button', textContent: action.label });
      button.addEventListener('click', () => perform(action, name));
      list.append(element('li', {}, button));
    }
    const close = element('button', { type: 'button', textContent: 'Close' });
    close.addEventListener('click', () => {
      closePlaces();
      tiles.querySelector<HTMLButtonElement>(`button[data-part="${part}"]`)?.focus();
    });
    const heading = element('h3', { tabIndex: -1, textContent: actions.length > 0 ? `Where the ${name} can go` : `The ${name} has nowhere to go` });
    places.replaceChildren(heading, list, close);
    places.hidden = false;
    heading.focus();
  };

  const perform = (action: ListAction, name: string): void => {
    const done = handle.listView.perform(action);
    said.textContent = done ? `Placed the ${name}: ${action.label}.` : `The ${name} was not placed.`;
    closePlaces();
  };

  const drawTray = (): void => {
    closePlaces();
    const groups = new Map<string, HTMLElement>();
    tiles.replaceChildren();
    for (const tile of robot.tray) {
      let group = groups.get(tile.family);
      if (!group) {
        group = element('ul', { className: 'group' });
        groups.set(tile.family, group);
        tiles.append(group);
      }
      const picture = element('img', { alt: '', draggable: false, src: tile.picture ?? '' });
      if (!tile.picture) picture.hidden = true;
      const button = element('button', { type: 'button', className: 'tile' }, picture, element('span', { className: 'name', textContent: tile.name }), element('span', { className: 'count', textContent: `× ${tile.quantity}` }));
      button.dataset.part = tile.part;
      button.setAttribute('aria-label', `${tile.name}, ${tile.quantity} in the kit`);
      button.setAttribute('aria-pressed', 'false');
      button.addEventListener('pointerdown', (event) => {
        if (byList.getAttribute('aria-pressed') === 'true' || !event.isPrimary || event.button !== 0) return;
        pressed = { part: tile.part, pointerId: event.pointerId, x: event.clientX, y: event.clientY, handed: false };
      });
      button.addEventListener('pointermove', (event) => {
        if (!pressed || pressed.pointerId !== event.pointerId || pressed.handed) return;
        const travel = Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y);
        if (travel < DRAG_START_PX / PREFS.dragSensitivity) return;
        pressed.handed = true;
        waiting = undefined;
        mark();
        // The canvas carries the part from here, following this pointer wherever its events go.
        handle.beginPlacement(tile.part, event);
      });
      const release = (event: PointerEvent, tapped: boolean): void => {
        if (!pressed || pressed.pointerId !== event.pointerId) return;
        const { handed } = pressed;
        pressed = undefined;
        if (handed || !tapped) return;
        // A tap: the part waits for the next tap on the canvas. A second tap on the same tile lets it go.
        if (waiting === tile.part) {
          handle.cancelPlacement();
          waiting = undefined;
        } else {
          closePlaces();
          handle.beginPlacement(tile.part);
          waiting = handle.mode === 'build' ? tile.part : undefined;
        }
        mark();
      };
      button.addEventListener('pointerup', (event) => release(event, true));
      button.addEventListener('pointercancel', (event) => release(event, false));
      button.addEventListener('click', (event) => {
        // A click with no pointer behind it (Enter, a screen reader) or with Place by list on lists the places.
        if (event.detail === 0 || byList.getAttribute('aria-pressed') === 'true') offerPlaces(tile.part, tile.name);
      });
      group.append(element('li', {}, button));
    }
  };

  byList.addEventListener('click', () => {
    const on = byList.getAttribute('aria-pressed') !== 'true';
    byList.setAttribute('aria-pressed', String(on));
    if (!on) closePlaces();
  });

  // ---------------------------------------------------------------------------------------------------------
  // The robot picker and the start state.

  for (const [label, group] of [
    ['G3: the two Level 1 kit robots', robots.filter((each) => each.forG3)],
    ['Other Level 1 robots', robots.filter((each) => !each.forG3)],
  ] as const) {
    if (group.length === 0) continue;
    const optgroup = element('optgroup', { label });
    for (const each of group) optgroup.append(element('option', { value: each.fixture.name, textContent: each.fixture.name }));
    picker.append(optgroup);
  }

  const startBuild = (): Blueprint => {
    const empty = emptyBuild(robot);
    if (start === 'empty') return empty;
    const placed = applyEdit(empty, { kind: 'place-part', part: robot.root }, content.catalogue);
    return placed.ok ? placed.blueprint : empty;
  };

  const choose = (name: string, startState: StartState = start): void => {
    const next = robots.find((each) => each.fixture.name === name);
    if (!next) throw new Error(`No gate robot '${name}'.`);
    run.stop();
    handle.cancelPlacement();
    waiting = undefined;
    robot = next;
    start = startState;
    picker.value = robot.fixture.name;
    startPicker.value = start;
    about.textContent = robot.fixture.description;
    steps.replaceChildren(...robot.steps.map((line) => element('li', { textContent: line })));
    handle.setLevel(robot.fixture.blueprint.meta.level);
    const loaded = handle.load(startBuild());
    if (!loaded.ok) console.warn('The start build did not load:', loaded.issues);
    note = '';
    said.textContent = '';
    drawTray();
    handle.fit();
    show('build');
  };

  picker.addEventListener('change', () => choose(picker.value));
  startPicker.addEventListener('change', () => choose(robot.fixture.name, startPicker.value === 'chassis' ? 'chassis' : 'empty'));
  required<HTMLButtonElement>(root, '#reset').addEventListener('click', () => choose(robot.fixture.name));

  await probe.ready;
  choose(first.fixture.name, 'empty');

  const gate: Gate = {
    content,
    robots,
    get robot() {
      return robot;
    },
    get start() {
      return start;
    },
    handle,
    probe,
    run,
    get status() {
      return statusLine.textContent ?? '';
    },
    choose,
  };
  window.servoGate = gate;
  return gate;
};
