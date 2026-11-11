'use client';

import { memo, useEffect, useRef, useState } from 'react';
import { MiniWaveform } from '@/components/player/MiniWaveform';
import { useShareTransport } from '@/components/share/ShareTransport';

/** What the row waveform needs from a track. */
export interface ShareRowWaveformTrack {
  id: string;
  title: string;
  peaks_url?: string | null;
  duration_seconds?: number | null;
}

interface Props {
  track: ShareRowWaveformTrack;
  active: boolean;
  /** Start playing this track (a click on a row that is not the playing one). */
  onPlay: () => void;
  height?: number;
}

const WAVEFORM_HEIGHT = 36;

/**
 * THE waveform on a share row. Everything about how a row draws its waveform
 * goes through this one component, so the look can be replaced (or the engine
 * behind it) by editing this file and nothing else. Today it renders the
 * store's `MiniWaveform` in controlled mode.
 *
 * Cost control for a 200-beat share:
 * - it is a pure picture. No WaveSurfer, no audio element: the page's single
 *   engine plays the active track, and only that row reads the transport.
 * - bars are mounted only while the row is near the viewport. Scrolled away,
 *   the SVG is dropped and an empty box of the same height keeps the layout.
 * - peaks (the signed share route) are fetched by MiniWaveform only once its
 *   own observer sees it, so a beat nobody scrolls to never requests them.
 */
function ShareRowWaveformImpl({ track, active, onPlay, height = WAVEFORM_HEIGHT }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(() => typeof IntersectionObserver === 'undefined');

  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      ([entry]) => setNear(!!entry?.isIntersecting),
      { rootMargin: '400px 0px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={boxRef} data-testid="share-row-waveform" style={{ height }} className="w-full">
      {near && (active
        ? <ActiveWaveform track={track} height={height} onPlay={onPlay} />
        : <MiniWaveform trackId={track.id} peaksUrl={track.peaks_url} height={height} isActive={false} onPlay={onPlay} progress={0} />)}
    </div>
  );
}

/** Only the playing row subscribes to the transport, so the other 199 do not re-render each tick. */
function ActiveWaveform({ track, height, onPlay }: { track: ShareRowWaveformTrack; height: number; onPlay: () => void }) {
  const transport = useShareTransport();
  const duration = transport?.duration || track.duration_seconds || 0;
  const progress = transport && duration > 0 ? Math.min(1, Math.max(0, transport.currentTime / duration)) : 0;
  return (
    <MiniWaveform
      trackId={track.id}
      peaksUrl={track.peaks_url}
      height={height}
      isActive
      onPlay={onPlay}
      progress={progress}
      durationSeconds={duration || null}
      label={track.title}
      onSeek={transport ? transport.seekToFraction : () => {}}
    />
  );
}

export const ShareRowWaveform = memo(ShareRowWaveformImpl);
