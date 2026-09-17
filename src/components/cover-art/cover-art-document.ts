import type { CoverArtTemplateId, CoverArtWaveformStyle } from '@/design-system';
import {
  barRect, barSlots, buildWaveformSeries, capRadius, circularSegments, isBarMode,
  pointsAttribute, suggestedBarCount, waveformPathPoints, type WaveformMode,
} from '@/lib/cover/waveform';
import {
  buildFxFilterDef, fxDefaults, vignetteSvgGradientDef,
  type ArtworkBlendMode, type ArtworkLayerFx,
} from '@/lib/cover/effects';
import {
  fontStackFor, resolveWeight, type CoverFontId, type LegacyFontRole,
} from '@/lib/cover/fonts';
import { guidesDefaults, type DocumentGuides } from '@/lib/cover/rulers';
import {
  flattenForPath, hasTextPath, textPathD, textPathDefaults, textPathPlacement,
  type TextPathSettings,
} from '@/lib/cover/text-path';

export type { WaveformMode } from '@/lib/cover/waveform';
export type { ArtworkLayerFx, ArtworkBlendMode } from '@/lib/cover/effects';
export type { CoverFontId, LegacyFontRole } from '@/lib/cover/fonts';
export type { DocumentGuides } from '@/lib/cover/rulers';
export type { TextPathSettings, TextPathShape } from '@/lib/cover/text-path';

export type CoverArtTool =
  | 'source'
  | 'directions'
  | 'media'
  | 'typography'
  | 'elements'
  | 'textures'
  | 'waveform'
  | 'brand'
  | 'history';

export type ArtworkLayerType = 'text' | 'shape' | 'waveform' | 'texture' | 'image' | 'group';

export type ArtworkLayerBase = {
  id: string;
  name: string;
  type: ArtworkLayerType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  visible: boolean;
  locked: boolean;
  zIndex: number;
  /**
   * The group this layer belongs to, if any.
   *
   * Nesting is expressed as a parent POINTER on a flat array rather than as
   * nested `children`, so every existing consumer that walks `document.layers`
   * still sees every layer. The alternative — a real tree — would have meant
   * rewriting selection, snapping, alignment and both renderers at once.
   *
   * Children keep ABSOLUTE document coordinates. A group is a wrapper for
   * opacity, blend and organisation, not a coordinate space, which is what
   * lets `lib/cover/geometry.ts` stay entirely unaware that groups exist.
   */
  parentId?: string;
  blendMode: ArtworkBlendMode;
  /**
   * Adjustments and effects. Optional so every document saved before effects
   * existed keeps opening; every read goes through `fxDefaults`, and both
   * renderers consume the same `<filter>` this produces rather than each
   * writing their own — see `lib/cover/effects.ts`.
   */
  fx?: ArtworkLayerFx;
};

export type TextArtworkLayer = ArtworkLayerBase & {
  type: 'text';
  text: string;
  /**
   * A font id from `lib/cover/fonts.ts`, or one of the five legacy role names
   * documents used to store (`display`/`artwork`/`ui`/`mono`/`brand`). Both
   * resolve through `resolveFont`, so covers saved before the type library
   * existed keep opening in the face they were designed in.
   */
  fontFamily: CoverFontId | LegacyFontRole;
  /**
   * Requested weight. Snapped to a cut the family actually ships before it
   * reaches either renderer — see `nearestFace`. Optional so older documents
   * load; they resolve to 400.
   */
  fontWeight?: number;
  fontSize: number;
  tracking: number;
  lineHeight: number;
  align: 'left' | 'center' | 'right';
  uppercase: boolean;
  color: string;
  /** Outline colour. Undefined means no outline, which is the common case. */
  stroke?: string;
  strokeWidth?: number;
  /**
   * Curve the text sits on. Absent means ordinary flat text, which keeps
   * wrapping and multi-line support that `<textPath>` has no concept of.
   */
  path?: TextPathSettings;
};

/**
 * The weight a text layer actually renders at.
 *
 * Both renderers call this rather than reading `fontWeight` directly, because
 * an unsnapped weight is drawn by two different synthesisers — the page's font
 * engine on the canvas, an isolated SVG's on export — and they do not agree.
 */
export function textWeightFor(layer: TextArtworkLayer): number {
  return resolveWeight(layer.fontFamily, layer.fontWeight);
}

export type ShapeArtworkLayer = ArtworkLayerBase & {
  type: 'shape';
  shape: 'rect' | 'circle' | 'rule' | 'triangle';
  fill: string;
  stroke?: string;
  strokeWidth?: number;
  /** Corner rounding in document units. Ignored by non-rect shapes. */
  cornerRadius?: number;
};

export type WaveformArtworkLayer = ArtworkLayerBase & {
  type: 'waveform';
  /**
   * `linear` and `spectral-bars` predate the rest and are kept so saved
   * documents keep opening; both draw mirrored bars now.
   */
  mode: WaveformMode;
  style: CoverArtWaveformStyle;
  amplitude: number;
  strokeWidth: number;
  smoothing: number;
  color: string;
  bpm?: number | null;
  durationSeconds?: number | null;
  peakSource: 'real' | 'preview';
  peaks: number[];
  /** Bars drawn across the layer. Optional so older documents still load. */
  barCount?: number;
  /** Space between bars as a fraction of each slot, 0..0.9. */
  barGap?: number;
  cap?: 'flat' | 'round';
  /** Lift the loudest peak to full height. */
  normalize?: boolean;
  /** Mirror around the centreline. Off hangs bars from the baseline. */
  mirror?: boolean;
};

/** Defaults for the fields added after the first version of this layer. */
export function waveformDefaults(layer: WaveformArtworkLayer) {
  return {
    barCount: layer.barCount ?? suggestedBarCount(layer.width),
    barGap: layer.barGap ?? 0.3,
    cap: layer.cap ?? 'round',
    normalize: layer.normalize ?? true,
    mirror: layer.mirror ?? true,
  } as const;
}

/**
 * The drawable series for a waveform layer.
 *
 * Single source of truth for both renderers — the canvas and the SVG exporter
 * call this, so a waveform cannot look one way on screen and another in the
 * exported file.
 */
export function waveformSeriesFor(layer: WaveformArtworkLayer): number[] {
  const { barCount, normalize } = waveformDefaults(layer);
  const count = layer.mode === 'circular'
    // A dense circle turns into a solid ring; keep spokes countable.
    ? Math.min(barCount, 180)
    : barCount;
  return buildWaveformSeries({
    peaks: layer.peaks,
    count,
    smoothing: layer.smoothing,
    normalize,
    amplitude: layer.amplitude,
  });
}

export const artworkTextureKinds = [
  'paper-grain',
  'basalt-noise',
  'scan-grain',
  'halftone',
  'crosshatch',
  'vignette',
] as const;

export type ArtworkTextureKind = (typeof artworkTextureKinds)[number];

export type TextureArtworkLayer = ArtworkLayerBase & {
  type: 'texture';
  texture: ArtworkTextureKind;
  intensity: number;
};

export const artworkImageTreatments = [
  'normal',
  'duotone',
  'mineral-tint',
  'high-contrast',
  'grayscale',
  'bleach',
] as const;

export type ArtworkImageTreatment = (typeof artworkImageTreatments)[number];

export const artworkImageMasks = ['none', 'circle', 'arch', 'diamond'] as const;

export type ArtworkImageMask = (typeof artworkImageMasks)[number];

export type ImageArtworkLayer = ArtworkLayerBase & {
  type: 'image';
  src?: string;
  label: string;
  treatment: ArtworkImageTreatment;
  /**
   * Crop behaviour inside the layer frame. `cover` fills and crops, `contain`
   * fits the whole image inside, `fill` stretches. Optional so documents saved
   * before cropping existed still load; every read goes through
   * `imageCropDefaults`.
   */
  fit?: 'cover' | 'contain' | 'fill';
  /** Pan within the frame, -1..1, 0 centred. Only meaningful when scale > 1. */
  offsetX?: number;
  offsetY?: number;
  /** Zoom on top of `fit`. 1 = no extra zoom. */
  scale?: number;
  /** Corner rounding in document units. */
  radius?: number;
  mask?: ArtworkImageMask;
};

