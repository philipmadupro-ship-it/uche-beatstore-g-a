import { describe, expect, it } from 'vitest';
import { imageUploadLimits } from './image-validation';
import { getImageUploadPreflightError } from './image-upload-client';

describe('image upload client helpers', () => {
  it('returns no preflight error for valid cover artwork', () => {
    expect(getImageUploadPreflightError({ type: 'image/webp', size: 2048 })).toBeNull();
  });

  it('returns the shared unsupported type message before upload', () => {
    expect(getImageUploadPreflightError({ type: 'image/gif', size: 2048 })).toBe('Use JPG, PNG, or WebP artwork.');
  });

  it('returns the shared size limit message before upload', () => {
    expect(getImageUploadPreflightError({ type: 'image/png', size: imageUploadLimits.maxSizeBytes + 1 })).toBe('Keep artwork under 8 MB.');
  });
});
