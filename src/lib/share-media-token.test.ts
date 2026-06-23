import { describe, expect, it, vi } from 'vitest';
import { signedSharePreviewUrl, verifyShareMediaGrant } from './share-media-token';

describe('share media grants', () => {
  it('creates a short-lived grant that verifies only for the same share and track', () => {
    vi.stubEnv('SHARE_MEDIA_TOKEN_SECRET', 'test-share-secret');
    const url = new URL(signedSharePreviewUrl('share-a', 'track-a'), 'http://localhost');

    expect(
      verifyShareMediaGrant(
        'share-a',
        'track-a',
        url.searchParams.get('expires'),
        url.searchParams.get('sig'),
      ),
    ).toBe(true);
    expect(
      verifyShareMediaGrant(
        'share-a',
        'track-b',
        url.searchParams.get('expires'),
        url.searchParams.get('sig'),
      ),
    ).toBe(false);
    expect(
      verifyShareMediaGrant(
        'share-b',
        'track-a',
        url.searchParams.get('expires'),
        url.searchParams.get('sig'),
      ),
    ).toBe(false);
  });

  it('rejects an expired grant', () => {
    vi.stubEnv('SHARE_MEDIA_TOKEN_SECRET', 'test-share-secret');
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-22T12:00:00Z'));
    const url = new URL(signedSharePreviewUrl('share-a', 'track-a'), 'http://localhost');
    vi.advanceTimersByTime(16 * 60 * 1000);

    expect(
      verifyShareMediaGrant(
        'share-a',
        'track-a',
        url.searchParams.get('expires'),
        url.searchParams.get('sig'),
      ),
    ).toBe(false);

    vi.useRealTimers();
  });
});
