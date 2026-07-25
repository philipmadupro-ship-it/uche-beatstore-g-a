import { describe, expect, it } from 'vitest';
import { coverArtExportPresets } from '@/design-system/presets/cover-art-presets';
import { createGeneratedCoverFile } from './generated-cover-upload';

describe('generated cover upload helpers', () => {
  it('wraps a rendered cover blob as a typed upload file', async () => {
    const blob = new Blob(['cover'], { type: 'image/webp' });
    const file = createGeneratedCoverFile(blob, 'beatstor-cover.webp', coverArtExportPresets['beat-store-card'].mimeType);

    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe('beatstor-cover.webp');
    expect(file.type).toBe('image/webp');
    expect(file.size).toBe(5);
  });
});
