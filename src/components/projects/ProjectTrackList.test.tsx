// @vitest-environment jsdom

/**
 * Project rows get the Library's Lyrics Studio / Send to studio items.
 * ProjectTrackList sits between the page and TrackCard, so a prop it forgets
 * to forward hides both items silently — the menu still renders, just
 * without them. This pins the forwarding.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProjectTrackList } from './ProjectTrackList';
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

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, json: async () => ({}) } as Response)));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function renderList(extra: Partial<Parameters<typeof ProjectTrackList>[0]> = {}) {
  const n = () => {};
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ProjectTrackList
        tabs={['All']} activeTab="All" setActiveTab={n}
        searchQuery="" setSearchQuery={n}
        filtered={[track]}
        onSelectTrack={n} onPlayTrack={n} onRemoveTrack={n} onDeleteTrack={n}
        onAddFromLibrary={n} onShowUpload={n}
        {...extra}
      />
    </QueryClientProvider>,
  );
}

const openMenu = () => fireEvent.click(screen.getByRole('button', { name: 'Track actions' }));

describe('ProjectTrackList row menu', () => {
  it('forwards Lyrics Studio and Send to studio to each row', async () => {
    const onOpenLyrics = vi.fn();
    const onOpenStudio = vi.fn();
    renderList({ onOpenLyrics, onOpenStudio });

    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /Lyrics Studio/ }));
    expect(onOpenLyrics).toHaveBeenCalledWith(track);
    // ActionMenu awaits onSelect before closing; reopen only once it has.
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());

    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /Send to studio/ }));
    expect(onOpenStudio).toHaveBeenCalledWith(track);
  });

  it('keeps the project-specific items alongside them', () => {
    renderList({ onOpenLyrics: () => {}, onOpenStudio: () => {} });
    openMenu();
    const labels = screen.getAllByRole('menuitem').map((el) => el.textContent ?? '');
    expect(labels.some((l) => l.startsWith('Remove from project'))).toBe(true);
    // Destructive stays last, even with the new items added above it.
    expect(labels[labels.length - 1]).toMatch(/^Delete from library/);
  });

  it('shows neither item when the page does not wire them', () => {
    renderList();
    openMenu();
    expect(screen.queryByRole('menuitem', { name: /Lyrics Studio/ })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /Send to studio/ })).toBeNull();
  });
});
