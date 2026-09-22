// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TrackCard } from './TrackCard';
import { DND_TRACK_TYPE } from '@/lib/dnd';
import type { Track } from '@/lib/types';

/**
 * Drag-out-of-app coverage: dragging a dashboard track row should carry a
 * `DownloadURL` entry (Chromium's drag-a-file-to-the-desktop mechanism) that
 * points at the authenticated `/api/audio` download proxy, so dropping a
 * card onto a DAW or Finder saves the real audio file. It must NOT hijack a
 * press that started on an interactive control inside the row (a button, or
 * the inline rename field) — those need to keep working as clicks.
 */

const baseTrack: Track = {
  id: 'track-1',
  user_id: 'user-1',
  title: 'Night Shift',
  type: 'beat',
  audio_url: 'r2://private-bucket/uploads/abc/night-shift.wav',
  duration_seconds: 120,
  bpm: 140,
  key: 'F',
  scale: 'minor',
  stems_status: 'none',
  created_at: '2026-01-01T00:00:00.000Z',
};

function renderCard(track: Track = baseTrack) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <TrackCard track={track} index={0} />
    </QueryClientProvider>,
  );
}

class FakeDataTransfer {
  effectAllowed = '';
  private store = new Map<string, string>();
  setData(type: string, value: string) {
    this.store.set(type, value);
  }
  getData(type: string) {
    return this.store.get(type) ?? '';
  }
  get types() {
    return Array.from(this.store.keys());
  }
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok: false, json: async () => ({}) } as Response)),
  );
  vi.stubGlobal('location', { ...window.location, origin: 'https://uche-beatstore-g.vercel.app' });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TrackCard drag-out', () => {
  it('carries a DownloadURL entry pointing at the authenticated /api/audio proxy', () => {
    renderCard();
    const row = screen.getByText('Night Shift').closest('[draggable]') as HTMLElement;
    expect(row).toBeTruthy();

    const dataTransfer = new FakeDataTransfer();
    fireEvent.dragStart(row, { dataTransfer });

    expect(dataTransfer.getData(DND_TRACK_TYPE)).not.toBe('');
    const downloadUrl = dataTransfer.getData('DownloadURL');
    expect(downloadUrl.startsWith('audio/wav:Night Shift.wav:')).toBe(true);
    expect(downloadUrl).toContain('https://uche-beatstore-g.vercel.app/api/audio?');
    expect(downloadUrl).toContain('download=1');
    // The opaque r2:// reference travels as the `src` query value, never as
    // a bare/public URL — the proxy resolves and auth-gates it server-side.
    expect(downloadUrl).toContain(encodeURIComponent('r2://private-bucket/uploads/abc/night-shift.wav'));
  });

  it('omits DownloadURL for a track with no resolvable audio source', () => {
    renderCard({ ...baseTrack, audio_url: '' });
    const row = screen.getByText('Night Shift').closest('[draggable]') as HTMLElement;

    const dataTransfer = new FakeDataTransfer();
    fireEvent.dragStart(row, { dataTransfer });

    expect(dataTransfer.getData(DND_TRACK_TYPE)).not.toBe('');
    expect(dataTransfer.getData('DownloadURL')).toBe('');
  });

  it('does not start a card drag when the press lands on the row menu button', () => {
    renderCard();
    const menuTrigger = screen.getByRole('button', { name: 'Track actions' });

    const dataTransfer = new FakeDataTransfer();
    const event = fireEvent.dragStart(menuTrigger, { dataTransfer });

    // preventDefault() on dragstart cancels the drag entirely — fireEvent
    // returns false when the event was cancelled.
    expect(event).toBe(false);
    expect(dataTransfer.getData(DND_TRACK_TYPE)).toBe('');
    expect(dataTransfer.getData('DownloadURL')).toBe('');
  });
});
