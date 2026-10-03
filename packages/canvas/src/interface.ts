// @servo/canvas interface: the build surface's contract with the app and tools (task 0.4). Types only.
// `mountCanvas` and `applyEdit` are exported from '@servo/canvas' with the `MountCanvas` and `ApplyEdit` types below;
// each member names the Phase 3 task that builds it, so no app task writes canvas code. The canvas reaches sim-core
// only through '@servo/sim-core/interface'. See packages/canvas/README.md.

import type {
  ArenaFeatureId,
  ArenaRef,
  AssetKey,
  Blueprint,
  Catalogue,
  HintStep,
  HintStepKind,
  IssueCode,
  Level,
  PartTypeId,
  PlacedPartId,
  PortId,
  PortRef,
  PortType,
  Pose,
  Prop,
  SettingId,
  SettingValue,
  Text,
  ValidationResult,
  Vec2,
  WireId,
  WireKind,
} from '@servo/schema';
import type { ControlInput, LiveState, RunFrame } from '@servo/sim-core/interface';

// ---------------------------------------------------------------------------------------------------------
// Mounting

/**
 * Draws the canvas into `host` (Pixi for the surface, DOM beside it for the list view) and returns its handle.
 * The canvas fills its host and follows the host's size, so when the app tucks an edge away the canvas gets the
 * room. Task 3.1.
 */
export type MountCanvas = (host: HTMLElement, options: CanvasOptions) => CanvasHandle;

export interface CanvasOptions {
  /** Part records and arena presets (the canvas draws the arena a blueprint names): the schema's `makeCatalogue` result. */
  readonly catalogue: Catalogue;
  /** The swap registry, injected by the app from content's art registry. */
  readonly resolveArt: ResolveArt;
  /** The child's level: sets the reading load of labels and the list view, and which settings the list view offers. */
  readonly level: Level;
  readonly prefs: CanvasPrefs;
  /**
   * Read-only (D43): a shared link or a phone replay. Every edit is refused (`edit.locked`), no control is emitted,
   * and the list view offers inspection only. The app shows a replay, with "keep a copy" beside it.
   */
  readonly readOnly?: boolean;
}

/**
 * A part's picture for an asset key (`identity.art`). Undefined when the registry has no entry: the canvas then
 * draws a neutral tile in the part's proportions (`body.size`). A part on a mirrored mount point is drawn as its
 * mirror image (`canvasPoseOf(...).mirrored`).
 */
export type ResolveArt = (key: AssetKey) => ArtSource | undefined;

/** The same shape as content's art registry entries. */
export interface ArtSource {
  /** A URL the browser can load. */
  readonly src: string;
  readonly isPlaceholder: boolean;
}

/** Brief Section 13. The app owns and keeps them, and passes them in. */
export interface CanvasPrefs {
  /**
   * Positive; 1 is the default. Below 1 a touch must travel further before it becomes a drag, and drops forgive
   * more, for unsteady hands (D44). Task 3.2 maps it to pixels.
   */
  readonly dragSensitivity: number;
  /** Puts the canvas's own handles (rotate, bin) on the other side of a selected part (D44). The app mirrors the tray and spec card. */
  readonly leftHanded: boolean;
  /** High-contrast colours for ports, wires and the grid. Line styles and socket shapes stay, so colour is never the only cue. */
  readonly highContrast: boolean;
  /** The typeface for everything the canvas writes: labels, hint callouts, the list view. */
  readonly typeface: 'standard' | 'dyslexia-friendly';
}

export type CanvasMode = 'build' | 'run';

/** What a tap or click selects. A part selection opens its spec card in the app. */
export type Selection =
  | { readonly kind: 'part'; readonly partId: PlacedPartId }
  | { readonly kind: 'wire'; readonly wireId: WireId }
  | { readonly kind: 'prop'; readonly propId: ArenaFeatureId };

/** The hint rungs the canvas draws. The last rung, do-it, is a change: the app applies it as one `batch` command. */
export type DrawnHintStep = Extract<HintStep, { readonly step: 'pulse-part' | 'pulse-port' | 'ghost-wire' }>;

/** A prop the arena strip offers (D36): a box or a cylinder with its size and weight. It gets its id and place as it lands. */
export type PropTemplate = Omit<Prop, 'id' | 'at'>;

