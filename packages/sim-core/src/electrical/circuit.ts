import type { ActuatorState } from './types.ts';
import { at } from './model.ts';
import type { Model, Situation, SourceInfo, UseInfo } from './model.ts';
import { batteryEmf, positionActuatorMilliamps } from './primitives.ts';

/**
 * The lumped circuit at one tick, solved as a nodal network. Every element is a branch whose current is a
 * continuous, piecewise-linear, non-decreasing function of one voltage across it, so the operating point is
 * where a convex, piecewise-quadratic function of the node volts is least. Damped Newton finds it: take the
 * segment each branch's voltage lies on, solve that linear network, and walk towards its answer only as far
 * as the function keeps falling, until the answer lies on the segments it was solved on. That always ends.
 * Around it: a regulator's drop follows its supply, and a motor driver that would sag its supply below onVolts
 * runs at the duty that holds it there (a bracketed search), each solved again until both stand.
 * Each linear solve eliminates the unknowns in a fixed order (by net) on a symmetric positive definite
 * matrix, so it needs no pivoting. No transient physics: no inductance or capacitance; a motor's back-EMF and
 * load come from last tick. See docs/electrical.md.
 */

/**
 * The slope, in siemens, a two-terminal element is given wherever it conducts nothing, so no net is left
 * without one voltage and no two answers tie. It is never reported: the currents reported are the parts' own.
 */
export const LEAK_SIEMENS = 1e-9;
/** A driver channel's or regulator's output resistance: small enough not to show, so the output stays a source with limited current. */
export const OUTPUT_OHMS = 0.01;
/** Where a draw that is constant above a threshold of 0 V ramps up from nothing, so the circuit has one answer. */
export const KNEE_VOLTS = 0.01;
/** How far a voltage may sit outside its branch's segment, or a regulator's drop may move, and the answer still stand. */
export const SETTLE_VOLTS = 1e-9;
/**
 * Bounds no circuit has come near (docs/electrical.md): a handful of solves, or a few dozen while a motor driver
 * browns out. At them the last step stands, marked unsettled.
 */
const MAX_SOLVES = 2048;
const MAX_ROUNDS = 64;
/** How many steps the search for a browning-out driver's duty may take. */
const MAX_DUTY_STEPS = 64;
/**
 * A browning-out driver's supply is held between onVolts and onVolts + 2 × DUTY_VOLTS (aiming a microvolt above),
 * so it never reads below onVolts. A microvolt is looser than SETTLE_VOLTS because where a net hangs on leaks
 * alone the answer is only that good. The duty search also stops once its bracket is narrower than DUTY_WIDTH.
 */
export const DUTY_VOLTS = 1e-6;
const DUTY_WIDTH = 1e-9;

/** What a branch stands for, so its numbers can be set each tick. */
type Role =
  | { readonly kind: 'battery'; readonly source: number }
  | { readonly kind: 'use'; readonly use: number }
  | { readonly kind: 'leak' }
  | { readonly kind: 'output'; readonly output: number };

/**
 * A branch: across its ports, weighted, the voltage u = Σ weights × port volts, and on the segment holding u
 * the current g·u + c for the solver and pg·u + pc for the part. Segments are split at `breaks` (ascending); a u
 * on a break belongs to the lower segment. The current leaves each port's net into the part as weight × current.
 * Its ports, nodes and weights are fixed for a situation; its numbers are set again every tick.
 */
interface Branch {
  readonly role: Role;
  readonly ports: readonly number[];
  /** Fixed for a two-terminal branch; an output's ratio is set every tick. */
  readonly weights: number[];
  /** Per port: its node, and its unknown (−1 for a reference node). */
  readonly nodes: readonly number[];
  readonly cols: readonly number[];
  readonly breaks: number[];
  readonly g: number[];
  readonly c: number[];
  readonly pg: number[];
  readonly pc: number[];
  region: number;
}

