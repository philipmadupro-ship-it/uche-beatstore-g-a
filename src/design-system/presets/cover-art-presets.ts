export type CoverArtTemplateId =
  | 'de-roche-archive'
  | 'dark-listening-room'
  | 'contact-sheet'
  | 'audio-document'
  | 'poster-deconstruction'
  | 'image-mask';

export type CoverArtMood = 'editorial' | 'nocturne' | 'utility' | 'technical' | 'poster' | 'image-led';
export type CoverArtWaveformStyle = 'none' | 'low-scanline' | 'center-mask' | 'edge-meter' | 'document-rule';
export type CoverArtMetadataMode = 'minimal' | 'catalog' | 'technical' | 'full';
export type CoverArtSafeArea = 'standard' | 'tight' | 'social-safe' | 'banner-safe';

export type CoverArtTemplate = {
  id: CoverArtTemplateId;
  name: string;
  mood: CoverArtMood;
  beginnerLabel: string;
  description: string;
  layout: {
    grid: 'centered' | 'asymmetric' | 'modular' | 'document' | 'fragmented' | 'masked';
    imageRole: 'none' | 'background' | 'panel' | 'contact-strip' | 'masked-subject';
    titlePlacement: 'center' | 'upper-left' | 'lower-left' | 'right-rail' | 'split';
    metadataMode: CoverArtMetadataMode;
    waveformStyle: CoverArtWaveformStyle;
    safeArea: CoverArtSafeArea;
  };
  tokens: {
    background: string;
    foreground: string;
    accent: string;
    secondaryAccent: string;
  };
  defaultControls: {
    blendMode: 'normal' | 'multiply' | 'screen' | 'soft-light' | 'overlay';
    texture: 'paper-grain' | 'basalt-noise' | 'scan-grain' | 'none';
    cropMarks: boolean;
    showSafeArea: boolean;
  };
};

export type CoverArtExportPresetId =
  | 'square-cover'
  | 'streaming-cover'
  | 'social-post'
  | 'youtube-thumbnail'
  | 'beat-store-card'
  | 'store-banner'
  | 'playlist-cover'
  | 'download-artwork';

export type CoverArtExportPreset = {
  id: CoverArtExportPresetId;
  name: string;
  width: number;
  height: number;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  quality: number;
  safeAreaInsetPct: number;
  intendedUse: string;
};

export type CoverArtArtworkSource = {
  source: 'local-upload';
  name: string;
  mimeType: string;
  sizeBytes: number;
  dataUrl?: string;
};

export type CoverArtSourceConfig = {
  templateId: CoverArtTemplateId;
  exportPresetId: CoverArtExportPresetId;
  title: string;
  subtitle?: string;
  producerName?: string;
  bpm?: number;
  musicalKey?: string;
  colorVariation: 'theme' | 'original' | 'luxury-beige';
  waveformVariation: CoverArtWaveformStyle;
  artwork?: CoverArtArtworkSource;
  preserveSource: true;
};

