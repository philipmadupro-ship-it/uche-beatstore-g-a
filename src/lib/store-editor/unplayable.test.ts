import { describe, expect, it } from 'vitest';
import { getStoreEditorAttentionIssues, isUnplayableOnStore } from './attention-issues';
import { publicPreviewSource } from '@/lib/store/public-preview-access';

describe('isUnplayableOnStore', () => {
  it('matches exactly what /api/store/preview/[id] can serve', () => {
    expect(isUnplayableOnStore({ preview_url: 'https://pub.r2.dev/previews/a.mp3', audio_url: 'r2://p/a.wav' })).toBe(false);
    expect(isUnplayableOnStore({ preview_url: null, audio_url: 'https://pub.r2.dev/a.mp3' })).toBe(false);
    // The production case: no clip, private master only.
    expect(isUnplayableOnStore({ preview_url: null, audio_url: 'r2://private/tracks/a.wav' })).toBe(true);
    expect(isUnplayableOnStore({ preview_url: null, audio_url: null })).toBe(true);
  });

  it('agrees with the preview route on every shape of row', () => {
    const rows = [
      { preview_url: 'https://pub/p.mp3', audio_url: 'r2://p/a.wav' },
      { preview_url: null, audio_url: 'https://pub/a.mp3' },
      { preview_url: null, audio_url: 'r2://p/a.wav' },
      { preview_url: null, audio_url: null },
      { preview_url: null, audio_url: '' },
      { preview_url: '', audio_url: 'r2://p/a.wav' },
    ];
    for (const row of rows) expect(isUnplayableOnStore(row)).toBe(publicPreviewSource(row) == null);
  });
});

describe('attention issues', () => {
  it('surfaces unplayable beats first, from the server summary', () => {
    const issues = getStoreEditorAttentionIssues({
      tracks: [],
      hasReadyPrice: () => true,
      summary: {
        noCover: { count: 1, firstId: 'a' },
        noPreview: { count: 3, firstId: 'b' },
      },
    });
    expect(issues[0]).toMatchObject({ label: "won't play (no preview)", count: 3, kind: 'waveforms' });
  });
});
