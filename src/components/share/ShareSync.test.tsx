// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ShareTrackList, type ShareListItem } from './ShareTrackList';
import { ShareTransportBar } from './ShareTransportBar';
import { ShareWaveformVinyl } from './ShareWaveformVinyl';
import { ShareTransportProvider, useShareTransport, type ShareTransport } from './ShareTransport';
import { ShareActions } from './ShareActions';

/**
 * One engine, several views. The bottom bar, the playing row's waveform and the
 * vinyl are all driven by the same ShareTransport, so they must agree on the
 * time, and the vinyl must follow the audio element's own state, not a click.
 */
afterEach(() => {
  cleanup();
  // The list keeps its view in the URL; do not let one test's search leak into the next.
  window.history.replaceState(null, '', '/');
});

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

const tracks: ShareListItem[] = ['One', 'Two', 'Three'].map((title, i) => ({
  id: `t${i}`, title, type: 'beat', bpm: 100 + i, key: 'C', scale: 'major', duration_seconds: 200, peaks_url: '/p.json', cover_url: null,
}));

function value(over: Partial<ShareTransport> = {}): ShareTransport {
  return {
    track: { ...tracks[1], audio_url: '/a.wav' }, index: 1, count: 3, currentTime: 50, duration: 200,
    playing: true, buffering: false,
    toggle: vi.fn(), prev: vi.fn(), next: vi.fn(), seekToFraction: vi.fn(), playAt: vi.fn(),
    ...over,
  };
}

function Page({ t, requested = true }: { t: ShareTransport; requested?: boolean }) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <ShareTransportProvider value={t}>
        <VinylFromTransport />
        <ShareTrackList tracks={tracks} playingId="t1" isPlaying={requested} onPlay={() => {}} />
        <ShareTransportBar />
      </ShareTransportProvider>
    </QueryClientProvider>
  );
}
function VinylFromTransport() {
  const t = useShareTransport();
  return (
    <ShareWaveformVinyl
      track={t?.track ? { ...t.track, type: 'beat', audio_url: '/a.wav' } : null}
      isPlaying={t?.playing ?? false}
      playingId={t?.track?.id ?? null}
      onTogglePlay={t ? () => t.toggle() : undefined}
      size="compact"
    />
  );
}

const bar = () => screen.getByTestId('share-transport-bar');
const disc = () => screen.getByTestId('share-vinyl-disc');
const playingRow = () => screen.getAllByTestId('share-track-row')[1];

describe('one clock', () => {
  it('the bar time, the bar progress and the playing row waveform read the same position', () => {
    render(<Page t={value({ currentTime: 50, duration: 200 })} />);
    expect(within(bar()).getByText('0:50')).toBeTruthy();
    expect(within(bar()).getByText('3:20')).toBeTruthy();
    expect(within(bar()).getByRole('slider').getAttribute('aria-valuenow')).toBe('25');
    expect(within(playingRow()).getByRole('slider').getAttribute('aria-valuenow')).toBe('25');
  });

  it('moving the clock moves every view together', () => {
    const { rerender } = render(<Page t={value({ currentTime: 50 })} />);
    rerender(<Page t={value({ currentTime: 100 })} />);
    expect(within(bar()).getByText('1:40')).toBeTruthy();
    expect(within(bar()).getByRole('slider').getAttribute('aria-valuenow')).toBe('50');
    expect(within(playingRow()).getByRole('slider').getAttribute('aria-valuenow')).toBe('50');
  });

  it('a track change shows in the bar, the vinyl and the active row', () => {
    const next = { ...tracks[2], audio_url: '/c.wav' };
    const { rerender } = render(<Page t={value()} />);
    expect(within(bar()).getAllByText('Two').length).toBeGreaterThan(0);
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <ShareTransportProvider value={value({ track: next, index: 2 })}>
          <VinylFromTransport />
          <ShareTrackList tracks={tracks} playingId="t2" isPlaying onPlay={() => {}} />
          <ShareTransportBar />
        </ShareTransportProvider>
      </QueryClientProvider>,
    );
    expect(within(bar()).getAllByText('Three').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Three').length).toBeGreaterThan(1);
    expect(screen.getAllByTestId('share-track-row')[2].querySelector('[aria-label="Pause track"]')).toBeTruthy();
  });
});

