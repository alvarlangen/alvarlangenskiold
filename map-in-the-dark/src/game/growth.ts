import { LIT_FRACTION_BY_STEP } from './config';
import { rngFrom } from './rng';

/**
 * Order in which a country's pieces light up: a contiguous region grown from a seeded start piece.
 * At each step the frontier piece closest to the start (plus a little seeded noise) is added, so
 * the silhouette grows as a blob rather than appearing as scattered dots.
 *
 * @param neighbors adjacency list (piece index → neighbouring piece indices)
 * @param centroids [x, y] per piece (any planar-ish coordinates, e.g. lon/lat)
 */
export function growthOrder(neighbors: number[][], centroids: [number, number][], seed: string): number[] {
  const n = neighbors.length;
  if (n === 0) return [];
  const rng = rngFrom(seed);
  const start = Math.floor(rng() * n);
  const noise = centroids.map(() => rng());
  const [sx, sy] = centroids[start];
  const span = Math.max(1e-9, ...centroids.map(([x, y]) => Math.hypot(x - sx, y - sy)));
  const cost = centroids.map(([x, y], i) => Math.hypot(x - sx, y - sy) / span + noise[i] * 0.35);
  const inOrder = new Uint8Array(n);
  const frontier = new Set<number>([start]);
  const order: number[] = [];
  while (order.length < n) {
    let best = -1;
    for (const i of frontier) if (best < 0 || cost[i] < cost[best]) best = i;
    if (best < 0) {
      // Disconnected remainder (should not happen with Delaunay adjacency): continue from the cheapest piece.
      for (let i = 0; i < n; i++) if (!inOrder[i] && (best < 0 || cost[i] < cost[best])) best = i;
    }
    frontier.delete(best);
    inOrder[best] = 1;
    order.push(best);
    for (const j of neighbors[best]) if (!inOrder[j]) frontier.add(j);
  }
  return order;
}

/**
 * Number of pieces (from the front of `order`) lit in `step`: the smallest prefix whose area
 * reaches the target fraction for that step. Always at least one piece, all pieces in step 6.
 */
export function litCountForStep(order: number[], areas: number[], step: number): number {
  const target = LIT_FRACTION_BY_STEP[Math.min(LIT_FRACTION_BY_STEP.length, Math.max(1, step)) - 1];
  if (target >= 1) return order.length;
  const total = areas.reduce((a, b) => a + b, 0) || 1;
  let acc = 0;
  for (let k = 0; k < order.length; k++) {
    acc += areas[order[k]] / total;
    if (acc >= target - 1e-9) return k + 1;
  }
  return order.length;
}
