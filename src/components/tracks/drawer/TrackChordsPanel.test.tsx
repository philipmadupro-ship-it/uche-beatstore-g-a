// @vitest-environment jsdom

/**
 * Detect chords in the track drawer: busy state while Essentia runs, the
 * timeline renders and is POSTed to /analyze, and Download MIDI saves a real
 * SMF named after the track. An empty result offers no download.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Track } from '@/lib/types';

const detectChordsFromUrl = vi.fn();
vi.mock('@/lib/audio/chords.client', () => ({ detectChordsFromUrl: (url: string) => detectChordsFromUrl(url) }));

const toast = vi.hoisted(() => ({ info: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock('@/hooks/useToast', () => ({ toast }));

import { TrackChordsPanel } from './TrackChordsPanel';

const track: Track = {
  id: 'track-1',
  user_id: 'user-1',
  title: 'Night Shift',
  type: 'beat',
  audio_url: 'r2://private/night-shift.wav',
  duration_seconds: 8,
  bpm: 120,
  key: 'C',
  scale: 'major',
  stems_status: 'none',
  created_at: '2026-01-01T00:00:00.000Z',
  chords: null,
};

const fetchMock = vi.fn();
let blobs: Blob[] = [];
let downloads: string[] = [];

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ track: {} }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  blobs = [];
  downloads = [];
  URL.createObjectURL = vi.fn((b: Blob) => {
    blobs.push(b);
    return 'blob:midi';
  }) as typeof URL.createObjectURL;
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push(this.download);
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  detectChordsFromUrl.mockReset();
  Object.values(toast).forEach((f) => f.mockReset());
});

describe('TrackChordsPanel', () => {
  it('detects, shows busy state, renders and saves the timeline, and downloads MIDI', async () => {
    let resolve!: (v: unknown) => void;
    detectChordsFromUrl.mockReturnValue(new Promise((r) => { resolve = r; }));
    render(<TrackChordsPanel track={track} />);

    expect(screen.queryByRole('button', { name: /midi/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Detect chords' }));

    const busy = await screen.findByRole('button', { name: 'Detecting…' });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    expect(busy.getAttribute('aria-busy')).toBe('true');
    expect(detectChordsFromUrl).toHaveBeenCalledWith('r2://private/night-shift.wav');

    resolve([
      { time: 0, chord: 'C' },
      { time: 2, chord: 'Am' },
      { time: 4, chord: 'N' },
      { time: 5, chord: 'F' },
    ]);

    const list = await screen.findByRole('list', { name: 'Chord timeline' });
    expect(list.textContent).toBe('0:00C0:02Am0:05F');

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/tracks/track-1/analyze');
    expect(JSON.parse(init.body)).toEqual({
      chords: [
        { time: 0, chord: 'C' },
        { time: 2, chord: 'Am' },
        { time: 4, chord: 'N' },
        { time: 5, chord: 'F' },
      ],
    });

    fireEvent.click(screen.getByRole('button', { name: /midi/i }));
    expect(downloads).toEqual(['Night Shift - chords.mid']);
    expect(blobs[0].type).toBe('audio/midi');
    const bytes = new Uint8Array(await blobs[0].arrayBuffer());
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('MThd');
    // 3 chords × 3 notes × (on + off)
    const noteOns = Array.from(bytes).filter((b, i) => b === 0x90 && i > 22).length;
    expect(noteOns).toBe(9);
  });

  it('says so and offers no download when nothing confident is found', async () => {
    detectChordsFromUrl.mockResolvedValue([]);
    render(<TrackChordsPanel track={track} />);
    fireEvent.click(screen.getByRole('button', { name: 'Detect chords' }));
    await screen.findByText('No confident chords found.');
    expect(toast.info).toHaveBeenCalledWith('No confident chords found', expect.any(String));
    expect(screen.queryByRole('button', { name: /midi/i })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps the download when saving fails', async () => {
    detectChordsFromUrl.mockResolvedValue([{ time: 0, chord: 'Em' }]);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'nope' }), { status: 500 }));
    render(<TrackChordsPanel track={track} />);
    fireEvent.click(screen.getByRole('button', { name: 'Detect chords' }));
    await waitFor(() => expect(toast.warning).toHaveBeenCalled());
    expect((screen.getByRole('button', { name: /midi/i }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows saved chords without re-running, loading them when the row omitted the column', async () => {
    const { chords: _omit, ...listRow } = track;
    void _omit;
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ...track, chords: [{ time: 3, chord: 'G' }] }), { status: 200 }));
    render(<TrackChordsPanel track={listRow as Track} />);
    const list = await screen.findByRole('list', { name: 'Chord timeline' });
    expect(list.textContent).toBe('0:03G');
    expect(fetchMock).toHaveBeenCalledWith('/api/tracks/track-1');
    expect(detectChordsFromUrl).not.toHaveBeenCalled();
    screen.getByRole('button', { name: 'Re-detect' });
  });
});