export const coverArtTemplates: Record<CoverArtTemplateId, CoverArtTemplate> = {
  'de-roche-archive': {
    id: 'de-roche-archive',
    name: 'De Roche Archive',
    mood: 'editorial',
    beginnerLabel: 'Archive',
    description: 'A restrained catalogue cover with warm paper contrast, crop marks, and sparse technical metadata.',
    layout: {
      grid: 'document',
      imageRole: 'panel',
      titlePlacement: 'upper-left',
      metadataMode: 'catalog',
      waveformStyle: 'document-rule',
      safeArea: 'standard',
    },
    tokens: {
      background: 'var(--background-primary)',
      foreground: 'var(--text-primary)',
      accent: 'var(--brand-primary)',
      secondaryAccent: 'var(--text-tertiary)',
    },
    defaultControls: {
      blendMode: 'multiply',
      texture: 'paper-grain',
      cropMarks: true,
      showSafeArea: true,
    },
  },
  'dark-listening-room': {
    id: 'dark-listening-room',
    name: 'Dark Listening Room',
    mood: 'nocturne',
    beginnerLabel: 'Room',
    description: 'A deep near-black cover treatment with image glow held behind centered title and a quiet waveform bed.',
    layout: {
      grid: 'centered',
      imageRole: 'background',
      titlePlacement: 'center',
      metadataMode: 'minimal',
      waveformStyle: 'low-scanline',
      safeArea: 'standard',
    },
    tokens: {
      background: 'var(--background-recessed)',
      foreground: 'var(--text-primary)',
      accent: 'var(--brand-primary)',
      secondaryAccent: 'var(--wave-mid)',
    },
    defaultControls: {
      blendMode: 'soft-light',
      texture: 'basalt-noise',
      cropMarks: false,
      showSafeArea: true,
    },
  },
  'contact-sheet': {
    id: 'contact-sheet',
    name: 'Contact Sheet',
    mood: 'utility',
    beginnerLabel: 'Sheet',
    description: 'A modular grid for beat packs, snippets, stems, or alternate covers with track metadata anchored below.',
    layout: {
      grid: 'modular',
      imageRole: 'contact-strip',
      titlePlacement: 'lower-left',
      metadataMode: 'full',
      waveformStyle: 'edge-meter',
      safeArea: 'social-safe',
    },
    tokens: {
      background: 'var(--surface-primary)',
      foreground: 'var(--text-primary)',
      accent: 'var(--brand-primary)',
      secondaryAccent: 'var(--border-strong)',
    },
    defaultControls: {
      blendMode: 'normal',
      texture: 'scan-grain',
      cropMarks: true,
      showSafeArea: true,
    },
  },
  'audio-document': {
    id: 'audio-document',
    name: 'Audio Document',
    mood: 'technical',
    beginnerLabel: 'Document',
    description: 'A metadata-forward sleeve with BPM, key, license tier, and waveform treated like an archival audio record.',
    layout: {
      grid: 'document',
      imageRole: 'none',
      titlePlacement: 'upper-left',
      metadataMode: 'technical',
      waveformStyle: 'document-rule',
      safeArea: 'standard',
    },
    tokens: {
      background: 'var(--background-primary)',
      foreground: 'var(--text-primary)',
      accent: 'var(--brand-primary)',
      secondaryAccent: 'var(--wave-high)',
    },
    defaultControls: {
      blendMode: 'normal',
      texture: 'paper-grain',
      cropMarks: true,
      showSafeArea: true,
    },
  },
  'poster-deconstruction': {
    id: 'poster-deconstruction',
    name: 'Poster Deconstruction',
    mood: 'poster',
    beginnerLabel: 'Poster',
    description: 'A fractured poster composition with oversized type, offset metadata, and a controlled spectral accent.',
    layout: {
      grid: 'fragmented',
      imageRole: 'panel',
      titlePlacement: 'split',
      metadataMode: 'catalog',
      waveformStyle: 'center-mask',
      safeArea: 'tight',
    },
    tokens: {
      background: 'var(--background-primary)',
      foreground: 'var(--text-primary)',
      accent: 'var(--brand-primary)',
      secondaryAccent: 'var(--wave-low-mid)',
    },
    defaultControls: {
      blendMode: 'overlay',
      texture: 'basalt-noise',
      cropMarks: false,
      showSafeArea: true,
    },
  },
  'image-mask': {
    id: 'image-mask',
    name: 'Image Mask',
    mood: 'image-led',
    beginnerLabel: 'Mask',
    description: 'A cover-led template where imported artwork is masked by the waveform and protected by safe contrast overlays.',
    layout: {
      grid: 'masked',
      imageRole: 'masked-subject',
      titlePlacement: 'right-rail',
      metadataMode: 'minimal',
      waveformStyle: 'center-mask',
      safeArea: 'social-safe',
    },
    tokens: {
      background: 'var(--background-recessed)',
      foreground: 'var(--text-primary)',
      accent: 'var(--brand-primary)',
      secondaryAccent: 'var(--wave-high-mid)',
    },
    defaultControls: {
      blendMode: 'screen',
      texture: 'none',
      cropMarks: false,
      showSafeArea: true,
    },
  },
} as const;

