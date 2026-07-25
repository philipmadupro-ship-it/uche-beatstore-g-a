import { describe, expect, it } from 'vitest';
import { createCoverArtSourceConfig } from './cover-art-presets';
import { renderCoverArtSvg } from './cover-art-renderer';

describe('cover art SVG renderer', () => {
  it('renders selected export dimensions and escaped metadata', () => {
    const rendered = renderCoverArtSvg(createCoverArtSourceConfig({
      templateId: 'audio-document',
      exportPresetId: 'youtube-thumbnail',
      title: 'A&B <Test>',
      producerName: 'Uche "Archive"',
      bpm: 142,
      musicalKey: 'C# minor',
    }));

    expect(rendered.svg).toContain('width="1280" height="720"');
    expect(rendered.svg).toContain('A&amp;B &lt;Test&gt;');
    expect(rendered.svg).toContain('Uche &quot;Archive&quot;');
    expect(rendered.svg).toContain('142 BPM / C# minor / technical');
  });

  it('creates a safe SVG filename from the title and export preset', () => {
    expect(renderCoverArtSvg(createCoverArtSourceConfig({
      title: '  Midnight / Cartel!!!  ',
      exportPresetId: 'download-artwork',
    })).filename).toBe('beatstor-cover-midnight-cartel-download-artwork.svg');
  });

  it('omits waveform bars when waveform variation is none', () => {
    const rendered = renderCoverArtSvg(createCoverArtSourceConfig({
      waveformVariation: 'none',
    }));

    expect(rendered.svg).not.toContain('<rect x="160.00"');
  });

  it('embeds imported artwork data urls when source config includes artwork', () => {
    const rendered = renderCoverArtSvg(createCoverArtSourceConfig({
      templateId: 'image-mask',
      artwork: {
        source: 'local-upload',
        name: 'cover.png',
        mimeType: 'image/png',
        sizeBytes: 2048,
        dataUrl: 'data:image/png;base64,a&b',
      },
    }));

    expect(rendered.svg).toContain('<image href="data:image/png;base64,a&amp;b"');
    expect(rendered.svg).toContain('preserveAspectRatio="xMidYMid slice"');
  });
});