interface Output {
  readonly source: number;
  readonly info: SourceInfo;
  /** The size of its command (a regulator's is 1), and whether it drives the other way round. */
  readonly n: number;
  readonly flip: boolean;
  readonly maxAmps: number;
  readonly branch: Branch;
  /** A driver channel's supply group, or −1 for a regulator. */
  readonly group: number;
  /** Whether the wiring gives it power and its command is not stop. */
  live: boolean;
  /** A regulator's drop this tick (dropoutVolts or more); a driver channel's dropVolts. */
  drop: number;
}

/**
 * A motor driver's channels on one supply, and their duty: the share of the time they are on. It is 1 unless
 * the supply would sag below the driver's onVolts. Then a real driver stutters, cutting out and coming back
 * faster than a tick, and the duty is the lumped average of that: the share that holds the supply at onVolts,
 * or 0 when even the supply with its outputs off is below it.
 */
interface Group {
  readonly part: string;
  readonly outputs: readonly Output[];
  readonly onVolts: number;
  /** The supply's two nodes. */
  readonly pos: number;
  readonly neg: number;
  duty: number;
}

/** A situation's branches, made once and given new numbers every tick. */
interface Layout {
  readonly fixed: readonly Branch[];
  readonly batteries: readonly (Branch | undefined)[];
  readonly uses: readonly Branch[];
  readonly outputs: readonly Output[];
  readonly groups: readonly Group[];
}

/** The operating point of one tick at one situation. Volts are per node (a net's volts are its node's). */
export interface Solved {
  readonly volts: Float64Array;
  /** Out of each source's + port, amps. */
  readonly sourceAmps: Float64Array;
  /** Each source's open-circuit volts, + over −: a battery's, or an output's the way it drives (never less than 0 that way). */
  readonly sourceEmf: Float64Array;
  /** Whether each source can give power now: a battery with charge, an output that is on and has volts to give. */
  readonly giving: readonly boolean[];
  /** Each source's duty: a motor driver channel's share of the time on (below 1 while it browns out); 1 for any other. */
  readonly duty: Float64Array;
  /** Whether each source is a motor driver channel, with a command, that browns out: its duty is below 1. */
  readonly browned: readonly boolean[];
  /** Into each use's + port, amps. */
  readonly useAmps: Float64Array;
  /** From each port's net into its part, amps, through the parts' elements (not yet through switches). */
  readonly portAmps: Float64Array;
  readonly solves: number;
  readonly settled: boolean;
}

/** Segments per branch: fixed by what it stands for (a motor's by whether it blocks and its throttle). */
const segmentsOf = (model: Model, role: Role): number => {
  if (role.kind === 'output') return 3;
  if (role.kind !== 'use') return 1;
  const use = model.uses[role.use];
  const spec = use?.spec;
  if (!spec) return 1;
  switch (spec.kind) {
    case 'load':
      return spec.whenReversed === 'blocks' ? 2 : 3;
    case 'actuator':
      if (spec.mode === 'position') return 3;
      return spec.whenReversed === 'blocks' && (use.motor?.throttle ?? 0) > 0 ? 2 : 1;
    case 'program':
    case 'driver':
      return 3;
    default:
      return 1;
  }
};

const layouts = new WeakMap<Situation, Layout>();

