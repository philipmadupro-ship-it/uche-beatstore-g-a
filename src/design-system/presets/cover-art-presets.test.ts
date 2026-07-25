import { describe, expect, it } from 'vitest';
import {
  coverArtExportPresets,
  coverArtTemplates,
  createCoverArtSourceConfig,
  getCoverArtExportPreset,
  getCoverArtTemplate,
} from './cover-art-presets';

describe('cover art presets', () => {
  it('defines the constrained De Roche template set from the prompt', () => {
    expect(Object.keys(coverArtTemplates)).toEqual([
      'de-roche-archive',
      'dark-listening-room',
      'contact-sheet',
      'audio-document',
      'poster-deconstruction',
      'image-mask',
    ]);

    expect(getCoverArtTemplate('image-mask').layout.imageRole).toBe('masked-subject');
    expect(getCoverArtTemplate('audio-document').layout.metadataMode).toBe('technical');
  });

  it('covers square, social, video, card, banner, playlist, streaming, and download exports', () => {
    expect(Object.keys(coverArtExportPresets)).toEqual([
      'square-cover',
      'streaming-cover',
      'social-post',
      'youtube-thumbnail',
      'beat-store-card',
      'store-banner',
      'playlist-cover',
      'download-artwork',
    ]);

    expect(getCoverArtExportPreset('streaming-cover')).toMatchObject({
      width: 3000,
      height: 3000,
      mimeType: 'image/jpeg',
    });
    expect(getCoverArtExportPreset('store-banner').width).toBeGreaterThan(getCoverArtExportPreset('store-banner').height);
    expect(getCoverArtExportPreset('social-post').height).toBeGreaterThan(getCoverArtExportPreset('social-post').width);
  });

  it('creates editable source config from track metadata without losing source state', () => {
    expect(createCoverArtSourceConfig({
      templateId: 'audio-document',
      exportPresetId: 'download-artwork',
      title: '  Midnight Cartel  ',
      producerName: '  Uche  ',
      bpm: 144,
      musicalKey: '  F minor  ',
    })).toEqual({
      templateId: 'audio-document',
      exportPresetId: 'download-artwork',
      title: 'Midnight Cartel',
      subtitle: undefined,
      producerName: 'Uche',
      bpm: 144,
      musicalKey: 'F minor',
      colorVariation: 'theme',
      waveformVariation: 'document-rule',
      artwork: undefined,
      preserveSource: true,
    });
  });

  it('preserves imported artwork source metadata in config', () => {
    expect(createCoverArtSourceConfig({
      title: 'Cover Import',
      artwork: {
        source: 'local-upload',
        name: 'cover.png',
        mimeType: 'image/png',
        sizeBytes: 2400,
        dataUrl: 'data:image/png;base64,abc123',
      },
    }).artwork).toEqual({
      source: 'local-upload',
      name: 'cover.png',
      mimeType: 'image/png',
      sizeBytes: 2400,
      dataUrl: 'data:image/png;base64,abc123',
    });
  });
});
