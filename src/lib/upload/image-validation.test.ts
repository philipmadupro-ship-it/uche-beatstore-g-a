import { describe, expect, it } from 'vitest';
import { imageUploadErrorMessage, imageUploadLimits, validateImageUpload } from './image-validation';

describe('image upload validation', () => {
  it('accepts JPG, PNG, and WebP under the size limit with storage extensions', () => {
    expect(validateImageUpload({ type: 'image/jpeg', size: 1 })).toEqual({ ok: true, extension: 'jpg', mimeType: 'image/jpeg' });
    expect(validateImageUpload({ type: 'image/png', size: imageUploadLimits.maxSizeBytes })).toEqual({ ok: true, extension: 'png', mimeType: 'image/png' });
    expect(validateImageUpload({ type: 'image/webp', size: 2048 })).toEqual({ ok: true, extension: 'webp', mimeType: 'image/webp' });
  });

  it('rejects non-cover image formats and non-images', () => {
    expect(validateImageUpload({ type: 'image/gif', size: 1024 })).toEqual({ ok: false, error: 'unsupported-type' });
    expect(validateImageUpload({ type: 'image/avif', size: 1024 })).toEqual({ ok: false, error: 'unsupported-type' });
    expect(validateImageUpload({ type: 'text/plain', size: 1024 })).toEqual({ ok: false, error: 'unsupported-type' });
  });

  it('rejects files over the shared size limit', () => {
    expect(validateImageUpload({ type: 'image/png', size: imageUploadLimits.maxSizeBytes + 1 })).toEqual({
      ok: false,
      error: 'too-large',
    });
  });

  it('returns producer-facing validation messages', () => {
    expect(imageUploadErrorMessage('unsupported-type')).toBe('Use JPG, PNG, or WebP artwork.');
    expect(imageUploadErrorMessage('too-large')).toBe('Keep artwork under 4 MB.');
    expect(imageUploadErrorMessage('too-large', 40 * 1024 * 1024)).toBe('Keep artwork under 40 MB.');
  });

  it('keeps the stored limit under the platform request-body ceiling', () => {
    // Vercel refuses bodies over 4.5 MB with a non-JSON 413 before the route
    // runs; the multipart envelope needs headroom on top of the file.
    expect(imageUploadLimits.maxSizeBytes).toBeLessThan(4.5 * 1024 * 1024 - 64 * 1024);
    expect(imageUploadLimits.maxSourceBytes).toBeGreaterThan(imageUploadLimits.maxSizeBytes);
  });
});
