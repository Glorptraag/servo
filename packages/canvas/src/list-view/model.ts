// The list view's model (task 3.6): the build as parts, ports, wires and props in plain words, and the actions on
// each, for the DOM beside the canvas (dom.ts), the app and the e2e harness's parity checks (task 3.8). It reads the
// build from its host and acts only through it: an edit goes to the host's `apply`, the same path touch and pointer
// take, a switch flip to its `control` event, an inspection to its `select`. See README.md, "The list view".
import type { Blueprint, Catalogue, Level, PartTypeId, PlacedPartId } from '@servo/schema';
import type { ControlInput, LiveState } from '@servo/sim-core/interface';
import type {
  CanvasMode,
  EditCommand,
  EditResult,
  ListAction,
  ListPart,
  ListPort,
  ListProp,
  ListSubject,
  ListView,
  ListWire,
  PropTemplate,
  Selection,
  UnlockSettings,
} from '../interface.ts';
import { wireKindOf } from '../wiring/commands.ts';
import { actionsFor, heldOf, placementsFor, propPlacementsFor, settingNow } from './actions.ts';
import type { ListState } from './actions.ts';
import { heldPhrase, listOf, namesOf, naturalCompare, propDescription, propNamesOf, propsOf, wireDescription } from './words.ts';

/** What the list view needs from the canvas it sits beside. */
export interface ListHost {
  readonly catalogue: Catalogue;
  readonly readOnly: boolean;
  blueprint(): Blueprint | undefined;
  mode(): CanvasMode;
  level(): Level;
  /** Settings offered before their unlock level (CanvasOptions.unlockSettings). */
  readonly unlockSettings?: UnlockSettings;
  /** The canvas's own `apply`: the one way into the build. */
  apply(command: EditCommand): EditResult;
  /** Fires the canvas's `control` event (Run mode, D42). */
  control(input: ControlInput): void;
  /** The canvas's `select`. Null clears it. */
  select(selection: Selection | null): void;
  /** What the canvas has selected now: the list offers Clear selection on it (task 7.3). */
  selection?(): Selection | null;
  /** The one plain line the canvas shows now (a removal, a held part), for the live region to read (task 7.3). */
  notice?(): string | undefined;
  /**
   * Calls back after every edit, by any path, with its command, and after every change of selection: so the list view
   * can say what a canvas edit changed and offer Clear selection (task 7.3). Returns the unsubscribe function.
   */
  watch?(listener: (change: { readonly kind: 'edit'; readonly command: EditCommand } | { readonly kind: 'select' }) => void): () => void;
  /** Run mode: a subject's live state (a placed part's id, or `arena:<propId>`), when frames have come. */
  live?(subject: string): LiveState | undefined;
  /** The hint rung drawn on the canvas now, as its text twin. */
  hint?(): ListView['hint'];
  /** The wires' routes (task 3.7): a tidy changes them, not the build. Any value that changes when they do. */
  routes?(): unknown;
}

interface Snapshot {
  readonly blueprint: Blueprint | undefined;
  readonly mode: CanvasMode;
  readonly level: Level;
  readonly parts: readonly ListPart[];
  readonly wires: readonly ListWire[];
  readonly props: readonly ListProp[];
}

const sameRef = (a: { part: string; port: string }, b: { part: string; port: string }): boolean => a.part === b.part && a.port === b.port;

export class ListViewModel implements ListView {
  private readonly host: ListHost;
  private readonly listeners = new Set<() => void>();
  /** The switch states this list view sent in the current Run, until frames report them. */
  private readonly flipped = new Map<PlacedPartId, boolean>();
  private snapshot: Snapshot | undefined;

  constructor(host: ListHost) {
    this.host = host;
  }

  get mode(): CanvasMode {
    return this.host.mode();
  }

  /** A read-only canvas (D43): inspecting only. */
  get readOnly(): boolean {
    return this.host.readOnly;
  }

  /** The build the model reads now. */
  get blueprint(): Blueprint | undefined {
    return this.host.blueprint();
  }

  get parts(): readonly ListPart[] {
    return this.current().parts;
  }

  get wires(): readonly ListWire[] {
    return this.current().wires;
  }

  get props(): readonly ListProp[] {
    return this.current().props;
  }

  get hint(): ListView['hint'] {
    return this.host.hint?.();
  }

  /** What the canvas has selected now, when its host says. */
  get selection(): Selection | null {
    return this.host.selection?.() ?? null;
  }

  /** The one plain line the canvas shows now (a removal, a held part), when its host says. */
  get notice(): string | undefined {
    return this.host.notice?.();
  }

  /** The host's edits, by any path, and changes of selection (ListHost.watch); a host without them never calls back. */
  watch(listener: Parameters<NonNullable<ListHost['watch']>>[0]): () => void {
    return this.host.watch?.(listener) ?? (() => undefined);
  }

  actionsFor(subject: ListSubject): readonly ListAction[] {
    return actionsFor(this.state(), subject);
  }

  placementsFor(part: PartTypeId): readonly ListAction[] {
    return placementsFor(this.state(), part);
  }

  propPlacementsFor(prop: PropTemplate): readonly ListAction[] {
    return propPlacementsFor(this.state(), prop);
  }

  /** How a part is held (`mounted on chassis rear deck`, `loose`), as its description says it. */
  heldOf(partId: PlacedPartId): string | undefined {
    return heldOf(this.state(), partId);
  }

