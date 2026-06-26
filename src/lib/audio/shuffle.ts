/**
 * Seeded shuffle-bag for the player queue.
 *
 * The old shuffle picked a uniformly-random track on every `next()`, excluding
 * only the *currently playing* one. That means a track you just heard can come
 * straight back while others haven't played at all — the "not very random,
 * keeps repeating" complaint. A real shuffle is a *bag*: every track plays
 * exactly once before any repeats, in a randomised order.
 *
 * It's also seeded (a deterministic PRNG) so the order is reproducible — the
 * same queue + seed always yields the same shuffle, which makes it testable
 * and lets the order survive a reload instead of re-randomising mid-listen.
 */

/** mulberry32 — tiny, fast, well-distributed 32-bit seeded PRNG. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A fresh seed for a new shuffle cycle. */
export function newShuffleSeed(): number {
  return (Math.floor(Math.random() * 0xffffffff) >>> 0) || 1;
}

/**
 * Deterministic Fisher-Yates shuffle of `items` using `seed`. Pure: never
 * mutates the input, always returns a new array.
 */
export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const out = items.slice();
  const rand = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Build the play order for a shuffle cycle: a seeded shuffle of `ids` with
 * `currentId` (if present) pulled to the front so the track that's already
 * playing stays put and the rest follow in shuffled, no-repeat order.
 */
export function buildShuffleOrder(
  ids: readonly string[],
  seed: number,
  currentId: string | null,
): string[] {
  const order = seededShuffle(ids, seed);
  if (!currentId) return order;
  const idx = order.indexOf(currentId);
  if (idx <= 0) return order; // not present, or already first
  order.splice(idx, 1);
  order.unshift(currentId);
  return order;
}

/**
 * Given the shuffle order and the current track, return the next id in the
 * bag. Returns null when the bag is exhausted (caller decides whether to
 * reshuffle for repeat-all or stop).
 */
export function nextInShuffle(order: readonly string[], currentId: string | null): string | null {
  if (order.length === 0) return null;
  const idx = currentId ? order.indexOf(currentId) : -1;
  const next = order[idx + 1];
  return next ?? null;
}
