// The challenge runner (task 4.5) in Chromium, through the real App: the real canvas, content, sim-core and run loop,
// and a real store in IndexedDB. Home opens over the shell and lists a new build, the saved builds and the challenges
// by level; a challenge comes onto the same canvas with its goal line, kit, level and arena; a Run that meets the goal
// shows a plain check mark and says "Goal met", and one that does not shows none. The arena strip sets the preset and
// brings props in by pointer, tap-then-tap and keyboard. Content has no challenges yet (tasks 4.7 and 4.8), so the
// test gives the App the schema's example challenges that validate against it, each starting from a content fixture.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cdp, userEvent } from 'vitest/browser';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { loadContent } from '@servo/content';
import type { Content } from '@servo/content';
import { loadFixtures } from '@servo/content/fixtures';
import { validateChallenge } from '@servo/schema';
import type { Blueprint, Challenge } from '@servo/schema';
import { exampleChallenges } from '@servo/schema/fixtures';
import { App } from '../../src/App.tsx';
import { CHALLENGE_TEXT, PROP_PALETTE } from '../../src/challenges/index.ts';
import { openStore } from '../../src/store/index.ts';
import type { ProfileStore, ServoStore } from '../../src/store/index.ts';

const { content } = loadContent();
const fixtures = loadFixtures().fixtures;
const fixture = (name: string): Blueprint => {
  const found = fixtures.find((candidate) => candidate.name === name)?.blueprint;
  if (!found) throw new Error(`no ${name} fixture`);
  return found;
};

const example = (name: string, start?: Blueprint): Challenge => {
  const data = exampleChallenges.find((candidate) => candidate.name === name)?.data as Challenge;
  const result = validateChallenge(start ? { ...data, start } : data, content.catalogue);
  if (!result.ok) throw new Error(`${name}: ${result.issues.map((issue) => issue.message).join(' ')}`);
  return result.value;
};

/** Cross and stop, starting from the bumper robot, which meets it; drive and light, from the roller, which does not. */
const CROSS = example('cross-and-stop', fixture('bumper-stops-at-wall'));
const LIGHT = example('drive-and-light', fixture('level-1-roller'));
const MEET = example('meet-the-switch');
const withChallenges: Content = { ...content, challenges: [MEET, CROSS, LIGHT] };

const SOON = { timeout: 10_000 };
const RUN = { timeout: 60_000 };

const opened: { root: Root; host: HTMLElement; store: ServoStore }[] = [];

afterEach(() => {
  for (const { root, host, store } of opened.splice(0)) {
    root.unmount();
    host.remove();
    store.close();
  }
  vi.restoreAllMocks();
});

interface Mounted {
  readonly host: HTMLElement;
  readonly child: ProfileStore;
  readonly first: Blueprint;
}

/** The App on a store of its own, opened on an empty "Build 1", or on a copy of `start`. */
const mount = async (start?: Blueprint): Promise<Mounted> => {
  const store = await openStore({ name: `servo-challenges-${crypto.randomUUID()}` });
  const profile = await store.profiles.create('Builder 1');
  const child = store.forProfile(profile.id);
  const copied = start ? await child.blueprints.copy(start, 'Build 1') : undefined;
  if (copied && !copied.ok) throw new Error('the start did not copy');
  const first = copied?.blueprint ?? (await child.blueprints.create({ name: 'Build 1', level: 1, arena: { preset: 'open-floor', props: [] } }));
  const host = document.createElement('div');
  host.style.cssText = 'position: fixed; left: 0; top: 0; width: 1180px; height: 820px;';
  document.body.appendChild(host);
  const root = createRoot(host);
  opened.push({ root, host, store });
  await new Promise<void>((ready) => root.render(<App content={withChallenges} child={child} start={first} onReady={ready} />));
  return { host, child, first };
};

