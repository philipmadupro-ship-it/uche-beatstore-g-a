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

/**
 * How the colours are painted.
 *
 * Colour variation alone does not scale. A catalogue of a thousand beats
 * drawing from one brand palette will exhaust perceptibly-different hues long
 * before it exhausts ids — past a few dozen, "another slightly different
 * purple" stops registering as a different cover at all.
 *
 * Composition is the axis that does scale, because it changes the SHAPE of the
 * artwork rather than its tint. Six archetypes multiply the usable space by
 * six at every hue, and two covers that differ in form read as distinct even
 * when their colours are close.
 */
export type Composition = 'linear' | 'spotlight' | 'sweep' | 'dual' | 'ridge' | 'halo';

export const COMPOSITIONS: Composition[] = [
  'linear', 'spotlight', 'sweep', 'dual', 'ridge', 'halo',
];

/**
 * Which shapes each kind may draw.
 *
 * Hue alone was not separating projects from playlists strongly enough in a
 * mixed grid — two things the same colour read as the same thing regardless of
 * what shade they are. Giving each kind its own shapes makes the category
 * legible before the colour is even processed. The sets overlap on `linear` so
 * the three still look like one system rather than three unrelated apps.
 */
const KIND_COMPOSITIONS: Record<ArtworkKind, Composition[]> = {
  track:    ['linear', 'spotlight', 'sweep', 'dual', 'ridge', 'halo'],
  project:  ['linear', 'ridge', 'dual'],
  playlist: ['linear', 'halo', 'spotlight'],
};