  /** What a setting reads now: `DC motor 1 speed is 60% now`. */
  settingNow(partId: PlacedPartId, settingId: string): string | undefined {
    return settingNow(this.state(), partId, settingId);
  }

  /** The part's name as the list reads it, numbered when the build has more than one of its type (`DC motor 2`). */
  titleOf(partId: PlacedPartId): string {
    const blueprint = this.host.blueprint();
    return blueprint ? namesOf(blueprint, this.host.catalogue).title(partId) : partId;
  }

  perform(action: ListAction): boolean {
    const does = action.does;
    if (does.kind === 'edit') {
      const before = this.host.blueprint();
      const routes = this.host.routes?.();
      const result = this.host.apply(does.command);
      return result.ok && (this.host.blueprint() !== before || this.host.routes?.() !== routes);
    }
    if (does.kind === 'control') {
      if (this.host.readOnly || this.host.mode() !== 'run') return false;
      this.host.control(does.input);
      this.flipped.set(does.input.partId, does.input.closed);
      this.changed();
      return true;
    }
    this.host.select(does.selection);
    return true;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The canvas calls this after every change to what the model reads: the build, the mode, the level, a frame. */
  changed(): void {
    if (this.host.mode() === 'build') this.flipped.clear();
    this.snapshot = undefined;
    for (const listener of [...this.listeners]) listener();
  }

  private state(): ListState {
    return {
      blueprint: this.host.blueprint(),
      catalogue: this.host.catalogue,
      level: this.host.level(),
      ...(this.host.unlockSettings ? { unlockSettings: this.host.unlockSettings } : {}),
      mode: this.host.mode(),
      readOnly: this.host.readOnly,
      selection: this.host.selection?.() ?? null,
      switchClosed: (partId) => {
        const live = this.host.mode() === 'run' ? this.host.live?.(partId)?.values.closed : undefined;
        return live ?? this.flipped.get(partId);
      },
    };
  }

  private current(): Snapshot {
    const blueprint = this.host.blueprint();
    const mode = this.host.mode();
    const level = this.host.level();
    const cached = this.snapshot;
    if (cached && cached.blueprint === blueprint && cached.mode === mode && cached.level === level && mode === 'build') return cached;
    const fresh = this.read(blueprint, mode, level);
    this.snapshot = fresh;
    return fresh;
  }

  private read(blueprint: Blueprint | undefined, mode: CanvasMode, level: Level): Snapshot {
    if (!blueprint) return { blueprint, mode, level, parts: [], wires: [], props: [] };
    const { catalogue } = this.host;
    const names = namesOf(blueprint, catalogue);
    const run = mode === 'run';
    const kinds = new Map(blueprint.wires.map((wire) => [wire.id, wireKindOf(blueprint, catalogue, wire.from, wire.to)] as const));
    const wires: ListWire[] = [...blueprint.wires]
      .sort((a, b) => naturalCompare(a.id, b.id))
      .flatMap((wire) => {
        const kind = kinds.get(wire.id);
        return kind ? [{ wireId: wire.id, kind, from: wire.from, to: wire.to, description: wireDescription(names, wire, kind) }] : [];
      });
    const parts: ListPart[] = names.parts.flatMap((part) => {
      const record = catalogue.parts.get(part.part);
      if (!record) return [];
      const ports: ListPort[] = record.ports.map((spec) => {
        const ref = { part: part.id, port: spec.id };
        return {
          ref,
          label: spec.label,
          type: spec.type,
          wires: wires.filter((wire) => sameRef(wire.from, ref) || sameRef(wire.to, ref)).map((wire) => wire.wireId),
        };
      });
      const words = [names.title(part.id)];
      const held = heldPhrase(names, blueprint, part.id);
      if (held) words.push(held);
      const holder = names.placement(part.id)?.parent;
      for (const port of ports) {
        const holds: string[] = [];
        const joined: string[] = [];
        for (const wire of wires) {
          const mine = sameRef(wire.from, port.ref) ? wire.from : sameRef(wire.to, port.ref) ? wire.to : undefined;
          if (!mine) continue;
          const other = mine === wire.from ? wire.to : wire.from;
          // The mount or shaft that holds the part is already said; a mount point says what it holds.
          if (other.part === holder && (wire.kind === 'mount' || wire.kind === 'drive')) continue;
          if (wire.kind === 'mount') holds.push(names.title(other.part));
          else joined.push(names.portPhrase(other));
        }
        if (holds.length > 0) words.push(`${port.label} holds ${listOf(holds)}`);
        if (joined.length > 0) words.push(`${port.label} connected to ${listOf(joined)}`);
      }
      const live = run ? this.host.live?.(part.id) : undefined;
      return [{ partId: part.id, part: part.part, name: record.identity.name, description: words.join(', '), ports, ...(live ? { live } : {}) }];
    });
    const preset = catalogue.arenas?.get(blueprint.arena.preset);
    const every = propsOf(blueprint, catalogue);
    const propNames = propNamesOf(every.map((each) => each.prop));
    const props: ListProp[] = every.map(({ prop, preset: own }) => {
      const live = run ? this.host.live?.(`arena:${prop.id}`) : undefined;
      return { propId: prop.id, description: propDescription(prop, preset, own, propNames.get(prop.id)), ...(live ? { live } : {}) };
    });
    return { blueprint, mode, level, parts, wires, props };
  }
}

