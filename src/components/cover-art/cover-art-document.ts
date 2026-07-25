import type { CoverArtTemplateId, CoverArtWaveformStyle } from '@/design-system';

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

export type ArtworkLayerType = 'text' | 'shape' | 'waveform' | 'texture' | 'image';

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
  blendMode: 'normal' | 'multiply' | 'screen' | 'overlay' | 'soft-light';
};

export type TextArtworkLayer = ArtworkLayerBase & {
  type: 'text';
  text: string;
  fontFamily: 'display' | 'artwork' | 'ui' | 'mono';
  fontSize: number;
  tracking: number;
  lineHeight: number;
  align: 'left' | 'center' | 'right';
  uppercase: boolean;
  color: string;
};

export type ShapeArtworkLayer = ArtworkLayerBase & {
  type: 'shape';
  shape: 'rect' | 'circle' | 'rule';
  fill: string;
  stroke?: string;
  strokeWidth?: number;
};

export type WaveformArtworkLayer = ArtworkLayerBase & {
  type: 'waveform';
  mode: 'linear' | 'circular' | 'spectral-bars' | 'contour';
  style: CoverArtWaveformStyle;
  amplitude: number;
  strokeWidth: number;
  smoothing: number;
  color: string;
  bpm?: number | null;
  durationSeconds?: number | null;
  peakSource: 'real' | 'preview';
  peaks: number[];
};

export type TextureArtworkLayer = ArtworkLayerBase & {
  type: 'texture';
  texture: 'paper-grain' | 'basalt-noise' | 'scan-grain';
  intensity: number;
};

export type ImageArtworkLayer = ArtworkLayerBase & {
  type: 'image';
  src?: string;
  label: string;
  treatment: 'normal' | 'duotone' | 'mineral-tint' | 'high-contrast';
};

export type ArtworkLayer =
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
  createdAt: string;
  updatedAt: string;
};

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
  background: '#080806',
  panel: '#1B1A15',
  text: '#EEE8DD',
  muted: '#706B61',
  accent: '#C7B89D',
  secondary: '#A95235',
  waveformLow: '#3C78A8',
  waveformHigh: '#73A5B5',
};

