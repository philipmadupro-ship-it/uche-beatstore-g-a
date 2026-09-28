// @vitest-environment jsdom

/**
 * Sections (browse) cards get the same Lyrics Studio / Send to studio items
 * as the list, grid and portfolio menus. The card's whole cover is a play
 * button and the card itself opens the details drawer, so the menu must
 * swallow its own clicks or choosing an item would also play or open.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MiniTrackCard } from './MiniTrackCard';
import type { Track } from '@/lib/types';

afterEach(cleanup);

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

function renderCard(props: Partial<Parameters<typeof MiniTrackCard>[0]> = {}) {
  const onPlay = vi.fn();
  const onOpen = vi.fn();
  render(<MiniTrackCard track={track} isCurrent={false} isPlaying={false} onPlay={onPlay} onOpen={onOpen} {...props} />);
  return { onPlay, onOpen };
}

const trigger = () => screen.getByRole('button', { name: 'Actions for Night Shift' });

describe('MiniTrackCard ⋯ menu', () => {
  it('offers Lyrics Studio then Send to studio', () => {
    renderCard({ onOpenLyrics: () => {}, onOpenStudio: () => {} });
    fireEvent.click(trigger());
    const labels = screen.getAllByRole('menuitem').map((el) => el.textContent ?? '');
    expect(labels[0]).toMatch(/^Lyrics Studio/);
    expect(labels[1]).toMatch(/^Send to studio/);
  });

  it('opens Lyrics Studio without playing or opening the card', () => {
    const onOpenLyrics = vi.fn();
    const { onPlay, onOpen } = renderCard({ onOpenLyrics, onOpenStudio: () => {} });
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole('menuitem', { name: /Lyrics Studio/ }));
    expect(onOpenLyrics).toHaveBeenCalledWith(track);
    expect(onPlay).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('sends to the studio from the keyboard with S', () => {
    const onOpenStudio = vi.fn();
    renderCard({ onOpenLyrics: () => {}, onOpenStudio });
    fireEvent.click(trigger());
    fireEvent.keyDown(screen.getByRole('menu'), { key: 's' });
    expect(onOpenStudio).toHaveBeenCalledWith(track);
  });

  it('reveals the hover-only trigger on keyboard focus, above the play overlay', () => {
    renderCard({ onOpenLyrics: () => {} });
    const wrapper = trigger().parentElement!;
    expect(wrapper.className).toContain('focus-within:opacity-100');
    expect(wrapper.className).toContain('z-10');
  });

  it('renders no trigger when nothing is wired', () => {
    renderCard();
    expect(screen.queryByRole('button', { name: /Actions for/ })).toBeNull();
  });

  it('still plays and opens as before', () => {
    const { onPlay, onOpen } = renderCard({ onOpenLyrics: () => {} });
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Night Shift'));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
