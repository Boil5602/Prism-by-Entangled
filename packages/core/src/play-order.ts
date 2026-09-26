/**
 * Play orders (2026-09-17, spec §32 layer 5 - "v2, only if demanded", and it was): the order a collection's
 * tracks play in when the WALL decides it rather than the service. "normal" and "shuffle" are the service's
 * own (its queue, its shuffle switch); "true-shuffle" and "reverse" are Prism's - core reads the track list
 * and hands the player the order. The rule for true shuffle is a uniformly random permutation: every track
 * once before any repeats, no weighting by anything, a fresh draw each pass.
 */

export type PlayOrder = "normal" | "shuffle" | "true-shuffle" | "reverse";

export const PLAY_ORDERS: readonly PlayOrder[] = ["normal", "shuffle", "true-shuffle", "reverse"];

export function isPlayOrder(x: unknown): x is PlayOrder {
  return typeof x === "string" && (PLAY_ORDERS as readonly string[]).includes(x);
}

/** The order's words for a wall: "in order", "shuffle", "true shuffle", "in reverse". */
export function playOrderLabel(order: PlayOrder): string {
  return order === "normal" ? "in order" : order === "shuffle" ? "shuffle" : order === "true-shuffle" ? "true shuffle" : "in reverse";
}

/** A uniform random integer in [0, n) - the browser's cryptographic source when there is one. */
function randomBelow(n: number, rand?: () => number): number {
  if (rand) return Math.floor(rand() * n);
  try {
    const c = (globalThis as { crypto?: Crypto }).crypto;
    if (c?.getRandomValues) {
      const b = new Uint32Array(1);
      // rejection sampling: no modulo bias
      const limit = Math.floor(0x100000000 / n) * n;
      for (let i = 0; i < 64; i++) { c.getRandomValues(b); if (b[0]! < limit) return b[0]! % n; }
    }
  } catch { /* fall through */ }
  return Math.floor(Math.random() * n);
}

/**
 * The ids in the order asked for. "true-shuffle" is Fisher-Yates over a copy (uniform over permutations);
 * "reverse" is the list backwards; "normal" and "shuffle" return the list as given (the service orders those).
 * `rand` is for tests only (a stand-in for the random source).
 */
export function orderTracks(ids: readonly string[], order: PlayOrder, rand?: () => number): string[] {
  const out = ids.slice();
  if (order === "reverse") return out.reverse();
  if (order !== "true-shuffle") return out;
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomBelow(i + 1, rand);
    const t = out[i]!; out[i] = out[j]!; out[j] = t;
  }
  return out;
}
