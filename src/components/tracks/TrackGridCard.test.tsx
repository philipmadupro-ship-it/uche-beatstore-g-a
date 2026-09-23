// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { useSessionContext } from '@/hooks/useSessionContext';
import { TrackGridCard } from './TrackGridCard';
import type { Track } from '@/lib/types';

function renderCard(track: Track) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <TrackGridCard track={track} />
    </QueryClientProvider>,
  );
}

const baseTrack: Track = {
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

const setSession = (bpm: number | null, key: 'F' | 'G#' | null, scale: 'major' | 'minor' | null) =>
  useSessionContext.setState({ bpm, key, scale, matchTolerance: 2, previewInSession: false });

describe('TrackGridCard session fit markers', () => {
  beforeEach(() => setSession(null, null, null));

  it('shows no session-fit marker when no session is set', () => {
    const { container } = renderCard(baseTrack);
    expect(container.querySelector('[aria-label*="session" i]')).toBe(null);
  });

  it('shows a session-fit marker once a matching session is set', () => {
    setSession(140, 'F', 'minor');
    const { container } = renderCard(baseTrack);
    expect(container.querySelector('[aria-label="Same key as your session"]')).toBeTruthy();
    expect(container.querySelector('[aria-label="Same tempo as your session"]')).toBeTruthy();
  });
});
