// @vitest-environment jsdom
import { Profiler } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/audio/visual-peaks', async (orig) => {
  const actual = await orig<typeof import('@/lib/audio/visual-peaks')>();
  return { ...actual, loadVisualPeaks: vi.fn(async () => [0.1, 0.9, 0.3, 0.7]) };
});

import { usePlayer } from '@/hooks/usePlayer';
import type { Track } from '@/lib/types';
import { RowWaveform } from './RowWaveform';

// jsdom has no IntersectionObserver. This one reports every target as visible
// straight away, which is the path that matters here.
class VisibleObserver {
  constructor(private cb: IntersectionObserverCallback) {}
  observe(el: Element) {
    this.cb([{ isIntersecting: true, target: el } as IntersectionObserverEntry], this as never);
  }
  disconnect() {}
  unobserve() {}
  takeRecords() { return []; }
}

const track = (id: string) => ({ id, title: id, duration_seconds: 200 }) as unknown as Track;

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', VisibleObserver);
  usePlayer.setState({ currentTrack: null, progress: 0, seekTarget: null });
});

const slider = () => screen.getByRole('slider');

describe('RowWaveform', () => {
  it('renders nothing for a track with no peaks, rather than a fake waveform', () => {
    const { container } = render(<RowWaveform trackId="a" peaksUrl={null} title="a" />);
    expect(container.innerHTML).toBe('');
  });

  it('loads the real shape once the row is visible', async () => {
    const { container } = render(<RowWaveform trackId="a" peaksUrl="/p.json" title="a" />);
    await waitFor(() => expect(container.querySelector('path')?.getAttribute('d')).toBeTruthy());
  });

  it('re-renders ONLY the playing row on a progress tick', () => {
    // The whole cost model. If every row read `progress`, fifty rows would
    // re-render sixty times a second and undo the list memoisation.
    usePlayer.setState({ currentTrack: track('a'), progress: 0 });
    const renders: Record<string, number> = { a: 0, b: 0 };
    const count = (id: string) => { renders[id] += 1; };

    render(
      <>
        <Profiler id="a" onRender={() => count('a')}><RowWaveform trackId="a" peaksUrl="/a.json" title="a" /></Profiler>
        <Profiler id="b" onRender={() => count('b')}><RowWaveform trackId="b" peaksUrl="/b.json" title="b" /></Profiler>
      </>,
    );
    const idleBefore = renders.b;
    const playingBefore = renders.a;

    act(() => {
      for (let i = 1; i <= 10; i += 1) usePlayer.setState({ progress: i / 100 });
    });

    expect(renders.a).toBeGreaterThan(playingBefore);
    expect(renders.b).toBe(idleBefore);
  });

  it('seeks the playing row without restarting it', () => {
    const onPlay = vi.fn();
    usePlayer.setState({ currentTrack: track('a') });
    render(<RowWaveform trackId="a" peaksUrl="/a.json" title="a" onPlay={onPlay} />);
    vi.spyOn(slider(), 'getBoundingClientRect').mockReturnValue({ left: 0, width: 200 } as DOMRect);

    fireEvent.click(slider(), { clientX: 50 });

    expect(onPlay).not.toHaveBeenCalled();
    expect(usePlayer.getState().seekTarget).toBeCloseTo(0.25);
  });

  it('starts an idle row, then seeks to where it was clicked', () => {
    const onPlay = vi.fn();
    render(<RowWaveform trackId="b" peaksUrl="/b.json" title="b" onPlay={onPlay} />);
    vi.spyOn(slider(), 'getBoundingClientRect').mockReturnValue({ left: 0, width: 200 } as DOMRect);

    fireEvent.click(slider(), { clientX: 150 });

    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(usePlayer.getState().seekTarget).toBeCloseTo(0.75);
  });

  it('cannot seek an idle row it has no way to start', () => {
    render(<RowWaveform trackId="b" peaksUrl="/b.json" title="b" />);
    fireEvent.click(slider(), { clientX: 150 });
    expect(usePlayer.getState().seekTarget).toBe(null);
  });

  it('does not let the click reach the row, which would open its details', () => {
    const rowClick = vi.fn();
    usePlayer.setState({ currentTrack: track('a') });
    render(
      <div onClick={rowClick}>
        <RowWaveform trackId="a" peaksUrl="/a.json" title="a" />
      </div>,
    );
    fireEvent.click(slider(), { clientX: 10 });
    expect(rowClick).not.toHaveBeenCalled();
  });

  it('seeks by keyboard and claims the key from the global shortcuts', () => {
    usePlayer.setState({ currentTrack: track('a'), progress: 0.5 });
    render(<RowWaveform trackId="a" peaksUrl="/a.json" title="a" />);
    let claimed = false;
    const spy = (e: KeyboardEvent) => { claimed = e.defaultPrevented; };
    window.addEventListener('keydown', spy);

    fireEvent.keyDown(slider(), { key: 'ArrowRight' });

    window.removeEventListener('keydown', spy);
    expect(usePlayer.getState().seekTarget).toBeCloseTo(0.55);
    // Otherwise the player's own ←/→ would seek a second time.
    expect(claimed).toBe(true);
  });

  it('is a tab stop only on the row that is playing', () => {
    // Fifty waveform tab stops would bury the rest of the page.
    usePlayer.setState({ currentTrack: track('a') });
    render(
      <>
        <RowWaveform trackId="a" peaksUrl="/a.json" title="Night Shift" />
        <RowWaveform trackId="b" peaksUrl="/b.json" title="Cold Front" />
      </>,
    );
    expect(screen.getByLabelText('Seek Night Shift').getAttribute('tabindex')).toBe('0');
    expect(screen.getByLabelText('Seek Cold Front').getAttribute('tabindex')).toBe('-1');
  });

  it('reports its position to assistive tech', () => {
    usePlayer.setState({ currentTrack: track('a'), progress: 0.42 });
    render(<RowWaveform trackId="a" peaksUrl="/a.json" title="a" />);
    expect(slider().getAttribute('aria-valuenow')).toBe('42');
    expect(slider().getAttribute('aria-valuetext')).toBe('42%');
  });
});
