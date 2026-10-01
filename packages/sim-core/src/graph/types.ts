import type {
  ActuatorPrimitive,
  Blueprint,
  Catalogue,
  Control,
  DrivePush,
  DriverPrimitive,
  LoadPrimitive,
  PartPlacement,
  PartRecord,
  PlacedPart,
  PlacedPartId,
  Placement,
  PortId,
  PortRef,
  PortSpec,
  Primitive,
  PrimitiveId,
  ProgramPrimitive,
  RegulatorPrimitive,
  SourcePrimitive,
  SwitchPrimitive,
  WireId,
} from '@servo/schema';

/**
 * The wired graph of one blueprint, built once when a Run starts and read by the solvers every tick.
 * Every list is in a fixed order, so the same blueprint and catalogue always give the same graph.
 * Net, source, switch, use and control numbers are indices into the lists here. Internal to sim-core:
 * the solvers import it from src/graph/index.ts, and the package entry does not export it. See docs/graph.md.
 */
export interface SimGraph {
  /** The blueprint and catalogue it was built from, for the schema's own judgements (`wiredNeeds`). */
  readonly blueprint: Blueprint;
  readonly catalogue: Catalogue;
  /** Every placed part, in id order. */
  readonly parts: ReadonlyMap<PlacedPartId, GraphPart>;
  /** Ports joined by power wires alone, in the order of their first port. Switches join nets only at solve time. */
  readonly nets: readonly PowerNet[];
  /** Batteries, and the outputs of motor-driver channels and regulators: in part id order, then the record's primitive order. */
  readonly sources: readonly PowerSource[];
  /** Switch terminals: joins that the control state opens and closes. Same order. */
  readonly switches: readonly PowerSwitch[];
  /** What takes power: loads, actuators, programs, and the supplies of drivers and regulators. Same order. */
  readonly uses: readonly PowerUse[];
  /** The controls, exactly as the schema's `controlsOf` gives them: switch positions and driver-channel commands. */
  readonly controls: readonly Control[];
  /**
   * The live nets for every setting of the controls, indexed by control key (bit i set when control i is
   * on: a switch closed, a channel not at stop). Present when there are at most LIVE_TABLE_CONTROLS
   * controls; otherwise `liveAt` works each state out when asked.
   */
  readonly liveTable: readonly LiveNets[] | undefined;
  /** Signal lines, signal out → signal in, in wire id order. */
  readonly signals: readonly SignalLink[];
  /** Drive linkages, drive-out → drive-in, in wire id order. */
  readonly drives: readonly DriveLink[];
  /** Mounts, a part's mount → another part's mount point, in wire id order. */
  readonly mounts: readonly MountLink[];
  /** The robot's root part (the schema's `robotRoot`), or undefined when no part holds another. */
  readonly root: PlacedPartId | undefined;
  /** Which way each drive wheel pushes the robot at positive actuator speed (the schema's `drivePushes`). */
  readonly pushes: readonly DrivePush[];
}

/** One placed part with its record, its ports bound to nets and links, and its place on the robot. */
export interface GraphPart {
  readonly id: PlacedPartId;
  /** The blueprint's entry: position, rotation and settings as built. */
  readonly placed: PlacedPart;
  readonly record: PartRecord;
  /** Every port of the record, in the record's order. */
  readonly ports: ReadonlyMap<PortId, BoundPort>;
  /** The record's primitives in its order, each with the power elements it makes. */
  readonly primitives: readonly BoundPrimitive[];
  /** How it is held and its frame in its root's frame (the schema's `placeParts`). */
  readonly placement: PartPlacement;
}

/** A port and what it is joined to. */
export interface BoundPort {
  readonly spec: PortSpec;
  /** A power port's net. */
  readonly net?: number;
  /**
   * The ports at the other end of its signal lines or mechanical linkage, in port order. A signal out
   * may feed several signal ins; every other signal or mechanical port takes at most one. Empty for power
   * ports: their wires are summed up by the net.
   */
  readonly joined: readonly PortRef[];
}