/** The branches of a situation, made once: their ports, nodes, unknowns and weights. */
const layoutOf = (model: Model, situation: Situation): Layout => {
  const known = layouts.get(situation);
  if (known) return known;
  const nodeOf = (port: number): number => at(situation.live.nodes, at(situation.netOfPort, port));
  const make = (role: Role, ports: readonly number[], weights: readonly number[]): Branch => {
    const nodes = ports.map(nodeOf);
    const count = segmentsOf(model, role);
    return {
      role,
      ports,
      weights: [...weights],
      nodes,
      cols: nodes.map((node) => at(situation.unknownOf, node)),
      breaks: new Array<number>(count - 1).fill(0),
      g: new Array<number>(count).fill(0),
      c: new Array<number>(count).fill(0),
      pg: new Array<number>(count).fill(0),
      pc: new Array<number>(count).fill(0),
      region: 0,
    };
  };
  const pair = [1, -1];
  const fixed: Branch[] = [];
  const batteries = model.sources.map((source, index) => {
    if (source.kind !== 'battery') return undefined;
    const branch = make({ kind: 'battery', source: index }, [source.pos, source.neg], pair);
    fixed.push(branch);
    return branch;
  });
  const uses = model.uses.map((use, index) => {
    const branch = make({ kind: 'use', use: index }, [use.pos, use.neg], pair);
    fixed.push(branch);
    return branch;
  });
  const outputs: Output[] = [];
  const groups: { readonly part: string; outputs: Output[]; onVolts: number; readonly pos: number; readonly neg: number; duty: number }[] = [];
  model.sources.forEach((info, index) => {
    if (info.kind === 'battery') return;
    // Leaks on the output and on the supply, so each pair keeps its nodes tied while the output gives nothing.
    fixed.push(make({ kind: 'leak' }, [info.pos, info.neg], pair));
    fixed.push(make({ kind: 'leak' }, [info.feederPos, info.feederNeg], pair));
    const spec = info.spec;
    const command = info.kind === 'channel' ? at(situation.command, info.control) : 1;
    const n = command < 0 ? -command : command;
    const flip = command < 0;
    const ports = [info.feederPos, info.feederNeg, flip ? info.neg : info.pos, flip ? info.pos : info.neg];
    const maxAmps = spec.kind === 'source' ? 0 : spec.maxMilliamps / 1000;
    // A driver's channels on one supply share a duty: each driver browns out as a whole, and on its own.
    let group = -1;
    if (spec.kind === 'driver') {
      const pos = nodeOf(info.feederPos);
      const neg = nodeOf(info.feederNeg);
      group = groups.findIndex((each) => each.part === info.part && each.pos === pos && each.neg === neg);
      if (group < 0) group = groups.push({ part: info.part, outputs: [], onVolts: 0, pos, neg, duty: 1 }) - 1;
    }
    const output: Output = { source: index, info, n, flip, maxAmps, branch: make({ kind: 'output', output: outputs.length }, ports, [n, -n, -1, 1]), group, live: false, drop: 0 };
    outputs.push(output);
    const owner = groups[group];
    if (owner && spec.kind === 'driver') {
      owner.outputs.push(output);
      owner.onVolts = Math.max(owner.onVolts, spec.onVolts);
    }
  });
  const layout = { fixed, batteries, uses, outputs, groups };
  layouts.set(situation, layout);
  return layout;
};

/**
 * Sets a two-terminal branch's solver curve from the part's own (`pg`, `pc` already set, continuous): the part's
 * own plus LEAK_SIEMENS × (how far u runs along flat segments from 0 V). So the curve is continuous and strictly
 * rising, keeps the part's own slope wherever it conducts, and still gives no current at 0 V: an off LED or a
 * dangling leg draws nothing and sits at its neighbour's volts. Elsewhere it differs from the part's own by
 * leak currents alone, which are never reported.
 */
const leaky = (branch: Branch): void => {
  const { breaks, g, c, pg, pc } = branch;
  const count = pg.length;
  /** The segment holding 0 V: every break below it is negative, every one from it on is not. */
  let zero = 0;
  while (zero < breaks.length && (breaks[zero] as number) < 0) zero += 1;
  const set = (index: number, near: number, run: number): void => {
    // `run`: the flat length from 0 V to `near`, the segment's point nearest 0 V.
    const flat = (pg[index] as number) > 0 ? 0 : 1;
    g[index] = (pg[index] as number) + LEAK_SIEMENS * flat;
    c[index] = (pc[index] as number) + LEAK_SIEMENS * (run - flat * near);
  };
  set(zero, 0, 0);
  let run = 0;
  for (let index = zero + 1; index < count; index += 1) {
    const below = breaks[index - 2] ?? 0;
    const near = breaks[index - 1] as number;
    if ((pg[index - 1] as number) <= 0) run += near - (index - 1 === zero ? 0 : below);
    set(index, near, run);
  }
  run = 0;
  for (let index = zero - 1; index >= 0; index -= 1) {
    const above = index + 1 === zero ? 0 : (breaks[index + 1] as number);
    const near = breaks[index] as number;
    if ((pg[index + 1] as number) <= 0) run += near - above;
    set(index, near, run);
  }
};

