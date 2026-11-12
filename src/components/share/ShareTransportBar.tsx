'use client';

import { MiniWaveform } from '@/components/player/MiniWaveform';
import { PlayerPill } from '@/components/player/PlayerPill';
import { useShareTransport } from '@/components/share/ShareTransport';
import { getPlayerStreamStatus } from '@/lib/audio/player-status';

/**
 * The share page's bottom bar. It is the store player's own pill
 * (`PlayerPill`) driven by the page's one engine through `ShareTransport`: a
 * view and remote, never a second player. Time, progress, play state and the
 * track all come from the same context the rows and the vinyl read.
 */
export function ShareTransportBar() {
  const t = useShareTransport();
  if (!t || !t.track) return null;
  const { track } = t;
  const total = t.duration || track.duration_seconds || 0;
  const progress = total > 0 ? Math.min(1, Math.max(0, t.currentTime / total)) : 0;
  const status = getPlayerStreamStatus({
    hasAudioUrl: Boolean(track.audio_url),
    isPlaying: t.playing,
    isBuffering: t.buffering,
    playbackError: null,
    trackType: track.type,
    bpm: track.bpm,
  });
  return (
    <div
      data-testid="share-transport-bar"
      className="fixed bottom-3 md:bottom-5 left-2 right-2 md:left-1/2 md:right-auto md:-translate-x-1/2 z-50 pointer-events-none flex justify-center"
      style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
    >
      <PlayerPill
        track={track}
        metaLabel={status.metaLabel}
        badgeLabel={status.badgeLabel}
        isPlaying={t.playing}
        isBuffering={t.buffering}
        canPlay={status.canAttemptPlayback}
        playTitle={status.detail ?? status.title}
        currentSeconds={t.currentTime}
        totalSeconds={total}
        waveform={track.audio_url ? (
          <MiniWaveform
            trackId={track.id}
            peaksUrl={track.peaks_url}
            height={26}
            isActive
            progress={progress}
            durationSeconds={total || null}
            label={track.title}
            onSeek={t.seekToFraction}
          />
        ) : (
          <div className="w-full h-[2px] bg-white/10 rounded" />
        )}
        onPrev={t.prev}
        onPlay={t.toggle}
        onNext={t.next}
      />
    </div>
  );
}
