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
/** Bounds no circuit has come near (docs/electrical.md: 8 solves at most in 27,000 random ones). At them the last step stands, marked unsettled. */
const MAX_SOLVES = 256;
const MAX_ROUNDS = 64;

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
  readonly weights: readonly number[];
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
  readonly n: number;
  readonly flip: boolean;
  readonly maxAmps: number;
  readonly branch: Branch;
  /** Whether it gives anything. A driver channel that browns out stays off for the rest of the tick. */
  active: boolean;
  drop: number;
}

/** A situation's branches, made once and given new numbers every tick. */
interface Layout {
  readonly fixed: readonly Branch[];
  readonly batteries: readonly (Branch | undefined)[];
  readonly uses: readonly Branch[];
  readonly outputs: readonly Output[];
}

/** The operating point of one tick at one situation. Volts are per node (a net's volts are its node's). */
export interface Solved {
  readonly volts: Float64Array;
  /** Out of each source's + port, amps. */
  readonly sourceAmps: Float64Array;
  /** Each source's open-circuit volts, + over −. */
  readonly sourceEmf: Float64Array;
  readonly giving: readonly boolean[];
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
      weights,
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
    outputs.push({ source: index, info, n, flip, maxAmps, branch: make({ kind: 'output', output: outputs.length }, ports, [n, -n, -1, 1]), active: false, drop: 0 });
  });
  const layout = { fixed, batteries, uses, outputs };
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
 * A driver channel's or regulator's output: an ideal transformer of ratio `n` from its supply, less `drop`,
 * behind OUTPUT_OHMS, passing current one way only, up to its limit. Across u = n·(supply volts) − (output
 * volts the way it drives), the current out is 0 below `drop`, (u − drop)/OUTPUT_OHMS above, and the limit
 * past it; the supply carries n times that. It adds one symmetric outer product to the matrix.
 */
const setOutput = (output: Output, drop: number): void => {
  const { breaks, g, c, pg, pc } = output.branch;
  output.drop = drop;
  breaks[0] = drop;
  breaks[1] = drop + output.maxAmps * OUTPUT_OHMS;
  g[0] = 0;
  g[1] = 1 / OUTPUT_OHMS;
  g[2] = 0;
  c[0] = 0;
  c[1] = -drop / OUTPUT_OHMS;
  c[2] = output.maxAmps;
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
  for (const output of layout.outputs) {
    const spec = output.info.spec;
    setOutput(output, spec.kind === 'driver' ? spec.dropVolts : spec.kind === 'regulator' ? spec.dropoutVolts : 0);
    output.branch.region = 1;
    output.active = situation.live.sources[output.source] === true && output.n > 0;
  }

  const count = situation.wiring.nets.length;
  const unknowns = situation.unknowns;
  const size = unknowns * unknowns + unknowns;
  if (!situation.scratch || situation.scratch.length < size) situation.scratch = new Float64Array(size);
  const scratch = situation.scratch;
  const branches: Branch[] = [];
  const gather = (): Branch[] => {
    branches.length = 0;
    for (const branch of layout.fixed) branches.push(branch);
    for (const output of layout.outputs) if (output.active) branches.push(output.branch);
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

  let volts: Float64Array | undefined;
  let solves = 0;
  let settled = false;
  for (let round = 0; round < MAX_ROUNDS && solves < MAX_SOLVES; round += 1) {
    // Damped Newton for the outputs as they stand.
    let steady = false;
    while (solves < MAX_SOLVES) {
      const list = gather();
      const here = volts;
      if (here) for (const branch of list) branch.region = regionOf(branch.breaks, across(branch, here));
      const newton = linearSolve(list);
      solves += 1;
      let fitting = true;
      for (const branch of list) {
        if (fits(branch, across(branch, newton))) continue;
        fitting = false;
        break;
      }
      if (fitting) {
        volts = newton;
        steady = true;
        break;
      }
      if (!here) {
        volts = newton;
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
      if (!(moved > SETTLE_VOLTS)) {
        // Nothing left to fall: `here` is the answer, on the segments it lies on. (A Newton answer can miss a
        // break it should land on by rounding, where a net hangs on leaks alone; the walk then stops at once.)
        steady = true;
        break;
      }
      volts = next;
    }
    if (!steady || !volts) break;
    // Then the outputs at that answer: a driver channel browns out below its onVolts, and a regulator holds
    // `volts` while its supply allows and follows the supply less dropoutVolts below that.
    let changed = false;
    for (const output of layout.outputs) {
      if (!output.active) continue;
      const supply = at(volts, at(output.branch.nodes, 0)) - at(volts, at(output.branch.nodes, 1));
      const spec = output.info.spec;
      if (spec.kind === 'driver' && supply < spec.onVolts - SETTLE_VOLTS) {
        output.active = false;
        changed = true;
      } else if (spec.kind === 'regulator') {
        const drop = Math.max(spec.dropoutVolts, supply - spec.volts);
        if (drop - output.drop > SETTLE_VOLTS || output.drop - drop > SETTLE_VOLTS) {
          setOutput(output, drop);
          changed = true;
        }
      }
    }
    if (!changed) {
      settled = true;
      break;
    }
  }

  const answer = volts ?? new Float64Array(count);
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
  for (const branch of layout.fixed) {
    const amps = flow(branch);
    if (branch.role.kind === 'battery') sourceAmps[branch.role.source] = -amps;
    else if (branch.role.kind === 'use') useAmps[branch.role.use] = amps;
  }
  for (const output of layout.outputs) {
    if (!output.active) continue;
    const amps = flow(output.branch);
    const supply = at(answer, at(output.branch.nodes, 0)) - at(answer, at(output.branch.nodes, 1));
    const sign = output.flip ? -1 : 1;
    sourceAmps[output.source] = sign * amps;
    sourceEmf[output.source] = sign * (output.n * supply - output.drop);
    giving[output.source] = true;
    const use = output.info.use;
    if (use >= 0) useAmps[use] = at(useAmps, use) + output.n * amps;
  }
  return { volts: answer, sourceAmps, sourceEmf, giving, useAmps, portAmps, solves, settled };
};
