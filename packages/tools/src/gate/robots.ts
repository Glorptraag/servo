// Gate G3's robots, from content records only (ground rule 1): the Level 1 fixture robots that run with no fault, each
// with the Level 1 kit that holds every part it uses, the kit's tray, the empty build Drew starts from, and the
// finished robot's connections as lines of plain words for the page's "What to build" list. No DOM: the test reads it.
import { checkPortPair, placeParts, robotRoot, socketOf } from '@servo/schema';
import type { Blueprint, Catalogue, Kit, PartFamily, PartTypeId, PlacedPartId, PortRef, PortSpec, Wire } from '@servo/schema';
import type { Content } from '@servo/content';
import type { ContentFixture } from '@servo/content/fixtures';

/**
 * The two robots G3 names, "the two Level 1 kit robots", read conservatively: content has one Level 1 kit (Rolling
 * Start), and these are the two working fixture robots built from it that differ. kit-rolling-start is the kit's own
 * robot, with the switch in its power line; level-1-roller is the same kit's parts with the motors on the battery pack
 * directly. switch-in-the-line wires the same robot as kit-rolling-start, so it is offered as a third, not a second.
 */
export const G3_ROBOTS: readonly string[] = ['kit-rolling-start', 'level-1-roller'];

export interface TrayTile {
  readonly part: PartTypeId;
  /** The part record's real name. */
  readonly name: string;
  readonly family: PartFamily;
  /** How many the kit holds. */
  readonly quantity: number;
  /** The swap registry's picture, when `pnpm art` has made one. */
  readonly picture: string | undefined;
}

export interface GateRobot {
  readonly fixture: ContentFixture;
  readonly kit: Kit;
  /** In the kit's tray order, group by group. */
  readonly tray: readonly TrayTile[];
  /** The part type the finished robot is built on (the schema's robot root): the chassis. */
  readonly root: PartTypeId;
  /** One of G3_ROBOTS. */
  readonly forG3: boolean;
  /** The finished robot's connections in plain words, in the order a builder makes them: mounts, then drives, then wires. */
  readonly steps: readonly string[];
}

const countsOf = (blueprint: Blueprint): Map<PartTypeId, number> => {
  const counts = new Map<PartTypeId, number>();
  for (const placed of blueprint.parts) counts.set(placed.part, (counts.get(placed.part) ?? 0) + 1);
  return counts;
};

/** The kit at the fixture's level that holds every part the fixture uses, as many as it uses. */
const kitFor = (fixture: ContentFixture, kits: readonly Kit[]): Kit | undefined =>
  kits.find(
    (kit) =>
      kit.level === fixture.blueprint.meta.level &&
      [...countsOf(fixture.blueprint)].every(([part, count]) => (kit.parts.find((entry) => entry.part === part)?.quantity ?? 0) >= count),
  );

const portSpec = (catalogue: Catalogue, blueprint: Blueprint, ref: PortRef): PortSpec | undefined => {
  const placed = blueprint.parts.find((part) => part.id === ref.part);
  return placed && catalogue.parts.get(placed.part)?.ports.find((port) => port.id === ref.port);
};

/** The wire's kind as the schema judges the pair, and which end is held (a mounted part, a driven hub). */
const judged = (catalogue: Catalogue, blueprint: Blueprint, wire: Wire): { kind: string; held?: PortRef; holder?: PortRef } => {
  const from = portSpec(catalogue, blueprint, wire.from);
  const to = portSpec(catalogue, blueprint, wire.to);
  if (!from || !to) return { kind: 'unknown' };
  const verdict = checkPortPair(from, to);
  if (!verdict.legal) return { kind: 'unknown' };
  if (verdict.kind === 'mount' || verdict.kind === 'drive') {
    const heldSocket = verdict.kind === 'mount' ? 'mount' : 'drive-in';
    const fromHeld = socketOf(from) === heldSocket;
    return { kind: verdict.kind, held: fromHeld ? wire.from : wire.to, holder: fromHeld ? wire.to : wire.from };
  }
  return { kind: verdict.kind };
};

/**
 * Plain words for the finished robot: each part by its real name, told apart from its twin by the mount point that
 * holds it, or that holds the part driving it (`DC motor at the left motor mount`, `large wheel on the DC motor at
 * the left motor mount`).
 */