/**
 * Crop fields are optional on the layer so older documents keep loading, but
 * every consumer wants concrete numbers. This is the single place that decides
 * what "unset" means, so the canvas preview and the SVG export cannot drift
 * apart — which is exactly how the on-canvas image and the exported image
 * ended up disagreeing before.
 */
export function imageCropDefaults(layer: ImageArtworkLayer) {
  return {
    fit: layer.fit ?? 'cover',
    offsetX: layer.offsetX ?? 0,
    offsetY: layer.offsetY ?? 0,
    scale: layer.scale ?? 1,
    radius: layer.radius ?? 0,
    mask: layer.mask ?? 'none',
  } as const;
}

/**
 * Geometry of the <image> inside its frame, given fit/scale/pan.
 *
 * Shared by the canvas and the exporter. Pan is expressed as a fraction of the
 * overflow the zoom creates: 0 centres the image, +1 pushes it fully to one
 * edge, and when scale is 1 there is no overflow so pan is a no-op by
 * construction rather than by a special case.
 */
export function imageFrameRect(layer: ImageArtworkLayer) {
  const { scale, offsetX, offsetY } = imageCropDefaults(layer);
  const width = layer.width * scale;
  const height = layer.height * scale;
  const overflowX = width - layer.width;
  const overflowY = height - layer.height;
  return {
    x: -overflowX / 2 + (offsetX * overflowX) / 2,
    y: -overflowY / 2 + (offsetY * overflowY) / 2,
    width,
    height,
  };
}

/** `preserveAspectRatio` value matching a fit mode. */
export function imagePreserveAspectRatio(fit: 'cover' | 'contain' | 'fill') {
  if (fit === 'fill') return 'none';
  if (fit === 'contain') return 'xMidYMid meet';
  return 'xMidYMid slice';
}

/** CSS `object-fit` matching a fit mode, for the canvas preview. */
export function imageObjectFit(fit: 'cover' | 'contain' | 'fill'): 'cover' | 'contain' | 'fill' {
  return fit;
}

/**
 * A group.
 *
 * Carries no geometry of its own worth reading — its bounds are whatever its
 * descendants occupy, derived on demand by `groupBounds`. The stored rect is
 * set once at creation and left alone; nothing depends on it, because every
 * geometry operation expands a selected group into its leaves first.
 */
export type GroupArtworkLayer = ArtworkLayerBase & {
  type: 'group';
  /** Folded shut in the layers panel. Purely a panel affordance. */
  collapsed?: boolean;
};

export type ArtworkLayer =
  | GroupArtworkLayer
  | TextArtworkLayer
  | ShapeArtworkLayer
  | WaveformArtworkLayer
  | TextureArtworkLayer
  | ImageArtworkLayer;

export type ArtworkPalette = {
  background: string;
  panel: string;
  text: string;
  muted: string;
  accent: string;
  secondary: string;
  waveformLow: string;
  waveformHigh: string;
};

export type ArtworkSource = {
  kind: 'track' | 'project' | 'playlist' | 'upload' | 'empty';
  id?: string;
  label: string;
  detail?: string;
};

export type ArtworkDocument = {
  id: string;
  name: string;
  version: number;
  width: number;
  height: number;
  background: string;
  palette: ArtworkPalette;
  templateId: CoverArtTemplateId;
  directionId: CoverArtDirectionId;
  source: ArtworkSource;
  layers: ArtworkLayer[];
  /**
   * Ruler guides, in document units.
   *
   * Optional so covers saved before rulers existed keep opening; read through
   * `documentGuides`. Deliberately NOT read by `renderArtworkDocumentSvg` —
   * guides are a working aid, and the exporter never seeing them is what makes
   * it impossible to bake one into a finished cover.
   */
  guides?: DocumentGuides;
  createdAt: string;
  updatedAt: string;
};

/** The guides on a document, with the unset case resolved in one place. */
export function documentGuides(document: ArtworkDocument): DocumentGuides {
  return guidesDefaults(document.guides);
}

export type CoverArtDirectionId =
  | 'brutalist-archive'
  | 'de-roche-mineral'
  | 'industrial-editorial'
  | 'spectral-night';

export type CoverArtDirection = {
  id: CoverArtDirectionId;
  name: string;
  templateId: CoverArtTemplateId;
  palette: ArtworkPalette;
  typography: string;
  material: string;
  rationale: string;
};

export const defaultArtworkPalette: ArtworkPalette = {
  background: '#090907',
  panel: '#0D0D0A',
  text: '#F2F2F0',
  muted: '#6E6E6B',
  accent: '#F2F2F0',
  secondary: '#A95235',
  waveformLow: '#6E6E6B',
  waveformHigh: '#F2F2F0',
};

/**
 * The four house looks.
 *
 * All neutral: they separate by value and contrast — bone paper, deep mineral,
 * hard white, dim silver — rather than by hue. The studio previously carried a
 * warm palette of its own that appeared nowhere else in the app, which made the
 * whole surface read brown next to the near-black, silver-on-black chrome
 * everything else uses.
 */
export const coverArtDirections: CoverArtDirection[] = [
  {
    id: 'brutalist-archive',
    name: 'Brutalist Archive',
    templateId: 'de-roche-archive',
    palette: { ...defaultArtworkPalette, background: '#090907', panel: '#E8E8E6', text: '#F2F2F0', accent: '#F2F2F0', secondary: '#6E6E6B' },
    typography: 'Compressed editorial title with restrained metadata.',
    material: 'Paper grain, crop marks, archival catalogue spacing.',
    rationale: 'Best for beats that need a serious collector-grade sleeve.',
  },
  {
    id: 'de-roche-mineral',
    name: 'De Roche Mineral',
    templateId: 'image-mask',
    palette: { ...defaultArtworkPalette, background: '#090907', panel: '#0D0D0A', accent: '#D8D8D5', secondary: '#4A4A47' },
    typography: 'Quiet luxury display type balanced with clean UI labels.',
    material: 'Stone tint, masked imagery, mineral edge contrast.',
    rationale: 'Turns cover art into a dark mineral object without losing readability.',
  },
  {
    id: 'industrial-editorial',
    name: 'Industrial Editorial',
    templateId: 'poster-deconstruction',
    palette: { ...defaultArtworkPalette, background: '#090907', accent: '#FFFFFF', secondary: '#8A8A87' },
    typography: 'Large offset display text with utility metadata rails.',
    material: 'Halftone structure, rules, stamped production labels.',
    rationale: 'Useful for aggressive records that need motion and pressure.',
  },
  {
    id: 'spectral-night',
    name: 'Spectral Night',
    templateId: 'dark-listening-room',
    palette: { ...defaultArtworkPalette, background: '#090907', accent: '#B8B8B5', secondary: '#3A3A38' },
    typography: 'Centered artwork display with a low-lit waveform field.',
    material: 'Nocturne image treatment, spectral band accents.',
    rationale: 'Keeps the artwork cinematic while making audio feel visible.',
  },
];

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'untitled';
}

function layerId(directionId: CoverArtDirectionId, source: ArtworkSource, prefix: string) {
  return `${slug(directionId)}-${slug(source.id ?? source.label)}-${prefix}`;
}

