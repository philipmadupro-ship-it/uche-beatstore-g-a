import { describe, expect, it } from 'vitest';
import { imageUploadLimits } from './image-validation';
import { getImageUploadPreflightError, uploadResponseError } from './image-upload-client';

describe('image upload client helpers', () => {
  it('returns no preflight error for valid cover artwork', () => {
    expect(getImageUploadPreflightError({ type: 'image/webp', size: 2048 })).toBeNull();
  });

  it('returns the shared unsupported type message before upload', () => {
    expect(getImageUploadPreflightError({ type: 'image/gif', size: 2048 })).toBe('Use JPG, PNG, or WebP artwork.');
  });

  it('returns the shared size limit message before upload', () => {
    expect(getImageUploadPreflightError({ type: 'image/png', size: imageUploadLimits.maxSourceBytes + 1 })).toBe('Keep artwork under 40 MB.');
  });
});

describe('uploadResponseError', () => {
  it('prefers the route error message', () => {
    expect(uploadResponseError(415, { error: 'Use JPG, PNG, or WebP artwork.' })).toBe('Use JPG, PNG, or WebP artwork.');
  });
  it('explains a platform 413 that carried no JSON', () => {
    expect(uploadResponseError(413, {})).toBe('Keep artwork under 4 MB.');
  });
  it('names the auth problem instead of a status code', () => {
    expect(uploadResponseError(403, {})).toBe('Sign in again to upload artwork.');
  });
  it('falls back to a retryable message', () => {
    expect(uploadResponseError(502, null)).toBe('Upload failed (HTTP 502). Try again.');
  });
});
