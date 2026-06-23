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
  compact?: boolean;
  priceFor: (t: T, kind: 'lease' | 'exclusive') => number | null;
  onPlay: (t: T) => void;
  onPreview: (t: T) => void;
}

export function RecommendationsStrip<T extends MinTrack>({
  label, tracks, accentColor, currentTrackId, isPlaying, compact = false, priceFor, onPlay, onPreview,
}: RecommendationsStripProps<T>) {
  const display = useMemo(() => tracks.slice(0, 12), [tracks]);
  if (display.length === 0) return null;

  return (
    <section className={`${compact ? 'mt-7' : 'mt-12'} max-w-[1400px] mx-auto px-4 md:px-8`}>
      <div className={`flex items-baseline justify-between ${compact ? 'mb-2' : 'mb-3'}`}>
        <p className="text-[10px] font-mono uppercase tracking-[0.25em] text-[#D0C3AF]">
          {label}
        </p>
        <p className="text-[9px] font-mono uppercase tracking-wider text-[#6E685B] tabular-nums">
          {display.length} {display.length === 1 ? 'pick' : 'picks'}
        </p>
      </div>

      <div className={`${compact ? 'gap-2 pb-1.5' : 'gap-3 pb-2'} flex overflow-x-auto no-scrollbar`}>
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
              className={`${compact ? 'w-[104px] sm:w-[118px] rounded-lg' : 'w-[140px] sm:w-[160px] rounded-xl'} group shrink-0 text-left border border-[#2B2821] bg-[#171511] hover:border-[#3B372F] transition-colors overflow-hidden flex flex-col`}
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
                  <span className={`${compact ? 'w-8 h-8' : 'w-10 h-10'} rounded-full bg-white text-black flex items-center justify-center shadow-xl`}>
                    {isCurrentPlaying ? <PauseGlyph size={compact ? 14 : 17} /> : <PlayGlyph size={compact ? 14 : 17} className="ml-0.5" />}
                  </span>
                </span>
              </div>

              {/* Body */}
              <div className={`${compact ? 'p-2 gap-0.5' : 'p-2.5 gap-1'} flex flex-col min-w-0`}>
                <p className={`${compact ? 'text-[11px]' : 'text-[12px]'} font-medium truncate ${isCurrent ? '' : 'text-[#F7EBDD]'}`}
                  style={isCurrent ? { color: accentColor } : {}}
                >
                  {t.title}
                </p>
                <div className="flex items-center justify-between gap-2">
                  <span className={`${compact ? 'text-[8px]' : 'text-[9px]'} font-mono uppercase tracking-wider text-[#9B9282] truncate`}>
                    {t.type}{t.bpm ? ` · ${t.bpm}` : ''}
                  </span>
                  {free ? (
                    <span className={`${compact ? 'text-[8px] px-1' : 'text-[9px] px-1.5'} font-mono uppercase tracking-wider text-[#6DC6A4] bg-[#6DC6A4]/10 border border-[#6DC6A4]/20 py-0.5 rounded`}>
                      Free
                    </span>
                  ) : lease != null ? (
                    <span className={`${compact ? 'text-[9px]' : 'text-[11px]'} font-mono font-bold text-[#F7EBDD] tabular-nums`}>
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
