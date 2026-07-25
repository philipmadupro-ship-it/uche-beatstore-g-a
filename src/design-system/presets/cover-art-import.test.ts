import { describe, expect, it } from 'vitest';
import { coverArtImportErrorMessage, coverArtImportLimits, validateCoverArtImport } from './cover-art-import';

describe('cover art import helpers', () => {
  it('accepts supported artwork mime types under the size limit', () => {
    expect(validateCoverArtImport({ type: 'image/png', size: 1024 })).toEqual({ ok: true });
    expect(validateCoverArtImport({ type: 'image/jpeg', size: coverArtImportLimits.maxSizeBytes })).toEqual({ ok: true });
    expect(validateCoverArtImport({ type: 'image/webp', size: 2048 })).toEqual({ ok: true });
  });

  it('rejects unsupported image and non-image mime types', () => {
    expect(validateCoverArtImport({ type: 'image/gif', size: 1024 })).toEqual({ ok: false, error: 'unsupported-type' });
    expect(validateCoverArtImport({ type: 'text/plain', size: 1024 })).toEqual({ ok: false, error: 'unsupported-type' });
  });

  it('rejects supported files that exceed the size limit', () => {
    expect(validateCoverArtImport({ type: 'image/png', size: coverArtImportLimits.maxSizeBytes + 1 })).toEqual({
      ok: false,
      error: 'too-large',
    });
  });

  it('returns human-readable import failure messages', () => {
    expect(coverArtImportErrorMessage('unsupported-type')).toBe('Use JPG, PNG, or WebP artwork.');
    expect(coverArtImportErrorMessage('too-large')).toBe('Keep artwork under 8 MB.');
    expect(coverArtImportErrorMessage('read-failed')).toBe('Artwork could not be read.');
  });
});
