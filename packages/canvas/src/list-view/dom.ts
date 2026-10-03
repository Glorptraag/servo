// The list view's DOM (task 3.6): the screen-reader and keyboard path beside the canvas (ground rule 8). Native lists
// and buttons, so a screen reader reads every part, port, wire and prop as a line of plain words, and Tab and Enter
// reach every action. Hidden until it takes focus, then shown over the canvas's corner so a sighted keyboard user sees
// where focus is. Enter does an action, as it flips a manual switch in Run mode; Space stays the app's Run and Stop
// (D42). It says what each action changed in a polite live region, which parts a removal left loose among it (D35).
import type { PlacedPartId, ValuePayload } from '@servo/schema';
import type { LiveState } from '@servo/sim-core/interface';
import type { CanvasPrefs, ListAction, ListSubject, ListWire } from '../interface.ts';
import { FONT_STACKS } from '../renderer/style.ts';
import { listOf } from './words.ts';
import type { ListViewModel } from './model.ts';

/** The list view's accessible name. */
export const LIST_VIEW_NAME = 'Parts and wires';
/** Room kept round the panel when it shows over the canvas, px. */
const INSET_PX = 8;
const PANEL_WIDTH_PX = 380;

const STYLE = `
.servo-list-view { box-sizing: border-box; z-index: 10; }
.servo-list-view:not([data-open]) {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden;
  clip-path: inset(50%); white-space: nowrap; border: 0;
}
.servo-list-view[data-open] {
  position: fixed; overflow: auto; padding: 12px 16px; border-radius: 8px; font-size: 18px; line-height: 1.4;
  background: #ffffff; color: #1b1b1b; border: 2px solid #1b1b1b;
}
.servo-list-view[data-contrast] { background: #000000; color: #ffffff; border-color: #ffffff; }
.servo-list-view h2, .servo-list-view h3 { font-size: 1em; margin: 12px 0 4px; }
.servo-list-view ul { list-style: none; margin: 0; padding: 0; }
.servo-list-view li { margin: 4px 0; }
.servo-list-view li ul { padding-left: 16px; }
.servo-list-view button {
  font: inherit; min-height: 44px; min-width: 44px; margin: 2px 4px 2px 0; padding: 4px 12px; border-radius: 6px;
  border: 2px solid currentColor; background: transparent; color: inherit; text-align: left;
}
.servo-list-view button:focus-visible { outline: 4px solid #1f6feb; outline-offset: 2px; }
.servo-list-view[data-contrast] button:focus-visible { outline-color: #ffd400; }
`;

const subjectKey = (subject: ListSubject): string => {
  switch (subject.kind) {
    case 'part':
      return `part:${subject.partId}`;
    case 'port':
      return `port:${subject.port.part}.${subject.port.port}`;
    case 'wire':
      return `wire:${subject.wireId}`;
    case 'prop':
      return `prop:${subject.propId}`;
  }
};

/** Live readouts as words, for Run mode. */
export const readoutWords = (values: ValuePayload): string => {
  const words: string[] = [];
  if (values.closed !== undefined) words.push(values.closed ? 'closed' : 'open');
  if (values.volts !== undefined) words.push(`${values.volts.toFixed(1)} volts`);
  if (values.milliamps !== undefined) words.push(`${Math.round(values.milliamps)} milliamps`);
  if (values.rpm !== undefined) words.push(`${Math.round(values.rpm)} turns a minute`);
  if (values.angle !== undefined) words.push(`arm at ${Math.round(values.angle)}°`);
  if (values.light !== undefined) words.push(`light ${Math.round(values.light * 100)}%`);
  if (values.signal !== undefined) words.push(`signal ${Math.round(values.signal * 100)}%`);
  if (values.charge !== undefined) words.push(`charge ${Math.round(values.charge * 100)}%`);
  return words.join(', ');
};

/** The model as it was before an action, to say what the action changed. */
interface Before {
  readonly parts: ReadonlyMap<PlacedPartId, { readonly held: string | undefined; readonly name: string }>;
  readonly wires: ReadonlyMap<string, ListWire>;
  readonly props: ReadonlySet<string>;
}

export interface ListViewDomOptions {
  prefs(): CanvasPrefs;
}

export class ListViewDom {
  readonly element: HTMLElement;
  private readonly host: HTMLElement;
  private readonly model: ListViewModel;
  private readonly options: ListViewDomOptions;
  private readonly body: HTMLElement;
  private readonly status: HTMLElement;
  private readonly heading: HTMLElement;
  /** Subjects whose actions are shown, by key. */
  private readonly expanded = new Set<string>();
  private readonly unsubscribe: () => void;
  private open = false;

