import { describe, expect, it } from 'vitest';
import { getPlayerStreamStatus } from './player-status';

describe('getPlayerStreamStatus', () => {
  it('blocks playback when no preview URL exists', () => {
    expect(getPlayerStreamStatus({
      hasAudioUrl: false,
      isPlaying: false,
      isBuffering: false,
      playbackError: null,
      trackType: 'beat',
      bpm: 140,
    })).toMatchObject({
      metaLabel: 'Preview unavailable',
      badgeLabel: 'No audio',
      canAttemptPlayback: false,
      canSeek: false,
      coverState: 'error',
    });
  });

  it('distinguishes autoplay prompts from broken streams', () => {
    expect(getPlayerStreamStatus({
      hasAudioUrl: true,
      isPlaying: false,
      isBuffering: false,
      playbackError: 'Tap play to start this preview.',
    })).toMatchObject({
      metaLabel: 'Ready to resume',
      badgeLabel: 'Tap play',
      canAttemptPlayback: true,
      canSeek: false,
      coverState: 'error',
    });
  });

  it('reports buffering as seekable because a valid stream is still loading', () => {
    expect(getPlayerStreamStatus({
      hasAudioUrl: true,
      isPlaying: true,
      isBuffering: true,
      playbackError: null,
    })).toMatchObject({
      metaLabel: 'Buffering...',
      canAttemptPlayback: true,
      canSeek: true,
      coverState: 'buffering',
    });
  });

  it('uses track metadata for normal playback labels', () => {
    expect(getPlayerStreamStatus({
      hasAudioUrl: true,
      isPlaying: true,
      isBuffering: false,
      playbackError: null,
      trackType: 'beat',
      bpm: 128,
    })).toMatchObject({
      metaLabel: 'beat · 128',
      title: 'Pause',
      coverState: 'playing',
    });
  });
});
