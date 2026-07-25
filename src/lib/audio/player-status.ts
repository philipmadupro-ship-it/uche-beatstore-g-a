export type CoverPlaybackState = 'idle' | 'loading' | 'playing' | 'paused' | 'buffering' | 'error' | 'purchased';

export interface PlayerStreamStatusInput {
  hasAudioUrl: boolean;
  isPlaying: boolean;
  isBuffering: boolean;
  playbackError: string | null;
  trackType?: string | null;
  bpm?: number | null;
}

export interface PlayerStreamStatus {
  metaLabel: string;
  badgeLabel: string | null;
  detail: string | null;
  title: string;
  canAttemptPlayback: boolean;
  canSeek: boolean;
  coverState: CoverPlaybackState;
}

export function getPlayerStreamStatus({
  hasAudioUrl,
  isPlaying,
  isBuffering,
  playbackError,
  trackType,
  bpm,
}: PlayerStreamStatusInput): PlayerStreamStatus {
  if (!hasAudioUrl) {
    return {
      metaLabel: 'Preview unavailable',
      badgeLabel: 'No audio',
      detail: 'No playable preview is attached to this beat yet.',
      title: 'Preview unavailable',
      canAttemptPlayback: false,
      canSeek: false,
      coverState: 'error',
    };
  }

  if (playbackError) {
    const isGesturePrompt = playbackError.toLowerCase().includes('tap play');
    return {
      metaLabel: isGesturePrompt ? 'Ready to resume' : 'Stream unavailable',
      badgeLabel: isGesturePrompt ? 'Tap play' : 'Check source',
      detail: playbackError,
      title: isGesturePrompt ? 'Tap play to start this preview.' : 'Preview stream unavailable',
      canAttemptPlayback: true,
      canSeek: false,
      coverState: 'error',
    };
  }

  if (isBuffering) {
    return {
      metaLabel: 'Buffering...',
      badgeLabel: null,
      detail: 'Loading the preview stream.',
      title: 'Buffering preview',
      canAttemptPlayback: true,
      canSeek: true,
      coverState: 'buffering',
    };
  }

  const meta = `${trackType || 'audio'}${bpm ? ` · ${bpm}` : ''}`;

  return {
    metaLabel: meta,
    badgeLabel: null,
    detail: null,
    title: isPlaying ? 'Pause' : 'Play',
    canAttemptPlayback: true,
    canSeek: true,
    coverState: isPlaying ? 'playing' : 'paused',
  };
}
