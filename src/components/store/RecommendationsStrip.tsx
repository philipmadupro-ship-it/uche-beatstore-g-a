'use client';

/**
 * RecommendationsStrip — horizontal scrollable carousel of related tracks
 * rendered at the bottom of /store to keep visitors browsing after the
 * main list scrolls off-screen.
 *
 * Two strips stack on the page: "More from this producer" and
 * "You might also like". Each is just this same component with different
 * pre-computed track arrays passed in.
 */

import { useMemo } from 'react';
import { Music } from 'lucide-react';
import { PlayGlyph, PauseGlyph } from '@/components/player/TransportIcons';
import { CoverImage } from '@/components/ui/CoverImage';

interface MinTrack {
  id: string;
  title: string;
  type: string;
  cover_url?: string | null;
  bpm?: number | null;
  free_download_enabled?: boolean | null;
}

interface RecommendationsStripProps<T extends MinTrack> {
  label: string;
  tracks: T[];
  accentColor: string;
  currentTrackId: string | null;
  isPlaying: boolean;
  priceFor: (t: T, kind: 'lease' | 'exclusive') => number | null;
  onPlay: (t: T) => void;
  onPreview: (t: T) => void;
}

export function RecommendationsStrip<T extends MinTrack>({
  label, tracks, accentColor, currentTrackId, isPlaying, priceFor, onPlay, onPreview,
}: RecommendationsStripProps<T>) {
  const display = useMemo(() => tracks.slice(0, 12), [tracks]);
  if (display.length === 0) return null;

  return (
    <section className="mt-12 max-w-[1400px] mx-auto px-4 md:px-8">
      <div className="flex items-baseline justify-between mb-3">
        <p className="text-[10px] font-mono uppercase tracking-[0.25em] text-[#D0C3AF]">
          {label}
        </p>
        <p className="text-[9px] font-mono uppercase tracking-wider text-[#6E685B] tabular-nums">
          {display.length} {display.length === 1 ? 'pick' : 'picks'}
        </p>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-2 no-scrollbar">
        {display.map((t) => {
          const isCurrent = currentTrackId === t.id;
          const isCurrentPlaying = isCurrent && isPlaying;
          const lease = priceFor(t, 'lease');
          const free = !!t.free_download_enabled;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onPreview(t)}
              className="group shrink-0 w-[140px] sm:w-[160px] text-left rounded-xl border border-[#2B2821] bg-[#171511] hover:border-[#3B372F] transition-colors overflow-hidden flex flex-col"
            >
              {/* Cover */}
              <div className="relative aspect-square bg-[#090907] overflow-hidden">
                {t.cover_url ? (
                  <CoverImage src={t.cover_url} alt="" sizes="160px" className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-[#6E685B] bg-gradient-to-br from-[#2B2821] to-[#090907]">
                    <Music size={18} />
                  </div>
                )}
                {/* Play affordance — stopPropagation so the cover's preview-click stays the default for the rest of the card */}
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => { e.stopPropagation(); onPlay(t); }}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onPlay(t); } }}
                  className={`absolute inset-0 flex items-center justify-center bg-black/40 transition-opacity ${
                    isCurrent ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                  }`}
                  aria-label={isCurrentPlaying ? 'Pause' : 'Play'}
                >
                  <span className="w-10 h-10 rounded-full bg-white text-black flex items-center justify-center shadow-xl">
                    {isCurrentPlaying ? <PauseGlyph size={17} /> : <PlayGlyph size={17} className="ml-0.5" />}
                  </span>
                </span>
              </div>

              {/* Body */}
              <div className="p-2.5 flex flex-col gap-1 min-w-0">
                <p className={`text-[12px] font-medium truncate ${isCurrent ? '' : 'text-[#F7EBDD]'}`}
                  style={isCurrent ? { color: accentColor } : {}}
                >
                  {t.title}
                </p>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[9px] font-mono uppercase tracking-wider text-[#9B9282] truncate">
                    {t.type}{t.bpm ? ` · ${t.bpm}` : ''}
                  </span>
                  {free ? (
                    <span className="text-[9px] font-mono uppercase tracking-wider text-[#6DC6A4] bg-[#6DC6A4]/10 border border-[#6DC6A4]/20 px-1.5 py-0.5 rounded">
                      Free
                    </span>
                  ) : lease != null ? (
                    <span className="text-[11px] font-mono font-bold text-[#F7EBDD] tabular-nums">
                      ${lease}
                    </span>
                  ) : (
                    <span className="text-[10px] font-mono text-[#6E685B]">—</span>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