/**
 * A primitive of a placed part, bound to the power elements it makes (indices into the graph's lists).
 * Its other ports (a shaft, a hub, a signal in) resolve through the part's `ports`, by the ids it names.
 */
export interface BoundPrimitive {
  readonly spec: Primitive;
  /** A battery, or a driver channel's or regulator's output. */
  readonly source?: number;
  /** A supply: a load's, an actuator's, a program's, or a driver's or regulator's. */
  readonly use?: number;
  /** A switch's terminals. */
  readonly switch?: number;
}

/** Ports joined by power wires alone. A net is named by its first port. */
export interface PowerNet {
  /** In comparePortRefs order (part id, then port id). */
  readonly ports: readonly PortRef[];
  /** The power wires inside it, in id order. */
  readonly wires: readonly WireId[];
}

/** The + and − nets of a pair of power ports. */
export interface NetPair {
  readonly pos: number;
  readonly neg: number;
}

/** A battery, or an output that gives power while its supply has it. Its polarity: `pos` is its + net, `neg` its −. */
export interface PowerSource extends NetPair {
  readonly part: PlacedPartId;
  readonly primitive: PrimitiveId;
  readonly spec: SourcePrimitive | DriverPrimitive | RegulatorPrimitive;
  /** For an output: the supply that must close through a source giving power before it gives any. */
  readonly feeder?: NetPair;
  /** For a driver channel's output: its control. At stop (command 0) it gives none. */
  readonly control?: number;
}

/** A switch's two terminals, joined while its control has it closed. */
export interface PowerSwitch {
  readonly part: PlacedPartId;
  readonly primitive: PrimitiveId;
  readonly spec: SwitchPrimitive;
  readonly a: number;
  readonly b: number;
  readonly control: number;
}

/** Something that takes power between its supply's + net and − net. */
export interface PowerUse extends NetPair {
  readonly part: PlacedPartId;
  readonly primitive: PrimitiveId;
  readonly spec: LoadPrimitive | ActuatorPrimitive | ProgramPrimitive | DriverPrimitive | RegulatorPrimitive;
}

/**
 * The power graph at one setting of the controls: which nets closed switches join, which sources give power
 * and which nets are live. Arrays are indexed like the graph's nets and sources. Not the interface's
 * `LiveState`, which is one part's live values during a Run.
 */
export interface LiveNets {
  /** Each net's node: nets joined by closed switches share one, numbered by the lowest net index among them. */
  readonly nodes: readonly number[];
  /** Whether each source gives power: a battery always; an output while its supply has power and, for a driver channel, its command is not stop. */
  readonly sources: readonly boolean[];
  /** Whether each net is live: a closed path through a source giving power runs through it. */
  readonly nets: readonly boolean[];
}

/** A signal line. */
export interface SignalLink {
  readonly wire: WireId;
  /** The signal out. */
  readonly from: PortRef;
  /** The signal in. */
  readonly to: PortRef;
}

/** A drive linkage: the drive-in turns exactly as the drive-out turns. */
export interface DriveLink {
  readonly wire: WireId;
  /** The drive-out: a shaft or an arm. */
  readonly from: PortRef;
  /** The drive-in: a hub or a gearbox input. */
  readonly to: PortRef;
  /**
   * The driven part's frame in the driving part's frame when it rides this shaft (the schema's
   * `carriedPlacement`), or undefined when no quarter turn lines the axes up. The driven part's own
   * placement says whether it rides it: a mounted part is held by its mount instead.
   */
  readonly carried: Placement | undefined;
}

/** A mount: a part fixed by its mount to a mount point on its host. */
export interface MountLink {
  readonly wire: WireId;
  readonly part: PlacedPartId;
  readonly mount: PortId;
  readonly host: PlacedPartId;
  readonly point: PortId;
  /** The part's frame in the host's frame (the schema's `mountPlacement`), mirrored on a mirrored mount point. */
  readonly local: Placement;
}
