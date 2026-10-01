import { describe, expect, it } from 'vitest';
import { cosSin, validateArenaPreset } from '@servo/schema';
import type { ArenaPreset, Pose, Prop, Ramp, Vec2, Wall, Zone } from '@servo/schema';

// Vite reads each arena file as text, so the test parses the exact bytes that ship.
declare global {
  interface ImportMeta {
    glob(pattern: string, options: { query: '?raw'; import: 'default'; eager: true }): Record<string, string>;
  }
}

// Every preset file in packages/content/arenas/, parsed here as JSON with no content loader in between.
const files = Object.entries(import.meta.glob('../arenas/*.json', { query: '?raw', import: 'default', eager: true })).map(
  ([path, text]) => ({ file: path.slice(path.lastIndexOf('/') + 1), text }),
);

const issuesIn = (text: string): string[] => {
  const result = validateArenaPreset(JSON.parse(text));
  return result.ok ? [] : result.issues.map(({ code, path, message }) => `${code} at ${path}: ${message}`);
};

const parse = (text: string): ArenaPreset => {
  const result = validateArenaPreset(JSON.parse(text));
  if (!result.ok) throw new Error('Not a valid arena preset; the validation test lists why.');
  return result.value;
};

const preset = (id: string): ArenaPreset => {
  const found = files.find(({ file }) => file === `${id}.json`);
  if (!found) throw new Error(`packages/content/arenas/${id}.json is missing.`);
  return parse(found.text);
};

const byId = <T extends { readonly id: string }>(items: readonly T[], id: string): T => {
  const found = items.find((item) => item.id === id);
  if (!found) throw new Error(`No '${id}' in the arena.`);
  return found;
};

const pair = <T>(items: readonly T[]): readonly [T, T] => {
  const [first, second] = items;
  if (items.length !== 2 || first === undefined || second === undefined) throw new Error(`Expected two, found ${items.length}.`);
  return [first, second];
};

/**
 * The reference robot: the schema's rolling-start fixture (a 160 × 130 mm chassis on the large wheels) with
 * a bumper switch on its bumper mount. Millimetres from the chassis centre, which the start pose places.
 */
const ROBOT = {
  front: 80, // the chassis's front edge
  probe: 90, // the bumper switch's probe
  rear: 81, // the back of the caster
  halfWidth: 92, // the outer face of each wheel
  clearance: 16.5, // the chassis's underside above the floor
  overhang: 40, // how far the chassis reaches ahead of the wheel axles
  wheelbase: 110, // from the wheel axles back to the caster
} as const;

/** How far points lie ahead of the start pose, along its heading, and to its left: [least, most]. */
interface Span {
  readonly ahead: readonly [number, number];
  readonly left: readonly [number, number];
}

const spanFrom = (start: Pose, points: readonly Vec2[]): Span => {
  const [cos, sin] = cosSin(start.heading);
  const ahead = points.map(({ x, y }) => (x - start.x) * cos + (y - start.y) * sin);
  const left = points.map(({ x, y }) => (y - start.y) * cos - (x - start.x) * sin);
  return { ahead: [Math.min(...ahead), Math.max(...ahead)], left: [Math.min(...left), Math.max(...left)] };
};

/** The floor point `ahead` millimetres along the start heading and `left` millimetres to its left. */
const fromStart = (start: Pose, ahead: number, left = 0): Vec2 => {
  const [cos, sin] = cosSin(start.heading);
  return { x: start.x + ahead * cos - left * sin, y: start.y + ahead * sin + left * cos };
};

const corners = (from: Vec2, to: Vec2): Vec2[] => [from, { x: to.x, y: from.y }, to, { x: from.x, y: to.y }];

const floorOf = (arena: ArenaPreset): Vec2[] => corners({ x: 0, y: 0 }, arena.size);

const rectangle = (feature: Zone | Ramp): Vec2[] => corners(feature.from, feature.to);

const wallOutline = (wall: Wall): Vec2[] => {
  const half = wall.thicknessMm / 2;
  return corners(
    { x: Math.min(wall.from.x, wall.to.x) - half, y: Math.min(wall.from.y, wall.to.y) - half },
    { x: Math.max(wall.from.x, wall.to.x) + half, y: Math.max(wall.from.y, wall.to.y) + half },
  );
};

const SIGNS = [
  [1, 1],
  [-1, 1],
  [-1, -1],
  [1, -1],
] as const;

const propOutline = (prop: Prop): Vec2[] => {
  if (prop.shape === 'cylinder') {
    const radius = prop.size.x / 2;
    return corners({ x: prop.at.x - radius, y: prop.at.y - radius }, { x: prop.at.x + radius, y: prop.at.y + radius });
  }
  const [cos, sin] = cosSin(prop.at.heading);
  return SIGNS.map(([a, b]) => {
    const dx = (a * prop.size.x) / 2;
    const dy = (b * prop.size.y) / 2;
    return { x: prop.at.x + dx * cos - dy * sin, y: prop.at.y + dx * sin + dy * cos };
  });
};