export interface CanvasHandle {
  readonly mode: CanvasMode;
  /** The build in canonical form (`canonicalizeBlueprint`). Undefined until the first successful `load`. Task 3.1. */
  readonly blueprint: Blueprint | undefined;
  readonly selection: Selection | null;
  /** 1 is the default zoom. Task 3.1. */
  readonly zoom: number;
  /** The screen-reader path: the same build and the same actions as touch and pointer (ground rule 8). Task 3.6. */
  readonly listView: ListView;
  /**
   * Shows a build: validates it against the catalogue, canonicalises it and redraws. Keeps the view, and the
   * selection when it still exists. On failure the current build stays and the issues come back. Fires no
   * `edit`; the app's Undo uses it to step back. Throws in Run mode. Task 3.1.
   */
  load(blueprint: Blueprint): ValidationResult<Blueprint>;
  /**
   * Applies one command exactly as touch, pointer and the list view do, through `applyEdit`, and fires `edit`
   * when it changes the build. Refused with `edit.locked` in Run mode and when read-only, and with `edit.no_build`
   * before a load. The app uses it for spec-card settings, the name, the arena strip and the hint ladder's do-it.
   * Task 3.2.
   */
  apply(command: EditCommand): EditResult;
  /**
   * Starts placing a part from the app's tray or library. Given the pointer that is dragging the tile, the canvas
   * takes over the drag: the part follows it, snaps to a mount point or a shaft within the forgiveness radius, and
   * lands on release. Without one (tap-then-tap), the canvas shows where the part can go and places it at the next
   * tap. It ends with `placement`, and with `edit` (place-part) when the part landed. Build mode only. Task 3.2.
   */
  beginPlacement(part: PartTypeId, pointer?: PointerEvent): void;
  /** The same for a prop from the arena strip (D36), landing as `place-prop`. Build mode only. Task 3.2. */
  beginPropPlacement(prop: PropTemplate, pointer?: PointerEvent): void;
  cancelPlacement(): void;
  /**
   * Releasing a dragged part, wire or prop over one of these elements (the tray, the arena strip) removes it, as
   * the bin does. An empty list turns it off. Task 3.2.
   */
  setRemoveTargets(elements: readonly HTMLElement[]): void;
  /** Selects, or clears with null. Fires `select` when the selection changes. Task 3.4. */
  select(selection: Selection | null): void;
  /**
   * 'run' locks the build (wires lock, edits are refused), expands the arena and waits for frames. 'build'
   * returns to the build exactly as it was before Run: the canvas never writes to it in Run mode (ground rule 4).
   * A read-only canvas shows the build in either mode and never lets it change. Task 3.1.
   */
  setMode(mode: CanvasMode): void;
  /**
   * Run mode: live values, motion, sounds' visual twins and faults for one tick, from Simulation.step. Ignored in Build
   * mode. Task 3.5. Give each frame once, in tick order: a frame at the same or an earlier tick than the last starts
   * the drawing again (a restore). The one-second spin-up is tick 0's frame given once and held, not given again
   * (packages/canvas/docs/run-animation.md).
   */
  applyRunFrame(frame: RunFrame): void;
  /**
   * Draws one hint rung over everything without covering a port. A target given by type (`{ part }`) matches
   * every placed part of that type; the app narrows it to `{ placed }` when it knows which part. Returns false
   * when nothing on the canvas matches, so the app can move to the next rung. The step's `line` is the list
   * view's text twin. Task 3.4.
   */
  showHint(step: DrawnHintStep): boolean;
  clearHints(): void;
  /** Re-centres and zooms to show the whole build, and in Run mode the arena. Task 3.1. */
  fit(): void;
  /** Zooms about the centre of the view, held within the zoom limits (task 3.7), up to 4 (400%, brief Section 13). Fires `zoom`. Task 3.1. */
  setZoom(zoom: number): void;
  /** Re-routes wires around part bodies. Routes are view state, not part of the blueprint. Task 3.7. */
  tidyWires(): void;
  setLevel(level: Level): void;
  setPrefs(prefs: CanvasPrefs): void;
  on<K extends keyof CanvasEventMap>(type: K, listener: (event: CanvasEventMap[K]) => void): () => void;
  /** Removes everything the canvas added to its host. Task 3.1. */
  destroy(): void;
}

// ---------------------------------------------------------------------------------------------------------
// Events out