/** The part's own curve: flat at 0 (a leak), or one straight line. */
const line = (branch: Branch, slope: number, offset: number): void => {
  branch.pg[0] = slope;
  branch.pc[0] = offset;
  branch.region = 0;
  leaky(branch);
};

/**
 * Nothing reversed, rising in a straight line to `amps` at `knee` volts, and holding there. The first guess
 * is the ramp: a resistance, which a weak or drained supply can always meet.
 */
const saturating = (branch: Branch, amps: number, knee: number): void => {
  const top = knee > 0 ? knee : KNEE_VOLTS;
  branch.breaks[0] = 0;
  branch.breaks[1] = top;
  branch.pg[0] = 0;
  branch.pc[0] = 0;
  branch.pg[1] = amps / top;
  branch.pc[1] = 0;
  branch.pg[2] = 0;
  branch.pc[2] = amps;
  branch.region = 1;
  leaky(branch);
};

const finite = (value: number | undefined): number => (value !== undefined && Number.isFinite(value) ? value : 0);

/** A use's curve this tick: a load, an actuator, a program, or a driver's or regulator's supply. */
const setUse = (branch: Branch, use: UseInfo, state: ActuatorState | undefined): void => {
  const spec = use.spec;
  switch (spec.kind) {
    case 'load': {
      // Nothing below onVolts; ratedMilliamps at ratedVolts, in a straight line from onVolts.
      const slope = spec.ratedMilliamps / 1000 / (spec.ratedVolts - spec.onVolts);
      const on = spec.onVolts;
      if (spec.whenReversed === 'blocks') {
        branch.breaks[0] = on;
        branch.pg[0] = 0;
        branch.pc[0] = 0;
        branch.pg[1] = slope;
        branch.pc[1] = -slope * on;
        branch.region = 1;
      } else {
        branch.breaks[0] = -on;
        branch.breaks[1] = on;
        branch.pg[0] = slope;
        branch.pc[0] = slope * on;
        branch.pg[1] = 0;
        branch.pc[1] = 0;
        branch.pg[2] = slope;
        branch.pc[2] = -slope * on;
        branch.region = 2;
      }
      leaky(branch);
      return;
    }
    case 'actuator': {
      if (spec.mode === 'position') {
        saturating(branch, positionActuatorMilliamps(spec, finite(state?.loadNmm)) / 1000, spec.startVolts);
        return;
      }
      const motor = use.motor;
      if (!motor) {
        line(branch, 0, 0);
        return;
      }
      // The winding at throttle d (switched on for a share d of the time): current d·(d·u − back-EMF)/ohms,
      // with the no-load draw while it turns, in the way it turns.
      const d = motor.throttle;
      const turning = motor.reverse ? -finite(state?.rpm) : finite(state?.rpm);
      const back = motor.voltsPerRpm * turning;
      const loss = turning > 0 ? motor.noLoadAmps : turning < 0 ? -motor.noLoadAmps : 0;
      const slope = (d * d) / motor.ohms;
      const offset = (-d * back) / motor.ohms + d * loss;
      if (branch.g.length === 1) {
        line(branch, slope, offset);
        return;
      }
      // Blocks: no current the wrong way through it.
      branch.breaks[0] = -offset / slope;
      branch.pg[0] = 0;
      branch.pc[0] = 0;
      branch.pg[1] = slope;
      branch.pc[1] = offset;
      branch.region = 1;
      leaky(branch);
      return;
    }
    case 'program':
      saturating(branch, spec.milliamps / 1000, spec.onVolts);
      return;
    case 'driver':
      saturating(branch, spec.idleMilliamps / 1000, spec.onVolts);
      return;
    default:
      // A regulator's supply carries only what its output passes on (the output's branch).
      line(branch, 0, 0);
  }
};

