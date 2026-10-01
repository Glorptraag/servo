/**
 * Graph helpers over numbered nodes: union-find, and blocks (biconnected components), the same structures
 * the schema's circuit rules use over port keys (packages/schema/src/circuit/wired.ts). Every loop is
 * iterative and every order is fixed, so a long chain of parts cannot overflow the stack and the answers
 * never depend on the engine.
 */

/** An edge between two nodes. */
export type Edge = readonly [number, number];

const at = (list: ArrayLike<number>, index: number): number => list[index] as number;

/** For each of `count` nodes, its group's lowest node, once `joins` are joined. Any join order gives the same groups. */
export const groupsOf = (count: number, joins: Iterable<Edge>): number[] => {
  const parent = Array.from({ length: count }, (_, index) => index);
  const find = (node: number): number => {
    let root = node;
    while (at(parent, root) !== root) {
      parent[root] = at(parent, at(parent, root));
      root = at(parent, root);
    }
    return root;
  };
  for (const [a, b] of joins) {
    const ra = find(a);
    const rb = find(b);
    // The lower root stays a root, so every group is named by its lowest node.
    if (ra < rb) parent[rb] = ra;
    else if (rb < ra) parent[ra] = rb;
  }
  return parent.map((_, node) => find(node));
};

interface Frame {
  readonly node: number;
  readonly via: number;
  next: number;
}

/**
 * The block (biconnected component) of every edge, by index, or −1 for an edge whose two ends are one
 * node. Two edges lie on one simple closed path exactly when they share a block. Nodes are numbered from 0.
 */
export const blocksOf = (edges: readonly Edge[]): number[] => {
  const block = edges.map(() => -1);
  let size = 0;
  for (const [a, b] of edges) size = Math.max(size, a + 1, b + 1);
  const adjacency: number[][] = Array.from({ length: size }, () => []);
  edges.forEach(([a, b], index) => {
    if (a === b) return;
    adjacency[a]?.push(index);
    adjacency[b]?.push(index);
  });
  const order = new Array<number>(size).fill(-1);
  const low = new Array<number>(size).fill(-1);
  const stack: number[] = [];
  let visited = 0;
  let blocks = 0;
  for (let start = 0; start < size; start += 1) {
    if (at(order, start) !== -1 || (adjacency[start]?.length ?? 0) === 0) continue;
    order[start] = visited;
    low[start] = visited;
    visited += 1;
    const frames: Frame[] = [{ node: start, via: -1, next: 0 }];
    while (frames.length > 0) {
      const frame = frames[frames.length - 1] as Frame;
      const list = adjacency[frame.node] ?? [];
      if (frame.next < list.length) {
        const index = at(list, frame.next);
        frame.next += 1;
        if (index === frame.via) continue;
        const [a, b] = edges[index] as Edge;
        const other = a === frame.node ? b : a;
        const seen = at(order, other);
        if (seen === -1) {
          order[other] = visited;
          low[other] = visited;
          visited += 1;
          stack.push(index);
          frames.push({ node: other, via: index, next: 0 });
        } else if (seen < at(order, frame.node)) {
          // A back edge to an ancestor, or a second edge to the parent.
          stack.push(index);
          low[frame.node] = Math.min(at(low, frame.node), seen);
        }
        continue;
      }
      frames.pop();
      const parent = frames[frames.length - 1];
      if (!parent) continue;
      const reach = at(low, frame.node);
      low[parent.node] = Math.min(at(low, parent.node), reach);
      if (reach < at(order, parent.node)) continue;
      // The parent cuts this subtree off: everything stacked since the tree edge into it is one block.
      let index = stack.pop();
      while (index !== undefined) {
        block[index] = blocks;
        if (index === frame.via) break;
        index = stack.pop();
      }
      blocks += 1;
    }
  }
  return block;
};

/** Which of `edges` lie on one simple closed path with an extra edge from `from` to `to` (two different nodes). */
export const cycleMates = (edges: readonly Edge[], from: number, to: number): ((index: number) => boolean) => {
  const block = blocksOf([...edges, [from, to]]);
  const probe = at(block, edges.length);
  return (index) => at(block, index) === probe;
};