export interface CanvasEventMap {
  /** The build changed: a command from touch, pointer, the list view or `apply`. Never fires in Run mode. Task 3.2. */
  readonly edit: EditEvent;
  /** The selection changed, by any path. Task 3.4. */
  readonly select: SelectEvent;
  /** A placement from `beginPlacement` or `beginPropPlacement` ended, landed or not, so the app can clear its pending tile. Task 3.2. */
  readonly placement: PlacementEvent;
  /**
   * Run mode: the child flipped a manual switch by tapping or clicking it, by pressing Enter with it selected
   * (D42: Space stays the app's Run and Stop), or from the list view. The app passes it to Simulation.input. Never
   * fires when read-only. Task 3.5.
   */
  readonly control: ControlEvent;
  /** The zoom changed, by pinch, wheel, `fit` or `setZoom`, so the app's zoom control can follow it. Task 3.1. */
  readonly zoom: ZoomEvent;
}

export interface EditEvent {
  readonly command: EditCommand;
  /** The build after the command, in canonical form. */
  readonly blueprint: Blueprint;
}

export interface SelectEvent {
  readonly selection: Selection | null;
}

export type PlacementEvent =
  | { readonly kind: 'part'; readonly part: PartTypeId; readonly placed: boolean }
  | { readonly kind: 'prop'; readonly placed: boolean };

export interface ControlEvent {
  readonly input: ControlInput;
}

export interface ZoomEvent {
  readonly zoom: number;
}

// ---------------------------------------------------------------------------------------------------------
// The command layer (ground rule 8). Touch, pointer and the list view only ever emit EditCommands, applied by
// the one pure `applyEdit`, so the same steps give byte-identical blueprints on every path (task 3.6).

/**
 * Pure. For a blueprint validateBlueprint accepts, a successful result is one it accepts too, in canonical form,
 * with `meta.highWater` raised by every id claimed (`claimPartId`, `claimWireId`): the same commands give the same
 * ids. Wires go through the schema's `planWire`. It never reads the clock (`meta.updatedAt` is the store's job),
 * never touches its input, and never throws except the RangeError the id claims give once ids run out. Task 3.3
 * builds `connect` and `disconnect`; task 3.2 builds every other command.
 */
export type ApplyEdit = (blueprint: Blueprint, command: EditCommand, catalogue: Catalogue) => EditResult;

export type EditResult =
  | { readonly ok: true; readonly blueprint: Blueprint }
  | { readonly ok: false; readonly refusal: EditRefusal };

/**
 * Why a command changed nothing. Impossible drops carry the schema's `wire.*` codes: the canvas shows them as
 * a colour cue at the socket, never as text to the child. The message is for logs and tests.
 */
export interface EditRefusal {
  readonly code: IssueCode | EditCode;
  readonly message: string;
  /** In a batch, the index of the refused command. */
  readonly index?: number;
}

/**
 * Codes the schema does not have:
 * - `edit.unknown_wire`: no wire has that id, or no mount is on that port;
 * - `edit.unknown_prop`: the arena has no prop of the child's with that id;
 * - `edit.wrong_command`: mounts are made and removed with `mount` and `unmount`, other wires with `connect` and `disconnect`;
 * - `edit.locked` (handle only): the build is locked in Run mode or read-only;
 * - `edit.no_build` (handle only): nothing is loaded yet.
 */
export type EditCode = 'edit.unknown_wire' | 'edit.unknown_prop' | 'edit.wrong_command' | 'edit.locked' | 'edit.no_build';

/** One change to the build. Serialisable: plain JSON data. */
export type EditCommand = SingleEdit | EditBatch;

export type SingleEdit =
  | PlacePart
  | MovePart
  | RotatePart
  | RemovePart
  | Connect
  | Disconnect
  | MountPart
  | UnmountPart
  | ChangeSetting
  | SetArena
  | PlaceProp
  | MoveProp
  | RemoveProp
  | Rename;

/** Places a new part from the tray with the next `p<n>` id. */
export interface PlacePart {
  readonly kind: 'place-part';
  readonly part: PartTypeId;
  /**
   * Where its frame origin goes, in canvas mm, after the input path has snapped it (forgiveness radii are screen
   * pixels, so they belong to the input path). Omitted (the list view, the hint ladder's do-it), the placement
   * rule picks a free spot (task 3.2), so every path that omits it lands on the same spot.
   */
  readonly position?: Vec2;
  /** Degrees clockwise in [0, 360); default 0. Ignored with `attach`. */
  readonly rotation?: number;
  /**
   * Attaches it as it lands: its mount port onto a mount point, or its hub (a drive-in) onto a shaft (a drive-out).
   * The mount or the shaft then decides where it sits.
   */
  readonly attach?: { readonly port: PortId; readonly onto: PortRef };
}

