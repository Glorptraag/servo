import type { Primitive } from './behaviour.ts';
import type {
  AssetKey,
  FailureModeId,
  HexColour,
  Level,
  NeedId,
  PartTypeId,
  PortId,
  PrimitiveId,
  SettingId,
  Text,
  Vec3,
} from './common.ts';
import type { PortSpec, PowerPair } from './port.ts';
import type { Domain, PartFamily } from './taxonomy.ts';

/** Who the part is. */
export interface PartIdentity {
  /** The real name as it reads mid-sentence: `battery pack`, `DC motor`, `LED`. Titles capitalise the first letter. */
  readonly name: Text;
  readonly family: PartFamily;
  /** At least one, no repeats. */
  readonly domains: readonly Domain[];
  /** The level at which the part is introduced. */
  readonly level: Level;
  /** Swap-registry key for the part's picture. */
  readonly art: AssetKey;
  /** Colours for the placeholder art. */
  readonly colours: { readonly main: HexColour; readonly accent: HexColour };
}

/**
 * The part as a physical body. Frame: origin at the centre of the part's footprint on its base,
 * +x forward, +y left, +z up, millimetres. `size` is the bounding box and the placeholder proportions.
 */
export interface PartBody {
  readonly grams: number;
  readonly size: Vec3;
  /** Inside the box: |x| ≤ size.x/2, |y| ≤ size.y/2, 0 ≤ z ≤ size.z. */
  readonly centreOfMass: Vec3;
}

/**
 * Switches never make a fault. Wherever a need speaks of a loop or a complete circuit, every switch is
 * counted closed: a switch the child opens is state (a run input), never a failure mode.
 */

/**
 * A complete circuit, the right way round, with the voltage across `supply` within [minVolts, maxVolts].
 * Unmet as `open` when there is no loop through the supply even with every switch counted closed, `low`
 * or `high` outside the range, and `reversed` when the loop runs the wrong way round.
 */
export interface PowerNeed {
  readonly id: NeedId;
  readonly kind: 'power';
  readonly supply: PowerPair;
  readonly minVolts: number;
  readonly maxVolts: number;
}

/**
 * A loop runs between these two power ports outside the part: through at least one part that uses power
 * and, unless this part is a source, through a source. Every switch counts as closed. Unmet as `open`.
 */
export interface LoopNeed {
  readonly id: NeedId;
  readonly kind: 'loop';
  readonly ports: readonly [PortId, PortId];
}

/** A signal source drives this signal-in port. */
export interface SignalNeed {
  readonly id: NeedId;
  readonly kind: 'signal';
  readonly port: PortId;
}

/** This mount is fixed to a mount point. */
export interface MountNeed {
  readonly id: NeedId;
  readonly kind: 'mount';
  readonly port: PortId;
}

/** This drive-in is linked to a drive-out. */
export interface DriveNeed {
  readonly id: NeedId;
  readonly kind: 'drive';
  readonly port: PortId;
}

/** The load on this drive-out (an actuator's) stays below what the actuator can turn. */
export interface TorqueNeed {
  readonly id: NeedId;
  readonly kind: 'torque';
  readonly port: PortId;
}

/** No short circuit (a loop through a source with nothing that uses power) runs through these two power ports. */
export interface IsolationNeed {
  readonly id: NeedId;
  readonly kind: 'isolation';
  readonly ports: readonly [PortId, PortId];
}

/**
 * The part's wheel or support rests on the floor, for a part with a `wheel` or `support` primitive.
 * Unmet as `lifted` when it does not reach the floor, and, for a wheel, `slipping` when it pushes harder
 * than its grip allows.
 */
export interface FloorNeed {
  readonly id: NeedId;
  readonly kind: 'floor';
}

/**
 * The robot this part carries rides upright on its wheels and supports. Unmet as `lost` when it falls
 * over, and `grounded` when it settles with its frame on the floor (nothing holds one end up) and drags.
 */
export interface BalanceNeed {
  readonly id: NeedId;
  readonly kind: 'balance';
}

/** What must be true for the part to work. Failure modes name a need and the way it is not met. */
export type Need =
  | PowerNeed
  | LoopNeed
  | SignalNeed
  | MountNeed
  | DriveNeed
  | TorqueNeed
  | IsolationNeed
  | FloorNeed
  | BalanceNeed;

export type NeedKind = Need['kind'];

/** The ways each kind of need can go unmet. */
export const UNMET = {
  power: ['open', 'low', 'high', 'reversed'],
  loop: ['open'],
  signal: ['absent'],
  mount: ['absent'],
  drive: ['absent'],
  torque: ['exceeded'],
  isolation: ['shorted'],
  floor: ['lifted', 'slipping'],
  balance: ['lost', 'grounded'],
} as const satisfies Record<NeedKind, readonly string[]>;

export type Unmet = (typeof UNMET)[NeedKind][number];

