// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import { useSessionContext } from '@/hooks/useSessionContext';
import { BeatListRow } from './BeatListRow';
import type { StoreTrack } from './types';

const baseTrack: StoreTrack = {
  id: 't1',
  user_id: 'u1',
  title: 'Night Shift',
  type: 'beat',
  audio_url: 'https://example.com/a.mp3',
  duration_seconds: 120,
  bpm: 140,
  key: 'F',
  scale: 'minor',
  stems_status: 'none',
  created_at: '2026-01-01T00:00:00.000Z',
};

const noop = () => {};

const setSession = (bpm: number | null, key: 'F' | 'G#' | null, scale: 'major' | 'minor' | null) =>
  useSessionContext.setState({ bpm, key, scale, matchTolerance: 2, previewInSession: false });

describe('BeatListRow session fit markers', () => {
  beforeEach(() => setSession(null, null, null));

  it('shows no session-fit marker when no session is set — untouched for a buyer', () => {
    const { container } = render(
      <BeatListRow
        track={baseTrack}
        index={0}
        priceLease={20}
        priceExclusive={100}
        isCurrent={false}
        isPlaying={false}
        isPreview={false}
        onPlay={noop}
        onPreview={noop}
        onAddLease={noop}
        onAddExclusive={noop}
        onFreeDownload={noop}
        accentColor="#c8a47a"
      />,
    );
    expect(container.querySelector('[aria-label*="session" i]')).toBe(null);
  });

  it('shows a session-fit marker once the producer sets a matching session on their own browser', () => {
    setSession(140, 'F', 'minor');
    const { container } = render(
      <BeatListRow
        track={baseTrack}
        index={0}
        priceLease={20}
        priceExclusive={100}
        isCurrent={false}
        isPlaying={false}
        isPreview={false}
        onPlay={noop}
        onPreview={noop}
        onAddLease={noop}
        onAddExclusive={noop}
        onFreeDownload={noop}
        accentColor="#c8a47a"
      />,
    );
    expect(container.querySelector('[aria-label="Same key as your session"]')).toBeTruthy();
    expect(container.querySelector('[aria-label="Same tempo as your session"]')).toBeTruthy();
  });
});