/**
 * Moves a placed part (D34). Parts fixed to it or carried by it go with it, so moving the chassis carries the whole
 * robot. A part that is mounted, or carried on another part's shaft, comes off it (that mount or drive linkage is
 * removed) in the same step, because the mount or the shaft decides where such a part sits. Dropped near another
 * free mount point, the input path re-snaps it there with `mount` instead.
 */
export interface MovePart {
  readonly kind: 'move-part';
  readonly partId: PlacedPartId;
  readonly position: Vec2;
}

/** Turns a placed part to `rotation` (degrees clockwise in [0, 360)), with the same rules as MovePart (D34). */
export interface RotatePart {
  readonly kind: 'rotate-part';
  readonly partId: PlacedPartId;
  readonly rotation: number;
}

/**
 * Removes a part and every wire on its ports (D35). Parts that were mounted on it or carried by it stay where they
 * are, loose, and the canvas says which in a callout and in the list view. The app's Undo brings everything back.
 */
export interface RemovePart {
  readonly kind: 'remove-part';
  readonly partId: PlacedPartId;
}

/**
 * Joins two ports with a power line, a signal line or a drive linkage, in either order: `planWire` judges it and
 * gives its stored orientation, and it takes the next `w<n>` id. A drive linkage also moves the part on its drive-in
 * end (a wheel) onto the shaft, where the shaft carries it (`placeParts`), unless that part is mounted; so every
 * path stores a driven wheel at the same place. A mount and a mount point are refused as `edit.wrong_command`.
 */
export interface Connect {
  readonly kind: 'connect';
  readonly from: PortRef;
  readonly to: PortRef;
}

/** Removes a power line, a signal line or a drive linkage; a carried part stays where it is. A mount is refused as `edit.wrong_command`. */
export interface Disconnect {
  readonly kind: 'disconnect';
  readonly wireId: WireId;
}

/**
 * Fixes a placed part by its mount port `port` onto a mount point, and moves it (with the parts fixed to it or
 * carried by it) to where the mount puts it (`mountPlacement`, `canvasPoseOf`). A mount already on that port is
 * replaced in the same step, so a part re-snaps from one mount point to another as one change.
 */
export interface MountPart {
  readonly kind: 'mount';
  readonly partId: PlacedPartId;
  readonly port: PortId;
  readonly onto: PortRef;
}

/** Takes a part off the mount on its port `port`. It stays where it is. */
export interface UnmountPart {
  readonly kind: 'unmount';
  readonly partId: PlacedPartId;
  readonly port: PortId;
}

/**
 * Sets a placed part's setting, checked as validateBlueprint checks it (type, range, step, option). Without
 * `value`, or with the default, the setting goes back to its default. Unlock levels are the input path's
 * concern: the spec card and the list view offer only the settings unlocked at the child's level.
 */
export interface ChangeSetting {
  readonly kind: 'set-setting';
  readonly partId: PlacedPartId;
  readonly setting: SettingId;
  readonly value?: SettingValue;
}

/**
 * Replaces the arena the build runs in: the arena strip's preset picker, and Reset arena, which keeps the preset
 * and drops the props the child added (D29). Parts and wires are never touched.
 */
export interface SetArena {
  readonly kind: 'set-arena';
  readonly arena: ArenaRef;
}

/**
 * Adds a prop from the arena strip (D36) with the next `prop-<n>` id: one more than the highest such id among the
 * preset's features and the arena's props. So after the highest is removed its id can be given out again, unlike a
 * part's or a wire's; that is harmless in v1, because props carry no faults or goals. `at` is in arena millimetres;
 * omitted (the list view), the placement rule picks a free spot on the floor (task 3.2).
 */
export interface PlaceProp {
  readonly kind: 'place-prop';
  readonly prop: PropTemplate;
  readonly at?: Pose;
}

/** Moves one of the child's props. A preset's own props stay where the preset puts them. */
export interface MoveProp {
  readonly kind: 'move-prop';
  readonly propId: ArenaFeatureId;
  readonly at: Pose;
}