export const coverArtDirections: CoverArtDirection[] = [
  {
    id: 'brutalist-archive',
    name: 'Brutalist Archive',
    templateId: 'de-roche-archive',
    palette: { ...defaultArtworkPalette, background: '#0D0D0A', panel: '#DED1B8', text: '#EEE8DD', accent: '#C7B89D' },
    typography: 'Compressed editorial title with restrained metadata.',
    material: 'Paper grain, crop marks, archival catalogue spacing.',
    rationale: 'Best for beats that need a serious collector-grade sleeve.',
  },
  {
    id: 'de-roche-mineral',
    name: 'De Roche Mineral',
    templateId: 'image-mask',
    palette: { ...defaultArtworkPalette, background: '#080806', panel: '#151510', accent: '#C7B89D', secondary: '#4B3524' },
    typography: 'Quiet luxury display type balanced with clean UI labels.',
    material: 'Stone tint, masked imagery, mineral edge contrast.',
    rationale: 'Turns cover art into a dark mineral object without losing readability.',
  },
  {
    id: 'industrial-editorial',
    name: 'Industrial Editorial',
    templateId: 'poster-deconstruction',
    palette: { ...defaultArtworkPalette, background: '#0D0D0A', accent: '#A95235', secondary: '#926F82' },
    typography: 'Large offset display text with utility metadata rails.',
    material: 'Halftone structure, rules, stamped production labels.',
    rationale: 'Useful for aggressive records that need motion and pressure.',
  },
  {
    id: 'spectral-night',
    name: 'Spectral Night',
    templateId: 'dark-listening-room',
    palette: { ...defaultArtworkPalette, background: '#080806', accent: '#73A5B5', secondary: '#3C78A8' },
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
        mode: direction.id === 'spectral-night' ? 'spectral-bars' : 'linear',
        style: direction.id === 'brutalist-archive' ? 'document-rule' : 'low-scanline',
        amplitude: 0.66,
        strokeWidth: 16,
        smoothing: 0.42,
        color: direction.palette.waveformHigh,
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
        fontFamily: 'mono',
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

export function sortArtworkLayers(layers: ArtworkLayer[]) {
  return [...layers].sort((a, b) => a.zIndex - b.zIndex);
}

export function moveLayer(layers: ArtworkLayer[], id: string, delta: -1 | 1) {
  const sorted = sortArtworkLayers(layers);
  const index = sorted.findIndex((layer) => layer.id === id);
  const nextIndex = index + delta;
  if (index < 0 || nextIndex < 0 || nextIndex >= sorted.length) return layers;

  const next = [...sorted];
  [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
  return next.map((layer, zIndex) => ({ ...layer, zIndex }));
}

export type DawWaveformBar = {
  index: number;
  height: number;
  lane: 'low' | 'mid' | 'high';
  beat: boolean;
  transient: boolean;
};

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

export function createDawWaveformBars({
  peaks,
  bpm,
  durationSeconds,
  count = 64,
  sensitivity = 1,
}: {
  peaks: number[];
  bpm?: number | null;
  durationSeconds?: number | null;
  count?: number;
  sensitivity?: number;
}): DawWaveformBar[] {
  const source = peaks.length > 0 ? peaks : createPreviewPeaks('empty', count);
  const bars = Array.from({ length: count }, (_, index) => {
    const position = count === 1 ? 0 : index / (count - 1);
    const sourceIndex = position * (source.length - 1);
    const low = Math.floor(sourceIndex);
    const high = Math.min(source.length - 1, low + 1);
    const mix = sourceIndex - low;
    const value = Math.abs((source[low] ?? 0) * (1 - mix) + (source[high] ?? 0) * mix);
    return Math.min(1, Math.max(0.05, value * sensitivity));
  });

  const seconds = durationSeconds && durationSeconds > 0 ? durationSeconds : null;
  const beats = bpm && bpm > 0 && seconds ? Math.max(1, (bpm / 60) * seconds) : count / 4;
  const barsPerBeat = Math.max(1, count / beats);

  return bars.map((height, index) => {
    const previous = bars[Math.max(0, index - 1)] ?? height;
    const next = bars[Math.min(bars.length - 1, index + 1)] ?? height;
    const transient = height - Math.max(previous, next) * 0.72 > 0.16;
    const beat = Math.abs(index / barsPerBeat - Math.round(index / barsPerBeat)) < 0.18;
    const lane = index % 6 === 0 || beat ? 'low' : index % 3 === 0 ? 'mid' : 'high';
    return {
      index,
      height: Number(height.toFixed(4)),
      lane,
      beat,
      transient,
    };
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

export function renderArtworkDocumentSvg(document: ArtworkDocument) {
  const fontFor = (layer: TextArtworkLayer) => {
    if (layer.fontFamily === 'mono') return 'Panchang, monospace';
    if (layer.fontFamily === 'ui') return 'Inter, sans-serif';
    return 'Synkopy, Akira Expanded, sans-serif';
  };

  const escape = (value: string) => value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

  const layerMarkup = sortArtworkLayers(document.layers)
    .filter((layer) => layer.visible)
    .map((layer) => {
      const transform = `translate(${layer.x} ${layer.y}) rotate(${layer.rotation} ${layer.width / 2} ${layer.height / 2})`;
      const common = `opacity="${layer.opacity}" style="mix-blend-mode:${layer.blendMode}" transform="${transform}"`;
      if (layer.type === 'shape') {
        if (layer.shape === 'circle') {
          return `<ellipse ${common} cx="${layer.width / 2}" cy="${layer.height / 2}" rx="${layer.width / 2}" ry="${layer.height / 2}" fill="${layer.fill}" stroke="${layer.stroke ?? 'none'}" stroke-width="${layer.strokeWidth ?? 0}" />`;
        }
        return `<rect ${common} width="${layer.width}" height="${layer.height}" fill="${layer.fill}" stroke="${layer.stroke ?? 'none'}" stroke-width="${layer.strokeWidth ?? 0}" />`;
      }
      if (layer.type === 'image') {
        return `<rect ${common} width="${layer.width}" height="${layer.height}" fill="${document.palette.panel}" stroke="${document.palette.accent}" stroke-width="4" /><text ${common} x="${layer.width / 2}" y="${layer.height / 2}" text-anchor="middle" dominant-baseline="middle" fill="${document.palette.muted}" font-size="64" font-family="Panchang, monospace">${escape(layer.label)}</text>`;
      }
      if (layer.type === 'waveform') {
        const bars = createDawWaveformBars({
          peaks: layer.peaks,
          bpm: layer.bpm,
          durationSeconds: layer.durationSeconds,
          count: 64,
          sensitivity: layer.amplitude,
        }).map((bar) => {
          const height = 42 + bar.height * layer.height;
          const barWidth = Math.max(4, layer.strokeWidth);
          const x = (bar.index / 64) * layer.width;
          const y = (layer.height - height) / 2;
          const fill = bar.lane === 'low' ? document.palette.waveformLow : bar.lane === 'mid' ? layer.color : document.palette.waveformHigh;
          return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth}" height="${height.toFixed(1)}" fill="${fill}" opacity="${bar.beat ? 1 : 0.72}" />`;
        }).join('');
        return `<g ${common}>${bars}</g>`;
      }
      if (layer.type === 'texture') {
        return `<rect ${common} width="${layer.width}" height="${layer.height}" fill="url(#paperGrain)" />`;
      }
      const text = layer.uppercase ? layer.text.toUpperCase() : layer.text;
      const anchor = layer.align === 'center' ? 'middle' : layer.align === 'right' ? 'end' : 'start';
      const x = layer.align === 'center' ? layer.width / 2 : layer.align === 'right' ? layer.width : 0;
      return `<text ${common} x="${x}" y="${layer.fontSize}" text-anchor="${anchor}" fill="${layer.color}" font-size="${layer.fontSize}" font-family="${fontFor(layer)}" letter-spacing="${layer.tracking}" style="font-weight:700">${escape(text)}</text>`;
    })
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${document.width}" height="${document.height}" viewBox="0 0 ${document.width} ${document.height}">
  <defs>
    <pattern id="paperGrain" width="80" height="80" patternUnits="userSpaceOnUse">
      <rect width="80" height="80" fill="${document.palette.text}" opacity="0.04" />
      <path d="M0 13H80M0 47H80M11 0V80M53 0V80" stroke="${document.palette.muted}" stroke-width="1" opacity="0.16" />
    </pattern>
  </defs>
  <rect width="${document.width}" height="${document.height}" fill="${document.background}" />
  ${layerMarkup}
</svg>`;
}