/**
 * What the child sees or hears when a failure mode happens: a claim the behaviour fixtures test.
 * Subjects: still, slow, reverse, stall, hold and slip are this part's output (slip: it turns but does not
 * move the robot); hum, silent and quiet its sound; dark and dim its light; off the part as a whole; drain
 * the battery pack feeding it; tip and drag the robot it is on. Slow, quiet and dim mean less than at the
 * rated voltage.
 */
export const EFFECTS = [
  'still',
  'slow',
  'reverse',
  'stall',
  'hold',
  'slip',
  'hum',
  'silent',
  'quiet',
  'dark',
  'dim',
  'off',
  'drain',
  'tip',
  'drag',
] as const;

export type Effect = (typeof EFFECTS)[number];

/** What the part does when a need is not met, and the teaching behind it. Shown as behaviour, never as a dialog (ground rule 9). */
export interface FailureMode {
  readonly id: FailureModeId;
  readonly need: NeedId;
  /** One of UNMET for the need's kind. */
  readonly unmet: Unmet;
  /** At least one, no repeats. */
  readonly shows: readonly Effect[];
  /** For adults and reviewers: why it happens. */
  readonly teachingNote: Text;
  /** The spec card's failure line, shown when it happens: `No signal: the arm stays where it is and hums.` */
  readonly cardLine: Text;
  /** A one-line hint naming the part or port, without a full stop: `The servo is waiting for a signal`. */
  readonly hint?: Text;
}

/** The primitive parameter a setting drives. For a number setting, `range` maps [min, max] onto the parameter linearly. */
export interface SettingBinding {
  readonly primitive: PrimitiveId;
  readonly param: string;
  readonly range?: readonly [number, number];
}

interface SettingBase {
  readonly id: SettingId;
  readonly label: Text;
  /** The level at which the child can change it; before that the default applies. */
  readonly unlockLevel: Level;
  readonly binds: SettingBinding;
}

/** A dial or slider: values from `min` to `max` in child-sized `step`s, shown with the real `unit` beside. */
export interface NumberSetting extends SettingBase {
  readonly kind: 'number';
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly default: number;
  /** The real unit shown beside the value, for example `°`, `%`, `V`. */
  readonly unit: string;
}

export interface ChoiceOption {
  readonly id: string;
  readonly label: Text;
  /** What the bound parameter receives. */
  readonly value: number | boolean | string;
}

/** A small set of named choices, for example forward or backward. */
export interface ChoiceSetting extends SettingBase {
  readonly kind: 'choice';
  /** At least two. */
  readonly options: readonly ChoiceOption[];
  /** An option id. */
  readonly default: string;
}

export type Setting = NumberSetting | ChoiceSetting;

/** The spec card's authored layers. Name and picture come from identity, settings from `settings`, failure notes from `failureModes`. */
export interface SpecCard {
  /** What it does (Level 1). */
  readonly does: Text;
  /** Needs line (Level 2), as shown: `Needs: power (red) and a signal (yellow).` */
  readonly needs: Text;
  /** Gives line (Level 2), as shown: `Gives: a turning arm.` */
  readonly gives: Text;
  /** One sentence linking the part to something a child has seen (Level 2). */
  readonly popularMechanics: Text;
  /** Real specs (Level 4). */
  readonly specLine?: Text;
  /** Swap-registry key of the real-world picture beside the popular-mechanics line. */
  readonly realWorldArt?: AssetKey;
  /** Adult-supervision note on batteries and small parts where the card points at a real kit (brief Section 13). */
  readonly safetyNote?: Text;
}

export type SpecCardLayer =
  | 'name'
  | 'picture'
  | 'does'
  | 'needs-gives'
  | 'popular-mechanics'
  | 'settings'
  | 'spec-line'
  | 'failure-notes';

/**
 * When each layer shows. The settings layer has no level of its own: each setting shows from its own
 * `unlockLevel` (a DC motor's direction from Level 2, its speed from Level 3). Failure notes show when the
 * failure happens, at any level.
 */
export const SPEC_CARD_LAYERS: readonly {
  readonly layer: SpecCardLayer;
  readonly from: Level | 'each-setting-unlock' | 'when-it-happens';
}[] = [
  { layer: 'name', from: 1 },
  { layer: 'picture', from: 1 },
  { layer: 'does', from: 1 },
  { layer: 'needs-gives', from: 2 },
  { layer: 'popular-mechanics', from: 2 },
  { layer: 'settings', from: 'each-setting-unlock' },
  { layer: 'spec-line', from: 4 },
  { layer: 'failure-notes', from: 'when-it-happens' },
];

/** One record per part type, authored as content (packages/content). The brief's parts schema, Section 6. */
export interface PartRecord {
  readonly id: PartTypeId;
  readonly identity: PartIdentity;
  readonly body: PartBody;
  /** At least one. Order is display order. */
  readonly ports: readonly PortSpec[];
  readonly needs: readonly Need[];
  readonly behaviour: readonly Primitive[];
  readonly settings: readonly Setting[];
  readonly failureModes: readonly FailureMode[];
  readonly card: SpecCard;
}