  constructor(host: HTMLElement, model: ListViewModel, options: ListViewDomOptions) {
    this.host = host;
    this.model = model;
    this.options = options;
    const doc = host.ownerDocument;
    this.element = doc.createElement('section');
    this.element.className = 'servo-list-view';
    this.element.setAttribute('aria-label', LIST_VIEW_NAME);
    const style = doc.createElement('style');
    style.textContent = STYLE;
    this.heading = doc.createElement('h2');
    this.heading.textContent = LIST_VIEW_NAME;
    this.heading.tabIndex = -1;
    this.status = doc.createElement('p');
    this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-live', 'polite');
    this.body = doc.createElement('div');
    this.element.append(style, this.heading, this.status, this.body);
    this.element.addEventListener('focusin', this.focused);
    this.element.addEventListener('focusout', this.blurred);
    this.element.addEventListener('keyup', this.keyUp);
    this.element.addEventListener('click', this.clicked);
    host.appendChild(this.element);
    this.unsubscribe = model.subscribe(() => this.render());
    this.render();
  }

  destroy(): void {
    this.unsubscribe();
    this.element.removeEventListener('focusin', this.focused);
    this.element.removeEventListener('focusout', this.blurred);
    this.element.removeEventListener('keyup', this.keyUp);
    this.element.removeEventListener('click', this.clicked);
    this.element.remove();
  }

  /** Draws the model again, keeping which subjects are open and where focus was. */
  render(): void {
    const doc = this.element.ownerDocument;
    const active = doc.activeElement instanceof HTMLElement && this.element.contains(doc.activeElement) ? doc.activeElement : undefined;
    const focusKey = active?.dataset.key;
    const focusSubject = active?.dataset.subject;
    const prefs = this.options.prefs();
    this.element.style.fontFamily = FONT_STACKS[prefs.typeface].map((face) => (face.includes(' ') ? `"${face}"` : face)).join(', ');
    this.element.toggleAttribute('data-contrast', prefs.highContrast);
    this.element.dataset.mode = this.model.mode;
    const keep = new Set<string>();
    const sections: HTMLElement[] = [];
    const hint = this.model.hint;
    if (hint) {
      const line = doc.createElement('p');
      line.textContent = hint.line;
      sections.push(line);
    }
    sections.push(this.heading3('Parts'));
    const parts = doc.createElement('ul');
    for (const part of this.model.parts) {
      const subject: ListSubject = { kind: 'part', partId: part.partId };
      keep.add(subjectKey(subject));
      const title = this.model.titleOf(part.partId);
      const item = this.item(subject, part.description + (part.live ? `. ${this.liveWords(part.live)}` : ''), title);
      if (this.model.mode === 'build') {
        const ports = doc.createElement('ul');
        ports.setAttribute('aria-label', `Ports of ${title}`);
        for (const port of part.ports) {
          const portSubject: ListSubject = { kind: 'port', port: port.ref };
          keep.add(subjectKey(portSubject));
          const wires = port.wires.length === 0 ? 'no wire' : port.wires.length === 1 ? 'one wire' : `${port.wires.length} wires`;
          ports.appendChild(this.item(portSubject, `${port.label}, ${wires}`, `${title} ${port.label}`));
        }
        item.appendChild(ports);
      }
      parts.appendChild(item);
    }
    if (this.model.parts.length === 0) parts.appendChild(this.line('Nothing placed yet'));
    sections.push(parts);
    sections.push(this.heading3('Wires'));
    const wires = doc.createElement('ul');
    for (const wire of this.model.wires) {
      const subject: ListSubject = { kind: 'wire', wireId: wire.wireId };
      keep.add(subjectKey(subject));
      wires.appendChild(this.item(subject, wire.description, wire.description));
    }
    if (this.model.wires.length === 0) wires.appendChild(this.line('No wires yet'));
    sections.push(wires);
    if (this.model.props.length > 0) {
      sections.push(this.heading3('Arena'));
      const props = doc.createElement('ul');
      for (const prop of this.model.props) {
        const subject: ListSubject = { kind: 'prop', propId: prop.propId };
        keep.add(subjectKey(subject));
        props.appendChild(this.item(subject, prop.description, prop.description.split(',')[0] ?? prop.propId));
      }
      sections.push(props);
    }
    for (const key of [...this.expanded]) if (!keep.has(key)) this.expanded.delete(key);
    this.body.replaceChildren(...sections);
    if (active) this.refocus(focusKey, focusSubject);
    this.place();
  }