const shellOf = (app: Mounted): HTMLElement => app.host.querySelector<HTMLElement>('.servo-shell') as HTMLElement;
const homeOf = (app: Mounted): HTMLElement | null => app.host.querySelector<HTMLElement>('.servo-home');
const headerButton = (app: Mounted, name: string): HTMLButtonElement => {
  const found = [...app.host.querySelectorAll<HTMLButtonElement>('[data-region="header"] button')].find((button) => button.textContent === name);
  if (!found) throw new Error(`no ${name} button in the header`);
  return found;
};
const homeButton = (app: Mounted, name: string): HTMLButtonElement => {
  const found = [...(homeOf(app)?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find((button) =>
    (button.querySelector('.home-choice-name')?.textContent ?? button.textContent) === name,
  );
  if (!found) throw new Error(`no ${name} on Home`);
  return found;
};
/** The challenge titled `name` in Home's level lists, as against a saved build named after it. */
const challengeButton = (app: Mounted, name: string): HTMLButtonElement => {
  const found = [...(homeOf(app)?.querySelectorAll<HTMLButtonElement>('.home-level button.home-choice') ?? [])].find(
    (button) => button.querySelector('.home-choice-name')?.textContent === name,
  );
  if (!found) throw new Error(`no challenge ${name} on Home`);
  return found;
};
const stripButton = (app: Mounted, name: string): HTMLButtonElement => {
  const found = [...app.host.querySelectorAll<HTMLButtonElement>('[data-region="arenaStrip"] button')].find((button) => button.textContent?.startsWith(name));
  if (!found) throw new Error(`no ${name} in the arena strip`);
  return found;
};
const runToggle = (app: Mounted): HTMLButtonElement => app.host.querySelector<HTMLButtonElement>('[data-region="runBar"] .run-bar-toggle') as HTMLButtonElement;
const goal = (app: Mounted): HTMLElement | null => app.host.querySelector<HTMLElement>('[data-region="header"] .challenge-goal');
const ticked = (app: Mounted): boolean => goal(app)?.dataset.met === 'true';
const spoken = (app: Mounted): string | null | undefined => goal(app)?.querySelector('[role="status"]')?.textContent;
/** The build on the canvas, as the canvas's list view describes it to a screen reader. */
const listed = (app: Mounted): number => app.host.querySelectorAll('.servo-list-view [data-toggle^="part:"]').length;
const headerText = (app: Mounted): string => app.host.querySelector('[data-region="header"]')?.textContent ?? '';

const pageAt = (element: Element, dx = 0.5, dy = 0.5): { x: number; y: number } => {
  const box = element.getBoundingClientRect();
  const frame = window.frameElement?.getBoundingClientRect();
  return { x: (frame?.left ?? 0) + box.left + box.width * dx, y: (frame?.top ?? 0) + box.top + box.height * dy };
};

const openHome = async (app: Mounted): Promise<HTMLElement> => {
  await userEvent.click(headerButton(app, CHALLENGE_TEXT.home));
  await vi.waitFor(() => expect(homeOf(app)).not.toBeNull(), SOON);
  return homeOf(app) as HTMLElement;
};

describe('Home', () => {
  it('opens over the resting shell with a new build, the saved builds and the challenges by level, and closes with Escape', async () => {
    const alerts = [vi.spyOn(window, 'alert'), vi.spyOn(window, 'confirm')];
    const app = await mount();
    const home = await openHome(app);
    expect(home.getAttribute('aria-labelledby')).toBe(home.querySelector('h2')?.id);
    expect(document.activeElement).toBe(home.querySelector('h2'));
    // The shell rests under Home: nothing there takes a tap, a key or focus.
    const rested = [...shellOf(app).children].filter((element) => element !== home);
    expect(rested.length).toBeGreaterThan(0);
    expect(rested.every((element) => (element as HTMLElement).inert)).toBe(true);
    await vi.waitFor(() => expect(homeButton(app, 'Build 1')).toBeDefined(), SOON);
    expect(home.querySelector('button')?.textContent).toBe(CHALLENGE_TEXT.back);
    expect(homeButton(app, CHALLENGE_TEXT.newBuild)).toBeDefined();
    expect([...home.querySelectorAll('h4')].map((heading) => heading.textContent)).toEqual(['Level 1 · Parts', 'Level 2 · Circuits']);
    expect(homeButton(app, 'Cross and stop').textContent).toContain('Unscripted build');
    expect(homeButton(app, 'Meet the switch').textContent).toContain('Part introduction');
    // The gated parent entry (D91, task 5.2): a plain link to the parent page, whose parental gate asks first (D28).
    // Beside it, the access options' switches (task 5.7), and no other link.
    const entry = home.querySelector('[data-slot="parent-entry"]');
    expect(entry?.querySelectorAll('a')).toHaveLength(1);
    expect(entry?.querySelectorAll('[data-region="access"] input[role="switch"]')).toHaveLength(4);
    const link = entry?.querySelector('a');
    expect(link?.textContent).toBe(CHALLENGE_TEXT.forAdults);
    expect(new URL(link?.href ?? '').pathname).toBe('/parent.html');
    expect(link?.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    // Space never reaches the Run bar from Home.
    await userEvent.keyboard(' ');
    expect(runToggle(app).dataset.run).toBe('run');
    // Real words, no exclamation marks; no dialog (ground rules 7 and 9).
    expect(home.textContent).not.toContain('!');
    for (const alert of alerts) expect(alert).not.toHaveBeenCalled();

    await userEvent.keyboard('{Escape}');
    await vi.waitFor(() => expect(homeOf(app)).toBeNull(), SOON);
    expect(document.activeElement).toBe(headerButton(app, CHALLENGE_TEXT.home));
    expect(rested.every((element) => !(element as HTMLElement).inert || element.getAttribute('data-shown') === 'false')).toBe(true);
  });

  it('starts a new sandbox build by touch and keeps it, then reopens a saved build by keyboard', async () => {
    const app = await mount();
    await openHome(app);
    await vi.waitFor(() => expect(homeButton(app, 'Build 1')).toBeDefined(), SOON);
    const box = pageAt(homeButton(app, CHALLENGE_TEXT.newBuild));
    await cdp().send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...box, id: 1 }] });
    await cdp().send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await vi.waitFor(() => expect(homeOf(app)).toBeNull(), SOON);
    await vi.waitFor(() => expect(app.host.querySelector('.shell-blueprint-name')?.textContent).toBe('Build 2'), SOON);
    const builds = await app.child.blueprints.list();
    expect(builds.map((build) => build.name).sort()).toEqual(['Build 1', 'Build 2']);
    expect(goal(app)).toBeNull();

    await openHome(app);
    await vi.waitFor(() => expect(homeButton(app, 'Build 1')).toBeDefined(), SOON);
    homeButton(app, 'Build 1').focus();
    await userEvent.keyboard('{Enter}');
    await vi.waitFor(() => expect(homeOf(app)).toBeNull(), SOON);
    await vi.waitFor(() => expect(app.host.querySelector('.shell-blueprint-name')?.textContent).toBe('Build 1'), SOON);
  });
});

