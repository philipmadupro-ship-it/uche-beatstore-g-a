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
    muted: false,
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

describe('usePlayer playback, volume and mute stay independent', () => {
  const a = makeTrack({ id: 'a', title: 'A' });
  const b = makeTrack({ id: 'b', title: 'B' });

  it('survives volume, mute, pause/resume and track switches without crosstalk', () => {
    const p = () => usePlayer.getState();
    p().setQueue([a, b]);
    p().setTrack(a);
    p().setProgress(0.4);

    // Volume change while playing: playback untouched.
    p().setVolume(0.35);
    expect(p()).toMatchObject({ isPlaying: true, volume: 0.35, muted: false, progress: 0.4 });
    expect(p().currentTrack?.id).toBe('a');

    // Mute: level kept, playback untouched.
    p().toggleMute();
    expect(p()).toMatchObject({ isPlaying: true, volume: 0.35, muted: true, progress: 0.4 });

    // Pause/resume while muted: mute and level untouched.
    p().togglePlay();
    expect(p()).toMatchObject({ isPlaying: false, volume: 0.35, muted: true });
    p().togglePlay();
    expect(p()).toMatchObject({ isPlaying: true, volume: 0.35, muted: true });

    // Switch tracks while muted: still muted at the same level.
    p().next();
    expect(p().currentTrack?.id).toBe('b');
    expect(p()).toMatchObject({ isPlaying: true, volume: 0.35, muted: true });
    p().setTrack(a);
    expect(p()).toMatchObject({ isPlaying: true, volume: 0.35, muted: true });

    // Unmute: back to the kept level, still playing.
    p().toggleMute();
    expect(p()).toMatchObject({ isPlaying: true, volume: 0.35, muted: false });
    expect(p().currentTrack?.id).toBe('a');
  });

  it('setMuted is idempotent and never changes the level', () => {
    usePlayer.getState().setVolume(0.5);
    usePlayer.getState().setMuted(true);
    usePlayer.getState().setMuted(true);
    expect(usePlayer.getState()).toMatchObject({ volume: 0.5, muted: true });
    usePlayer.getState().setMuted(false);
    expect(usePlayer.getState()).toMatchObject({ volume: 0.5, muted: false });
  });

  it('persists the mute flag and the kept level separately', () => {
    usePlayer.getState().setVolume(0.35);
    usePlayer.getState().toggleMute();
    const saved = JSON.parse(storage['antigravity-player']);
    expect(saved.state).toMatchObject({ volume: 0.35, muted: true });
    expect(saved.state.isPlaying).toBeUndefined();
  });

  it('restores mute and level after a reload', async () => {
    storage['antigravity-player'] = JSON.stringify({ state: { volume: 0.35, muted: true }, version: 1 });
    vi.resetModules();
    const { usePlayer: reloaded } = await import('./usePlayer');
    await reloaded.persist.rehydrate();
    expect(reloaded.getState()).toMatchObject({ volume: 0.35, muted: true, isPlaying: false });
  });

  it('migrates a pre-flag mute (stored as volume 0) to muted at an audible level', async () => {
    storage['antigravity-player'] = JSON.stringify({ state: { volume: 0, repeat: 'all' }, version: 0 });
    vi.resetModules();
    const { usePlayer: reloaded } = await import('./usePlayer');
    await reloaded.persist.rehydrate();
    expect(reloaded.getState()).toMatchObject({ volume: 0.8, muted: true, repeat: 'all' });
  });
});