  /** One subject: its line, its actions behind a disclosure button (shown at once in Run mode, so Enter flips a switch). */
  private item(subject: ListSubject, text: string, name: string): HTMLLIElement {
    const doc = this.element.ownerDocument;
    const key = subjectKey(subject);
    const item = doc.createElement('li');
    item.dataset.subject = key;
    const line = doc.createElement('span');
    line.textContent = text;
    item.appendChild(line);
    // Run mode and a read-only canvas have few actions (inspect, flip a switch), shown at once, so Enter flips a
    // switch. Build mode's are many and slower to work out, so each subject's wait behind its button until asked for.
    const direct = this.model.mode === 'run' || this.model.readOnly;
    const open = direct || this.expanded.has(key);
    const actions = open ? this.model.actionsFor(subject) : [];
    if (direct && actions.length === 0) return item;
    if (!direct) {
      const toggle = doc.createElement('button');
      toggle.type = 'button';
      toggle.textContent = 'Actions';
      toggle.setAttribute('aria-label', `Actions for ${name}`);
      toggle.setAttribute('aria-expanded', String(open));
      toggle.dataset.key = `toggle:${key}`;
      toggle.dataset.subject = key;
      toggle.dataset.toggle = key;
      item.appendChild(toggle);
    }
    if (open && actions.length === 0) {
      item.appendChild(this.line('Nothing to do here now', 'p'));
    } else if (open) {
      const list = doc.createElement('ul');
      list.setAttribute('aria-label', `Actions for ${name}`);
      for (const action of actions) {
        const entry = doc.createElement('li');
        const button = doc.createElement('button');
        button.type = 'button';
        button.textContent = action.label;
        button.dataset.key = `action:${action.id}`;
        button.dataset.subject = key;
        button.dataset.action = action.id;
        entry.appendChild(button);
        list.appendChild(entry);
      }
      item.appendChild(list);
    }
    return item;
  }

  private heading3(text: string): HTMLElement {
    const heading = this.element.ownerDocument.createElement('h3');
    heading.textContent = text;
    return heading;
  }

  private line(text: string, tag: 'li' | 'p' = 'li'): HTMLElement {
    const item = this.element.ownerDocument.createElement(tag);
    item.textContent = text;
    return item;
  }

  private liveWords(live: LiveState): string {
    return readoutWords(live.values);
  }

  private refocus(key: string | undefined, subject: string | undefined): void {
    const find = (selector: string): HTMLElement | null => this.element.querySelector<HTMLElement>(selector);
    const target =
      (key ? find(`[data-key="${CSS.escape(key)}"]`) : null) ??
      (subject ? find(`[data-key="${CSS.escape(`toggle:${subject}`)}"]`) : null) ??
      (subject ? find(`[data-subject="${CSS.escape(subject)}"] button`) : null) ??
      this.heading;
    target.focus();
  }

  private findAction(subject: string, id: string): ListAction | undefined {
    const parsed = this.subjectOf(subject);
    return parsed ? this.model.actionsFor(parsed).find((action) => action.id === id) : undefined;
  }

  private subjectOf(key: string): ListSubject | undefined {
    const [kind, ...rest] = key.split(':');
    const id = rest.join(':');
    if (kind === 'part') return { kind, partId: id };
    if (kind === 'wire') return { kind, wireId: id };
    if (kind === 'prop') return { kind, propId: id };
    if (kind === 'port') {
      const dot = id.indexOf('.');
      return dot < 0 ? undefined : { kind, port: { part: id.slice(0, dot), port: id.slice(dot + 1) } };
    }
    return undefined;
  }

  private readonly clicked = (event: MouseEvent): void => {
    const button = event.target instanceof Element ? event.target.closest('button') : null;
    if (!button || !this.element.contains(button)) return;
    const toggle = button.dataset.toggle;
    if (toggle !== undefined) {
      if (this.expanded.has(toggle)) this.expanded.delete(toggle);
      else this.expanded.add(toggle);
      this.render();
      return;
    }
    const subject = button.dataset.subject;
    const id = button.dataset.action;
    if (subject === undefined || id === undefined) return;
    const action = this.findAction(subject, id);
    if (!action) return;
    const before = this.capture();
    if (this.model.perform(action)) this.say(this.changes(before, action));
  };

  /** Space never activates a list-view button: it stays the app's Run and Stop (D42). */
  private readonly keyUp = (event: KeyboardEvent): void => {
    if (event.key === ' ' && event.target instanceof HTMLButtonElement) event.preventDefault();
  };

  private readonly focused = (): void => {
    if (this.open) return;
    this.open = true;
    this.element.toggleAttribute('data-open', true);
    this.place();
  };