const stepsOf = (catalogue: Catalogue, blueprint: Blueprint): string[] => {
  const nameOf = (id: PlacedPartId): string => {
    const placed = blueprint.parts.find((part) => part.id === id);
    return (placed && catalogue.parts.get(placed.part)?.identity.name) ?? id;
  };
  const label = (ref: PortRef): string => portSpec(catalogue, blueprint, ref)?.label ?? ref.port;
  const judgements = blueprint.wires.map((wire) => ({ wire, ...judged(catalogue, blueprint, wire) }));
  const holderOf = new Map<PlacedPartId, { kind: string; holder: PortRef }>();
  for (const { kind, held, holder } of judgements) if (held && holder) holderOf.set(held.part, { kind, holder });
  const twins = countsOf(blueprint);
  const called = (id: PlacedPartId, seen: ReadonlySet<PlacedPartId> = new Set()): string => {
    const name = nameOf(id);
    const placed = blueprint.parts.find((part) => part.id === id);
    if (!placed || (twins.get(placed.part) ?? 0) < 2) return name;
    const holding = holderOf.get(id);
    if (!holding || seen.has(id)) return name;
    if (holding.kind === 'mount') return `${name} at the ${label(holding.holder)}`;
    return `${name} on the ${called(holding.holder.part, new Set([...seen, id]))}`;
  };
  const mounts: string[] = [];
  const drives: string[] = [];
  const wires: string[] = [];
  for (const { wire, kind, held, holder } of judgements) {
    // The mount point or the shaft tells twins apart here, so the part placed on it goes by its plain name.
    if (kind === 'mount' && held && holder) mounts.push(`Place a ${nameOf(held.part)} on the ${nameOf(holder.part)}'s ${label(holder)}.`);
    else if (kind === 'drive' && held && holder) drives.push(`Place a ${nameOf(held.part)} on the ${called(holder.part)}'s ${label(holder)}.`);
    else {
      const line = kind === 'signal' ? 'signal line' : 'power line';
      wires.push(`A ${line} from the ${called(wire.from.part)} ${label(wire.from)} to the ${called(wire.to.part)} ${label(wire.to)}.`);
    }
  }
  return [...mounts.sort(), ...drives.sort(), ...wires.sort()];
};

/** The part type the fixture's robot is built on. */
const rootOf = (catalogue: Catalogue, blueprint: Blueprint): PartTypeId | undefined => {
  const id = robotRoot(placeParts(blueprint, catalogue));
  return blueprint.parts.find((part) => part.id === id)?.part;
};

/** Every Level 1 fixture robot that runs with no fault and has a Level 1 kit, G3's two first. */
export const gateRobots = (content: Content, fixtures: readonly ContentFixture[]): GateRobot[] => {
  const robots: GateRobot[] = [];
  for (const fixture of fixtures) {
    if (fixture.blueprint.meta.level !== 1 || fixture.expect.faults.length > 0) continue;
    const kit = kitFor(fixture, content.kits);
    const root = rootOf(content.catalogue, fixture.blueprint);
    if (!kit || !root) continue;
    const tray = kit.tray.flatMap((group) =>
      group.parts.flatMap((part): TrayTile[] => {
        const record = content.catalogue.parts.get(part);
        if (!record) return [];
        const quantity = kit.parts.find((entry) => entry.part === part)?.quantity ?? 1;
        return [{ part, name: record.identity.name, family: group.family, quantity, picture: content.art.get(record.identity.art)?.src }];
      }),
    );
    robots.push({ fixture, kit, tray, root, forG3: G3_ROBOTS.includes(fixture.name), steps: stepsOf(content.catalogue, fixture.blueprint) });
  }
  const rank = (robot: GateRobot): number => (robot.forG3 ? G3_ROBOTS.indexOf(robot.fixture.name) : G3_ROBOTS.length);
  return robots.sort((a, b) => rank(a) - rank(b) || a.fixture.name.localeCompare(b.fixture.name));
};

/** The build Drew starts from: the fixture's arena, level and name, and no parts. */
export const emptyBuild = (robot: GateRobot): Blueprint => {
  const { blueprint } = robot.fixture;
  return { ...blueprint, parts: [], wires: [], meta: { ...blueprint.meta, highWater: { parts: 0, wires: 0 } } };
};
