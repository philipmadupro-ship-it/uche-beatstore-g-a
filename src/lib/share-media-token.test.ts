import { describe, expect, it, vi } from 'vitest';
import { signedSharePeaksUrl, signedSharePreviewUrl, verifyShareMediaGrant } from './share-media-token';

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

  it('stays valid through a long writing session on a full track', () => {
    vi.stubEnv('SHARE_MEDIA_TOKEN_SECRET', 'test-share-secret');
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-22T12:00:00Z'));
    const url = new URL(signedSharePreviewUrl('share-a', 'track-a'), 'http://localhost');
    // The old 15-minute grant failed here: a seek after 16 min re-fetched a
    // byte range and the player went silent mid-session.
    vi.advanceTimersByTime(3 * 60 * 60 * 1000);

    expect(
      verifyShareMediaGrant('share-a', 'track-a', url.searchParams.get('expires'), url.searchParams.get('sig')),
    ).toBe(true);
    vi.useRealTimers();
  });

  it('rejects an expired grant', () => {
    vi.stubEnv('SHARE_MEDIA_TOKEN_SECRET', 'test-share-secret');
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-22T12:00:00Z'));
    const url = new URL(signedSharePreviewUrl('share-a', 'track-a'), 'http://localhost');
    // 4 h grant (a writing session on a full track), so just past it.
    vi.advanceTimersByTime(4 * 60 * 60 * 1000 + 60 * 1000);

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

  it('creates a peaks grant on the tokenized peaks route', () => {
    vi.stubEnv('SHARE_MEDIA_TOKEN_SECRET', 'test-share-secret');
    const url = new URL(signedSharePeaksUrl('share-a', 'track-a'), 'http://localhost');

    expect(url.pathname).toBe('/api/share/share-a/peaks/track-a');
    expect(
      verifyShareMediaGrant(
        'share-a',
        'track-a',
        url.searchParams.get('expires'),
        url.searchParams.get('sig'),
      ),
    ).toBe(true);
  });
});