export function createArtworkDocument(
  directionId: CoverArtDirectionId,
  source: ArtworkSource,
  now = new Date('2026-07-25T00:00:00.000Z'),
): ArtworkDocument {
  const direction = coverArtDirections.find((item) => item.id === directionId) ?? coverArtDirections[1];
  const timestamp = now.toISOString();
  const name = source.kind === 'empty' ? 'Untitled cover' : `${source.label} cover`;

  return {
    id: `cover-${slug(direction.id)}-${slug(source.id ?? source.label)}`,
    name,
    version: 1,
    width: 3000,
    height: 3000,
    background: direction.palette.background,
    palette: direction.palette,
    templateId: direction.templateId,
    directionId: direction.id,
    source,
    createdAt: timestamp,
    updatedAt: timestamp,
    layers: [
      {
        id: layerId(direction.id, source, 'background'),
        name: 'Background Field',
        type: 'shape',
        x: 0,
        y: 0,
        width: 3000,
        height: 3000,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: true,
        zIndex: 0,
        blendMode: 'normal',
        shape: 'rect',
        fill: direction.palette.background,
      },
      {
        id: layerId(direction.id, source, 'image'),
        name: 'Artwork Image',
        type: 'image',
        x: 420,
        y: 420,
        width: 2160,
        height: 1580,
        rotation: 0,
        opacity: 0.72,
        visible: true,
        locked: false,
        zIndex: 1,
        blendMode: 'soft-light',
        label: 'Imported image placeholder',
        treatment: direction.id === 'industrial-editorial' ? 'high-contrast' : 'mineral-tint',
      },
      {
        id: layerId(direction.id, source, 'waveform'),
        name: 'Spectral Waveform',
        type: 'waveform',
        x: 350,
        y: 2010,
        width: 2300,
        height: 320,
        rotation: 0,
        opacity: 0.86,
        visible: true,
        locked: false,
        zIndex: 2,
        blendMode: 'screen',
        mode: direction.id === 'spectral-night' ? 'mirror' : 'linear',
        style: direction.id === 'brutalist-archive' ? 'document-rule' : 'low-scanline',
        amplitude: 0.92,
        strokeWidth: 16,
        // Light smoothing only: the point of peak-per-bucket resampling is that
        // transients survive, and heavy smoothing throws them away again.
        smoothing: 0.12,
        // The artwork's own accent, not the stock blue/teal. Two cool colours
        // striped across a warm cover is what made the old waveform read as
        // clip art rather than part of the design.
        color: direction.palette.accent,
        barCount: 132,
        barGap: 0.32,
        cap: 'round',
        normalize: true,
        mirror: true,
        bpm: source.kind === 'track' && source.detail?.includes('BPM') ? Number.parseInt(source.detail, 10) : null,
        durationSeconds: null,
        peakSource: 'preview',
        peaks: createPreviewPeaks(source.label, 96),
      },
      {
        id: layerId(direction.id, source, 'title'),
        name: 'Main Title',
        type: 'text',
        x: 360,
        y: 360,
        width: 2280,
        height: 620,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        zIndex: 3,
        blendMode: 'normal',
        text: source.kind === 'empty' ? 'MIDNIGHT CARTEL' : source.label,
        fontFamily: 'artwork',
        fontSize: 220,
        tracking: -4,
        lineHeight: 0.92,
        align: direction.id === 'spectral-night' ? 'center' : 'left',
        uppercase: true,
        color: direction.palette.text,
      },
      {
        id: layerId(direction.id, source, 'artist'),
        name: 'Artist Name',
        type: 'text',
        x: 360,
        y: 2470,
        width: 1320,
        height: 140,
        rotation: 0,
        opacity: 0.9,
        visible: true,
        locked: false,
        zIndex: 4,
        blendMode: 'normal',
        text: 'UCHE',
        // Same face as the app's own brand mark, and the same 0.22em tracking
        // it carries, so the producer name reads as the same identity.
        fontFamily: 'brand',
        fontSize: 82,
        tracking: 18,
        lineHeight: 1,
        align: 'left',
        uppercase: true,
        color: direction.palette.accent,
      },
      {
        id: layerId(direction.id, source, 'meta'),
        name: 'Metadata Label',
        type: 'text',
        x: 1780,
        y: 2470,
        width: 860,
        height: 140,
        rotation: 0,
        opacity: 0.78,
        visible: true,
        locked: false,
        zIndex: 5,
        blendMode: 'normal',
        text: source.detail ?? '144 BPM / F MINOR',
        fontFamily: 'mono',
        fontSize: 54,
        tracking: 8,
        lineHeight: 1,
        align: 'right',
        uppercase: true,
        color: direction.palette.muted,
      },
      {
        id: layerId(direction.id, source, 'texture'),
        name: 'Paper Texture',
        type: 'texture',
        x: 0,
        y: 0,
        width: 3000,
        height: 3000,
        rotation: 0,
        opacity: 0.18,
        visible: true,
        locked: false,
        zIndex: 6,
        blendMode: 'overlay',
        texture: direction.id === 'spectral-night' ? 'basalt-noise' : 'paper-grain',
        intensity: 0.34,
      },
    ],
  } satisfies ArtworkDocument;
}

/* ── Grouping ──────────────────────────────────────────────────────────────
 *
 * Nesting is a parent pointer on a flat array (see `ArtworkLayerBase.parentId`).
 * Everything below is pure and tested; per CLAUDE.md this is exactly the kind
 * of logic that gets silently reverted when it hides inside a component, and
 * the cycle guards in particular are impossible to exercise from the UI.
 */

/** Layers with no parent, in stacking order. */
export function topLevelLayers(layers: ArtworkLayer[]): ArtworkLayer[] {
  return sortArtworkLayers(layers.filter((layer) => !layer.parentId));
}

/** Direct children of a group, in stacking order. */
export function childrenOf(layers: ArtworkLayer[], parentId: string): ArtworkLayer[] {
  return sortArtworkLayers(layers.filter((layer) => layer.parentId === parentId));
}

/**
 * Every layer beneath a group, at any depth.
 *
 * Guarded against cycles. A hand-edited document — or a future bug in a move
 * operation — can point a group at its own descendant, and without the visited
 * set this recurses until the stack blows, taking the whole studio down rather
 * than degrading.
 */
export function descendantIds(layers: ArtworkLayer[], groupId: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>([groupId]);
  const walk = (id: string) => {
    for (const child of layers.filter((layer) => layer.parentId === id)) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      out.push(child.id);
      if (child.type === 'group') walk(child.id);
    }
  };
  walk(groupId);
  return out;
}

/** True when `id` sits anywhere beneath `ancestorId`. */
export function isDescendantOf(layers: ArtworkLayer[], id: string, ancestorId: string): boolean {
  const seen = new Set<string>();
  let current = layers.find((layer) => layer.id === id)?.parentId;
  while (current) {
    if (current === ancestorId) return true;
    if (seen.has(current)) return false;
    seen.add(current);
    current = layers.find((layer) => layer.id === current)?.parentId;
  }
  return false;
}

/**
 * Replace any selected group with the drawable layers inside it.
 *
 * THE function that lets groups exist without touching `lib/cover/geometry.ts`.
 * Move, resize, align and snapping all operate on leaves, so selecting a group
 * and dragging it moves its contents — and a group contributes no rect of its
 * own to a selection's bounding box, which is what keeps those bounds correct
 * without anyone having to keep a group's stored rect up to date.
 */
