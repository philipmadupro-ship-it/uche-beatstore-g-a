import { deRochePrimitives } from '../foundations/colors';
import { coverArtExportPresets, coverArtTemplates, type CoverArtSourceConfig } from './cover-art-presets';

type RenderedCoverArt = {
  svg: string;
  filename: string;
};

const colorVariations = {
  theme: {
    background: deRochePrimitives.black950,
    surface: deRochePrimitives.charcoal850,
    text: deRochePrimitives.chalk150,
    secondaryText: deRochePrimitives.beige400,
    accent: '#C4B49C',
    wave: '#9A6E83',
    paper: deRochePrimitives.paper100,
    ink: deRochePrimitives.black900,
  },
  original: {
    background: deRochePrimitives.black950,
    surface: deRochePrimitives.charcoal800,
    text: deRochePrimitives.chalk150,
    secondaryText: deRochePrimitives.sand350,
    accent: '#E7D7BE',
    wave: '#3C78A8',
    paper: deRochePrimitives.paper100,
    ink: deRochePrimitives.black900,
  },
  'luxury-beige': {
    background: deRochePrimitives.black900,
    surface: deRochePrimitives.basalt750,
    text: deRochePrimitives.chalk150,
    secondaryText: deRochePrimitives.beige400,
    accent: '#C4B49C',
    wave: '#D66738',
    paper: deRochePrimitives.paper100,
    ink: deRochePrimitives.black900,
  },
} as const;