describe('a challenge on the canvas', () => {
  it('lays its goal line, kit, level and arena over the same canvas, and ticks when a Run meets the goal', async () => {
    const app = await mount();
    await openHome(app);
    await userEvent.click(homeButton(app, 'Cross and stop'));
    await vi.waitFor(() => expect(homeOf(app)).toBeNull(), SOON);
    // Its start, kept as the child's own build, on the canvas; the goal line from content, not ticked.
    await vi.waitFor(() => expect(goal(app)?.textContent).toContain(CROSS.goalLine), SOON);
    await vi.waitFor(() => expect(listed(app)).toBe(CROSS.start?.parts.length), SOON);
    expect(ticked(app)).toBe(false);
    expect(spoken(app)).toBe('');
    expect(headerText(app)).toContain('Circuit Crew');
    expect(headerText(app)).toContain('Level 2 · Circuits');
    expect((await app.child.blueprints.list()).map((build) => build.name)).toContain(CROSS.title);
    // The challenge sets the arena: its preset is pressed, and the others rest.
    expect(stripButton(app, 'Wall stop').getAttribute('aria-pressed')).toBe('true');
    // Still reachable by keyboard and screen reader, with its reason, and a press changes nothing.
    expect(stripButton(app, 'Open floor').disabled).toBe(false);
    expect(stripButton(app, 'Open floor').getAttribute('aria-disabled')).toBe('true');
    expect(stripButton(app, 'Open floor').textContent).toContain(CHALLENGE_TEXT.setByChallenge);
    // (Playwright will not click what is aria-disabled, so this is the DOM's click.)
    stripButton(app, 'Open floor').click();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(stripButton(app, 'Wall stop').getAttribute('aria-pressed')).toBe('true');

    // Run: the bumper robot crosses, stops at the wall with its motors off, and the goal is met.
    await userEvent.click(runToggle(app));
    await vi.waitFor(() => expect(ticked(app)).toBe(true), RUN);
    expect(spoken(app)).toBe(CHALLENGE_TEXT.met);
    expect(goal(app)?.textContent).not.toContain('!');
    // Stop keeps the check: it describes the build on the canvas, which Stop gives back unchanged.
    await userEvent.click(runToggle(app));
    await vi.waitFor(() => expect(runToggle(app).dataset.run).toBe('run'), SOON);
    // The Run is kept as the challenge's, with the verdict the check showed.
    await vi.waitFor(async () => {
      const runs = await app.child.runs.list({ challenge: CROSS.id });
      expect(runs.map((run) => [run.challenge, run.goal?.met, run.runNumber])).toEqual([[CROSS.id, true, 1]]);
    }, SOON);
    expect(ticked(app)).toBe(true);
    // A change to the build clears it: a prop brought in by keyboard, Enter on the strip's box.
    stripButton(app, PROP_PALETTE[0]?.label ?? 'Box').focus();
    await userEvent.keyboard('{Enter}');
    await vi.waitFor(() => expect(ticked(app)).toBe(false), SOON);
    expect(spoken(app)).toBe('');

    // Home marks the challenge met, with the same check mark and "Goal met" for a screen reader, and no other.
    const home = await openHome(app);
    // (The saved build the challenge made carries its title too; the challenge's own button is in the level's list.)
    await vi.waitFor(() => expect(challengeButton(app, CROSS.title).dataset.met).toBe('true'), SOON);
    expect(challengeButton(app, CROSS.title).textContent).toContain(CHALLENGE_TEXT.met);
    expect(challengeButton(app, CROSS.title).querySelector('.home-choice-tick')).not.toBeNull();
    expect(home.querySelectorAll('.home-choice[data-met="true"]').length).toBe(1);
    expect(challengeButton(app, LIGHT.title).dataset.met).toBeUndefined();
    expect(challengeButton(app, MEET.title).dataset.met).toBeUndefined();
    expect(home.textContent).not.toContain('!');
    await userEvent.click(homeButton(app, CHALLENGE_TEXT.back));
    await vi.waitFor(() => expect(homeOf(app)).toBeNull(), SOON);
  });

  it('lists each level along the path on Home: a guided challenge before the unscripted build, whatever order content gives', async () => {
    const app = await mount();
    const home = await openHome(app);
    // Content gives cross and stop before drive and light; the path puts the guided challenge first and the unscripted build last.
    const titles = [...home.querySelectorAll('.home-choice-name')].map((name) => name.textContent);
    expect(titles.indexOf(MEET.title)).toBeLessThan(titles.indexOf(LIGHT.title));
    expect(titles.indexOf(LIGHT.title)).toBeLessThan(titles.indexOf(CROSS.title));
    // Nothing met yet: no check marks.
    expect(home.querySelectorAll('.home-choice[data-met="true"]').length).toBe(0);
  });

  it('shows no check for a Run that misses the goal', async () => {
    const app = await mount();
    await openHome(app);
    await userEvent.click(homeButton(app, 'Drive and light'));
    await vi.waitFor(() => expect(goal(app)?.textContent).toContain(LIGHT.goalLine), SOON);
    await vi.waitFor(() => expect(listed(app)).toBe(LIGHT.start?.parts.length), SOON);
    await userEvent.click(runToggle(app));
    // Two simulated seconds of driving with no LED.
    await vi.waitFor(() => expect(runToggle(app).dataset.run).toBe('stop'), SOON);
    await new Promise((resolve) => setTimeout(resolve, 3500));
    expect(ticked(app)).toBe(false);
    await userEvent.click(runToggle(app));
    await vi.waitFor(async () => {
      const runs = await app.child.runs.list({ challenge: LIGHT.id });
      expect(runs.map((run) => [run.challenge, run.goal])).toEqual([[LIGHT.id, { met: false }]]);
    }, SOON);
    // Back to the sandbox from Home: the goal line goes.
    await openHome(app);
    await userEvent.click(homeButton(app, CHALLENGE_TEXT.newBuild));
    await vi.waitFor(() => expect(goal(app)).toBeNull(), SOON);
    expect(stripButton(app, 'Open floor').disabled).toBe(false);
    expect(stripButton(app, 'Open floor').hasAttribute('aria-disabled')).toBe(false);
  });
});

