import type { CoverArtSourceConfig } from './presets/cover-art-presets';

export type DesignSystemLabExport = {
  theme: string;
  accent: string;
  motion: string;
  playerPreset: string;
  cssVars: Record<string, string>;
  player: Record<string, string | number | boolean>;
  coverArt?: CoverArtSourceConfig;
};

export function formatDesignSystemLabExport(config: DesignSystemLabExport) {
  return `${JSON.stringify(config, null, 2)}\n`;
}

export function designSystemExportFilename(config: Pick<DesignSystemLabExport, 'theme' | 'accent' | 'playerPreset'>) {
  const safe = [config.theme, config.accent, config.playerPreset]
    .join('__')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `beatstor-design-${safe || 'config'}.json`;
}