/**
 * A driver channel's or regulator's output: an ideal transformer of ratio `ratio` from its supply, less `drop`,
 * behind OUTPUT_OHMS, passing current one way only, up to its limit. Across u = ratio·(supply volts) − (output
 * volts the way it drives), the current out is 0 below `drop`, (u − drop)/OUTPUT_OHMS above, and the limit
 * past it; the supply carries ratio times that. It adds one symmetric outer product to the matrix. A driver
 * channel's ratio is its command × its driver's duty, and its drop and its limit are dropVolts and maxMilliamps ×
 * the duty: what it gives when fully on, averaged over the share of the time it is on.
 */
const setOutput = (output: Output, ratio: number, drop: number, limit: number): void => {
  const { weights, breaks, g, c, pg, pc } = output.branch;
  weights[0] = ratio;
  weights[1] = -ratio;
  output.drop = drop;
  breaks[0] = drop;
  breaks[1] = drop + limit * OUTPUT_OHMS;
  g[0] = 0;
  g[1] = 1 / OUTPUT_OHMS;
  g[2] = 0;
  c[0] = 0;
  c[1] = -drop / OUTPUT_OHMS;
  c[2] = limit;
  for (let index = 0; index < 3; index += 1) {
    pg[index] = at(g, index);
    pc[index] = at(c, index);
  }
};

// The hot loops below index their arrays directly rather than through `at`, so each read site sees one kind
// of array and the engine keeps it fast.

const regionOf = (breaks: readonly number[], u: number): number => {
  let region = 0;
  while (region < breaks.length && u > (breaks[region] as number)) region += 1;
  return region;
};

/** Whether u lies on the branch's segment, within SETTLE_VOLTS. */
const fits = (branch: Branch, u: number): boolean => {
  const { breaks, region } = branch;
  if (region > 0 && u < (breaks[region - 1] as number) - SETTLE_VOLTS) return false;
  return !(region < breaks.length && u > (breaks[region] as number) + SETTLE_VOLTS);
};

const across = (branch: Branch, volts: Float64Array): number => {
  const { nodes, weights } = branch;
  let u = 0;
  for (let index = 0; index < nodes.length; index += 1) u += (weights[index] as number) * (volts[nodes[index] as number] as number);
  return u;
};

/** Solves the unknowns' symmetric positive definite system in place, eliminating them in index order. */
const eliminate = (n: number, a: Float64Array, b: Float64Array): void => {
  for (let k = 0; k < n; k += 1) {
    const pivot = a[k * n + k] as number;
    for (let i = k + 1; i < n; i += 1) {
      const factor = (a[i * n + k] as number) / pivot;
      if (factor === 0) continue;
      for (let j = k; j < n; j += 1) a[i * n + j] = (a[i * n + j] as number) - factor * (a[k * n + j] as number);
      b[i] = (b[i] as number) - factor * (b[k] as number);
    }
  }
  for (let k = n - 1; k >= 0; k -= 1) {
    let sum = b[k] as number;
    for (let j = k + 1; j < n; j += 1) sum -= (a[k * n + j] as number) * (b[j] as number);
    b[k] = sum / (a[k * n + k] as number);
  }
};

/**
 * The operating point at a situation, with each battery's charge and each actuator's state from last tick.
 * Pure: the same model, situation, charges and actuator states give the same bits.
 */
