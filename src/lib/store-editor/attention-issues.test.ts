import { describe, expect, it } from 'vitest';
import { getStoreEditorAttentionIssues, type StoreEditorAttentionTrack } from './attention-issues';

function track(overrides: Partial<StoreEditorAttentionTrack> & { id: string }): StoreEditorAttentionTrack {
  return {
    store_listed: true,
    cover_url: 'cover.jpg',
    peaks_url: 'peaks.json',
    bpm: 140,
    key: 'C',
    ...overrides,
  };
}

describe('getStoreEditorAttentionIssues', () => {
  it('finds listed beats missing real waveform sidecars', () => {
    const issues = getStoreEditorAttentionIssues({
      tracks: [
        track({ id: 'a', peaks_url: null }),
        track({ id: 'b', store_listed: false, peaks_url: null }),
        track({ id: 'c' }),
      ],
      hasReadyPrice: () => true,
    });

    expect(issues).toEqual([
      {
        label: 'need real waveforms',
        count: 1,
        firstId: 'a',
        kind: 'waveforms',
      },
    ]);
  });

  it('combines library-fix issues with the waveform batch issue', () => {
    const issues = getStoreEditorAttentionIssues({
      tracks: [
        track({ id: 'a', cover_url: null, bpm: null, key: null, peaks_url: null }),
      ],
      hasReadyPrice: () => false,
    });

    expect(issues.map((issue) => issue.label)).toEqual([
      'no cover art',
      'no price set',
      'no BPM or key',
      'need real waveforms',
    ]);
  });

  it('uses API summary counts when provided', () => {
    const issues = getStoreEditorAttentionIssues({
      tracks: [],
      summary: {
        missingPeaks: { count: 12, firstId: null },
      },
      hasReadyPrice: () => true,
    });

    expect(issues).toEqual([
      {
        label: 'need real waveforms',
        count: 12,
        firstId: '',
        kind: 'waveforms',
      },
    ]);
  });
});
