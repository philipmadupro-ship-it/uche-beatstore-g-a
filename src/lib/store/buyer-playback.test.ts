import { describe, it, expect } from 'vitest';
import { buyerPlayerQueue, buyerPlayerTrack, buyerPreviewUrl } from './buyer-playback';
import type { BuyerLibraryTrackSummary } from './buyer-library';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

const summary = (id: string, over: Partial<BuyerLibraryTrackSummary> = {}): BuyerLibraryTrackSummary => ({
  id, title: 'Night Shift', cover_url: 'https://cdn.example/c.jpg', type: 'beat',
  bpm: 140, key: 'F', scale: 'minor', duration_seconds: 180, ...over,
});

describe('buyerPlayerTrack', () => {
  it('plays through the identity-gated buyer route, as the session', () => {
    expect(buyerPlayerTrack(summary(A), 'session=1').audio_url)
      .toBe(`/api/store/me/preview/${A}?session=1`);
  });

  it('never carries a private or full-length source', () => {
    const t = buyerPlayerTrack(summary(A), 'session=1');
    expect(t.wav_url).toBeNull();
    expect(t.preview_url).toBeNull();
    expect(t.audio_url).not.toMatch(/^r2:|^https?:/);
  });

  it('keeps what the player shows: title, cover, length, tempo, key', () => {
    const t = buyerPlayerTrack(summary(A), 'session=1');
    expect(t).toMatchObject({
      id: A, title: 'Night Shift', type: 'beat', cover_url: 'https://cdn.example/c.jpg',
      duration_seconds: 180, bpm: 140, key: 'F', scale: 'minor',
    });
  });

  it('names an untitled beat and defaults a missing type', () => {
    const t = buyerPlayerTrack(summary(A, { title: '  ', type: null }), 'session=1');
    expect(t.title).toBe('Untitled beat');
    expect(t.type).toBe('beat');
  });

  it('encodes the id and passes a token identity through', () => {
    expect(buyerPreviewUrl('a/b', 'token=x%20y')).toBe('/api/store/me/preview/a%2Fb?token=x%20y');
  });
});

describe('buyerPlayerQueue', () => {
  it('skips unavailable rows and plays a beat once', () => {
    const q = buyerPlayerQueue([summary(A), null, undefined, summary(B), summary(A)], 'session=1');
    expect(q.map((t) => t.id)).toEqual([A, B]);
  });

  it('is empty when nothing is playable', () => {
    expect(buyerPlayerQueue([null, null], 'session=1')).toEqual([]);
  });
});
