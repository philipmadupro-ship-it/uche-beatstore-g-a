import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '@/lib/types';
import type { usePlayer as UsePlayerStore } from './usePlayer';

const storage: Record<string, string> = {};
let usePlayer: typeof UsePlayerStore;

function makeTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: 't1',
    user_id: 'u1',
    title: 'Test Beat',
    type: 'beat',
    audio_url: 'https://example.com/test.mp3',
    duration_seconds: 120,
    bpm: 140,
    key: 'C',
    scale: 'minor',
    stems_status: 'none',
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  } as Track;
}

beforeEach(async () => {
  Object.keys(storage).forEach((key) => delete storage[key]);
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (key: string) => storage[key] ?? null,
      setItem: (key: string, value: string) => { storage[key] = value; },
      removeItem: (key: string) => { delete storage[key]; },
    },
    writable: true,
  });
  Object.defineProperty(globalThis, 'window', {
    value: globalThis,
    writable: true,
  });
  vi.resetModules();
  ({ usePlayer } = await import('./usePlayer'));
  usePlayer.setState({
    currentTrack: null,
    queue: [],
    history: [],
    isPlaying: false,
    isBuffering: false,
    playbackError: null,
    progress: 0,
    volume: 0.8,
    shuffle: false,
    shuffleOrder: [],
    repeat: 'off',
    seekTarget: null,
    duckGain: 1,
  });
});

describe('usePlayer buffering and error state', () => {
  it('starts buffering and clears prior errors when a track is selected', () => {
    usePlayer.getState().setPlaybackError('Previous failure');
    usePlayer.getState().setTrack(makeTrack());

    expect(usePlayer.getState().currentTrack?.id).toBe('t1');
    expect(usePlayer.getState().isPlaying).toBe(true);
    expect(usePlayer.getState().isBuffering).toBe(true);
    expect(usePlayer.getState().playbackError).toBeNull();
  });

  it('stores playback errors as non-buffering state', () => {
    usePlayer.getState().setBuffering(true);
    usePlayer.getState().setPlaybackError('Preview stream unavailable');

    expect(usePlayer.getState().isBuffering).toBe(false);
    expect(usePlayer.getState().playbackError).toBe('Preview stream unavailable');
  });

  it('clears playback errors when playback is toggled on again', () => {
    usePlayer.setState({ isPlaying: false, playbackError: 'Tap play to retry' });
    usePlayer.getState().togglePlay();

    expect(usePlayer.getState().isPlaying).toBe(true);
    expect(usePlayer.getState().playbackError).toBeNull();
  });
});