describe('the arena strip', () => {
  it('sets the preset in one step, and brings props in by pointer drag, tap-then-tap and keyboard (D36)', async () => {
    const app = await mount(fixture('level-1-roller'));
    // The child's props, as the canvas's list view lists them to a screen reader (the preset's own come first).
    const listedProps = (): number => app.host.querySelectorAll('.servo-list-view [data-toggle^="prop:"]').length;
    await vi.waitFor(() => expect(stripButton(app, 'Open floor').getAttribute('aria-pressed')).toBe('true'), SOON);
    await userEvent.click(stripButton(app, 'Ramp'));
    await vi.waitFor(() => expect(stripButton(app, 'Ramp').getAttribute('aria-pressed')).toBe('true'), SOON);
    expect(stripButton(app, 'Open floor').getAttribute('aria-pressed')).toBe('false');
    const preset = listedProps();
    const props = (): number => listedProps() - preset;
    await vi.waitFor(async () => {
      const stored = await app.child.blueprints.load(app.first.meta.id);
      expect(stored.ok && stored.blueprint.arena.preset).toBe('ramp');
    }, SOON);

    // Keyboard: Enter puts a box on the nearest free spot.
    stripButton(app, 'Box').focus();
    await userEvent.keyboard('{Enter}');
    await vi.waitFor(() => expect(props()).toBe(1), SOON);

    // Tap-then-tap: the tile stays pressed until a tap on the canvas places it.
    await userEvent.click(stripButton(app, 'Post'));
    expect(stripButton(app, 'Post').getAttribute('aria-pressed')).toBe('true');
    const stage = app.host.querySelector('[data-region="stage"]') as HTMLElement;
    const spot = pageAt(stage, 0.5, 0.7);
    await cdp().send('Input.dispatchMouseEvent', { type: 'mousePressed', ...spot, button: 'left', buttons: 1, clickCount: 1 });
    await cdp().send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...spot, button: 'left', buttons: 0, clickCount: 1 });
    await vi.waitFor(() => expect(stripButton(app, 'Post').getAttribute('aria-pressed')).toBe('false'), SOON);
    await vi.waitFor(() => expect(props()).toBe(2), SOON);

    // Pointer drag: from the box tile onto the canvas.
    const from = pageAt(stripButton(app, 'Box'));
    const to = pageAt(stage, 0.6, 0.6);
    await cdp().send('Input.dispatchMouseEvent', { type: 'mousePressed', ...from, button: 'left', buttons: 1, clickCount: 1 });
    for (let step = 1; step <= 8; step += 1) {
      const at = { x: from.x + ((to.x - from.x) * step) / 8, y: from.y + ((to.y - from.y) * step) / 8 };
      await cdp().send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...at, button: 'left', buttons: 1 });
    }
    await cdp().send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...to, button: 'left', buttons: 0, clickCount: 1 });
    await vi.waitFor(() => expect(props()).toBe(3), SOON);
    expect(stripButton(app, 'Box').getAttribute('aria-pressed')).toBe('false');

    // In Run mode the strip rests.
    await userEvent.click(runToggle(app));
    await vi.waitFor(() => expect(stripButton(app, 'Box').disabled).toBe(true), RUN);
    expect(stripButton(app, 'Open floor').disabled).toBe(true);
    await userEvent.click(runToggle(app));
  });
});
