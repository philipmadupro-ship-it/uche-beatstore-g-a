'use client';

import { Music, Heart, Download } from 'lucide-react';
import { PlayGlyph, PauseGlyph } from '@/components/player/TransportIcons';
import { CoverImage } from '@/components/ui/CoverImage';
import type { StoreTrack } from './types';

interface Props {
  track: StoreTrack;
  allTracks: StoreTrack[];
  priceLease: number | null;
  priceExclusive: number | null;
  isCurrent: boolean;
  isPlaying: boolean;
  isPreview: boolean;
  onPlay: () => void;
  onPreview: () => void;
  onAddLease: () => void;
  onAddExclusive: () => void;
  onFreeDownload: () => void;
  accentColor: string;
  isWishlisted?: boolean;
  onToggleWishlist?: () => void;
}

export function BeatCard({
  track, allTracks: _allTracks, priceLease, priceExclusive, isCurrent, isPlaying, isPreview,
  onPlay, onPreview, onAddLease, onAddExclusive, onFreeDownload, accentColor,
  isWishlisted, onToggleWishlist,
}: Props) {
  const stop = (fn: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); fn(); };

  const shellStyle: React.CSSProperties = isPreview
    ? { borderColor: `${accentColor}99`, boxShadow: `0 20px 60px ${accentColor}18, 0 0 0 1px ${accentColor}26` }
    : isPlaying
      ? { borderColor: `${accentColor}55`, boxShadow: `0 0 0 1px ${accentColor}22` }
      : isCurrent
        ? { borderColor: `${accentColor}3A` }
        : {};

  const keyLabel = track.key ? `${track.key}${track.scale === 'minor' ? 'm' : ''}` : null;

  // Compact metadata: "Instrumental · 142 BPM · Fm" on one line
  const meta = [
    track.type,
    track.bpm ? `${track.bpm} BPM` : null,
    keyLabel,
  ].filter(Boolean).join(' · ');

  // From price for compact mobile display
  const fromPrice = priceLease ?? priceExclusive;

  return (
    <div
      id={`beat-${track.id}`}
      role="button"
      tabIndex={0}
      onClick={onPreview}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPreview(); } }}
      className={`group relative rounded-2xl border bg-[#14110d]/90 backdrop-blur-xl overflow-hidden transition-all duration-200 flex flex-col cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-[#D4BFA0]/40
        ${!isPreview ? 'border-white/[0.06] hover:border-white/[0.12] hover:-translate-y-px hover:shadow-[0_16px_40px_rgba(0,0,0,0.5)]' : ''}`}
      style={shellStyle}
    >
      {/* ── Cover ── */}
      <div
        data-card-action
        onClick={stop(onPlay)}
        className="relative w-full aspect-square cursor-pointer overflow-hidden bg-[#0a0907]"
      >
        {track.cover_url ? (
          <CoverImage
            src={track.cover_url}
            alt=""
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 280px"
            className="block w-full h-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.03]"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center" style={{ background: `linear-gradient(135deg, #2A2418, #0a0907)` }}>
            <Music size={28} className="text-[#3a3328]" />
          </div>
        )}

        {/* Bottom scrim — always present for chip legibility */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent pointer-events-none" />

        {/* Centre play overlay — appears on hover */}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none">
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center shadow-[0_8px_24px_rgba(0,0,0,0.6)]"
            style={{ backgroundColor: accentColor }}
          >
            {isCurrent && isPlaying ? <PauseGlyph size={18} /> : <PlayGlyph size={18} className="ml-0.5 text-black" />}
          </div>
        </div>

        {/* Top-left: exclusive sold / free / BPM */}
        {track.exclusive_sold ? (
          <span className="absolute top-2 left-2 z-20 px-1.5 py-0.5 rounded text-[8px] font-mono font-bold uppercase tracking-wider bg-black/70 text-[#D4BFA0] border border-[#D4BFA0]/30 backdrop-blur-sm">
            Sold
          </span>
        ) : track.free_download_enabled ? (
          <span className="absolute top-2 left-2 z-20 px-1.5 py-0.5 rounded text-[8px] font-mono font-bold uppercase tracking-wider bg-[#6DC6A4] text-black">
            Free
          </span>
        ) : track.bpm ? (
          <span className="absolute top-2 left-2 z-20 px-1.5 py-0.5 rounded text-[8px] font-mono bg-black/60 text-white/80 border border-white/[0.08] backdrop-blur-sm">
            {track.bpm}
          </span>
        ) : null}

        {/* Top-right: key */}
        {keyLabel && (
          <span
            className="absolute top-2 right-2 z-20 px-1.5 py-0.5 rounded text-[8px] font-mono font-semibold backdrop-blur-sm"
            style={{ backgroundColor: `${accentColor}CC`, color: '#0a0907' }}
          >
            {keyLabel}
          </span>
        )}

        {/* Wishlist */}
        {onToggleWishlist && (
          <button
            data-card-action
            type="button"
            onClick={stop(onToggleWishlist)}
            aria-pressed={!!isWishlisted}
            className={`absolute bottom-2 right-2 z-20 w-7 h-7 rounded-full flex items-center justify-center backdrop-blur-sm transition-colors ${
              isWishlisted
                ? 'bg-[#c8a84b]/25 border border-[#c8a84b]/50 text-[#c8a84b]'
                : 'bg-black/40 border border-white/[0.10] text-white/60 hover:text-white'
            }`}
          >
            <Heart size={12} fill={isWishlisted ? 'currentColor' : 'none'} />
          </button>
        )}

        {/* Playing indicator */}
        {isCurrent && (
          <span className="absolute bottom-2 left-2 z-20 flex items-center gap-1 pointer-events-none">
            <span className="w-1.5 h-1.5 rounded-full bg-[#6DC6A4] shadow-[0_0_6px_#6DC6A4] animate-pulse" />
          </span>
        )}
      </div>

      {/* ── Body — ultra-clean, three rows max ── */}
      <div className="px-3 py-3 flex flex-col gap-2.5">
        {/* Title */}
        <p
          className="text-[13px] sm:text-[14px] font-semibold text-[#E8DCC8] truncate leading-snug group-hover:text-white transition-colors"
          style={isPreview || isCurrent ? { color: accentColor } : {}}
        >
          {track.title}
        </p>

        {/* Single metadata line */}
        <p className="text-[10px] font-mono text-white/35 uppercase tracking-[0.12em] truncate">
          {meta}
        </p>

        {/* ── Buy strip ── */}
        <div data-card-action onClick={(e) => e.stopPropagation()}>
          {track.exclusive_sold ? (
            <div className="flex items-center justify-center h-9 rounded-xl border border-[#D4BFA0]/20 text-[#D4BFA0]/60 text-[10px] font-mono uppercase tracking-wider">
              Exclusive sold
            </div>
          ) : track.free_download_enabled ? (
            <button
              onClick={stop(onFreeDownload)}
              className="flex items-center justify-center gap-1.5 w-full h-9 rounded-xl bg-[#6DC6A4]/10 border border-[#6DC6A4]/25 hover:bg-[#6DC6A4]/20 text-[#6DC6A4] text-[10px] font-mono font-bold uppercase tracking-wider transition-colors"
            >
              <Download size={11} />
              Free
            </button>
          ) : (
            /* Two-button strip: Lease | Exclusive. On very narrow screens
               the labels drop to just the price so nothing overflows. */
            <div className="flex gap-1.5 h-9">
              <button
                onClick={stop(onAddLease)}
                disabled={priceLease == null}
                className="flex-1 flex flex-col items-center justify-center rounded-xl bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.09] hover:border-white/[0.14] transition-colors disabled:opacity-25 disabled:cursor-not-allowed"
              >
                <span className="text-[7px] font-mono uppercase tracking-[0.2em] text-white/30 leading-none">Lease</span>
                <span className="text-[13px] font-bold text-[#E8DCC8] tabular-nums leading-tight">
                  {priceLease != null ? `$${priceLease}` : '—'}
                </span>
              </button>
              <button
                onClick={stop(onAddExclusive)}
                disabled={priceExclusive == null}
                className="flex-1 flex flex-col items-center justify-center rounded-xl transition-opacity disabled:opacity-25 disabled:cursor-not-allowed hover:opacity-90"
                style={{ backgroundColor: accentColor }}
              >
                <span className="text-[7px] font-mono uppercase tracking-[0.2em] text-black/40 leading-none">Excl.</span>
                <span className="text-[13px] font-bold text-black tabular-nums leading-tight">
                  {priceExclusive != null ? `$${priceExclusive}` : '—'}
                </span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
