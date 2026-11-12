// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ShareTrackList, type ShareListItem } from './ShareTrackList';
import { ShareTransportProvider, type ShareTransport } from './ShareTransport';

afterEach(() => {
  cleanup();
  // The list keeps its view in the URL; do not let one test's search leak into the next.
  window.history.replaceState(null, '', '/');
});

// jsdom has no ResizeObserver / matchMedia; the Dropdown and the filter drawer use them.
beforeAll(() => {
  if (typeof IntersectionObserver === 'undefined') {
    globalThis.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } } as unknown as typeof IntersectionObserver;
  }
  if (typeof ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  }
  if (typeof window.matchMedia === 'undefined') {
    window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false, onchange: null })) as typeof window.matchMedia;
  }
});

const name = (i: number) => `${'abcdefghijklmnopqrstuvwxyz'[i % 26]}${'abcdefghij'[Math.floor(i / 26)]}`;
function makeTracks(n: number): ShareListItem[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `t${i}`,
    title: `Beat ${name(i)}`,
    type: 'beat',
    bpm: 80 + i,
    key: 'F',
    scale: 'minor',
    duration_seconds: 120,
    peaks_url: '/p.json',
    created_at: new Date(2026, 0, 1 + i).toISOString(),
    track_tags: [{ tag: i % 3 === 0 ? 'Trap' : 'Lo-fi', category: 'genre' }],
  }));
}

function renderList(ui: React.ReactNode, transport?: Partial<ShareTransport>) {
  const value: ShareTransport = {
    track: null, index: 0, count: 0, currentTime: 0, duration: 0, playing: false, buffering: false,
    toggle: vi.fn(), prev: vi.fn(), next: vi.fn(), seekToFraction: vi.fn(), playAt: vi.fn(),
    ...transport,
  };
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ShareTransportProvider value={value}>{ui}</ShareTransportProvider>
    </QueryClientProvider>,
  );
  return value;
}
const rows = () => screen.queryAllByTestId('share-track-row');
const noop = () => {};

describe('ShareTrackList', () => {
  it('a short share is the Library rows only: no toolbar', () => {
    renderList(<ShareTrackList tracks={makeTracks(3)} onPlay={noop} />);
    expect(rows()).toHaveLength(3);
    expect(screen.queryByRole('searchbox', { name: 'Search tracks' })).toBeNull();
  });

  it('a long share gets the Library toolbar, and search narrows with an N of M count', () => {
    renderList(<ShareTrackList tracks={makeTracks(50)} onPlay={noop} />);
    expect(screen.getByTestId('share-list-count').textContent).toBe('50 tracks');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search tracks' }), { target: { value: 'beat ha' } });
    expect(rows()).toHaveLength(1);
    expect(screen.getByTestId('share-list-count').textContent).toBe('1 of 50');
  });

  it('opens the Library FilterBar in recipient mode: no owner-only facets', () => {
    renderList(<ShareTrackList tracks={makeTracks(12)} onPlay={noop} />);
    fireEvent.click(screen.getByRole('button', { name: /Filters/ }));
    expect(screen.getByRole('button', { name: /^Genre/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Tags/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^State/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Stage/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Offline/ })).toBeNull();
  });

  it('rows are the Library row in recipient mode: no rating, no owner menu', () => {
    renderList(<ShareTrackList tracks={makeTracks(3)} onPlay={noop} />);
    expect(screen.queryByRole('button', { name: /^Rate / })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Track actions' })).toBeNull();
  });

  it('plays the track whose row is pressed, even after filtering', () => {
    const onPlay = vi.fn();
    renderList(<ShareTrackList tracks={makeTracks(12)} onPlay={onPlay} />);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search tracks' }), { target: { value: 'beat fa' } });
    fireEvent.click(within(rows()[0]).getByRole('button', { name: 'Play track' }));
    expect(onPlay.mock.calls[0][0].id).toBe('t5');
  });

  it('puts Download on every row when allowed, none when not, and never nests buttons', () => {
    const onDownload = vi.fn();
    const { unmount } = render(
      <QueryClientProvider client={new QueryClient()}>
        <ShareTrackList tracks={makeTracks(4)} onPlay={noop} download={{ allowed: true, onDownload }} />
      </QueryClientProvider>,
    );
    expect(screen.getAllByRole('button', { name: /^Download Beat/ })).toHaveLength(4);
    fireEvent.click(screen.getByRole('button', { name: 'Download Beat ca' }));
    expect(onDownload).toHaveBeenCalledWith({ id: 't2', title: 'Beat ca' });
    expect(document.querySelector('button button')).toBeNull();
    unmount();
    renderList(<ShareTrackList tracks={makeTracks(4)} onPlay={noop} download={{ allowed: false, onDownload }} />);
    expect(screen.queryByRole('button', { name: /^Download Beat/ })).toBeNull();
  });

  it('↓ moves the cursor and auditions the row; Enter plays it', () => {
    const onPlay = vi.fn();
    renderList(<ShareTrackList tracks={makeTracks(10)} onPlay={onPlay} />);
    const group = screen.getByRole('group', { name: /Tracks\./ });
    fireEvent.keyDown(group, { key: 'ArrowDown' });
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(onPlay.mock.calls[0][0].id).toBe('t0');
    fireEvent.keyDown(group, { key: 'ArrowDown' });
    expect(onPlay.mock.calls[1][0].id).toBe('t1');
  });

  it('a click on an idle row\'s waveform selects that track and starts it at the clicked point', () => {
    const { playAt } = renderList(<ShareTrackList tracks={makeTracks(3)} onPlay={noop} />);
    const slider = within(rows()[1]).getByRole('slider');
    slider.getBoundingClientRect = () => ({ left: 0, width: 200, top: 0, right: 200, bottom: 32, height: 32, x: 0, y: 0, toJSON() {} });
    fireEvent.click(slider, { clientX: 100 });
    expect(playAt).toHaveBeenCalledWith('t1', 0.5);
  });

  it('only the playing row seeks the page\'s engine, and shows its progress', () => {
    const tracks = makeTracks(3);
    const { seekToFraction } = renderList(
      <ShareTrackList tracks={tracks} playingId="t0" isPlaying onPlay={noop} />,
      { currentTime: 30, duration: 120 },
    );
    const slider = within(rows()[0]).getByRole('slider');
    expect(slider.getAttribute('aria-valuenow')).toBe('25');
    slider.getBoundingClientRect = () => ({ left: 0, width: 200, top: 0, right: 200, bottom: 32, height: 32, x: 0, y: 0, toJSON() {} });
    fireEvent.click(slider, { clientX: 150 });
    expect(seekToFraction).toHaveBeenCalledWith(0.75);
    expect(within(rows()[1]).getByRole('slider').getAttribute('aria-valuenow')).toBe('0');
  });
});
