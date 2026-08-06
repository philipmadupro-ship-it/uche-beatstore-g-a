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

import { adjustLightness, adjustSaturation, hexToRgb, isValidHex, mix, rotateHue } from './color';

/** `#rrggbb` + alpha → `rgba(...)`. A two-digit hex suffix can only express
 *  256 steps and reads as noise in the output; this keeps the CSS legible. */
function rgba(hex: string, alpha: number): string {
  const c = hexToRgb(hex);
  if (!c) return hex;
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${a.toFixed(3)})`;
}

export interface GradientSpec {
  /** Ready for `background-image`. */
  css: string;
  /** Degrees, for callers that want to render their own. */
  angle: number;
  /** The seeded highlight: position in percent, strength 0..1. */
  glow: { x: number; y: number; alpha: number };
  stops: Array<{ color: string; position: number }>;
  /** The colour to draw a glyph or initial in over this background. */
  foreground: string;
}

/**
 * What the artwork belongs to.
 *
 * A project, a playlist and a single track should not read as the same thing
 * in a mixed grid. Each kind takes a different slice of the palette and a
 * small hue offset, so the three stay in one brand family while remaining
 * distinguishable at a glance — the same logic as the per-item seed, applied
 * one level up.
 */
export type ArtworkKind = 'track' | 'project' | 'playlist';

/** Palette offset and hue shift per kind. The shifts are small on purpose:
 *  this should separate categories, not invent three brands. */
const KIND_TREATMENT: Record<ArtworkKind, { offset: number; hue: number }> = {
  track:    { offset: 0, hue: 0 },
  project:  { offset: 1, hue: 18 },
  playlist: { offset: 2, hue: -16 },
};

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
export function generateGradient(
  palette: string[],
  seed: string,
  kind: ArtworkKind = 'track',
): GradientSpec {
  const usable = palette.filter(isValidHex);
  const base = usable.length > 0 ? usable : FALLBACK_PALETTE;

  const treatment = KIND_TREATMENT[kind] ?? KIND_TREATMENT.track;
  // Rotating the palette rather than indexing from a fixed start means a
  // project and a track with adjacent ids do not land on the same lead hue.
  const colors = base
    .map((_, i) => base[(i + treatment.offset) % base.length])
    .map((c) => (treatment.hue === 0 ? c : rotateHue(c, treatment.hue)));

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
  // Strength, spread and falloff all vary per beat, not just position. With a
  // fixed alpha every cover carried the same sheen in a different place, which
  // still read as one template — the difference registered as "moved" rather
  // than "different". Varying the light itself is what makes two covers from
  // the same palette feel like separate pieces of art.
  const glowAlpha = 0.07 + rand() * 0.13;
  const glowW = 95 + Math.floor(rand() * 55);
  const glowH = 70 + Math.floor(rand() * 45);
  const glowFalloff = 48 + Math.floor(rand() * 22);
  const glow = `radial-gradient(${glowW}% ${glowH}% at ${glowX}% ${glowY}%, ${rgba(mix(highlight, '#ffffff', 0.10), glowAlpha)} 0%, transparent ${glowFalloff}%)`;

  return {
    css: `${glow}, ${linear}`,
    angle,
    glow: { x: glowX, y: glowY, alpha: glowAlpha },
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
export function gradientCss(palette: string[], seed: string, kind: ArtworkKind = 'track'): string {
  return generateGradient(palette, seed, kind).css;
}
