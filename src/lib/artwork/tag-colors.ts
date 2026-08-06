/**
 * Tag colours — the colour identity of a genre, mood or status.
 *
 * Two beats tagged Trap should look related. That is the whole point: a
 * catalogue browsed by eye is easier to read when the artwork encodes
 * something real about the music, rather than being keyed only to a row id.
 *
 * So a tag's colour, when it has one, anchors the gradient. Per-item variation
 * still applies, but around a much narrower spread — enough that two Trap
 * beats are distinguishable, not so much that either stops reading as Trap.
 *
 * Everything here is pure. The stored per-user overrides come in as a plain
 * map; the defaults are computed, so an untouched install still shows sensible
 * colour coding rather than waiting for someone to assign twenty tags by hand.
 */

import { hexToRgb, hslToRgb, rgbToHex, rgbToHsl } from './color';
import { hashSeed } from './gradient';

export type TagColorMap = Record<string, string>;

/**
 * Hand-set hues for the taxonomy we ship.
 *
 * Assigned rather than hashed because these carry meaning a hash cannot know:
 * Dark should not come out yellow, Aggressive should not come out mint. Tags
 * outside this list fall back to a hash, which at least keeps them stable and
 * distinct from each other.
 */
const CURATED_HUES: Record<string, number> = {
  // Genre — spread across the wheel so a mixed catalogue separates cleanly.
  'trap': 280, 'drill': 220, 'afrobeats': 32, 'amapiano': 45,
  'r&b': 330, 'hip-hop': 258, 'uk drill': 205, 'jersey club': 300,
  'dancehall': 140, 'lo-fi': 25, 'pluggnb': 315, 'pop': 190,
  // Mood — read as temperature more than as identity.
  'dark': 250, 'melodic': 200, 'aggressive': 6, 'chill': 175,
  'emotional': 285, 'hype': 20, 'romantic': 340, 'cinematic': 230, 'eerie': 265,
};

/** Saturation and lightness for a generated tag colour. Chosen so every tag
 *  colour is usable as a chip background AND as a gradient anchor. */
const TAG_S = 0.58;
const TAG_L = 0.55;

export function normaliseTagKey(tag: string): string {
  return tag.trim().toLowerCase();
}

/**
 * The colour for a tag: the producer's override if set, otherwise a curated
 * hue, otherwise a stable hash of the name.
 *
 * Never returns null. A tag without a colour would have to be special-cased at
 * every call site, and "no colour" is not a state anyone benefits from seeing.
 */
export function colorForTag(tag: string, overrides: TagColorMap = {}): string {
  const key = normaliseTagKey(tag);
  const override = overrides[key];
  if (override && hexToRgb(override)) return override.toLowerCase();

  const curated = CURATED_HUES[key];
  const hue = curated ?? (hashSeed(key) % 360);
  return rgbToHex(hslToRgb({ h: hue, s: TAG_S, l: TAG_L }));
}

/**
 * Build the palette a gradient should use for a track.
 *
 * When the track carries a tag with a colour, that colour leads and the
 * producer's brand palette supports it — the artwork then says "Trap" first
 * and "this producer" second, which is the right order for a catalogue you
 * scan by genre.
 *
 * With no tags it falls through to the brand palette unchanged, so nothing
 * regresses for an untagged library.
 */
export function paletteForTags(
  tags: readonly string[],
  brandPalette: readonly string[],
  overrides: TagColorMap = {},
): string[] {
  if (tags.length === 0) return [...brandPalette];

  const lead = colorForTag(tags[0], overrides);
  // A second tag contributes a supporting colour; beyond two the gradient
  // stops being readable as any of them.
  const second = tags[1] ? colorForTag(tags[1], overrides) : null;

  const support = second && second !== lead
    ? second
    : brandPalette[0] ?? shiftHue(lead, 40);

  return [lead, support];
}

function shiftHue(hex: string, degrees: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const hsl = rgbToHsl(rgb);
  return rgbToHex(hslToRgb({ ...hsl, h: hsl.h + degrees }));
}

/**
 * Validate a stored colour map.
 *
 * Same reasoning as the palette: this arrives from the database, was written
 * by some earlier build, and goes straight into a CSS value.
 */
export function normaliseTagColors(raw: unknown): TagColorMap {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: TagColorMap = {};
  for (const [tag, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'string') continue;
    const hex = value.trim().startsWith('#') ? value.trim() : `#${value.trim()}`;
    if (!hexToRgb(hex)) continue;
    out[normaliseTagKey(tag)] = hex.toLowerCase();
  }
  return out;
}
