// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import type { Track } from '@/lib/types';

// Keep the engine off IndexedDB; only the element's behaviour matters here.
vi.mock('@/lib/offline/audio-cache', () => ({ getOfflineSrc: async () => null }));
vi.mock('@/lib/audio/preview-cache', () => ({
  getPreviewSrc: async () => null,
  peekPreviewSrc: () => null,
}));

import { SimpleAudioEngine } from './SimpleAudioEngine';
import { usePlayer } from '@/hooks/usePlayer';

const track = (id: string) =>
  ({ id, title: id, audio_url: `https://cdn.example/${id}.mp3`, duration_seconds: 60 }) as Track;

let play: ReturnType<typeof vi.fn>;
let pause: ReturnType<typeof vi.fn>;
let load: ReturnType<typeof vi.fn>;

beforeEach(() => {
  play = vi.fn(() => Promise.resolve());
  pause = vi.fn();
  load = vi.fn();
  Object.assign(HTMLMediaElement.prototype, { play, pause, load });
  usePlayer.setState({
    currentTrack: null, queue: [], history: [], isPlaying: false,
    isBuffering: false, playbackError: null, progress: 0,
    volume: 0.5, muted: false, duckGain: 1, seekTarget: null,
  });
});

afterEach(cleanup);

function audio(container: HTMLElement) {
  return container.querySelector('audio') as HTMLAudioElement;
}

describe('SimpleAudioEngine volume vs playback', () => {
  it('mute silences the element without pausing, reloading or losing the level', () => {
    const { container } = render(<SimpleAudioEngine />);
    act(() => { usePlayer.getState().setTrack(track('a')); });
    const a = audio(container);
    expect(a.volume).toBeCloseTo(0.5);
    const loadsBefore = load.mock.calls.length;
    const pausesBefore = pause.mock.calls.length;

    act(() => { usePlayer.getState().toggleMute(); });
    expect(a.volume).toBe(0);
    expect(usePlayer.getState()).toMatchObject({ isPlaying: true, volume: 0.5, muted: true });
    expect(load.mock.calls.length).toBe(loadsBefore);
    expect(pause.mock.calls.length).toBe(pausesBefore);

    act(() => { usePlayer.getState().toggleMute(); });
    expect(a.volume).toBeCloseTo(0.5);
  });

  it('pause/resume and track switches keep the element silent while muted', () => {
    const { container } = render(<SimpleAudioEngine />);
    act(() => { usePlayer.getState().setQueue([track('a'), track('b')]); });
    act(() => { usePlayer.getState().setTrack(track('a')); });
    act(() => { usePlayer.getState().toggleMute(); });
    const a = audio(container);

    act(() => { usePlayer.getState().togglePlay(); });
    expect(pause).toHaveBeenCalled();
    act(() => { usePlayer.getState().togglePlay(); });
    expect(a.volume).toBe(0);

    act(() => { usePlayer.getState().next(); });
    expect(a.getAttribute('src') ?? a.src).toContain('b.mp3');
    expect(a.volume).toBe(0);

    // Changing the level while muted and at zero does not unmute.
    act(() => { usePlayer.getState().setVolume(0); });
    expect(a.volume).toBe(0);
    // Raising it does, at the new level.
    act(() => { usePlayer.getState().setVolume(0.3); });
    expect(a.volume).toBeCloseTo(0.3);
    expect(usePlayer.getState().isPlaying).toBe(true);
  });
});

describe('SimpleAudioEngine remount (layout change)', () => {
  // The engine lives in a layout. Store → checkout, or dashboard → a share
  // page, unmounts it; an element leaving the page stops, so the store must
  // stop claiming it plays, and the next engine must pick up where it was.
  it('unmounting marks the store paused instead of leaving it "playing" over silence', () => {
    const { unmount } = render(<SimpleAudioEngine />);
    act(() => { usePlayer.getState().setTrack(track('a')); });
    expect(usePlayer.getState().isPlaying).toBe(true);

    unmount();
    expect(usePlayer.getState()).toMatchObject({ isPlaying: false, isBuffering: false });
    expect(usePlayer.getState().currentTrack?.id).toBe('a');
  });

  it('a remounted engine resumes the same track at its position and does not start on its own', () => {
    const first = render(<SimpleAudioEngine />);
    act(() => { usePlayer.getState().setTrack(track('a')); });
    act(() => { usePlayer.getState().setProgress(0.5); });
    first.unmount();

    const playsBefore = play.mock.calls.length;
    const { container } = render(<SimpleAudioEngine />);
    const a = audio(container);
    expect(a.getAttribute('src')).toContain('a.mp3');
    // duration_seconds 60 × 0.5 — jsdom has no media metadata, so the stored
    // duration is what the engine falls back to.
    expect(a.currentTime).toBe(30);
    expect(play.mock.calls.length).toBe(playsBefore);

    act(() => { usePlayer.getState().togglePlay(); });
    expect(play.mock.calls.length).toBeGreaterThan(playsBefore);
    expect(a.currentTime).toBe(30);
  });

  it('a track picked while no engine was mounted starts from the top', () => {
    const first = render(<SimpleAudioEngine />);
    act(() => { usePlayer.getState().setTrack(track('a')); });
    act(() => { usePlayer.getState().setProgress(0.5); });
    first.unmount();

    // e.g. Play all on a page without the player bar: setTrack resets progress.
    act(() => { usePlayer.getState().setTrack(track('b')); });
    const { container } = render(<SimpleAudioEngine />);
    const a = audio(container);
    expect(a.getAttribute('src')).toContain('b.mp3');
    expect(a.currentTime).toBe(0);
  });
});