export const solveCircuit = (model: Model, situation: Situation, charge: readonly number[], actuators: readonly (ActuatorState | undefined)[] = []): Solved => {
  const layout = layoutOf(model, situation);
  const sourceEmf = new Float64Array(model.sources.length);
  layout.batteries.forEach((branch, index) => {
    const spec = model.sources[index]?.spec;
    if (!branch || spec?.kind !== 'source') return;
    const left = at(charge, index);
    const emf = batteryEmf(spec, left);
    sourceEmf[index] = emf;
    if (left > 0) line(branch, 1 / spec.internalOhms, -emf / spec.internalOhms);
    else {
      // Drained, it gives nothing; only the leak shows its emptyVolts on an open circuit.
      line(branch, 0, 0);
      branch.c[0] = -emf * LEAK_SIEMENS;
    }
  });
  layout.uses.forEach((branch, index) => {
    const use = model.uses[index];
    if (use) setUse(branch, use, actuators[index]);
  });
  for (const branch of layout.fixed) if (branch.role.kind === 'leak') line(branch, 0, 0);
  /** A driver channel at its group's duty; a regulator at its drop. */
  const configure = (output: Output, drop: number): void => {
    const spec = output.info.spec;
    const duty = layout.groups[output.group]?.duty ?? 1;
    if (spec.kind === 'driver') setOutput(output, output.n * duty, spec.dropVolts * duty, output.maxAmps * duty);
    else setOutput(output, output.n, drop, output.maxAmps);
  };
  // Every tick starts with each driver fully on: one that browned out last tick comes back as soon as its
  // supply allows.
  for (const group of layout.groups) group.duty = 1;
  for (const output of layout.outputs) {
    const spec = output.info.spec;
    configure(output, spec.kind === 'regulator' ? spec.dropoutVolts : 0);
    output.branch.region = 1;
    output.live = situation.live.sources[output.source] === true && output.n > 0;
  }
  const isActive = (output: Output): boolean => output.live && (layout.groups[output.group]?.duty ?? 1) > 0;

  const count = situation.wiring.nets.length;
  const unknowns = situation.unknowns;
  const size = unknowns * unknowns + unknowns;
  if (!situation.scratch || situation.scratch.length < size) situation.scratch = new Float64Array(size);
  const scratch = situation.scratch;
  const branches: Branch[] = [];
  const gather = (): Branch[] => {
    branches.length = 0;
    for (const branch of layout.fixed) branches.push(branch);
    for (const output of layout.outputs) if (isActive(output)) branches.push(output.branch);
    return branches;
  };

  /** The answer of the linear network with every branch on its current segment. */
  const linearSolve = (list: readonly Branch[]): Float64Array => {
    scratch.fill(0, 0, size);
    const a = scratch.subarray(0, unknowns * unknowns);
    const b = scratch.subarray(unknowns * unknowns, size);
    for (const branch of list) {
      const g = branch.g[branch.region] as number;
      const c = branch.c[branch.region] as number;
      const { cols, weights } = branch;
      for (let i = 0; i < cols.length; i += 1) {
        const row = cols[i] as number;
        if (row < 0) continue;
        const wi = weights[i] as number;
        b[row] = (b[row] as number) - c * wi;
        if (g === 0) continue;
        for (let j = 0; j < cols.length; j += 1) {
          const col = cols[j] as number;
          if (col >= 0) a[row * unknowns + col] = (a[row * unknowns + col] as number) + g * wi * (weights[j] as number);
        }
      }
    }
    eliminate(unknowns, a, b);
    const volts = new Float64Array(count);
    const unknownOf = situation.unknownOf;
    for (let net = 0; net < count; net += 1) {
      const unknown = unknownOf[net] as number;
      if (unknown >= 0) volts[net] = b[unknown] as number;
    }
    return volts;
  };

  /**
   * How far to walk from `from` towards `to`, as a share t of the way (0 to 1): to where the convex function
   * stops falling. Along the walk its slope is Σ s·i(u + t·s) over the branches (s: how far each one's voltage
   * moves), which rises and is linear between the points where a voltage crosses a break, so the zero is found
   * exactly between two of them.
   */
  const stepSize = (list: readonly Branch[], from: Float64Array, to: Float64Array): number => {
    const start = list.map((branch) => across(branch, from));
    const moves = list.map((branch, index) => across(branch, to) - at(start, index));
    const slope = (t: number): number => {
      let sum = 0;
      list.forEach((branch, index) => {
        const move = at(moves, index);
        if (move === 0) return;
        const u = at(start, index) + t * move;
        const region = regionOf(branch.breaks, u);
        sum += move * (at(branch.g, region) * u + at(branch.c, region));
      });
      return sum;
    };
    const first = slope(0);
    if (!(first < 0)) return 0;
    const last = slope(1);
    if (last <= 0) return 1;
    const crossings: number[] = [];
    list.forEach((branch, index) => {
      const move = at(moves, index);
      if (move === 0) return;
      for (const join of branch.breaks) {
        const t = (join - at(start, index)) / move;
        if (t > 0 && t < 1) crossings.push(t);
      }
    });
    crossings.sort((p, q) => p - q);
    crossings.push(1);
    let low = 0;
    let lowSlope = first;
    for (const t of crossings) {
      if (t <= low) continue;
      const value = slope(t);
      if (value >= 0) return low + (-lowSlope * (t - low)) / (value - lowSlope);
      low = t;
      lowSlope = value;
    }
    return 1;
  };

  let volts: Float64Array = new Float64Array(count);
  let started = false;
  let solves = 0;

  /** Damped Newton for the outputs as they stand, from the last answer. False if it ran out of solves. */
  const settle = (): boolean => {
    while (solves < MAX_SOLVES) {
      const list = gather();
      const here = started ? volts : undefined;
      if (here) for (const branch of list) branch.region = regionOf(branch.breaks, across(branch, here));
      const newton = linearSolve(list);
      solves += 1;
      let fitting = true;
      for (const branch of list) {
        if (fits(branch, across(branch, newton))) continue;
        fitting = false;
        break;
      }
      if (fitting || !here) {
        volts = newton;
        started = true;
        if (fitting) return true;
        continue;
      }
      const t = stepSize(list, here, newton);
      const next = new Float64Array(count);
      let moved = 0;
      for (let net = 0; net < count; net += 1) {
        const step = t * (at(newton, net) - at(here, net));
        next[net] = at(here, net) + step;
        moved = Math.max(moved, step < 0 ? -step : step);
      }
      // Nothing left to fall: `here` is the answer, on the segments it lies on. (A Newton answer can miss a
      // break it should land on by rounding, where a net hangs on leaks alone; the walk then stops at once.)
      if (!(moved > SETTLE_VOLTS)) return true;
      volts = next;
    }
    return false;
  };

  /** How far a group's supply is above the volts its duty aims for: a microvolt over its onVolts. */
  const headroom = (group: Group): number => at(volts, group.pos) - at(volts, group.neg) - group.onVolts - DUTY_VOLTS;
  const setDuty = (group: Group, duty: number): void => {
    group.duty = duty;
    for (const output of group.outputs) configure(output, output.drop);
  };
  /** Whether a group's duty stands: fully on above onVolts, off below it, or in between exactly at it. */
  const holds = (group: Group): boolean => {
    if (!group.outputs.some((output) => output.live)) return group.duty === 1;
    const over = headroom(group);
    if (group.duty >= 1) return over >= -DUTY_VOLTS;
    if (group.duty <= 0) return over <= DUTY_VOLTS;
    return over <= DUTY_VOLTS && over >= -DUTY_VOLTS;
  };
  /**
   * The duty that holds a group's supply just above onVolts. The supply only falls as the duty rises, so: fully on if
   * that keeps the supply up, off if even the outputs off leave it below, and otherwise the root in between,
   * by regula falsi with the Illinois step, from a fresh bracket.
   */
  const findDuty = (group: Group): boolean => {
    const at1 = (): number => {
      setDuty(group, 1);
      return settle() ? headroom(group) : 0;
    };
    const full = group.duty === 1 ? headroom(group) : at1();
    if (!group.outputs.some((output) => output.live) || full >= -DUTY_VOLTS) return true;
    setDuty(group, 0);
    if (!settle()) return false;
    const empty = headroom(group);
    if (empty <= DUTY_VOLTS) return true;
    let low = 0;
    let lowOver = empty;
    let high = 1;
    let highOver = full;
    let kept = 0;
    for (let step = 0; step < MAX_DUTY_STEPS; step += 1) {
      const duty = (low * highOver - high * lowOver) / (highOver - lowOver);
      setDuty(group, duty);
      if (!settle()) return false;
      const over = headroom(group);
      if ((over <= DUTY_VOLTS && over >= -DUTY_VOLTS) || high - low <= DUTY_WIDTH) return true;
      if (over > 0) {
        low = duty;
        lowOver = over;
        if (kept > 0) highOver /= 2;
        kept = 1;
      } else {
        high = duty;
        highOver = over;
        if (kept < 0) lowOver /= 2;
        kept = -1;
      }
    }
    return true;
  };

  let settled = settle();
  for (let round = 0; settled && round < MAX_ROUNDS; round += 1) {
    // At that answer, a regulator holds `volts` while its supply allows and follows the supply less
    // dropoutVolts below that; then each motor driver takes the duty its supply allows.
    let changed = false;
    for (const output of layout.outputs) {
      const spec = output.info.spec;
      if (!output.live || spec.kind !== 'regulator') continue;
      const supply = at(volts, at(output.branch.nodes, 0)) - at(volts, at(output.branch.nodes, 1));
      const drop = Math.max(spec.dropoutVolts, supply - spec.volts);
      if (drop - output.drop > SETTLE_VOLTS || output.drop - drop > SETTLE_VOLTS) {
        configure(output, drop);
        changed = true;
      }
    }
    if (changed) {
      settled = settle();
      continue;
    }
    for (const group of layout.groups) {
      if (holds(group)) continue;
      changed = true;
      if (!findDuty(group)) {
        settled = false;
        break;
      }
    }
    if (!changed) break;
    if (round === MAX_ROUNDS - 1) settled = false;
  }

  const answer = volts;
  const portAmps = new Float64Array(model.portCount);
  /** A branch's own current (the part's, without the leak), carried into each of its ports. */
  const flow = (branch: Branch): number => {
    const u = across(branch, answer);
    branch.region = regionOf(branch.breaks, u);
    const amps = at(branch.pg, branch.region) * u + at(branch.pc, branch.region);
    branch.ports.forEach((port, index) => {
      portAmps[port] = at(portAmps, port) + at(branch.weights, index) * amps;
    });
    return amps;
  };
  const sourceAmps = new Float64Array(model.sources.length);
  const useAmps = new Float64Array(model.uses.length);
  const giving = model.sources.map((source, index) => source.kind === 'battery' && at(charge, index) > 0);
  const duty = new Float64Array(model.sources.length).fill(1);
  const browned = model.sources.map(() => false);
  for (const branch of layout.fixed) {
    const amps = flow(branch);
    if (branch.role.kind === 'battery') sourceAmps[branch.role.source] = -amps;
    else if (branch.role.kind === 'use') useAmps[branch.role.use] = amps;
  }
  for (const output of layout.outputs) {
    // A channel with no command, or no power by the wiring, is not browning out: its duty reads 1.
    const share = output.live ? (layout.groups[output.group]?.duty ?? 1) : 1;
    duty[output.source] = share;
    browned[output.source] = share < 1;
    if (!isActive(output)) continue;
    const amps = flow(output.branch);
    const ratio = at(output.branch.weights, 0);
    const supply = at(answer, at(output.branch.nodes, 0)) - at(answer, at(output.branch.nodes, 1));
    // What it can push the way it drives: never less than nothing (a regulator or channel with too little supply).
    const push = Math.max(0, ratio * supply - output.drop);
    const sign = output.flip ? -1 : 1;
    sourceAmps[output.source] = sign * amps;
    sourceEmf[output.source] = push === 0 ? 0 : sign * push;
    giving[output.source] = push > 0;
    const use = output.info.use;
    if (use >= 0) useAmps[use] = at(useAmps, use) + ratio * amps;
  }
  return { volts: answer, sourceAmps, sourceEmf, giving, duty, browned, useAmps, portAmps, solves, settled };
};