export interface GradientSpec {
  /** Which archetype was drawn — exposed for tests and diagnostics. */
  composition: Composition;
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

/** Palette offset and hue shift per kind. Enough to tell a project from a
 *  playlist at a glance, still short of inventing three brands. */
const KIND_TREATMENT: Record<ArtworkKind, { offset: number; hue: number }> = {
  track:    { offset: 0, hue: 0 },
  project:  { offset: 1, hue: 34 },
  playlist: { offset: 2, hue: -30 },
};

/**
 * How far an individual item may drift from the brand hue, in degrees.
 *
 * Picking a different palette entry per item is not enough on its own: a real
 * brand palette is usually a handful of NEARBY hues — the working one here is
 * five oranges and mauves — so two covers built from different entries still
 * looked like the same cover. This rotation is what actually separates them.
 *
 * Capped, and symmetric about the brand hue, so the set drifts around the
 * brand rather than away from it. Push it much past this and a catalogue
 * stops looking like one label.
 */
const ITEM_HUE_SPREAD = 26;

/** Drift allowed when a tag colour is the anchor. Tight enough that the tag
 *  stays recognisable, loose enough that two beats are not the same picture. */
const TAG_HUE_SPREAD = 11;

/** Used when the producer has set no artwork — the theme accent, dimmed. */
export const FALLBACK_PALETTE = ['#C4B49C', '#6C6255'];

/** The page's own background; every gradient is anchored to it. */
const BASE = '#0B0B0A';

/**
 * Film grain, as an inline SVG turbulence tile.
 *
 * The cover-art studio's most-used direction is "a grainy 35mm film
 * photograph, dust and light leaks" — that texture is most of why its output
 * reads as artwork rather than as a shape. A flat CSS gradient cannot get
 * there no matter how the colours are tuned; it is missing the grain, not the
 * hue. This is the cheapest honest approximation: no request, no bytes over
 * the wire, and it composites over any of the archetypes.
 *
 * `baseFrequency` is seeded per item so the grain itself differs, and the tile
 * is deliberately small — a large one is a large data URI repeated on every
 * card in a catalogue.
 */
function grainLayer(frequency: number, opacity: number): string {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='90' height='90'>` +
    `<filter id='n'>` +
    `<feTurbulence type='fractalNoise' baseFrequency='${frequency.toFixed(3)}' numOctaves='3' stitchTiles='stitch'/>` +
    `<feColorMatrix type='saturate' values='0'/>` +
    `</filter>` +
    `<rect width='100%' height='100%' filter='url(%23n)' opacity='${opacity.toFixed(3)}'/>` +
    `</svg>`;
  return `url("data:image/svg+xml,${svg.replace(/</g, '%3C').replace(/>/g, '%3E').replace(/#/g, '%23')}")`;
}

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
export interface GradientOptions {
  kind?: ArtworkKind;
  /**
   * The palette came from a tag rather than the brand, so hold the hue close.
   *
   * The point of tag colour is that every Trap beat looks like Trap. The full
   * ±26° drift used for brand palettes is wide enough to walk a tag out of its
   * own hue, which defeats it — two beats would be distinguishable but neither
   * would be identifiable.
   */
  tagAnchored?: boolean;
}

export function generateGradient(
  palette: string[],
  seed: string,
  kindOrOptions: ArtworkKind | GradientOptions = 'track',
): GradientSpec {
  const options: GradientOptions = typeof kindOrOptions === 'string'
    ? { kind: kindOrOptions }
    : kindOrOptions;
  const kind = options.kind ?? 'track';
  const hueSpread = options.tagAnchored ? TAG_HUE_SPREAD : ITEM_HUE_SPREAD;
  const usable = palette.filter(isValidHex);
  const base = usable.length > 0 ? usable : FALLBACK_PALETTE;

  const treatment = KIND_TREATMENT[kind] ?? KIND_TREATMENT.track;
  // Rotating the palette rather than indexing from a fixed start means a
  // project and a track with adjacent ids do not land on the same lead hue.
  const colors = base
    .map((_, i) => base[(i + treatment.offset) % base.length])
    .map((c) => (treatment.hue === 0 ? c : rotateHue(c, treatment.hue)));

  const rand = seededRandom(hashSeed(seed));

  /* Choosing the lead.
     
     For a brand palette, pick at random: otherwise every cover in a catalogue
     opens on the same hue.
     
     For a TAG palette the first entry is the tag's own colour, and it must
     lead. Picking randomly there meant a Trap cover and a Drill cover could
     both land on the shared brand support colour and come out identical — the
     tag colour was present but not deciding anything, which defeats the point
     of having one. */
  const pickedLead = options.tagAnchored
    ? colors[0]
    : (colors[Math.floor(rand() * colors.length)] ?? colors[0]);
  // The second colour is a different entry when there is one, so two-colour
  // brands still produce a gradient rather than a flat wash.
  const others = colors.filter((c) => c !== pickedLead);
  const pickedSupport = others.length > 0
    ? (options.tagAnchored ? others[0] : others[Math.floor(rand() * others.length)])
    : adjustLightness(pickedLead, 0.18);

  // Per-item drift. Lead and support rotate together so the pair stays
  // harmonic — rotating them independently produces clashes rather than
  // variety. Saturation moves too, so two items with a similar hue still
  // differ in how vivid they read.
  const itemHue = (rand() * 2 - 1) * hueSpread;
  const itemSat = 0.8 + rand() * 0.55;
  const lead = adjustSaturation(rotateHue(pickedLead, itemHue), itemSat);
  const support = adjustSaturation(rotateHue(pickedSupport, itemHue * 0.6), itemSat);

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

  const allowed = KIND_COMPOSITIONS[kind] ?? COMPOSITIONS;
  const composition = allowed[Math.floor(rand() * allowed.length)];

  const stopList = stops.map((st) => `${st.color} ${st.position}%`).join(', ');
  const glowX = 20 + Math.floor(rand() * 60);
  const glowY = 15 + Math.floor(rand() * 45);
  // Strength, spread and falloff all vary per beat, not just position. With a
  // fixed alpha every cover carried the same sheen in a different place, which
  // still read as one template — the difference registered as "moved" rather
  // than "different".
  const glowAlpha = 0.07 + rand() * 0.13;
  const glowW = 95 + Math.floor(rand() * 55);
  const glowH = 70 + Math.floor(rand() * 45);
  const glowFalloff = 48 + Math.floor(rand() * 22);
  const lit = mix(highlight, '#ffffff', 0.10);
  const glow = `radial-gradient(${glowW}% ${glowH}% at ${glowX}% ${glowY}%, ${rgba(lit, glowAlpha)} 0%, transparent ${glowFalloff}%)`;

  // Every archetype ends on the same linear base, so all six stay anchored in
  // the app's near-black and share a family however differently they're drawn.
  const baseLayer = `linear-gradient(${angle}deg, ${stopList})`;
  let css: string;

  switch (composition) {
    case 'spotlight': {
      // A single light source from off-centre; the palette recedes to the edge.
      const r = 70 + Math.floor(rand() * 55);
      css = `radial-gradient(${r}% ${r}% at ${glowX}% ${glowY}%, ${body} 0%, ${anchor} 70%), ${baseLayer}`;
      break;
    }
    case 'sweep': {
      // Conic: reads as a rotation rather than a direction, which is the most
      // distinct shape in the set at a glance.
      const from = Math.floor(rand() * 360);
      css = `conic-gradient(from ${from}deg at ${glowX}% ${glowY}%, ${anchor}, ${body}, ${highlight}, ${anchor}), ${baseLayer}`;
      break;
    }
    case 'dual': {
      // Two light sources, deliberately unequal so it doesn't read as symmetry.
      const x2 = 100 - glowX;
      const y2 = 100 - glowY;
      css = [
        `radial-gradient(80% 80% at ${glowX}% ${glowY}%, ${rgba(lit, glowAlpha * 1.6)} 0%, transparent 55%)`,
        `radial-gradient(60% 60% at ${x2}% ${y2}%, ${rgba(body, 0.55)} 0%, transparent 60%)`,
        baseLayer,
      ].join(', ');
      break;
    }
    case 'ridge': {
      // A hard band through the middle — the only archetype with an edge in it.
      const edge = stops[1].position;
      css = `linear-gradient(${angle}deg, ${anchor} 0%, ${body} ${edge - 6}%, ${highlight} ${edge}%, ${body} ${edge + 8}%, ${anchor} 100%)`;
      break;
    }
    case 'halo': {
      // Light around a dark core, rather than on it.
      const inner = 25 + Math.floor(rand() * 20);
      css = `radial-gradient(90% 90% at ${glowX}% ${glowY}%, ${anchor} ${inner}%, ${body} ${inner + 30}%, ${highlight} 100%), ${baseLayer}`;
      break;
    }
    default:
      css = `${glow}, ${baseLayer}`;
  }

  // Grain and a light leak, over whatever archetype was drawn. The leak is a
  // soft off-edge wash rather than another centred glow — a leak comes from
  // the side of the frame, which is what makes it read as film rather than as
  // a vignette.
  const grain = grainLayer(0.55 + rand() * 0.35, 0.16 + rand() * 0.12);
  const leakEdge = Math.floor(rand() * 4);
  const leakPos = ['0% 50%', '100% 50%', '50% 0%', '50% 100%'][leakEdge];
  const leakSize = 60 + Math.floor(rand() * 50);
  const leak = `radial-gradient(${leakSize}% ${leakSize + 20}% at ${leakPos}, ${rgba(lit, 0.10 + rand() * 0.10)} 0%, transparent 65%)`;

  return {
    css: `${grain}, ${leak}, ${css}`,
    composition,
    angle,
    glow: { x: glowX, y: glowY, alpha: glowAlpha },
    stops,
    foreground: mix('#ffffff', lead, 0.25),
  };
}

/**
 * Convenience for callers that only need the CSS value.
 *
 * Separate because it is what JSX call sites actually want, and having them
 * reach into `.css` on a spec they otherwise ignore reads worse everywhere.
 */
export function gradientCss(
  palette: string[],
  seed: string,
  kindOrOptions: ArtworkKind | GradientOptions = 'track',
): string {
  return generateGradient(palette, seed, kindOrOptions).css;
}
