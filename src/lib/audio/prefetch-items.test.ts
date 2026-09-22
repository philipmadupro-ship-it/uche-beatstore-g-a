import { describe, expect, it } from 'vitest';

import { prefetchItemsFor } from './prefetch-items';

describe('prefetchItemsFor', () => {
  it('queues a direct preview URL', () => {
    expect(prefetchItemsFor([{ id: 'a', audio_url: 'https://cdn.example/a.mp3' }])).toEqual([
      { id: 'a', url: 'https://cdn.example/a.mp3' },
    ]);
  });

  it('NEVER queues an r2:// master reference', () => {
    // That is the full-size WAV. Prefetching it would fill a clip cache with
    // masters on every page view.
    expect(prefetchItemsFor([{ id: 'a', audio_url: 'r2://private/masters/a.wav' }])).toEqual([]);
  });

  it('skips the relative proxy path too', () => {
    expect(prefetchItemsFor([{ id: 'a', audio_url: '/api/audio?src=x' }])).toEqual([]);
  });

  it('skips rows missing an id or a url', () => {
    expect(
      prefetchItemsFor([
        { id: null, audio_url: 'https://x/a.mp3' },
        { id: 'b', audio_url: null },
        null,
        undefined,
      ]),
    ).toEqual([]);
  });

  it('accepts plain http and any casing', () => {
    expect(prefetchItemsFor([{ id: 'a', audio_url: 'HTTP://x/a.mp3' }])).toHaveLength(1);
  });
});