  private readonly blurred = (event: FocusEvent): void => {
    const next = event.relatedTarget;
    if (next instanceof Node && this.element.contains(next)) return;
    // Focus that moves on during a redraw comes back within this task: only a real move away hides the panel.
    queueMicrotask(() => {
      const active = this.element.ownerDocument.activeElement;
      if (active instanceof Node && this.element.contains(active)) return;
      this.open = false;
      this.element.toggleAttribute('data-open', false);
      this.element.style.removeProperty('left');
      this.element.style.removeProperty('top');
      this.element.style.removeProperty('width');
      this.element.style.removeProperty('max-height');
    });
  };

  /** Shown over the canvas's top corner, on the side away from the canvas's own handles. */
  private place(): void {
    if (!this.open) return;
    const box = this.host.getBoundingClientRect();
    const width = Math.max(0, Math.min(PANEL_WIDTH_PX, box.width - 2 * INSET_PX));
    const left = this.options.prefs().leftHanded ? box.right - INSET_PX - width : box.left + INSET_PX;
    Object.assign(this.element.style, {
      left: `${left}px`,
      top: `${box.top + INSET_PX}px`,
      width: `${width}px`,
      maxHeight: `${Math.max(0, box.height - 2 * INSET_PX)}px`,
    });
  }

  private capture(): Before {
    return {
      parts: new Map(this.model.parts.map((part) => [part.partId, { held: this.model.heldOf(part.partId), name: this.model.titleOf(part.partId) }] as const)),
      wires: new Map(this.model.wires.map((wire) => [wire.wireId, wire] as const)),
      props: new Set(this.model.props.map((prop) => prop.propId)),
    };
  }

  /** What an action changed, in a line or two: what was placed, wired, moved, turned, set, removed, or left loose. */
  private changes(before: Before, action: ListAction): string {
    const does = action.does;
    if (does.kind === 'control') return `${before.parts.get(does.input.partId)?.name ?? 'switch'} ${does.input.closed ? 'closed' : 'open'}`;
    if (does.kind !== 'edit') return '';
    const command = does.command;
    const nameOf = (id: PlacedPartId): string => before.parts.get(id)?.name ?? this.model.titleOf(id);
    const lines: string[] = [];
    const after = new Map(this.model.parts.map((part) => [part.partId, part] as const));
    const loose = [...before.parts]
      .filter(([id, part]) => after.has(id) && part.held !== 'loose' && this.model.heldOf(id) === 'loose')
      .map(([id]) => id);
    for (const [id, part] of after) if (!before.parts.has(id)) lines.push(`Placed ${part.description}`);
    for (const [id, part] of before.parts) if (!after.has(id)) lines.push(`Removed ${part.name}`);
    const afterWires = new Map(this.model.wires.map((wire) => [wire.wireId, wire] as const));
    for (const [id, wire] of afterWires) if (!before.wires.has(id) && wire.kind !== 'mount') lines.push(`Added ${wire.description}`);
    for (const [id, wire] of before.wires) {
      if (afterWires.has(id)) continue;
      // A removed part's wires went with it, as its action said; a mount or a shaft let go is said as loose.
      const ends = [wire.from.part, wire.to.part];
      if (ends.some((end) => !after.has(end))) continue;
      if ((wire.kind === 'mount' || wire.kind === 'drive') && ends.some((end) => loose.includes(end))) continue;
      lines.push(`Removed ${wire.description}`);
    }
    if (command.kind === 'set-setting') {
      const split = action.label.lastIndexOf(' to ');
      if (split > 4) lines.push(`${action.label.slice(4, split)} is ${action.label.slice(split + 4)} now`);
    }
    if (command.kind === 'rotate-part') lines.push(`Turned ${nameOf(command.partId)}`);
    if (command.kind === 'move-part') lines.push(`Moved ${nameOf(command.partId)}`);
    if (command.kind === 'mount') lines.push(`${nameOf(command.partId)} ${this.model.heldOf(command.partId) ?? 'moved'}`);
    for (const prop of this.model.props) if (!before.props.has(prop.propId)) lines.push(`Placed ${prop.description}`);
    if (command.kind === 'move-prop') lines.push(`Moved the prop`);
    if (command.kind === 'remove-prop') lines.push('Removed the prop');
    if (command.kind === 'tidy-wires') lines.push('Tidied the wires round the parts');
    const names = loose.map(nameOf);
    if (names.length > 0) lines.push(`${listOf(names)} ${names.length === 1 ? 'is' : 'are'} loose now`);
    return lines.map((line) => (line[0]?.toUpperCase() ?? '') + line.slice(1)).join('. ');
  }

  private say(text: string): void {
    this.status.textContent = text;
  }
}
