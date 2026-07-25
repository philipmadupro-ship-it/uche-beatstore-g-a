import { describe, expect, it } from 'vitest';
import {
  createDawWaveformBars,
  createArtworkDocument,
  moveLayer,
  renderArtworkDocumentSvg,
  sortArtworkLayers,
  updateWaveformLayerPeaks,
} from './cover-art-document';

describe('cover art document model', () => {
  it('creates an editable document from a visual direction and source', () => {
    const document = createArtworkDocument('industrial-editorial', {
      kind: 'track',
      id: 'track-1',
      label: 'Pressure Test',
      detail: '142 BPM / D minor',
    }, new Date('2026-07-25T12:00:00.000Z'));

    expect(document.name).toBe('Pressure Test cover');
    expect(document.width).toBe(3000);
    expect(document.height).toBe(3000);
    expect(document.layers.map((layer) => layer.name)).toEqual([
      'Background Field',
      'Artwork Image',
      'Spectral Waveform',
      'Main Title',
      'Artist Name',
      'Metadata Label',
      'Paper Texture',
    ]);
    expect(document.layers.find((layer) => layer.name === 'Main Title')).toMatchObject({
      type: 'text',
      text: 'Pressure Test',
      visible: true,
      locked: false,
    });
  });

  it('moves layers by z-index without dropping layer data', () => {
    const document = createArtworkDocument('de-roche-mineral', { kind: 'empty', label: 'Empty design' });
    const title = document.layers.find((layer) => layer.name === 'Main Title');
    expect(title).toBeTruthy();

    const moved = moveLayer(document.layers, title!.id, -1);
    expect(moved).toHaveLength(document.layers.length);
    expect(sortArtworkLayers(moved).map((layer) => layer.zIndex)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(sortArtworkLayers(moved).findIndex((layer) => layer.id === title!.id)).toBe(2);
  });

  it('renders editable layers as an SVG artifact', () => {
    const document = createArtworkDocument('spectral-night', { kind: 'empty', label: 'Empty design' });
    const svg = renderArtworkDocumentSvg(document);

    expect(svg).toContain('<svg');
    expect(svg).toContain('MIDNIGHT CARTEL');
    expect(svg).toContain('Imported image placeholder');
    expect(svg).toContain('paperGrain');
  });

  it('creates DAW-like waveform bars with beat and transient markers', () => {
    const bars = createDawWaveformBars({
      peaks: [0.1, 0.9, 0.2, 0.85, 0.25, 0.7, 0.18, 0.95],
      bpm: 120,
      durationSeconds: 4,
      count: 16,
      sensitivity: 1,
    });

    expect(bars).toHaveLength(16);
    expect(bars.some((bar) => bar.beat)).toBe(true);
    expect(bars.some((bar) => bar.transient)).toBe(true);
    expect(new Set(bars.map((bar) => bar.lane))).toEqual(new Set(['low', 'mid', 'high']));
  });

  it('updates waveform layers with real peak data', () => {
    const document = createArtworkDocument('spectral-night', { kind: 'track', id: 'track-1', label: 'Beat One' });
    const layers = updateWaveformLayerPeaks(document.layers, [0.2, 0.7, 0.3], 'real', 144, 96);
    const waveform = layers.find((layer) => layer.type === 'waveform');

    expect(waveform).toMatchObject({
      peakSource: 'real',
      bpm: 144,
      durationSeconds: 96,
      peaks: [0.2, 0.7, 0.3],
    });
  });
});