export const coverArtExportPresets: Record<CoverArtExportPresetId, CoverArtExportPreset> = {
  'square-cover': {
    id: 'square-cover',
    name: 'Square Cover',
    width: 1600,
    height: 1600,
    mimeType: 'image/png',
    quality: 1,
    safeAreaInsetPct: 8,
    intendedUse: 'Primary beat artwork and store detail pages.',
  },
  'streaming-cover': {
    id: 'streaming-cover',
    name: 'Streaming Cover',
    width: 3000,
    height: 3000,
    mimeType: 'image/jpeg',
    quality: 0.92,
    safeAreaInsetPct: 10,
    intendedUse: 'DSP-ready release artwork with conservative title safe area.',
  },
  'social-post': {
    id: 'social-post',
    name: 'Social Post',
    width: 1080,
    height: 1350,
    mimeType: 'image/jpeg',
    quality: 0.9,
    safeAreaInsetPct: 12,
    intendedUse: 'Vertical social feed announcement.',
  },
  'youtube-thumbnail': {
    id: 'youtube-thumbnail',
    name: 'YouTube Thumbnail',
    width: 1280,
    height: 720,
    mimeType: 'image/jpeg',
    quality: 0.9,
    safeAreaInsetPct: 9,
    intendedUse: 'Landscape video thumbnail with title kept out of edge chrome.',
  },
  'beat-store-card': {
    id: 'beat-store-card',
    name: 'Beat Store Card',
    width: 1200,
    height: 900,
    mimeType: 'image/webp',
    quality: 0.86,
    safeAreaInsetPct: 8,
    intendedUse: 'Store grid/list artwork optimized for fast loading.',
  },
  'store-banner': {
    id: 'store-banner',
    name: 'Store Banner',
    width: 2400,
    height: 900,
    mimeType: 'image/webp',
    quality: 0.86,
    safeAreaInsetPct: 14,
    intendedUse: 'Wide storefront, project, or playlist banner.',
  },
  'playlist-cover': {
    id: 'playlist-cover',
    name: 'Playlist Cover',
    width: 1600,
    height: 1600,
    mimeType: 'image/webp',
    quality: 0.9,
    safeAreaInsetPct: 10,
    intendedUse: 'Curated playlist artwork with room for stacked beat names.',
  },
  'download-artwork': {
    id: 'download-artwork',
    name: 'Download Artwork',
    width: 2000,
    height: 2000,
    mimeType: 'image/png',
    quality: 1,
    safeAreaInsetPct: 8,
    intendedUse: 'High-quality buyer delivery artwork bundled with licensed files.',
  },
} as const;

export function getCoverArtTemplate(id: CoverArtTemplateId = 'dark-listening-room') {
  return coverArtTemplates[id];
}

export function getCoverArtExportPreset(id: CoverArtExportPresetId = 'square-cover') {
  return coverArtExportPresets[id];
}

export function createCoverArtSourceConfig(input: Partial<CoverArtSourceConfig> = {}): CoverArtSourceConfig {
  const templateId = input.templateId ?? 'dark-listening-room';
  const template = getCoverArtTemplate(templateId);

  return {
    templateId,
    exportPresetId: input.exportPresetId ?? 'square-cover',
    title: input.title?.trim() || 'Untitled Beat',
    subtitle: input.subtitle?.trim() || undefined,
    producerName: input.producerName?.trim() || undefined,
    bpm: input.bpm,
    musicalKey: input.musicalKey?.trim() || undefined,
    colorVariation: input.colorVariation ?? 'theme',
    waveformVariation: input.waveformVariation ?? template.layout.waveformStyle,
    artwork: input.artwork,
    preserveSource: true,
  };
}