export interface RemoveProp {
  readonly kind: 'remove-prop';
  readonly propId: ArenaFeatureId;
}

/** Renames the build (`meta.name`): child text, 1–60 characters on one line. */
export interface Rename {
  readonly kind: 'rename';
  readonly name: string;
}

/**
 * Commands applied in order, all or nothing: one `edit` event, one undo step. The hint ladder's do-it is one batch.
 * A later command names a part an earlier one places by the id the schema's `claimPartId` predicts: each
 * `place-part` takes the next `p<n>` in turn, so the batch's author can claim them in order beforehand.
 */
export interface EditBatch {
  readonly kind: 'batch';
  readonly commands: readonly SingleEdit[];
}

// ---------------------------------------------------------------------------------------------------------
// The list view (task 3.6): the canvas renders it as DOM beside the surface; the model is here for the app,
// the e2e harness's parity checks and tests. It offers only legal actions, so it never meets an impossible drop.

export interface ListView {
  readonly mode: CanvasMode;
  /** In placed-part id order. */
  readonly parts: readonly ListPart[];
  /** In wire id order. */
  readonly wires: readonly ListWire[];
  /** Every prop in the arena, the preset's and the child's, in id order. Only the child's can be moved or removed. */
  readonly props: readonly ListProp[];
  /** The rung drawn on the canvas now, as its text twin. */
  readonly hint?: { readonly step: HintStepKind; readonly line: Text };
  /**
   * The actions on a part, port, wire or prop in the current mode. In Build mode: every edit the canvas has,
   * including moving a part (to the free spot, or onto any free mount point or shaft it fits) and turning it a
   * quarter turn either way; settings unlocked at the child's level; removing. In Run mode: flipping a manual
   * switch, and inspecting. Read-only: inspecting only.
   */
  actionsFor(subject: ListSubject): readonly ListAction[];
  /** Where a tray part can go: the free spot, and every free mount point or shaft it fits. */
  placementsFor(part: PartTypeId): readonly ListAction[];
  /** Where a prop from the arena strip can go: a free spot on the floor. */
  propPlacementsFor(prop: PropTemplate): readonly ListAction[];
  /** Does what an action says, through the same paths as touch and pointer. Returns false when it changed nothing. */
  perform(action: ListAction): boolean;
  /** Called after every change to the model. Returns the unsubscribe function. */
  subscribe(listener: () => void): () => void;
}

export type ListSubject =
  | { readonly kind: 'part'; readonly partId: PlacedPartId }
  | { readonly kind: 'port'; readonly port: PortRef }
  | { readonly kind: 'wire'; readonly wireId: WireId }
  | { readonly kind: 'prop'; readonly propId: ArenaFeatureId };

export interface ListPart {
  readonly partId: PlacedPartId;
  readonly part: PartTypeId;
  /** The real name from the part record, for example `DC motor`. */
  readonly name: Text;
  /** One line to read aloud, for example `DC motor, mounted on chassis, plus (+) connected to battery pack plus (+)`. */
  readonly description: string;
  readonly ports: readonly ListPort[];
  /** Run mode: the live readouts. */
  readonly live?: LiveState;
}

export interface ListPort {
  readonly ref: PortRef;
  /** The port's label from the part record. */
  readonly label: Text;
  readonly type: PortType;
  readonly wires: readonly WireId[];
}

export interface ListWire {
  readonly wireId: WireId;
  readonly kind: WireKind;
  readonly from: PortRef;
  readonly to: PortRef;
  /** One line to read aloud, for example `power line from battery pack plus (+) to DC motor plus (+)`. */
  readonly description: string;
}

export interface ListProp {
  readonly propId: ArenaFeatureId;
  /** One line to read aloud, for example `box, 100 by 100 millimetres, ahead of the robot`. */
  readonly description: string;
  /** Run mode: where it is now. */
  readonly live?: LiveState;
}

export interface ListAction {
  /** Stable while the model is unchanged, for keyboard focus and tests. */
  readonly id: string;
  /** One line to read aloud with real names, for example `Connect to battery pack, plus (+)`. System text: no exclamation marks. */
  readonly label: string;
  readonly does:
    | { readonly kind: 'edit'; readonly command: EditCommand }
    | { readonly kind: 'control'; readonly input: ControlInput }
    | { readonly kind: 'select'; readonly selection: Selection };
}
