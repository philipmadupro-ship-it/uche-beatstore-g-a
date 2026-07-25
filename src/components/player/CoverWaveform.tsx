'use client';

import { AlertTriangle, Eye, EyeOff, Loader2, Music } from 'lucide-react';
import { useMemo, useState } from 'react';
import { CoverImage } from '@/components/ui/CoverImage';
import { useVisualPeaks } from '@/hooks/useVisualPeaks';
import { getArtworkSafetyTreatment } from '@/lib/audio/artwork-safety';
import type { CoverPlaybackState } from '@/lib/audio/player-status';
import { buildDawWaveformBars } from '@/lib/audio/visual-peaks';
import { cn } from '@/lib/utils';

const COVER_BAR_COUNT = 84;

interface CoverWaveformProps {
  trackId: string;
  title: string;
  producerName?: string | null;
  coverUrl?: string | null;
  ambientColor?: string | null;
  peaksUrl?: string | null;
  progress: number;
  state: CoverPlaybackState;
  onSeek?: (fraction: number) => void;
  onRetry?: () => void;
  statusDetail?: string | null;
  className?: string;
}

function clampProgress(progress: number) {
  return Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0));
}

export function CoverWaveform({
  trackId,
  title,
  producerName,
  coverUrl,
  ambientColor,
  peaksUrl,
  progress,
  state,
  onSeek,
  onRetry,
  statusDetail,
  className,
}: CoverWaveformProps) {
  const { peaks, source } = useVisualPeaks(trackId, peaksUrl, COVER_BAR_COUNT);
  const [showOriginal, setShowOriginal] = useState(false);
  const safety = useMemo(() => getArtworkSafetyTreatment(ambientColor), [ambientColor]);
  const bars = useMemo(() => buildDawWaveformBars(peaks), [peaks]);
  const normalizedProgress = clampProgress(progress);
  const isError = state === 'error';
  const isLoading = state === 'loading' || state === 'buffering';
  const isActive = state === 'playing' || state === 'paused' || state === 'buffering' || state === 'purchased';

  return (
    <div
      className={cn(
        'group/cover-wave relative isolate aspect-square overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-primary)]',
        'shadow-[0_28px_70px_-18px_rgba(0,0,0,0.78),inset_0_1px_0_rgba(255,255,255,0.05)]',
        className,
      )}
    >
      {coverUrl ? (
        <CoverImage src={coverUrl} alt="" sizes="400px" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[var(--surface-active)] to-[var(--background-primary)] text-[var(--text-tertiary)]">
          <Music size={48} />
        </div>
      )}

      <div
        className="absolute inset-0 bg-gradient-to-t from-black via-black/18 to-black/10 transition-opacity duration-200"
        style={{ opacity: showOriginal ? 0 : safety.overlayOpacity }}
      />

      {isActive && !showOriginal && (
        <button
          type="button"
          onClick={(event) => {
            if (!onSeek) return;
            const rect = event.currentTarget.getBoundingClientRect();
            onSeek(clampProgress((event.clientX - rect.left) / rect.width));
          }}
          className="absolute inset-x-3 bottom-16 top-7 cursor-col-resize rounded-xl"
          aria-label={`Seek ${title}`}
        >
          <span
            aria-hidden
            className="absolute inset-0 rounded-xl bg-black blur-xl"
            style={{ opacity: safety.waveformUnderlayOpacity }}
          />
          <svg viewBox={`0 0 ${COVER_BAR_COUNT} 100`} preserveAspectRatio="none" className="h-full w-full">
            {bars.map((bar) => (
              <line
                key={`grid-${bar.index}`}
                x1={bar.index + 0.46}
                x2={bar.index + 0.46}
                y1={bar.isDownbeat ? 2 : 12}
                y2={bar.isDownbeat ? 98 : 88}
                stroke={bar.isDownbeat ? 'rgba(231,215,190,0.22)' : 'rgba(231,215,190,0.10)'}
                strokeWidth={bar.isDownbeat ? 0.08 : 0.05}
                opacity={bar.isBeat ? 1 : 0}
              />
            ))}
            {bars.map((bar) => {
              const barHeight = bar.height * 100;
              const isPlayed = bar.index / COVER_BAR_COUNT <= normalizedProgress;
              const fill = isPlayed
                ? bar.band === 'low' ? 'var(--wave-low)'
                  : bar.band === 'lowMid' ? 'var(--wave-low-mid)'
                    : bar.band === 'mid' ? 'var(--wave-mid)'
                      : bar.band === 'highMid' ? 'var(--wave-high-mid)'
                        : 'var(--wave-high)'
                : 'rgba(230,222,209,0.20)';
              return (
                <rect
                  key={bar.index}
                  x={bar.index + 0.12}
                  y={(100 - barHeight) / 2}
                  width={bar.isDownbeat ? 0.82 : 0.68}
                  height={barHeight}
                  rx={0.34}
                  fill={fill}
                  opacity={isPlayed ? safety.waveformOpacity : bar.isTransient ? 0.62 : 0.46}
                />
              );
            })}
          </svg>
          <span
            className="absolute top-0 bottom-0 w-px rounded-full bg-[var(--dr-chalk-150)] shadow-[0_0_14px_rgba(230,222,209,0.65)]"
            style={{ left: `${normalizedProgress * 100}%` }}
          />
        </button>
      )}

      {isLoading && !showOriginal && (
        <div className="absolute left-4 top-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/40 px-3 py-1.5 text-[9px] font-mono uppercase tracking-[0.18em] text-[var(--dr-chalk-150)] backdrop-blur">
          <Loader2 size={11} className="animate-spin" />
          {state === 'buffering' ? 'Buffering' : 'Loading'}
        </div>
      )}

      <div className="absolute right-4 top-4 z-10 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setShowOriginal((value) => !value)}
          className="inline-flex min-h-9 items-center gap-2 rounded-full border border-white/10 bg-black/42 px-3 text-[9px] font-mono uppercase tracking-[0.16em] text-[var(--dr-chalk-150)] backdrop-blur transition-colors hover:bg-black/58 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
          aria-pressed={showOriginal}
        >
          {showOriginal ? <EyeOff size={12} /> : <Eye size={12} />}
          {showOriginal ? 'Show treatment' : 'View original'}
        </button>
      </div>

      <div className={cn('absolute inset-x-4 bottom-4 min-w-0 transition-opacity duration-200', showOriginal && 'opacity-0 pointer-events-none')}>
        {isError && (
          <div
            role="status"
            aria-live="polite"
            className="mb-3 rounded-xl border border-[var(--error)]/35 bg-black/48 px-3 py-2 text-[var(--error-text)] shadow-[0_10px_24px_-18px_rgba(0,0,0,0.8)] backdrop-blur"
          >
            <div className="flex items-center gap-2">
              <AlertTriangle size={13} className="shrink-0" />
              <p className="min-w-0 flex-1 truncate text-[9px] font-mono uppercase tracking-[0.18em]">
                {statusDetail || 'Preview stream unavailable'}
              </p>
              {onRetry && (
                <button
                  type="button"
                  onClick={onRetry}
                  className="shrink-0 rounded-full border border-white/10 px-2 py-1 text-[8px] font-bold uppercase tracking-[0.16em] text-[var(--dr-chalk-150)] transition-colors hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
                >
                  Retry
                </button>
              )}
            </div>
          </div>
        )}
        <div className="mb-3 flex items-center justify-between gap-3">
          <span className="rounded-full border border-white/10 bg-black/35 px-2 py-1 text-[8px] font-mono uppercase tracking-[0.18em] text-[var(--dr-chalk-150)] backdrop-blur">
            {source === 'real' ? 'Real peaks' : 'Preview shape'}
          </span>
          <span className="hidden rounded-full border border-white/10 bg-black/35 px-2 py-1 text-[8px] font-mono uppercase tracking-[0.18em] text-[var(--dr-bone-200)] backdrop-blur sm:inline-flex">
            {safety.label}
          </span>
          {state === 'paused' && (
            <span className="text-[8px] font-mono uppercase tracking-[0.18em] text-[var(--dr-bone-200)]">Paused</span>
          )}
        </div>
        <h2 className="truncate text-center text-2xl font-black uppercase leading-tight tracking-normal text-[var(--dr-paper-100)]">
          {title || 'Untitled'}
        </h2>
        {producerName && (
          <p className="mt-1 truncate text-center text-[10px] font-mono uppercase tracking-[0.22em] text-[var(--dr-bone-200)]">
            {producerName}
          </p>
        )}
      </div>
    </div>
  );
}
