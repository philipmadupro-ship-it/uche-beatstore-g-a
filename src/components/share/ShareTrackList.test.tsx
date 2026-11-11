// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { ShareTrackList, type ShareListItem } from './ShareTrackList';
import { ShareActions } from './ShareActions';

afterEach(cleanup);

// jsdom has no ResizeObserver; the Dropdown positions its menu with one.
beforeAll(() => {
  if (typeof ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  }
});

// Letters only, so a search for one title cannot also match a BPM or a number.
const name = (i: number) => `${'abcdefghijklmnopqrstuvwxyz'[i % 26]}${'abcdefghij'[Math.floor(i / 26)]}`;

function makeTracks(n: number): ShareListItem[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `t${i}`,
    title: `Beat ${name(i)}`,
    type: i % 10 === 0 ? 'loop' : 'beat',
    bpm: 80 + i,
    key: i % 2 ? 'F' : 'C',
    scale: i % 2 ? 'minor' : 'major',
    peaks_url: null,
    created_at: new Date(2026, 0, 1 + i).toISOString(),
    tags: [
      { tag: i % 3 === 0 ? 'Trap' : 'Lo-fi', category: 'genre' },
      { tag: i % 2 === 0 ? 'Dark' : 'Chill', category: 'mood' },
    ],
  }));
}

const noop = () => {};
const rows = () => screen.queryAllByTestId('share-track-row');

describe('ShareTrackList', () => {
  it('shows no controls for a short share and lists every track in order', () => {
    render(<ShareTrackList tracks={makeTracks(3)} onPlay={noop} />);
    expect(screen.queryByTestId('share-list-controls')).toBeNull();
    expect(rows()).toHaveLength(3);
  });

  it('shows search, sort and a count for a long share', () => {
    render(<ShareTrackList tracks={makeTracks(50)} onPlay={noop} />);
    expect(screen.getByRole('searchbox', { name: 'Search tracks' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sort tracks' })).toBeTruthy();
    expect(screen.getByTestId('share-list-count').textContent).toBe('50 tracks');
    expect(rows()).toHaveLength(50);
  });

  it('narrows by search with an "N of M" count, and clears', () => {
    render(<ShareTrackList tracks={makeTracks(50)} onPlay={noop} />);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search tracks' }), { target: { value: 'beat ha' } });
    expect(rows()).toHaveLength(1);
    expect(screen.getByTestId('share-list-count').textContent).toBe('1 of 50');
    fireEvent.click(screen.getByRole('button', { name: /Clear filters/ }));
    expect(rows()).toHaveLength(50);
  });

  it('Escape clears the search', () => {
    render(<ShareTrackList tracks={makeTracks(50)} onPlay={noop} />);
    const box = screen.getByRole('searchbox', { name: 'Search tracks' }) as HTMLInputElement;
    fireEvent.change(box, { target: { value: 'zzz' } });
    expect(screen.getByTestId('share-list-empty')).toBeTruthy();
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(box.value).toBe('');
    expect(rows()).toHaveLength(50);
  });

  it('filters by BPM range with the number fields', () => {
    render(<ShareTrackList tracks={makeTracks(50)} onPlay={noop} />);
    fireEvent.change(screen.getByLabelText('Minimum BPM'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('Maximum BPM'), { target: { value: '104' } });
    expect(rows()).toHaveLength(5);
  });

  it('lists the filter dropdowns as keyboard-reachable buttons, genre filters the list', () => {
    render(<ShareTrackList tracks={makeTracks(50)} onPlay={noop} />);
    fireEvent.click(screen.getByRole('button', { name: 'Filter by genre' }));
    const option = screen.getByRole('option', { name: /^Trap/ });
    fireEvent.click(option);
    // Every third beat is Trap: 0,3,…,48.
    expect(rows()).toHaveLength(17);
  });

  it('offers a type filter only when the share mixes types', () => {
    const uniform = makeTracks(12).map((t) => ({ ...t, type: 'beat' }));
    const { unmount } = render(<ShareTrackList tracks={uniform} onPlay={noop} />);
    expect(screen.queryByRole('button', { name: 'Filter by type' })).toBeNull();
    unmount();
    render(<ShareTrackList tracks={makeTracks(12)} onPlay={noop} />);
    expect(screen.getByRole('button', { name: 'Filter by type' })).toBeTruthy();
  });

  it('plays the track whose row is clicked, even after the list is re-ordered', () => {
    const onPlay = vi.fn();
    render(<ShareTrackList tracks={makeTracks(12)} onPlay={onPlay} />);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search tracks' }), { target: { value: 'beat fa' } });
    fireEvent.click(within(rows()[0]).getByTestId('share-track-play'));
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(onPlay.mock.calls[0][0].id).toBe('t5');
  });

  it('puts Download on every row when allowed, and on none when not', () => {
    const onDownload = vi.fn();
    const { unmount } = render(<ShareTrackList tracks={makeTracks(4)} onPlay={noop} download={{ allowed: true, onDownload }} />);
    expect(screen.getAllByRole('button', { name: /^Download Beat/ })).toHaveLength(4);
    fireEvent.click(screen.getByRole('button', { name: 'Download Beat ca' }));
    expect(onDownload).toHaveBeenCalledWith({ id: 't2', title: 'Beat ca' });
    unmount();
    render(<ShareTrackList tracks={makeTracks(4)} onPlay={noop} download={{ allowed: false, onDownload }} />);
    expect(screen.queryByRole('button', { name: /^Download Beat/ })).toBeNull();
  });

  it('renders genre and mood chips and a waveform slot on each row', () => {
    render(<ShareTrackList tracks={makeTracks(3)} onPlay={noop} />);
    const first = rows()[0];
    expect(within(first).getByTestId('share-track-tags').textContent).toContain('Trap');
    expect(within(first).getByTestId('share-track-tags').textContent).toContain('Dark');
    expect(within(first).getByTestId('share-row-waveform-slot')).toBeTruthy();
  });

  it('never nests buttons', () => {
    const { container } = render(<ShareTrackList tracks={makeTracks(12)} onPlay={noop} download={{ allowed: true, onDownload: noop }} />);
    expect(container.querySelector('button button')).toBeNull();
  });
});

describe('ShareActions', () => {
  it('has no per-track download list, only the share-level options', () => {
    render(<ShareActions allowDownloads fullPlayback />);
    expect(screen.queryByRole('button', { name: /^Download / })).toBeNull();
    expect(screen.queryByText('Downloads')).toBeNull();
    expect(screen.getByTestId('share-playback-mode').textContent).toMatch(/Full track/i);
  });

  it('says when downloads are off and shows the preview label', () => {
    render(<ShareActions allowDownloads={false} fullPlayback={false} />);
    expect(screen.getByText('Downloads are off for this link.')).toBeTruthy();
    expect(screen.getByTestId('share-playback-mode').textContent).toMatch(/1:15/);
  });

  it('keeps the collaboration entry for commenters and editors', () => {
    const onOpen = vi.fn();
    render(<ShareActions allowDownloads fullPlayback collaboration={{ role: 'commenter', commentCount: 3, onOpen }} />);
    fireEvent.click(screen.getByRole('button', { name: /Leave feedback/ }));
    expect(onOpen).toHaveBeenCalled();
  });
});
