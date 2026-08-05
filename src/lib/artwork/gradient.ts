/**
 * Brand-derived fallback artwork.
 *
 * When a track has no cover, we build one from the producer's own palette
 * rather than showing a grey music note. The result has to satisfy two things
 * that pull against each other: every cover should look like it came from the
 * same brand, and no two covers should look identical.
 *
 * The resolution is that variation is DETERMINISTIC, seeded by the track id.
 * `Math.random()` would give variety but a different cover on every render —
 * the grid would shimmer as you scrolled, and the same beat would look
 * different on the library and the storefront. Seeding on the id means a beat
 * has one cover, forever, without storing anything.
 *
 * "Luxury" here is a specific set of constraints, not a vibe:
 *   - dark base, so it sits in the app's near-black rather than glowing
 *   - two or three stops, never more; more reads as a heat map
 *   - hue drift capped, so variants stay recognisably the same family
 *   - saturation pulled down as lightness rises, which is what stops a
 *     gradient looking like default CSS
 */

import { adjustLightness, adjustSaturation, isValidHex, mix } from './color';

export interface GradientSpec {
  /** Ready for `background-image`. */
  css: string;
  /** Degrees, for callers that want to render their own. */
  angle: number;
  stops: Array<{ color: string; position: number }>;
  /** The colour to draw a glyph or initial in over this background. */
  foreground: string;
}

/** Used when the producer has set no artwork — the theme accent, dimmed. */
export const FALLBACK_PALETTE = ['#C4B49C', '#6C6255'];

/** The page's own background; every gradient is anchored to it. */
const BASE = '#0B0B0A';

/* ── deterministic randomness ─────────────────────────────────────── */

/** FNV-1a. Stable across runs and platforms, unlike anything hash-like built
 *  from string concatenation or `Date.now()`. */
export function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 — small, fast, good enough for choosing an angle. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ── generator ────────────────────────────────────────────────────── */

/**
 * Build a gradient from a palette and a stable seed.
 *
 * `palette` is the producer's extracted brand colours, dominant first. An
 * empty or unusable palette falls back to the theme accent so this never
 * returns nothing — a fallback that can itself fail is not a fallback.
 */
export function generateGradient(palette: string[], seed: string): GradientSpec {
  const usable = palette.filter(isValidHex);
  const colors = usable.length > 0 ? usable : FALLBACK_PALETTE;

  const rand = seededRandom(hashSeed(seed));

  // Pick the lead colour from the palette rather than always the dominant
  // one — otherwise every cover in a catalogue opens with the same hue.
  const lead = colors[Math.floor(rand() * colors.length)] ?? colors[0];
  // The second colour is a different entry when there is one, so two-colour
  // brands still produce a gradient rather than a flat wash.
  const others = colors.filter((c) => c !== lead);
  const support = others.length > 0
    ? others[Math.floor(rand() * others.length)]
    : adjustLightness(lead, 0.18);

  // Angle in 15° steps: arbitrary angles look accidental, and the steps keep
  // the set feeling art-directed. Biased away from exactly vertical or
  // horizontal, which read as a default.
  const angle = 20 + Math.floor(rand() * 15) * 15 % 140;

  // Depth: how far the lead is lifted out of the base. Small range — this is
  // where "premium restraint" actually lives, and a wide one gives you
  // neon on one card and near-black on the next.
  const depth = 0.10 + rand() * 0.14;

  const anchor = mix(BASE, lead, 0.12);
  const body = adjustSaturation(mix(BASE, lead, 0.30 + depth), 0.85);
  const highlight = adjustSaturation(
    adjustLightness(mix(BASE, support, 0.42 + depth * 0.6), 0.04),
    0.7,
  );

  const stops = [
    { color: anchor, position: 0 },
    { color: body, position: 48 + Math.floor(rand() * 14) },
    { color: highlight, position: 100 },
  ];

  const linear = `linear-gradient(${angle}deg, ${stops.map((s) => `${s.color} ${s.position}%`).join(', ')})`;
  // A soft off-centre radial over the top is what keeps these from looking
  // like a two-stop CSS default. Position is seeded too, so the light lands
  // differently on each cover.
  const glowX = 20 + Math.floor(rand() * 60);
  const glowY = 15 + Math.floor(rand() * 45);
  const glow = `radial-gradient(120% 90% at ${glowX}% ${glowY}%, ${mix(highlight, '#ffffff', 0.10)}22 0%, transparent 60%)`;

  return {
    css: `${glow}, ${linear}`,
    angle,
    stops,
    // Every gradient is anchored to a near-black base, so a light foreground
    // always clears contrast — no need to branch on the palette.
    foreground: mix('#ffffff', lead, 0.25),
  };
}

/**
 * Convenience for callers that only need the CSS value.
 *
 * Separate because it is what JSX call sites actually want, and having them
 * reach into `.css` on a spec they otherwise ignore reads worse everywhere.
 */
export function gradientCss(palette: string[], seed: string): string {
  return generateGradient(palette, seed).css;
}