describe('every control moves the one engine', () => {
  it('play / pause / prev / next on the bar, and the vinyl, call the same transport', () => {
    const t = value();
    render(<Page t={t} />);
    fireEvent.click(within(bar()).getByRole('button', { name: 'Pause' }));
    fireEvent.click(within(bar()).getByRole('button', { name: 'Previous track' }));
    fireEvent.click(within(bar()).getByRole('button', { name: 'Next track' }));
    expect(t.toggle).toHaveBeenCalledTimes(1);
    // The vinyl's own button is the same remote.
    const vinyl = within(disc()).getByRole('button', { name: 'Pause' });
    fireEvent.click(vinyl);
    expect(t.toggle).toHaveBeenCalledTimes(2);
    expect(t.prev).toHaveBeenCalledTimes(1);
    expect(t.next).toHaveBeenCalledTimes(1);
  });

  it('seeking on the bar waveform seeks the engine', () => {
    const t = value();
    render(<Page t={t} />);
    const slider = within(bar()).getByRole('slider');
    slider.getBoundingClientRect = () => ({ left: 0, width: 100, top: 0, right: 100, bottom: 26, height: 26, x: 0, y: 0, toJSON() {} });
    fireEvent.click(slider, { clientX: 80 });
    expect(t.seekToFraction).toHaveBeenCalledWith(0.8);
    fireEvent.keyDown(slider, { key: 'End' });
    expect(t.seekToFraction).toHaveBeenLastCalledWith(1);
  });
});

describe('the vinyl follows the audio element, not the click', () => {
  it('spins while the engine is playing', () => {
    render(<Page t={value({ playing: true })} />);
    expect(disc().getAttribute('data-spinning')).toBe('true');
    expect(disc().style.animationPlayState).toBe('running');
  });

  it('does not spin when play was requested but the element is not playing (loading, stalled)', () => {
    render(<Page t={value({ playing: false, buffering: true })} requested />);
    expect(disc().getAttribute('data-spinning')).toBe('false');
    expect(disc().style.animationPlayState).toBe('paused');
    // The bar says so rather than showing Pause over silence.
    expect(within(bar()).getByText('Buffering...')).toBeTruthy();
  });

  it('stops on pause and when a track ends (the engine reports not playing)', () => {
    const { rerender } = render(<Page t={value({ playing: true })} />);
    rerender(<Page t={value({ playing: false })} requested={false} />);
    expect(disc().getAttribute('data-spinning')).toBe('false');
  });

  it('does not spin at all under reduced motion', () => {
    const original = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false, onchange: null })) as typeof window.matchMedia;
    try {
      render(<Page t={value({ playing: true })} />);
      expect(disc().className).not.toMatch(/animate-/);
      expect(disc().style.animationPlayState).toBe('');
    } finally {
      window.matchMedia = original;
    }
  });
});

describe('ShareActions (the header strip)', () => {
  it('holds only the per-share options: no per-track downloads', () => {
    render(<ShareActions allowDownloads fullPlayback />);
    expect(screen.queryByRole('button', { name: /^Download / })).toBeNull();
    expect(screen.getByTestId('share-playback-mode').textContent).toMatch(/Full track/i);
  });

  it('says when downloads are off and shows the preview label', () => {
    render(<ShareActions allowDownloads={false} fullPlayback={false} />);
    expect(screen.getByText('Downloads are off for this link.')).toBeTruthy();
    expect(screen.getByTestId('share-playback-mode').textContent).toMatch(/1:15/);
  });

  it('keeps the collaboration entry for commenters and editors only', () => {
    const onOpen = vi.fn();
    const { unmount } = render(<ShareActions allowDownloads fullPlayback collaboration={{ role: 'editor', commentCount: 2, onOpen }} />);
    fireEvent.click(screen.getByRole('button', { name: /Comment & edit/ }));
    expect(onOpen).toHaveBeenCalled();
    unmount();
    render(<ShareActions allowDownloads fullPlayback />);
    expect(screen.queryByRole('button', { name: /Leave feedback|Comment & edit/ })).toBeNull();
  });
});