function escapeXml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function safeFilenamePart(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function getTitleAnchor(placement: string, width: number, height: number) {
  if (placement === 'center') {
    return { x: width / 2, y: height * 0.48, anchor: 'middle' as const };
  }
  if (placement === 'lower-left') {
    return { x: width * 0.1, y: height * 0.7, anchor: 'start' as const };
  }
  if (placement === 'right-rail') {
    return { x: width * 0.9, y: height * 0.18, anchor: 'end' as const };
  }
  if (placement === 'split') {
    return { x: width * 0.08, y: height * 0.24, anchor: 'start' as const };
  }
  return { x: width * 0.1, y: height * 0.16, anchor: 'start' as const };
}

function renderWaveform(config: CoverArtSourceConfig, width: number, height: number, accent: string) {
  if (config.waveformVariation === 'none') {
    return '';
  }

  const bars = Array.from({ length: 32 }, (_, index) => {
    const barWidth = width * 0.018;
    const gap = width * 0.006;
    const x = width * 0.1 + index * (barWidth + gap);
    const value = 0.2 + ((index * 17) % 67) / 100;
    const barHeight = height * 0.14 * value;
    const baseline = config.waveformVariation === 'center-mask' ? height * 0.55 : height * 0.84;
    return `<rect x="${x.toFixed(2)}" y="${(baseline - barHeight).toFixed(2)}" width="${barWidth.toFixed(2)}" height="${barHeight.toFixed(2)}" rx="${(barWidth / 2).toFixed(2)}" fill="${accent}" opacity="${config.waveformVariation === 'document-rule' ? '0.38' : '0.72'}" />`;
  });

  if (config.waveformVariation === 'document-rule') {
    return `<g>${bars.join('')}<line x1="${width * 0.1}" y1="${height * 0.86}" x2="${width * 0.9}" y2="${height * 0.86}" stroke="${accent}" stroke-width="${Math.max(1, width * 0.002)}" opacity="0.55" /></g>`;
  }

  return `<g>${bars.join('')}</g>`;
}

function renderArtworkImage(config: CoverArtSourceConfig, width: number, height: number) {
  if (!config.artwork?.dataUrl) {
    return '';
  }

  const template = coverArtTemplates[config.templateId];
  const href = escapeXml(config.artwork.dataUrl);
  const opacity = template.layout.imageRole === 'background' ? 0.52 : 0.78;
  const filter = template.layout.imageRole === 'masked-subject' ? 'saturate(0.82) contrast(1.08)' : 'saturate(0.72) contrast(0.96)';

  if (template.layout.imageRole === 'panel') {
    return `<image href="${href}" x="${width * 0.48}" y="${height * 0.1}" width="${width * 0.42}" height="${height * 0.48}" preserveAspectRatio="xMidYMid slice" opacity="${opacity}" style="filter:${filter}" />`;
  }

  if (template.layout.imageRole === 'contact-strip') {
    const tileWidth = width * 0.18;
    return Array.from({ length: 4 }, (_, index) => {
      const x = width * 0.1 + index * (tileWidth + width * 0.035);
      return `<image href="${href}" x="${x.toFixed(2)}" y="${height * 0.12}" width="${tileWidth.toFixed(2)}" height="${(height * 0.28).toFixed(2)}" preserveAspectRatio="xMidYMid slice" opacity="${(0.5 + index * 0.1).toFixed(2)}" style="filter:${filter}" />`;
    }).join('');
  }

  if (template.layout.imageRole === 'masked-subject') {
    return `<image href="${href}" x="${width * 0.08}" y="${height * 0.08}" width="${width * 0.62}" height="${height * 0.84}" preserveAspectRatio="xMidYMid slice" opacity="${opacity}" style="filter:${filter}" />`;
  }

  if (template.layout.imageRole === 'background') {
    return `<image href="${href}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice" opacity="${opacity}" style="filter:${filter}" />`;
  }

  return '';
}

export function renderCoverArtSvg(config: CoverArtSourceConfig): RenderedCoverArt {
  const template = coverArtTemplates[config.templateId];
  const exportPreset = coverArtExportPresets[config.exportPresetId];
  const palette = colorVariations[config.colorVariation];
  const width = exportPreset.width;
  const height = exportPreset.height;
  const safeInset = exportPreset.safeAreaInsetPct / 100;
  const safeX = width * safeInset;
  const safeY = height * safeInset;
  const safeWidth = width - safeX * 2;
  const safeHeight = height - safeY * 2;
  const title = escapeXml(config.title);
  const producer = escapeXml(config.producerName ?? 'Producer');
  const metadata = escapeXml([
    config.bpm ? `${config.bpm} BPM` : null,
    config.musicalKey,
    template.layout.metadataMode,
  ].filter(Boolean).join(' / '));
  const titleAnchor = getTitleAnchor(template.layout.titlePlacement, width, height);
  const isArchive = template.id === 'de-roche-archive';
  const background = isArchive ? palette.paper : palette.background;
  const text = isArchive ? palette.ink : palette.text;
  const secondaryText = isArchive ? deRochePrimitives.umber600 : palette.secondaryText;
  const titleSize = Math.max(44, Math.round(Math.min(width, height) * 0.095));
  const metaSize = Math.max(18, Math.round(Math.min(width, height) * 0.022));

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${title} cover art">`,
    '<defs>',
    `<radialGradient id="accentGlow" cx="24%" cy="18%" r="56%"><stop offset="0%" stop-color="${palette.accent}" stop-opacity="0.32"/><stop offset="100%" stop-color="${palette.accent}" stop-opacity="0"/></radialGradient>`,
    `<radialGradient id="waveGlow" cx="84%" cy="82%" r="50%"><stop offset="0%" stop-color="${palette.wave}" stop-opacity="0.28"/><stop offset="100%" stop-color="${palette.wave}" stop-opacity="0"/></radialGradient>`,
    '</defs>',
    `<rect width="${width}" height="${height}" fill="${background}" />`,
    renderArtworkImage(config, width, height),
    `<rect width="${width}" height="${height}" fill="url(#accentGlow)" />`,
    `<rect width="${width}" height="${height}" fill="url(#waveGlow)" />`,
    `<rect x="${width * 0.06}" y="${height * 0.06}" width="${width * 0.88}" height="${height * 0.88}" fill="none" stroke="${isArchive ? deRochePrimitives.limestone300 : palette.surface}" stroke-width="${Math.max(2, width * 0.002)}" opacity="0.82" />`,
    `<rect x="${safeX.toFixed(2)}" y="${safeY.toFixed(2)}" width="${safeWidth.toFixed(2)}" height="${safeHeight.toFixed(2)}" fill="none" stroke="${palette.accent}" stroke-width="${Math.max(2, width * 0.002)}" stroke-dasharray="${Math.max(12, width * 0.012)} ${Math.max(8, width * 0.008)}" opacity="0.5" />`,
    renderWaveform(config, width, height, palette.accent),
    `<text x="${titleAnchor.x}" y="${titleAnchor.y - titleSize * 0.55}" text-anchor="${titleAnchor.anchor}" fill="${palette.accent}" font-family="Panchang, monospace" font-size="${metaSize}" letter-spacing="${Math.round(metaSize * 0.36)}">${producer}</text>`,
    `<text x="${titleAnchor.x}" y="${titleAnchor.y}" text-anchor="${titleAnchor.anchor}" fill="${text}" font-family="Synkopy, Akira Expanded, sans-serif" font-size="${titleSize}" font-weight="700">${title}</text>`,
    `<text x="${titleAnchor.x}" y="${titleAnchor.y + titleSize * 0.62}" text-anchor="${titleAnchor.anchor}" fill="${secondaryText}" font-family="Panchang, monospace" font-size="${metaSize}" letter-spacing="${Math.round(metaSize * 0.22)}">${metadata}</text>`,
    '</svg>',
  ].join('');

  return {
    svg,
    filename: `beatstor-cover-${safeFilenamePart(config.title) || 'untitled'}-${config.exportPresetId}.svg`,
  };
}