const overlaps = (a: Span, b: Span): boolean =>
  a.ahead[0] < b.ahead[1] && b.ahead[0] < a.ahead[1] && a.left[0] < b.left[1] && b.left[0] < a.left[1];

const inside = (zone: Zone, point: Vec2): boolean =>
  point.x >= zone.from.x && point.x <= zone.to.x && point.y >= zone.from.y && point.y <= zone.to.y;

describe('arena preset files', () => {
  it('include open floor, wall stop, ramp and bump props', () => {
    expect(files.map(({ file }) => file)).toEqual(
      expect.arrayContaining(['open-floor.json', 'wall-stop.json', 'ramp.json', 'bump-props.json']),
    );
  });

  it.each(files)('$file validates as an arena preset', ({ text }) => {
    expect(issuesIn(text)).toEqual([]);
  });

  it.each(files)('$file is named after its id', ({ file, text }) => {
    expect(file).toBe(`${String((JSON.parse(text) as { id?: unknown }).id)}.json`);
  });
});

describe.each(files)('$file with the reference robot', ({ text }) => {
  it('starts the robot on the floor, clear of walls, props and ramps', () => {
    const arena = parse(text);
    const robot: Span = { ahead: [-ROBOT.rear, ROBOT.probe], left: [-ROBOT.halfWidth, ROBOT.halfWidth] };
    const outline = robot.ahead.flatMap((ahead) => robot.left.map((left) => fromStart(arena.start, ahead, left)));
    expect(outline.filter(({ x, y }) => x < 0 || y < 0 || x > arena.size.x || y > arena.size.y)).toEqual([]);

    const features = [
      ...arena.walls.map((wall) => ({ id: wall.id, outline: wallOutline(wall) })),
      ...arena.props.map((prop) => ({ id: prop.id, outline: propOutline(prop) })),
      ...arena.ramps.map((ramp) => ({ id: ramp.id, outline: rectangle(ramp) })),
    ];
    expect(features.filter(({ outline }) => overlaps(robot, spanFrom(arena.start, outline))).map(({ id }) => id)).toEqual([]);
  });

  // Before Level 3 no program steers the robot: it drives straight, spins or curves. So a goal zone lies on
  // the straight path ahead of the start, and never under the robot as it starts.
  it('puts every zone on the straight path ahead of the robot', () => {
    const arena = parse(text);
    const offPath = arena.zones.filter((zone) => {
      const { ahead, left } = spanFrom(arena.start, rectangle(zone));
      return !(ahead[0] > 0 && left[0] <= 0 && left[1] >= 0);
    });
    expect(offPath.map(({ id }) => id)).toEqual([]);
  });
});

describe('open floor', () => {
  it('has nothing on the floor to drive into', () => {
    const arena = preset('open-floor');
    expect({ walls: arena.walls, props: arena.props, ramps: arena.ramps }).toEqual({ walls: [], props: [], ramps: [] });
  });

  it('leaves at least a metre of floor ahead of the robot', () => {
    const arena = preset('open-floor');
    expect(spanFrom(arena.start, floorOf(arena)).ahead[1] - ROBOT.probe).toBeGreaterThanOrEqual(1000);
  });
});

// Level 1 crosses to the far side. Level 2 crosses and stops at the wall with the bumper switch (D26), which
// challenges test with `near-wall` on 'far-wall'.
describe('wall stop', () => {
  const layout = () => {
    const arena = preset('wall-stop');
    const wall = byId(arena.walls, 'far-wall');
    const ends = spanFrom(arena.start, [wall.from, wall.to]);
    return { arena, ends, face: ends.ahead[0] - wall.thicknessMm / 2 };
  };

  it('stands the far wall square across the robot’s path, from one side of the floor to the other', () => {
    const { arena, ends } = layout();
    const floor = spanFrom(arena.start, floorOf(arena));
    expect(ends.ahead[1] - ends.ahead[0]).toBeCloseTo(0, 9);
    expect(ends.left[0]).toBeLessThanOrEqual(floor.left[0]);
    expect(ends.left[1]).toBeGreaterThanOrEqual(floor.left[1]);
  });

  it('leaves at least a metre of floor between the robot and the wall', () => {
    expect(layout().face - ROBOT.probe).toBeGreaterThanOrEqual(1000);
  });

  it('holds the robot in the far-side zone when its front or its bumper switch meets the wall', () => {
    const { arena, face } = layout();
    const zone = byId(arena.zones, 'far-side');
    expect(inside(zone, fromStart(arena.start, face - ROBOT.front))).toBe(true);
    expect(inside(zone, fromStart(arena.start, face - ROBOT.probe))).toBe(true);
    expect(spanFrom(arena.start, rectangle(zone)).ahead[1]).toBeLessThanOrEqual(face);
  });
});

