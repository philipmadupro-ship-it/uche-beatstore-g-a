/**
 * "Make this feel more brutalist."
 *
 * The studio already has art DIRECTIONS, but they call `createArtworkDocument`
 * and replace the whole layer stack with a template — they are a starting
 * point, not a restyle. Asking for a mood after you have composed something
 * means changing how the existing work FEELS while leaving the work itself
 * alone: same images, same words, same positions, different register.
 *
 * WHY THIS IS NOT A MODEL CALL. Every example in the brief — brutalist,
 * luxury, underground — is a coherent set of parameter choices: a typeface, a
 * weight, tracking, contrast, grain, a palette. Those are better expressed as
 * curated values than inferred by a language model round-trip, and the
 * difference matters in practice: this is instant, free, works offline, is
 * identical every time, is one undo step, and needs no API key. An LLM asked
 * to emit layer JSON would be slower, cost money per press, and occasionally
 * return something that does not parse. The genuinely generative part of the
 * studio — making an image that did not exist — is a model call, and already
 * lives in the AI panel.
 *
 * Pure and tested, per the repo's pure-logic rule.
 */

import type {
  ArtworkDocument, ArtworkLayer, ArtworkPalette,
} from '@/components/cover-art/cover-art-document';
import type { ArtworkLayerFx } from './effects';
import type { CoverFontId } from './fonts';

export type MoodId = 'brutalist' | 'luxury' | 'underground' | 'editorial' | 'soft';

export type Mood = {
  id: MoodId;
  name: string;
  hint: string;
  type: {
    font: CoverFontId;
    weight: number;
    uppercase: boolean;
    /** Multiplies existing tracking, so deliberate spacing is not flattened. */
    trackingScale: number;
  };
  /** Merged onto every unlocked layer. The mood wins on the keys it names. */
  fx: ArtworkLayerFx;
  /** Merged onto image layers on top of `fx` — photographs take treatment differently. */
  imageFx?: ArtworkLayerFx;
  palette: Partial<ArtworkPalette>;
  /** Set only when the mood genuinely implies a different ground. */
  background?: string;
};

/**
 * Five positions, deliberately far apart.
 *
 * A long list of near-identical moods is the failure mode here — if two
 * choices produce artwork a producer cannot tell apart, neither was worth
 * offering. Each of these changes typeface, weight, case, contrast and palette
 * together, because that is what actually reads as a different genre.
 */
export const moods: Mood[] = [
  {
    id: 'brutalist',
    name: 'Brutalist',
    hint: 'Wide caps, hard contrast, no softness',
    type: { font: 'akira', weight: 400, uppercase: true, trackingScale: 0.6 },
    fx: { contrast: 1.45, saturation: 0.15, grain: 0.2, vignette: 0 },
    imageFx: { contrast: 1.6, saturation: 0, posterize: 5 },
    palette: { text: '#F2F2F0', accent: '#F2F2F0', secondary: '#6E6E6B', muted: '#6E6E6B' },
    background: '#090907',
  },
  {
    id: 'luxury',
    name: 'Luxury',
    hint: 'Light type, wide tracking, warm and quiet',
    type: { font: 'synkopy', weight: 400, uppercase: true, trackingScale: 2.2 },
    fx: { contrast: 0.94, saturation: 0.7, exposure: 0.06, vignette: 0.3 },
    imageFx: { gradientMap: { from: '#0C0C0A', to: '#C8A47A', amount: 0.75 }, contrast: 1.05 },
    palette: { text: '#EDE6DA', accent: '#C8A47A', secondary: '#8A7B66', muted: '#8A7B66' },
    background: '#0B0A08',
  },
  {
    id: 'underground',
    name: 'Underground',
    hint: 'Heavy, noisy, channel-split',
    type: { font: 'panchang', weight: 800, uppercase: true, trackingScale: 0.8 },
    fx: { contrast: 1.25, saturation: 1.1, grain: 0.45, chromatic: 5, vignette: 0.45 },
    imageFx: { contrast: 1.35, saturation: 0.6, posterize: 7, grain: 0.55 },
    palette: { text: '#E6E6E6', accent: '#6DC6A4', secondary: '#4A4A47', muted: '#5A5A57' },
    background: '#070707',
  },
  {
    id: 'editorial',
    name: 'Editorial',
    hint: 'Restrained, printed, mixed case',
    type: { font: 'panchang', weight: 300, uppercase: false, trackingScale: 1.1 },
    fx: { contrast: 1.06, saturation: 0.85, grain: 0.12, vignette: 0 },
    imageFx: { saturation: 0.35, contrast: 1.12 },
    palette: { text: '#EFEFED', accent: '#D8D8D5', secondary: '#7A7A77', muted: '#7A7A77' },
    background: '#0D0D0B',
  },
  {
    id: 'soft',
    name: 'Soft',
    hint: 'Lifted blacks, bloom, low contrast',
    type: { font: 'panchang', weight: 200, uppercase: false, trackingScale: 1.6 },
    fx: {
      contrast: 0.86,
      saturation: 0.9,
      exposure: 0.18,
      glow: { blur: 22, color: '#F2F2F0', opacity: 0.32 },
      vignette: 0.15,
    },
    imageFx: { blur: 2, exposure: 0.22, contrast: 0.9 },
    palette: { text: '#F4F1EC', accent: '#D9CFC2', secondary: '#8F8880', muted: '#8F8880' },
    background: '#101010',
  },
];

