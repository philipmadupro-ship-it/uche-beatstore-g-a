/**
 * Seeded generative gradients for project/playlist cards.
 *
 * When a project or playlist has no cover image, this gives it a unique,
 * visually rich gradient that is stable across renders (same id → same gradient).
 * Uses Mulberry32 PRNG (same as the waveform synthetic bars) so it is
 * deterministic with no external dependency.
 */

function mulberry32(seed: number) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function seedFromString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return h;
}

// Curated palette — warm, premium, on-brand. Each entry: [from-color, to-color].
const GRADIENT_PAIRS = [
  ['#2A1F14', '#090907'],   // warm amber smoke
  ['#1a1233', '#090907'],   // deep violet night
  ['#0d2318', '#090907'],   // forest emerald
  ['#2A1810', '#0c0907'],   // copper ember
  ['#1a0d2e', '#090907'],   // indigo dusk
  ['#22150a', '#090907'],   // aged leather
  ['#102018', '#090907'],   // muted sage
  ['#2a1428', '#090907'],   // plum haze
  ['#1f1a08', '#090907'],   // pale gold dust
  ['#0d1a2e', '#090907'],   // ocean midnight
] as const;

const DIRECTIONS = ['to-br', 'to-b', 'to-bl', 'to-r'] as const;

export interface CoverGradientStyle {
  background: string;
}

/**
 * Returns an inline style object with a deterministic gradient background.
 * Pass the project/playlist id as the seed.
 */
export function seededGradient(id: string): CoverGradientStyle {
  const rand = mulberry32(seedFromString(id));
  const pairIdx = Math.floor(rand() * GRADIENT_PAIRS.length);
  const dirIdx = Math.floor(rand() * DIRECTIONS.length);
  const [from, to] = GRADIENT_PAIRS[pairIdx];
  const dir = DIRECTIONS[dirIdx];
  // Map direction to CSS angle
  const angle: Record<string, string> = {
    'to-br': '135deg', 'to-b': '180deg', 'to-bl': '225deg', 'to-r': '90deg',
  };
  return { background: `linear-gradient(${angle[dir]}, ${from}, ${to})` };
}