// The robot climbs a steep slope and comes down a gentler one. By a rough estimate from the example part
// records, the 1-in-3 climb nearly stalls direct drive on the 2-cell battery pack while gearboxes carry the
// robot up (the gearbox lesson). The mechanical solver (task 1.4) decides the real numbers.
describe('ramp', () => {
  const UPHILL: Readonly<Record<Ramp['uphill'], Vec2>> = {
    '+x': { x: 1, y: 0 },
    '-x': { x: -1, y: 0 },
    '+y': { x: 0, y: 1 },
    '-y': { x: 0, y: -1 },
  };
  const grade = (ramp: Ramp): number =>
    ramp.riseMm / (ramp.uphill.endsWith('x') ? ramp.to.x - ramp.from.x : ramp.to.y - ramp.from.y);

  const layout = () => {
    const arena = preset('ramp');
    const [cos, sin] = cosSin(arena.start.heading);
    const slopes = arena.ramps
      .map((ramp) => ({
        ramp,
        span: spanFrom(arena.start, rectangle(ramp)),
        risesAhead: UPHILL[ramp.uphill].x * cos + UPHILL[ramp.uphill].y * sin > 0,
      }))
      .sort((a, b) => a.span.ahead[0] - b.span.ahead[0]);
    return { arena, slopes };
  };

  it('climbs one slope and comes down another, which meet at the top', () => {
    const { slopes } = layout();
    expect(slopes.map(({ risesAhead }) => risesAhead)).toEqual([true, false]);
    const [up, down] = pair(slopes);
    expect(up.span.ahead[1]).toBe(down.span.ahead[0]);
    expect(up.ramp.riseMm).toBe(down.ramp.riseMm);
  });

  it('runs both slopes from one side of the floor to the other, so the robot cannot drop off a side', () => {
    const { arena, slopes } = layout();
    const floor = spanFrom(arena.start, floorOf(arena));
    for (const { span } of slopes) {
      expect(span.left[0]).toBeLessThanOrEqual(floor.left[0]);
      expect(span.left[1]).toBeGreaterThanOrEqual(floor.left[1]);
    }
  });

  it('keeps both slopes within what the reference robot’s chassis clears', () => {
    const [up, down] = pair(layout().slopes.map(({ ramp }) => grade(ramp)));
    // Where a slope starts or ends, the chassis front reaches over the next stretch of floor.
    expect(Math.max(up, down)).toBeLessThanOrEqual(ROBOT.clearance / ROBOT.overhang);
    // Astride the top, the floor rises (wheelbase / 4) × (sum of the grades) above the wheels and caster.
    expect(up + down).toBeLessThanOrEqual((4 * ROBOT.clearance) / ROBOT.wheelbase);
  });

  it('puts the top zone over the top, and the far-side zone on flat floor past the slopes', () => {
    const { arena, slopes } = layout();
    const [up, down] = pair(slopes);
    expect(inside(byId(arena.zones, 'top'), fromStart(arena.start, up.span.ahead[1]))).toBe(true);
    const farSide = spanFrom(arena.start, rectangle(byId(arena.zones, 'far-side')));
    expect(farSide.ahead[0] - ROBOT.rear).toBeGreaterThanOrEqual(down.span.ahead[1]);
  });
});

// Collisions and the bumper switch: the robot pushes the box along until it meets the post, which never moves.
describe('bump props', () => {
  const layout = () => {
    const arena = preset('bump-props');
    const inPath = arena.props
      .map((prop) => ({ prop, span: spanFrom(arena.start, propOutline(prop)) }))
      .filter(({ span }) => span.ahead[1] > 0 && span.left[0] < ROBOT.halfWidth && span.left[1] > -ROBOT.halfWidth)
      .sort((a, b) => a.span.ahead[0] - b.span.ahead[0]);
    return { arena, inPath };
  };

  it('puts a prop the robot can push in its path, then one it cannot move', () => {
    expect(layout().inPath.map(({ prop }) => prop.fixed)).toEqual([false, true]);
  });

  it('holds the robot in the box-front zone when its bumper switch meets the box', () => {
    const { arena, inPath } = layout();
    const [box] = pair(inPath);
    expect(inside(byId(arena.zones, 'box-front'), fromStart(arena.start, box.span.ahead[0] - ROBOT.probe))).toBe(true);
  });

  it('holds the robot in the post-front zone at the post, with the box pushed ahead of it or without', () => {
    const { arena, inPath } = layout();
    const [box, post] = pair(inPath);
    const zone = byId(arena.zones, 'post-front');
    const boxLength = box.span.ahead[1] - box.span.ahead[0];
    expect(inside(zone, fromStart(arena.start, post.span.ahead[0] - boxLength - ROBOT.front))).toBe(true);
    expect(inside(zone, fromStart(arena.start, post.span.ahead[0] - ROBOT.front))).toBe(true);
  });
});