export function moodById(id: string): Mood | null {
  return moods.find((mood) => mood.id === id) ?? null;
}

/**
 * Merge effects, with the mood winning on the keys it names.
 *
 * Not a replace: a producer who dialled in a specific blur should keep it
 * unless the mood has an opinion about blur. Not a "keep existing" either,
 * or applying a mood would visibly do nothing on a layer that already had
 * effects — which is the case where they most want to see a change.
 */
function mergeFx(existing: ArtworkLayerFx | undefined, incoming: ArtworkLayerFx): ArtworkLayerFx {
  return { ...(existing ?? {}), ...incoming };
}

function restyleLayer(layer: ArtworkLayer, mood: Mood): ArtworkLayer {
  // Locked layers are skipped, matching `removeLayers` and `groupLayers`: the
  // lock exists to opt out of exactly this kind of sweeping change.
  if (layer.locked) return layer;

  // A group holds no pixels of its own; restyling its wrapper would double the
  // effect on everything inside it.
  if (layer.type === 'group') return layer;

  const base = { ...layer, fx: mergeFx(layer.fx, mood.fx) };

  if (base.type === 'text') {
    return {
      ...base,
      fontFamily: mood.type.font,
      fontWeight: mood.type.weight,
      uppercase: mood.type.uppercase,
      // Scaled, not set: a title deliberately spaced out at 40 should stay
      // relatively wide, and one set tight should stay relatively tight.
      tracking: Math.round(base.tracking * mood.type.trackingScale),
      color: mood.palette.text ?? base.color,
    };
  }

  if (base.type === 'image') {
    return { ...base, fx: mergeFx(base.fx, { ...mood.fx, ...(mood.imageFx ?? {}) }) };
  }

  if (base.type === 'shape') {
    return { ...base, fill: mood.palette.accent ?? base.fill };
  }

  if (base.type === 'waveform') {
    return { ...base, color: mood.palette.accent ?? base.color };
  }

  return base;
}

/**
 * Apply a mood to a document, keeping the work intact.
 *
 * Positions, sizes, rotations, text content and image sources are all
 * untouched — the point is that the composition survives and only its register
 * changes. Pass `ids` to restyle a selection instead of everything, which is
 * how a designer actually works: try it on the title before committing.
 */
export function restyleDocument(
  document: ArtworkDocument,
  moodId: string,
  ids?: string[],
): ArtworkDocument {
  const mood = moodById(moodId);
  if (!mood) return document;

  const targeted = ids && ids.length > 0 ? new Set(ids) : null;

  const layers = document.layers.map((layer) => (
    targeted && !targeted.has(layer.id) ? layer : restyleLayer(layer, mood)
  ));

  // A partial restyle leaves the document's own palette and ground alone: the
  // producer asked about those layers, not about the whole cover.
  if (targeted) {
    return { ...document, layers, updatedAt: new Date().toISOString() };
  }

  return {
    ...document,
    layers,
    palette: { ...document.palette, ...mood.palette },
    background: mood.background ?? document.background,
    updatedAt: new Date().toISOString(),
  };
}
