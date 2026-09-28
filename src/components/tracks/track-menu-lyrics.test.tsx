// @vitest-environment jsdom

/**
 * The "Lyrics Studio" item in the ⋯ menu of every Library view mode —
 * list (TrackCard), grid (TrackGridCard) and portfolio (MusicPortfolio).
 *
 * The menus are where a producer reaches for per-track actions, and until
 * this change none of them could reach the lyrics editor; the only way in
 * was the details drawer. These assert the item exists where the library
 * wires it, is absent where it is not wired (projects, playlists, the
 * storefront), is keyboard reachable, and hands the right track back.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { TrackCard } from './TrackCard';
import { TrackGridCard } from './TrackGridCard';
import MusicPortfolio from '@/components/library/MusicPortfolio';
import type { MenuSection } from '@/lib/ui/action-menu';
import type { Track } from '@/lib/types';

const track: Track = {
  id: 'track-1',
  user_id: 'user-1',
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

function wrap(ui: ReactNode) {
  return render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, json: async () => ({}) } as Response)));
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: false, media: q, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const LYRICS = 'Lyrics Studio';

describe('list mode — TrackCard ⋯ menu', () => {
  it('offers Lyrics Studio and passes the row track', async () => {
    const onOpenLyrics = vi.fn();
    wrap(<TrackCard track={track} index={1} onClickDetails={() => {}} onOpenLyrics={onOpenLyrics} />);
    fireEvent.click(screen.getByRole('button', { name: 'Track actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: new RegExp(LYRICS) }));
    expect(onOpenLyrics).toHaveBeenCalledWith(track);
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  it('sits directly after View details', () => {
    wrap(<TrackCard track={track} index={1} onClickDetails={() => {}} onOpenLyrics={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Track actions' }));
    const labels = screen.getAllByRole('menuitem').map((el) => el.textContent ?? '');
    const details = labels.findIndex((l) => l.startsWith('View details'));
    expect(labels[details + 1]).toMatch(new RegExp(LYRICS));
  });

  it('is invocable from the keyboard with its L accelerator', () => {
    const onOpenLyrics = vi.fn();
    wrap(<TrackCard track={track} index={1} onOpenLyrics={onOpenLyrics} />);
    fireEvent.click(screen.getByRole('button', { name: 'Track actions' }));
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'l' });
    expect(onOpenLyrics).toHaveBeenCalledWith(track);
  });

  it('is absent where the caller does not wire it (project / playlist rows)', () => {
    wrap(<TrackCard track={track} index={1} onClickDetails={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Track actions' }));
    expect(screen.queryByRole('menuitem', { name: new RegExp(LYRICS) })).toBeNull();
  });
});

describe('grid mode — TrackGridCard ⋯ menu', () => {
  it('offers Lyrics Studio and passes the card track', () => {
    const onOpenLyrics = vi.fn();
    const onClickDetails = vi.fn();
    wrap(<TrackGridCard track={track} onClickDetails={onClickDetails} onOpenLyrics={onOpenLyrics} />);
    fireEvent.click(screen.getByRole('button', { name: 'Track actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: new RegExp(LYRICS) }));
    expect(onOpenLyrics).toHaveBeenCalledWith(track);
    // Opening the menu and choosing an item must not also open the drawer.
    expect(onClickDetails).not.toHaveBeenCalled();
  });

  // The trigger is hidden until hover; without focus-within a keyboard user
  // tabbed onto a button they could not see.
  it('reveals the hover-only trigger on keyboard focus', () => {
    wrap(<TrackGridCard track={track} onOpenLyrics={() => {}} />);
    const wrapper = screen.getByRole('button', { name: 'Track actions' }).parentElement!;
    expect(wrapper.className).toContain('focus-within:opacity-100');
  });

  it('renders no trigger when every item is unwired', () => {
    wrap(<TrackGridCard track={track} />);
    expect(screen.queryByRole('button', { name: 'Track actions' })).toBeNull();
  });
});

describe('portfolio mode — MusicPortfolio ⋯ menu', () => {
  const pTrack = { id: 'track-1', title: 'Night Shift', artist: 'U2C', type: 'beat', cover_url: null, bpm: 140, key: 'F', scale: 'minor', year: '2026' };

  it('renders the menu the library supplies, without playing the row', () => {
    const onTrackPlay = vi.fn();
    const onLyrics = vi.fn();
    const sections = (id: string): MenuSection[] => [
      { id: 'content', items: [{ id: 'lyrics', label: LYRICS, onSelect: () => onLyrics(id) }] },
    ];
    render(<MusicPortfolio tracks={[pTrack]} onTrackPlay={onTrackPlay} trackMenuSections={sections} />);
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Night Shift' }));
    fireEvent.click(screen.getByRole('menuitem', { name: LYRICS }));
    expect(onLyrics).toHaveBeenCalledWith('track-1');
    expect(onTrackPlay).not.toHaveBeenCalled();
  });

  it('renders no trigger for an empty menu', () => {
    render(<MusicPortfolio tracks={[pTrack]} onTrackPlay={() => {}} trackMenuSections={() => []} />);
    expect(screen.queryByRole('button', { name: /Actions for/ })).toBeNull();
  });

  it('renders no menu at all when none is supplied (the storefront)', () => {
    render(<MusicPortfolio tracks={[pTrack]} onTrackPlay={() => {}} />);
    expect(screen.queryByRole('button', { name: /Actions for/ })).toBeNull();
  });
});

// "Send to studio" rides the same rails: library-only prop, one item per
// menu, keyboard reachable. /studio?track=<id> was already a deep link (the
// drawer and the track page use it) but no ⋯ menu reached it.
describe('Send to studio', () => {
  const STUDIO = 'Send to studio';

  it('list: sits right after Lyrics Studio, fires with the row track, and answers S', () => {
    const onOpenStudio = vi.fn();
    wrap(<TrackCard track={track} index={1} onClickDetails={() => {}} onOpenLyrics={() => {}} onOpenStudio={onOpenStudio} />);
    fireEvent.click(screen.getByRole('button', { name: 'Track actions' }));
    const labels = screen.getAllByRole('menuitem').map((el) => el.textContent ?? '');
    const lyrics = labels.findIndex((l) => l.startsWith(LYRICS));
    expect(labels[lyrics + 1]).toMatch(new RegExp(STUDIO));
    fireEvent.keyDown(screen.getByRole('menu'), { key: 's' });
    expect(onOpenStudio).toHaveBeenCalledWith(track);
  });

  it('list: absent where the caller does not wire it', () => {
    wrap(<TrackCard track={track} index={1} onClickDetails={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Track actions' }));
    expect(screen.queryByRole('menuitem', { name: new RegExp(STUDIO) })).toBeNull();
  });

  it('grid: fires with the card track without opening the drawer', () => {
    const onOpenStudio = vi.fn();
    const onClickDetails = vi.fn();
    wrap(<TrackGridCard track={track} onClickDetails={onClickDetails} onOpenStudio={onOpenStudio} />);
    fireEvent.click(screen.getByRole('button', { name: 'Track actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: new RegExp(STUDIO) }));
    expect(onOpenStudio).toHaveBeenCalledWith(track);
    expect(onClickDetails).not.toHaveBeenCalled();
  });
});