export function expandToLeaves(layers: ArtworkLayer[], ids: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    const layer = layers.find((item) => item.id === id);
    if (!layer) continue;
    if (layer.type === 'group') {
      for (const descendant of descendantIds(layers, id)) {
        const child = layers.find((item) => item.id === descendant);
        if (child && child.type !== 'group' && !seen.has(descendant)) {
          seen.add(descendant);
          out.push(descendant);
        }
      }
      continue;
    }
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/** The box a group's contents occupy, or null when it is empty. */
export function groupBounds(
  layers: ArtworkLayer[],
  groupId: string,
): { x: number; y: number; width: number; height: number } | null {
  const leaves = expandToLeaves(layers, [groupId])
    .map((id) => layers.find((layer) => layer.id === id))
    .filter((layer): layer is ArtworkLayer => Boolean(layer));
  if (leaves.length === 0) return null;
  const minX = Math.min(...leaves.map((layer) => layer.x));
  const minY = Math.min(...leaves.map((layer) => layer.y));
  const maxX = Math.max(...leaves.map((layer) => layer.x + layer.width));
  const maxY = Math.max(...leaves.map((layer) => layer.y + layer.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Renumber one sibling set so its z values are 0..n-1 in their current order.
 *
 * z only has to be meaningful WITHIN a sibling set, but ungrouping drops a
 * group's children into a set where their old values can collide with existing
 * siblings — and two layers sharing a z index stack in whatever order the sort
 * happens to be stable in, which is not a decision anyone made.
 */
function renumberSiblings(layers: ArtworkLayer[], parentId: string | undefined): ArtworkLayer[] {
  const siblings = sortArtworkLayers(layers.filter((layer) => layer.parentId === parentId));
  const order = new Map(siblings.map((layer, index) => [layer.id, index]));
  return layers.map((layer) => (
    order.has(layer.id) ? { ...layer, zIndex: order.get(layer.id)! } : layer
  ));
}

/**
 * Wrap the given layers in a new group.
 *
 * Members are taken from wherever they were, so grouping a mixed selection is
 * allowed and pulls everything into one place — which is what the gesture
 * means. Locked layers are left where they are, matching `removeLayers`:
 * the lock is there to stop exactly this kind of bulk change.
 */
export function groupLayers(
  document: ArtworkDocument,
  ids: string[],
  name = 'Group',
): { document: ArtworkDocument; id: string | null } {
  const members = document.layers.filter((layer) => ids.includes(layer.id) && !layer.locked);
  if (members.length === 0) return { document, id: null };

  const groupId = freshId('group');
  // The group lands where its topmost member was, so grouping does not change
  // what is in front of what.
  const zIndex = Math.max(...members.map((layer) => layer.zIndex));
  // A group nested inside another group keeps that parent, but only when every
  // member shares it — a mixed selection is flattened to the top level rather
  // than being guessed at.
  const parents = new Set(members.map((layer) => layer.parentId));
  const parentId = parents.size === 1 ? [...parents][0] : undefined;

  const memberIds = new Set(members.map((layer) => layer.id));

  const minX = Math.min(...members.map((layer) => layer.x));
  const minY = Math.min(...members.map((layer) => layer.y));
  const maxX = Math.max(...members.map((layer) => layer.x + layer.width));
  const maxY = Math.max(...members.map((layer) => layer.y + layer.height));

  const group: GroupArtworkLayer = {
    id: groupId,
    name,
    type: 'group',
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    zIndex,
    parentId,
    blendMode: 'normal',
  };

  let layers: ArtworkLayer[] = document.layers.map((layer) => (
    memberIds.has(layer.id) ? { ...layer, parentId: groupId } : layer
  ));
  layers = [...layers, group];
  // Members keep their relative order inside the new group; the sets they left
  // close up behind them.
  layers = renumberSiblings(layers, groupId);
  layers = renumberSiblings(layers, parentId);

  return {
    document: { ...document, layers, updatedAt: new Date().toISOString() },
    id: groupId,
  };
}

/**
 * Dissolve a group, promoting its children into the group's own parent.
 *
 * The children take the group's place in the stack rather than being appended,
 * so ungrouping never changes what is drawn in front of what.
 */
export function ungroupLayers(document: ArtworkDocument, groupId: string): ArtworkDocument {
  const group = document.layers.find((layer) => layer.id === groupId);
  if (!group || group.type !== 'group' || group.locked) return document;

  const children = childrenOf(document.layers, groupId);
  const siblings = sortArtworkLayers(
    document.layers.filter((layer) => layer.parentId === group.parentId && layer.id !== groupId),
  );

  // Rebuild the destination sibling order with the children spliced in where
  // the group sat.
  const rebuilt: ArtworkLayer[] = [];
  let inserted = false;
  for (const sibling of siblings) {
    if (!inserted && sibling.zIndex > group.zIndex) {
      rebuilt.push(...children);
      inserted = true;
    }
    rebuilt.push(sibling);
  }
  if (!inserted) rebuilt.push(...children);

  const order = new Map(rebuilt.map((layer, index) => [layer.id, index]));
  const childIds = new Set(children.map((layer) => layer.id));

  const layers = document.layers
    .filter((layer) => layer.id !== groupId)
    .map((layer) => {
      const next = childIds.has(layer.id) ? { ...layer, parentId: group.parentId } : layer;
      return order.has(next.id) ? { ...next, zIndex: order.get(next.id)! } : next;
    });

  return { ...document, layers, updatedAt: new Date().toISOString() };
}

export type LayerRow = { layer: ArtworkLayer; depth: number; hasChildren: boolean };

/**
 * The layer stack flattened for the panel, deepest-first within each group.
 *
 * Collapsed groups omit their children entirely rather than hiding them with
 * CSS, so a folded group of forty layers costs nothing to render.
 */
export function layerRows(layers: ArtworkLayer[]): LayerRow[] {
  const rows: LayerRow[] = [];
  const seen = new Set<string>();

  const walk = (siblings: ArtworkLayer[], depth: number) => {
    // Reversed: the panel reads top-down as front-to-back, matching every
    // layers panel, while `zIndex` counts up from the back.
    for (const layer of [...siblings].reverse()) {
      if (seen.has(layer.id)) continue;
      seen.add(layer.id);
      const children = layer.type === 'group' ? childrenOf(layers, layer.id) : [];
      rows.push({ layer, depth, hasChildren: children.length > 0 });
      if (layer.type === 'group' && !layer.collapsed && children.length > 0) {
        walk(children, depth + 1);
      }
    }
  };

  walk(topLevelLayers(layers), 0);
  return rows;
}

export function sortArtworkLayers(layers: ArtworkLayer[]) {
  return [...layers].sort((a, b) => a.zIndex - b.zIndex);
}

export function moveLayer(layers: ArtworkLayer[], id: string, delta: -1 | 1) {
  // Reordering happens WITHIN a sibling set. A layer inside a group that swapped
  // with whatever happened to be adjacent in the flat array would jump out of
  // its group, or silently reorder something in a different group entirely.
  const target = layers.find((layer) => layer.id === id);
  if (!target) return layers;
  const sorted = sortArtworkLayers(layers.filter((layer) => layer.parentId === target.parentId));
  const index = sorted.findIndex((layer) => layer.id === id);
  const nextIndex = index + delta;
  if (index < 0 || nextIndex < 0 || nextIndex >= sorted.length) return layers;

  const next = [...sorted];
  [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
  // Renumber only this sibling set and merge back into the full list. Returning
  // `next` alone would drop every layer outside the set from the document.
  const order = new Map(next.map((layer, zIndex) => [layer.id, zIndex]));
  return layers.map((layer) => (
    order.has(layer.id) ? { ...layer, zIndex: order.get(layer.id)! } : layer
  ));
}

/**
 * Deterministic stand-in peaks for a document with no analysed track.
 *
 * Seeded from the source label so the same beat always previews with the same
 * shape — a waveform that reshuffles on every render reads as a bug, and the
 * producer would be positioning against something that will not persist.
 */
export function createPreviewPeaks(seedText: string, count: number) {
  let seed = 0;
  for (let i = 0; i < seedText.length; i += 1) seed = (Math.imul(31, seed) + seedText.charCodeAt(i)) | 0;
  return Array.from({ length: count }, (_, index) => {
    const pulse = Math.abs(Math.sin(index * 0.62 + seed * 0.0001));
    const kick = index % 8 === 0 ? 0.94 : 0;
    const hat = index % 2 === 1 ? 0.22 : 0;
    return Math.min(1, Math.max(0.08, pulse * 0.54 + kick + hat));
  });
}

export function updateWaveformLayerPeaks(
  layers: ArtworkLayer[],
  peaks: number[],
  peakSource: WaveformArtworkLayer['peakSource'],
  bpm?: number | null,
  durationSeconds?: number | null,
) {
  return layers.map((layer) => (
    layer.type === 'waveform'
      ? { ...layer, peaks, peakSource, bpm: bpm ?? layer.bpm ?? null, durationSeconds: durationSeconds ?? layer.durationSeconds ?? null }
      : layer
  ));
}

/** One channel of a hex colour as a 0..1 value, for SVG filter tables. */
export function hexChannel(hex: string, channel: 0 | 1 | 2): string {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return channel === 0 ? '0' : '0';
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const v = parseInt(h.slice(channel * 2, channel * 2 + 2), 16) / 255;
  return v.toFixed(3);
}

/** Maps an image layer's treatment to the matching filter defined in <defs>. */
function imageTreatmentFilter(treatment: ArtworkImageTreatment): string {
  switch (treatment) {
    case 'duotone': return ' filter="url(#imgDuotone)"';
    case 'mineral-tint': return ' filter="url(#imgMineral)"';
    case 'high-contrast': return ' filter="url(#imgHighContrast)"';
    case 'grayscale': return ' filter="url(#imgGrayscale)"';
    case 'bleach': return ' filter="url(#imgBleach)"';
    default: return '';
  }
}

/**
 * The clip path for one image layer's frame.
 *
 * Cropping is done by clipping rather than by resizing the source: the image is
 * drawn larger than its frame and the frame shows a window onto it, which is
 * what pan/zoom cropping means. `mask` reuses the same mechanism for non-rect
 * windows, so a circular crop and a rectangular one take the same code path.
 */
function imageClipShape(layer: ImageArtworkLayer): string {
  const { mask, radius } = imageCropDefaults(layer);
  const w = layer.width;
  const h = layer.height;
  if (mask === 'circle') {
    return `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${w / 2}" ry="${h / 2}" />`;
  }
  if (mask === 'diamond') {
    return `<polygon points="${w / 2},0 ${w},${h / 2} ${w / 2},${h} 0,${h / 2}" />`;
  }
  if (mask === 'arch') {
    // Half-round top, square bottom — the sleeve/arch crop.
    const r = w / 2;
    return `<path d="M0 ${h} L0 ${r} A ${r} ${r} 0 0 1 ${w} ${r} L${w} ${h} Z" />`;
  }
  return `<rect width="${w}" height="${h}" rx="${radius}" ry="${radius}" />`;
}

/** SVG <pattern>/<radialGradient> body for each texture kind. */
function texturePatternDefs(palette: ArtworkPalette): string {
  return `
    <pattern id="texPaperGrain" width="80" height="80" patternUnits="userSpaceOnUse">
      <rect width="80" height="80" fill="${palette.text}" opacity="0.04" />
      <path d="M0 13H80M0 47H80M11 0V80M53 0V80" stroke="${palette.muted}" stroke-width="1" opacity="0.16" />
    </pattern>
    <pattern id="texBasaltNoise" width="60" height="60" patternUnits="userSpaceOnUse">
      <rect width="60" height="60" fill="${palette.panel}" opacity="0.10" />
      <circle cx="9" cy="14" r="2.4" fill="${palette.text}" opacity="0.20" />
      <circle cx="41" cy="7" r="1.6" fill="${palette.text}" opacity="0.14" />
      <circle cx="27" cy="38" r="3.1" fill="${palette.muted}" opacity="0.22" />
      <circle cx="52" cy="49" r="1.9" fill="${palette.text}" opacity="0.16" />
    </pattern>
    <pattern id="texScanGrain" width="6" height="6" patternUnits="userSpaceOnUse">
      <rect width="6" height="3" fill="${palette.text}" opacity="0.10" />
    </pattern>
    <pattern id="texHalftone" width="16" height="16" patternUnits="userSpaceOnUse">
      <circle cx="4" cy="4" r="2.6" fill="${palette.text}" opacity="0.26" />
      <circle cx="12" cy="12" r="2.6" fill="${palette.text}" opacity="0.26" />
    </pattern>
    <pattern id="texCrosshatch" width="14" height="14" patternUnits="userSpaceOnUse">
      <path d="M0 0L14 14M14 0L0 14" stroke="${palette.text}" stroke-width="1" opacity="0.20" />
    </pattern>
    <radialGradient id="texVignette" cx="50%" cy="50%" r="72%">
      <stop offset="55%" stop-color="#000000" stop-opacity="0" />
      <stop offset="100%" stop-color="#000000" stop-opacity="0.85" />
    </radialGradient>`;
}

function textureFill(texture: ArtworkTextureKind): string {
  switch (texture) {
    case 'basalt-noise': return 'url(#texBasaltNoise)';
    case 'scan-grain': return 'url(#texScanGrain)';
    case 'halftone': return 'url(#texHalftone)';
    case 'crosshatch': return 'url(#texCrosshatch)';
    case 'vignette': return 'url(#texVignette)';
    default: return 'url(#texPaperGrain)';
  }
}

export type RenderArtworkOptions = {
  /**
   * Omit the background plate entirely.
   *
   * Only meaningful for formats that carry an alpha channel — `resolveExport`
   * in `lib/cover/export-settings.ts` decides that and never asks for this on a
   * JPEG, because a canvas handed a transparent JPEG produces a BLACK plate
   * rather than a white one.
   */
  transparent?: boolean;
};

export function renderArtworkDocumentSvg(
  document: ArtworkDocument,
  options: RenderArtworkOptions = {},
) {
  // Reads the same registry the canvas does, so a stack cannot be listed in one
  // order here and another order there — which is how Akira ended up sitting
  // behind Synkopy in every role and never actually rendering.
  const fontFor = (layer: TextArtworkLayer) => fontStackFor(layer.fontFamily);

  const escape = (value: string) => value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

  /**
   * Rendering walks the layer TREE, not the flat array.
   *
   * A group emits a wrapper carrying its opacity and blend, and its children
   * are drawn inside it — which is what makes group opacity mean "fade these
   * as one thing" rather than "fade each of them", and what isolates a blend
   * mode to the group's own contents.
   */
  const renderList = (list: ArtworkLayer[]): string => list
    .filter((layer) => layer.visible)
    .map((layer) => renderOne(layer))
    .join('');

  // Clip paths are collected while rendering and emitted into <defs>, because
  // each image layer needs its own frame-shaped clip.
  const clipDefs: string[] = [];
  /** One `<path>` per text layer that curves, referenced by its `<textPath>`. */
  const textPathDefs: string[] = [];
  /**
   * Effect filters and vignette ramps, built by `lib/cover/effects.ts` at
   * scale 1 because a document unit is the unit here. The canvas builds the
   * very same defs at its current zoom and references them the same way, so
   * there is no second effects implementation that can fall out of step.
   */
  const fxDefs: string[] = [];

  function renderOne(layer: ArtworkLayer): string {
    {
      const transform = `translate(${layer.x} ${layer.y}) rotate(${layer.rotation} ${layer.width / 2} ${layer.height / 2})`;

      /**
       * The layer's own drawing, carrying no presentation attributes.
       *
       * Opacity, blend mode and the transform moved onto a wrapping <g> so an
       * effect filter can sit between them and the content. Two reasons it has
       * to nest that way rather than landing on the same element:
       *
       *   - A filter and a clip-path on one element clip the drop shadow away
       *     along with the crop, so the shadow silently disappears on exactly
       *     the layers most likely to want one.
       *   - The filter goes INSIDE the transform, which is what CSS does
       *     natively on the canvas. Matching it means a rotated layer's shadow
       *     rotates with the layer in the export too.
       *
       * Presentation attributes are also why `attrs()` used to exist: callers
       * appending a second `style=` produced `<text style="…" style="…">`,
       * which is invalid XML, so the whole export failed to load as an image.
       * Content elements no longer write `style` at all, which removes the
       * opportunity entirely.
       */
      const content = (): string => {
        // A group has nothing of its own to draw; it IS its children.
        if (layer.type === 'group') {
          return renderList(childrenOf(document.layers, layer.id));
        }

        if (layer.type === 'shape') {
          if (layer.shape === 'circle') {
            return `<ellipse cx="${layer.width / 2}" cy="${layer.height / 2}" rx="${layer.width / 2}" ry="${layer.height / 2}" fill="${layer.fill}" stroke="${layer.stroke ?? 'none'}" stroke-width="${layer.strokeWidth ?? 0}" />`;
          }
          if (layer.shape === 'triangle') {
            const points = `${layer.width / 2},0 ${layer.width},${layer.height} 0,${layer.height}`;
            return `<polygon points="${points}" fill="${layer.fill}" stroke="${layer.stroke ?? 'none'}" stroke-width="${layer.strokeWidth ?? 0}" />`;
          }
          const radius = layer.cornerRadius ?? 0;
          return `<rect width="${layer.width}" height="${layer.height}" rx="${radius}" ry="${radius}" fill="${layer.fill}" stroke="${layer.stroke ?? 'none'}" stroke-width="${layer.strokeWidth ?? 0}" />`;
        }

        if (layer.type === 'image') {
          // Render the actual artwork when the layer has one. `src` existed on
          // the type but was never read here, so every image layer — including
          // a generated or uploaded cover — drew as the grey placeholder box
          // forever.
          if (layer.src) {
            const { fit } = imageCropDefaults(layer);
            const rect = imageFrameRect(layer);
            const clipId = `clip-${layer.id}`;
            clipDefs.push(`<clipPath id="${clipId}">${imageClipShape(layer)}</clipPath>`);
            return `<g clip-path="url(#${clipId})">`
              + `<image x="${rect.x.toFixed(2)}" y="${rect.y.toFixed(2)}" width="${rect.width.toFixed(2)}" height="${rect.height.toFixed(2)}" href="${escape(layer.src)}" preserveAspectRatio="${imagePreserveAspectRatio(fit)}"${imageTreatmentFilter(layer.treatment)} />`
              + `</g>`;
          }
          return `<rect width="${layer.width}" height="${layer.height}" fill="${document.palette.panel}" stroke="${document.palette.accent}" stroke-width="4" /><text x="${layer.width / 2}" y="${layer.height / 2}" text-anchor="middle" dominant-baseline="middle" fill="${document.palette.muted}" font-size="64" font-family="Panchang, monospace">${escape(layer.label)}</text>`;
        }

        if (layer.type === 'waveform') {
          const { barGap, cap, mirror } = waveformDefaults(layer);
          const values = waveformSeriesFor(layer);

          if (layer.mode === 'circular') {
            const size = Math.min(layer.width, layer.height);
            const spokes = circularSegments(values, size)
              .map((segment) => `<line x1="${segment.x1.toFixed(2)}" y1="${segment.y1.toFixed(2)}" x2="${segment.x2.toFixed(2)}" y2="${segment.y2.toFixed(2)}" stroke="${layer.color}" stroke-width="${Math.max(1, layer.strokeWidth / 3)}" stroke-linecap="${cap === 'round' ? 'round' : 'butt'}" />`)
              .join('');
            // Centred so a non-square layer still puts the disc in the middle.
            const offsetX = (layer.width - size) / 2;
            const offsetY = (layer.height - size) / 2;
            return `<g transform="translate(${offsetX.toFixed(2)} ${offsetY.toFixed(2)})">${spokes}</g>`;
          }

          if (layer.mode === 'contour') {
            const points = pointsAttribute(waveformPathPoints(values, layer.width, layer.height, true));
            return `<polygon points="${points}" fill="${layer.color}" />`;
          }

          if (layer.mode === 'line') {
            const points = pointsAttribute(waveformPathPoints(values, layer.width, layer.height, false));
            return `<polyline points="${points}" fill="none" stroke="${layer.color}" stroke-width="${Math.max(1, layer.strokeWidth / 2)}" stroke-linejoin="round" stroke-linecap="round" />`;
          }

          // Every remaining mode draws bars. `blocks` squares them off and
          // drops the gap for a solid, printed-block look.
          const blocks = layer.mode === 'blocks';
          const slots = barSlots(layer.width, values.length, blocks ? 0.08 : barGap);
          return slots.map((slot, index) => {
            const rect = barRect(slot, values[index], layer.height, mirror);
            const radius = blocks ? 0 : capRadius(rect, cap);
            return `<rect x="${rect.x.toFixed(2)}" y="${rect.y.toFixed(2)}" width="${rect.width.toFixed(2)}" height="${rect.height.toFixed(2)}" rx="${radius.toFixed(2)}" ry="${radius.toFixed(2)}" fill="${layer.color}" />`;
          }).join('');
        }

        if (layer.type === 'texture') {
          return `<rect width="${layer.width}" height="${layer.height}" fill="${textureFill(layer.texture)}" />`;
        }

        const text = layer.uppercase ? layer.text.toUpperCase() : layer.text;
        const anchor = layer.align === 'center' ? 'middle' : layer.align === 'right' ? 'end' : 'start';
        const x = layer.align === 'center' ? layer.width / 2 : layer.align === 'right' ? layer.width : 0;

        /**
         * Type on a curve.
         *
         * The `d` comes from `lib/cover/text-path.ts`, which the canvas calls
         * with the same arguments — so both surfaces run an identical path
         * through an identical `<textPath>` rather than one approximating the
         * other. Fonts still embed normally: this is a `<text>` element, so
         * `collectUsedFontAssets` already accounts for it.
         */
        const curve = textPathD(textPathDefaults(layer.path), layer.width, layer.height);
        if (curve) {
          const place = textPathPlacement(layer.align);
          const strokeAttrs = layer.stroke && (layer.strokeWidth ?? 0) > 0
            ? ` stroke="${layer.stroke}" stroke-width="${layer.strokeWidth}" paint-order="stroke"`
            : '';
          textPathDefs.push(`<path id="tp-${layer.id}" d="${curve}" fill="none" />`);
          return `<text style="font-weight:${textWeightFor(layer)}" text-anchor="${place.anchor}"`
            + ` fill="${layer.color}"${strokeAttrs} font-size="${layer.fontSize}"`
            + ` font-family="${fontFor(layer)}" letter-spacing="${layer.tracking}">`
            + `<textPath href="#tp-${layer.id}" startOffset="${place.startOffset}">`
            + `${escape(flattenForPath(text))}</textPath></text>`;
        }
        // Multi-line text: SVG has no wrapping, so explicit newlines become
        // <tspan> rows. Without this a two-line title rendered as one long line
        // in the export while the canvas showed two.
        const lines = text.split('\n');
        const stroke = layer.stroke && (layer.strokeWidth ?? 0) > 0
          ? ` stroke="${layer.stroke}" stroke-width="${layer.strokeWidth}" paint-order="stroke"`
          : '';
        const tspans = lines
          .map((line, index) => `<tspan x="${x}" dy="${index === 0 ? 0 : layer.fontSize * layer.lineHeight}">${escape(line)}</tspan>`)
          .join('');
        return `<text style="font-weight:${textWeightFor(layer)}" y="${layer.fontSize}" text-anchor="${anchor}" fill="${layer.color}"${stroke} font-size="${layer.fontSize}" font-family="${fontFor(layer)}" letter-spacing="${layer.tracking}">${tspans}</text>`;
      };

      const fxId = `fx-${layer.id}`;
      const filterDef = buildFxFilterDef(layer.fx, fxId, 1, Math.min(layer.width, layer.height));
      if (filterDef) fxDefs.push(filterDef);
      const body = filterDef ? `<g filter="url(#${fxId})">${content()}</g>` : content();

      /**
       * Vignette sits OUTSIDE the filter group on purpose. Inside it, the
       * layer's own blur or grain would smear the vignette too, so the corner
       * falloff would soften as you raised an unrelated slider.
       */
      const { vignette } = fxDefaults(layer.fx);
      let vignetteMarkup = '';
      if (vignette > 0) {
        const vignetteId = `vig-${layer.id}`;
        fxDefs.push(vignetteSvgGradientDef(vignette, vignetteId));
        // Follow the image's crop so a circular photo gets a circular vignette.
        const clip = layer.type === 'image' && layer.src ? ` clip-path="url(#clip-${layer.id})"` : '';
        vignetteMarkup = `<rect width="${layer.width}" height="${layer.height}" fill="url(#${vignetteId})"${clip} />`;
      }

      // A group gets NO transform: its children hold absolute document
      // coordinates, so transforming the wrapper would move them twice.
      const placement = layer.type === 'group' ? '' : ` transform="${transform}"`;
      return `<g opacity="${layer.opacity}" style="mix-blend-mode:${layer.blendMode}"${placement}>${body}${vignetteMarkup}</g>`;
    }
  }

  const layerMarkup = renderList(topLevelLayers(document.layers));

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${document.width}" height="${document.height}" viewBox="0 0 ${document.width} ${document.height}">
  <defs>
    <pattern id="paperGrain" width="80" height="80" patternUnits="userSpaceOnUse">
      <rect width="80" height="80" fill="${document.palette.text}" opacity="0.04" />
      <path d="M0 13H80M0 47H80M11 0V80M53 0V80" stroke="${document.palette.muted}" stroke-width="1" opacity="0.16" />
    </pattern>${texturePatternDefs(document.palette)}
    ${clipDefs.join('\n    ')}
    <filter id="imgDuotone">
      <feColorMatrix type="saturate" values="0" />
      <feComponentTransfer>
        <feFuncR type="table" tableValues="${hexChannel(document.palette.background, 0)} ${hexChannel(document.palette.accent, 0)}" />
        <feFuncG type="table" tableValues="${hexChannel(document.palette.background, 1)} ${hexChannel(document.palette.accent, 1)}" />
        <feFuncB type="table" tableValues="${hexChannel(document.palette.background, 2)} ${hexChannel(document.palette.accent, 2)}" />
      </feComponentTransfer>
    </filter>
    <filter id="imgMineral">
      <feColorMatrix type="saturate" values="0.35" />
    </filter>
    <filter id="imgHighContrast">
      <feComponentTransfer>
        <feFuncR type="linear" slope="1.6" intercept="-0.3" />
        <feFuncG type="linear" slope="1.6" intercept="-0.3" />
        <feFuncB type="linear" slope="1.6" intercept="-0.3" />
      </feComponentTransfer>
    </filter>
    <filter id="imgGrayscale">
      <feColorMatrix type="saturate" values="0" />
    </filter>
    <filter id="imgBleach">
      <feColorMatrix type="saturate" values="0.15" />
      <feComponentTransfer>
        <feFuncR type="linear" slope="1.15" intercept="0.12" />
        <feFuncG type="linear" slope="1.15" intercept="0.12" />
        <feFuncB type="linear" slope="1.15" intercept="0.10" />
      </feComponentTransfer>
    </filter>
    ${textPathDefs.join('\n    ')}
    ${fxDefs.join('\n    ')}
  </defs>
  ${options.transparent ? '' : `<rect width="${document.width}" height="${document.height}" fill="${document.background}" />`}
  ${layerMarkup}
</svg>`;
}

/* ── Layer factories ───────────────────────────────────────────────────────
 *
 * Every "Add …" action in the studio comes through here. Centralising it means
 * a new layer is always well-formed — the old editor had no add path at all, so
 * the only layers that ever existed were the seven a template produced, and
 * anything the producer wanted beyond that was impossible.
 *
 * New layers land centred in the artboard at a readable size rather than at
 * 0,0 — a layer you have to hunt for reads as a bug.
 */

function nextZIndex(layers: ArtworkLayer[]) {
  return layers.reduce((max, layer) => Math.max(max, layer.zIndex), -1) + 1;
}

function freshId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function layerBase(
  document: ArtworkDocument,
  type: ArtworkLayerType,
  name: string,
  width: number,
  height: number,
): ArtworkLayerBase {
  return {
    id: freshId(type),
    name,
    type,
    x: Math.round((document.width - width) / 2),
    y: Math.round((document.height - height) / 2),
    width,
    height,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    zIndex: nextZIndex(document.layers),
    blendMode: 'normal',
  };
}

export function createTextLayer(
  document: ArtworkDocument,
  text = 'NEW TEXT',
  overrides: Partial<TextArtworkLayer> = {},
): TextArtworkLayer {
  return {
    ...layerBase(document, 'text', 'Text', Math.round(document.width * 0.72), 320),
    type: 'text',
    text,
    fontFamily: 'artwork',
    fontSize: 200,
    tracking: -2,
    lineHeight: 0.98,
    align: 'left',
    uppercase: true,
    color: document.palette.text,
    ...overrides,
  };
}

export function createImageLayer(
  document: ArtworkDocument,
  src: string,
  label = 'Image',
  overrides: Partial<ImageArtworkLayer> = {},
): ImageArtworkLayer {
  const size = Math.round(document.width * 0.56);
  return {
    ...layerBase(document, 'image', label, size, size),
    type: 'image',
    src,
    label,
    treatment: 'normal',
    fit: 'cover',
    offsetX: 0,
    offsetY: 0,
    scale: 1,
    radius: 0,
    mask: 'none',
    ...overrides,
  };
}

export function createShapeLayer(
  document: ArtworkDocument,
  shape: ShapeArtworkLayer['shape'] = 'rect',
  overrides: Partial<ShapeArtworkLayer> = {},
): ShapeArtworkLayer {
  const width = shape === 'rule' ? Math.round(document.width * 0.68) : Math.round(document.width * 0.42);
  const height = shape === 'rule' ? 12 : Math.round(document.width * 0.42);
  return {
    ...layerBase(document, 'shape', shape === 'rule' ? 'Rule' : shape === 'circle' ? 'Circle' : shape === 'triangle' ? 'Triangle' : 'Rectangle', width, height),
    type: 'shape',
    shape,
    fill: document.palette.accent,
    cornerRadius: 0,
    ...overrides,
  };
}

export function createTextureLayer(
  document: ArtworkDocument,
  texture: ArtworkTextureKind = 'paper-grain',
  overrides: Partial<TextureArtworkLayer> = {},
): TextureArtworkLayer {
  return {
    ...layerBase(document, 'texture', 'Texture', document.width, document.height),
    type: 'texture',
    x: 0,
    y: 0,
    texture,
    intensity: 0.34,
    opacity: 0.18,
    blendMode: 'overlay',
    ...overrides,
  };
}

export function createWaveformLayer(
  document: ArtworkDocument,
  overrides: Partial<WaveformArtworkLayer> = {},
): WaveformArtworkLayer {
  const existing = document.layers.find((layer): layer is WaveformArtworkLayer => layer.type === 'waveform');
  return {
    ...layerBase(document, 'waveform', 'Waveform', Math.round(document.width * 0.76), 320),
    type: 'waveform',
    mode: 'linear',
    style: 'low-scanline',
    amplitude: 0.92,
    strokeWidth: 16,
    smoothing: 0.12,
    color: document.palette.accent,
    barCount: suggestedBarCount(Math.round(document.width * 0.76)),
    barGap: 0.32,
    cap: 'round',
    normalize: true,
    mirror: true,
    // Reuse peaks already loaded for this document so a second waveform layer
    // shows the real track rather than dropping back to the synthetic pattern.
    bpm: existing?.bpm ?? null,
    durationSeconds: existing?.durationSeconds ?? null,
    peakSource: existing?.peakSource ?? 'preview',
    peaks: existing?.peaks ?? createPreviewPeaks(document.name, 96),
    ...overrides,
  };
}

/* ── Document operations ───────────────────────────────────────────────── */

export function addLayer(document: ArtworkDocument, layer: ArtworkLayer): ArtworkDocument {
  return { ...document, layers: [...document.layers, layer], updatedAt: new Date().toISOString() };
}

/**
 * Locked layers are skipped rather than deleted — that is what the lock is for.
 *
 * Deleting a group takes its contents with it. Leaving orphaned children behind
 * with a `parentId` pointing at nothing would make them invisible: every render
 * path walks down from the top level, so a layer whose parent no longer exists
 * is never reached and simply vanishes without being gone.
 */
export function removeLayers(document: ArtworkDocument, ids: string[]): ArtworkDocument {
  const removable = new Set(
    document.layers.filter((layer) => ids.includes(layer.id) && !layer.locked).map((layer) => layer.id),
  );
  if (removable.size === 0) return document;

  for (const id of [...removable]) {
    const layer = document.layers.find((item) => item.id === id);
    if (layer?.type === 'group') {
      // A locked child inside a deleted group still goes: the group it lived
      // in is being removed, and there is nowhere for it to remain.
      for (const descendant of descendantIds(document.layers, id)) removable.add(descendant);
    }
  }

  return {
    ...document,
    layers: document.layers.filter((layer) => !removable.has(layer.id)),
    updatedAt: new Date().toISOString(),
  };
}

/** Copies are offset so the duplicate is visibly on top, not hidden underneath. */
export function duplicateLayers(
  document: ArtworkDocument,
  ids: string[],
  offset = 80,
): { document: ArtworkDocument; ids: string[] } {
  // Duplicating a group duplicates what is inside it. The descendants are
  // added to the copy set but NOT returned as separate selections — selecting
  // both a copied group and its copied children would make the next drag move
  // everything twice.
  const roots = document.layers.filter((layer) => ids.includes(layer.id));
  if (roots.length === 0) return { document, ids: [] };

  const wanted = new Set(roots.map((layer) => layer.id));
  for (const root of roots) {
    if (root.type === 'group') {
      for (const descendant of descendantIds(document.layers, root.id)) wanted.add(descendant);
    }
  }
  const originals = document.layers.filter((layer) => wanted.has(layer.id));

  // Old id → new id, so a copied child can be re-pointed at the copied group
  // rather than at the original one it came from.
  const remap = new Map<string, string>();
  originals.forEach((layer) => remap.set(layer.id, freshId(`${layer.type}-copy`)));

  const rootIds = new Set(roots.map((layer) => layer.id));
  let z = nextZIndex(document.layers);
  const clones = originals.map((layer) => {
    const clone = {
      ...structuredClone(layer),
      id: remap.get(layer.id)!,
      name: `${layer.name} copy`,
      // EVERY copied layer is offset, descendants included. A group draws
      // nothing itself — its children are the visual — so offsetting only the
      // group would leave the duplicate sitting exactly on top of the original
      // and looking like nothing happened. Each layer is offset once, so a
      // subtree moves as a unit rather than accumulating.
      x: layer.x + offset,
      y: layer.y + offset,
      locked: false,
      parentId: layer.parentId && remap.has(layer.parentId)
        ? remap.get(layer.parentId)
        : layer.parentId,
      zIndex: rootIds.has(layer.id) ? z++ : layer.zIndex,
    } as ArtworkLayer;
    return clone;
  });

  return {
    document: { ...document, layers: [...document.layers, ...clones], updatedAt: new Date().toISOString() },
    ids: roots.map((layer) => remap.get(layer.id)!),
  };
}

export type LayerReorder = 'front' | 'back' | 'forward' | 'backward';

export function reorderLayer(layers: ArtworkLayer[], id: string, move: LayerReorder): ArtworkLayer[] {
  if (move === 'forward') return moveLayer(layers, id, 1);
  if (move === 'backward') return moveLayer(layers, id, -1);

  const target = layers.find((layer) => layer.id === id);
  if (!target) return layers;
  // Front and back mean "of my siblings", for the same reason as `moveLayer`:
  // sending a layer inside a group to the front should put it in front of the
  // group's other contents, not rip it out to the front of the document.
  const siblings = sortArtworkLayers(layers.filter((layer) => layer.parentId === target.parentId));
  const rest = siblings.filter((layer) => layer.id !== id);
  const next = move === 'front' ? [...rest, target] : [target, ...rest];
  const order = new Map(next.map((layer, zIndex) => [layer.id, zIndex]));
  return layers.map((layer) => (
    order.has(layer.id) ? { ...layer, zIndex: order.get(layer.id)! } : layer
  ));
}

export type LayerAlignment = 'left' | 'center-x' | 'right' | 'top' | 'center-y' | 'bottom';

/**
 * Align layers to the artboard when one is selected, or to the selection's own
 * bounding box when several are. That is the behaviour every design tool has,
 * and the one that makes "align left" useful in both situations.
 */
export function alignLayers(
  document: ArtworkDocument,
  ids: string[],
  alignment: LayerAlignment,
): ArtworkDocument {
  const targets = document.layers.filter((layer) => ids.includes(layer.id) && !layer.locked);
  if (targets.length === 0) return document;

  const bounds = targets.length > 1
    ? {
      left: Math.min(...targets.map((layer) => layer.x)),
      top: Math.min(...targets.map((layer) => layer.y)),
      right: Math.max(...targets.map((layer) => layer.x + layer.width)),
      bottom: Math.max(...targets.map((layer) => layer.y + layer.height)),
    }
    : { left: 0, top: 0, right: document.width, bottom: document.height };

  const moved = new Map(targets.map((layer) => {
    switch (alignment) {
      case 'left': return [layer.id, { x: bounds.left }];
      case 'right': return [layer.id, { x: bounds.right - layer.width }];
      case 'center-x': return [layer.id, { x: Math.round((bounds.left + bounds.right - layer.width) / 2) }];
      case 'top': return [layer.id, { y: bounds.top }];
      case 'bottom': return [layer.id, { y: bounds.bottom - layer.height }];
      case 'center-y': return [layer.id, { y: Math.round((bounds.top + bounds.bottom - layer.height) / 2) }];
      default: return [layer.id, {}];
    }
  }));

  return {
    ...document,
    layers: document.layers.map((layer) => (moved.has(layer.id) ? { ...layer, ...moved.get(layer.id) } : layer)),
    updatedAt: new Date().toISOString(),
  };
}

/** Even gaps between three or more layers along one axis. */
export function distributeLayers(
  document: ArtworkDocument,
  ids: string[],
  axis: 'x' | 'y',
): ArtworkDocument {
  const targets = document.layers
    .filter((layer) => ids.includes(layer.id) && !layer.locked)
    .sort((a, b) => (axis === 'x' ? a.x - b.x : a.y - b.y));
  if (targets.length < 3) return document;

  const sizeKey = axis === 'x' ? 'width' : 'height';
  const first = targets[0];
  const last = targets[targets.length - 1];
  const span = (last[axis] + last[sizeKey]) - first[axis];
  const used = targets.reduce((total, layer) => total + layer[sizeKey], 0);
  const gap = (span - used) / (targets.length - 1);

  let cursor = first[axis];
  const placed = new Map<string, number>();
  targets.forEach((layer) => {
    placed.set(layer.id, Math.round(cursor));
    cursor += layer[sizeKey] + gap;
  });

  return {
    ...document,
    layers: document.layers.map((layer) => (
      placed.has(layer.id) ? { ...layer, [axis]: placed.get(layer.id)! } : layer
    )),
    updatedAt: new Date().toISOString(),
  };
}
