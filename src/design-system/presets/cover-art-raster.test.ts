import { describe, expect, it } from 'vitest';
import { coverArtExportPresets } from './cover-art-presets';
import { getCoverArtRasterFilename } from './cover-art-raster';

describe('cover art raster helpers', () => {
  it('converts SVG filenames to PNG, JPG, and WebP names from export presets', () => {
    expect(getCoverArtRasterFilename('beatstor-cover-midnight-square-cover.svg', coverArtExportPresets['square-cover']))
      .toBe('beatstor-cover-midnight-square-cover.png');
    expect(getCoverArtRasterFilename('beatstor-cover-midnight-streaming-cover.svg', coverArtExportPresets['streaming-cover']))
      .toBe('beatstor-cover-midnight-streaming-cover.jpg');
    expect(getCoverArtRasterFilename('beatstor-cover-midnight-beat-store-card.svg', coverArtExportPresets['beat-store-card']))
      .toBe('beatstor-cover-midnight-beat-store-card.webp');
  });
});
