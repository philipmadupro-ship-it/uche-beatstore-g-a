// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import type { Track } from '@/lib/types';
import { usePlayerKeyboardShortcuts } from './usePlayerKeyboardShortcuts';

function Harness(props: Parameters<typeof usePlayerKeyboardShortcuts>[0]) {
  usePlayerKeyboardShortcuts(props);
  return null;
}

function setup(volume = 0.5) {
  const fns = {
    togglePlay: vi.fn(), next: vi.fn(), prev: vi.fn(), seekTo: vi.fn(),
    setVolume: vi.fn(), toggleMute: vi.fn(),
  };
  const track = { id: 't', audio_url: 'x.mp3', duration_seconds: 100 } as Track;
  render(<Harness currentTrack={track} progress={0} volume={volume} {...fns} />);
  return fns;
}

afterEach(cleanup);

describe('usePlayerKeyboardShortcuts', () => {
  it('m toggles mute without touching volume or playback', () => {
    const f = setup();
    fireEvent.keyDown(window, { key: 'm' });
    expect(f.toggleMute).toHaveBeenCalledTimes(1);
    expect(f.setVolume).not.toHaveBeenCalled();
    expect(f.togglePlay).not.toHaveBeenCalled();
  });

  it('space toggles playback without touching volume or mute', () => {
    const f = setup();
    fireEvent.keyDown(window, { key: ' ' });
    expect(f.togglePlay).toHaveBeenCalledTimes(1);
    expect(f.setVolume).not.toHaveBeenCalled();
    expect(f.toggleMute).not.toHaveBeenCalled();
  });

  it('arrows step the level and never toggle mute', () => {
    const f = setup(0.5);
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(f.setVolume.mock.calls.map(([v]) => v)).toEqual([0.6, 0.4]);
    expect(f.toggleMute).not.toHaveBeenCalled();
  });
});
