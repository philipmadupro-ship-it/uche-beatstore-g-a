import { afterEach, describe, expect, it, vi } from 'vitest';
import { imageUploadLimits } from './image-validation';
import { getImageUploadPreflightError, uploadAndAttachImage, uploadResponseError } from './image-upload-client';

// jsdom-free: the file already fits, so no resize work happens.
vi.mock('./image-resize', () => ({ prepareImageForUpload: async (f: File) => f }));

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

describe('uploadAndAttachImage', () => {
  const URL_ = 'https://pub.r2.dev/covers/abcDEF_123.webp';
  const file = new File([new Uint8Array([1])], 'c.webp', { type: 'image/webp' });

  function stubFetch() {
    const calls: Array<{ method: string; body: unknown }> = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      calls.push({ method: init.method!, body: init.body });
      return Response.json(init.method === 'POST' ? { url: URL_ } : { success: true });
    }));
    return calls;
  }
  afterEach(() => vi.unstubAllGlobals());

  it('keeps the upload when the attach succeeds', async () => {
    const calls = stubFetch();
    expect(await uploadAndAttachImage(file, async () => true)).toBe(URL_);
    expect(calls.map((c) => c.method)).toEqual(['POST']);
  });

  it('discards the upload when the attach reports failure', async () => {
    const calls = stubFetch();
    expect(await uploadAndAttachImage(file, async () => false)).toBeNull();
    await vi.waitFor(() => expect(calls.map((c) => c.method)).toEqual(['POST', 'DELETE']));
    expect(JSON.parse(calls[1].body as string)).toEqual({ url: URL_ });
  });

  it('discards and rethrows when the attach throws', async () => {
    const calls = stubFetch();
    await expect(uploadAndAttachImage(file, async () => { throw new Error('Could not save'); })).rejects.toThrow('Could not save');
    await vi.waitFor(() => expect(calls.map((c) => c.method)).toEqual(['POST', 'DELETE']));
  });

  it('never attaches when the upload fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Request Entity Too Large', { status: 413 })));
    const attach = vi.fn();
    await expect(uploadAndAttachImage(file, attach)).rejects.toThrow('Keep artwork under 4 MB.');
    expect(attach).not.toHaveBeenCalled();
  });
});
