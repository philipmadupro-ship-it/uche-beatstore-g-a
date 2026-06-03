'use client';

/**
 * BeatCard — Untitled-grade store card.
 *
 * Architecture: cover image IS the card. Title, type, and price are
 * overlaid on the bottom half with a gradient scrim so they're always
 * legible. The only element outside the cover is a compact buy strip —
 * keeping the card a clean, tight unit at any size.
 */

import { Heart, Download } from 'lucide-react';
import { PlayGlyph, PauseGlyph } from '@/components/player/TransportIcons';
import { CoverImage } from '@/components/ui/CoverImage';
import { seededGradient } from '@/lib/ui/cover-gradient';
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

  const keyLabel = track.key ? `${track.key}${track.scale === 'minor' ? 'm' : ''}` : null;
  const fromPrice = priceLease ?? priceExclusive;

  const ringStyle: React.CSSProperties = isPreview
    ? { boxShadow: `0 0 0 1.5px ${accentColor}` }
    : isPlaying
      ? { boxShadow: `0 0 0 1px ${accentColor}66` }
      : {};

  return (
    <div
      id={`beat-${track.id}`}
      role="button"
      tabIndex={0}
      onClick={onPreview}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPreview(); } }}
      className="group relative rounded-xl overflow-hidden cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-[#D4BFA0]/40 flex flex-col"
      style={ringStyle}
    >
      {/* ── Cover — fills the card, everything overlaid on top ── */}
      <div
        data-card-action
        onClick={stop(onPlay)}
        className="relative w-full aspect-square overflow-hidden"
      >
        {/* Art or seeded gradient fallback */}
        {track.cover_url ? (
          <CoverImage
            src={track.cover_url}
            alt=""
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 280px"
            className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.04]"
          />
        ) : (
          <div
            className="absolute inset-0"
            style={seededGradient(track.id)}
          />
        )}

        {/* Gradient scrim — bottom-heavy for text legibility */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-black/10" />

        {/* ── Top row: BPM · wishlist ── */}
        <div className="absolute top-0 inset-x-0 flex items-start justify-between p-2.5 gap-2">
          {/* BPM or status chip */}
          {track.exclusive_sold ? (
            <span className="text-[9px] font-mono font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-black/60 text-[#D4BFA0]/80 border border-[#D4BFA0]/25 backdrop-blur-sm">
              Sold
            </span>
          ) : track.free_download_enabled ? (
            <span className="text-[9px] font-mono font-bold uppercase px-1.5 py-0.5 rounded bg-[#6DC6A4] text-black">
              Free
            </span>
          ) : track.bpm ? (
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-black/50 text-white/75 backdrop-blur-sm">
              {track.bpm}
            </span>
          ) : <span />}

          {/* Wishlist */}
          {onToggleWishlist ? (
            <button
              data-card-action
              type="button"
              onClick={stop(onToggleWishlist)}
              aria-pressed={!!isWishlisted}
              className={`w-7 h-7 rounded-full flex items-center justify-center backdrop-blur-sm transition-colors shrink-0 ${
                isWishlisted
                  ? 'bg-[#c8a84b]/30 text-[#c8a84b]'
                  : 'bg-black/30 text-white/50 hover:text-white'
              }`}
            >
              <Heart size={12} fill={isWishlisted ? 'currentColor' : 'none'} />
            </button>
          ) : <span />}
        </div>

        {/* ── Centre: play button (hover) ── */}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none">
          <div
            className="w-11 h-11 rounded-full flex items-center justify-center shadow-[0_4px_20px_rgba(0,0,0,0.5)]"
            style={{ backgroundColor: accentColor }}
          >
            {isCurrent && isPlaying
              ? <PauseGlyph size={16} />
              : <PlayGlyph size={16} className="ml-0.5 text-black" />}
          </div>
        </div>

        {/* ── Bottom overlay: title + key + price ── */}
        <div className="absolute bottom-0 inset-x-0 p-2.5 flex items-end justify-between gap-2">
          <div className="min-w-0 flex-1">
            {/* Playing indicator */}
            {isCurrent && (
              <span className="block w-1.5 h-1.5 rounded-full bg-[#6DC6A4] shadow-[0_0_6px_#6DC6A4] animate-pulse mb-1.5" />
            )}
            <p
              className="text-[12px] sm:text-[13px] font-semibold text-white leading-tight truncate"
              style={isCurrent ? { color: accentColor } : {}}
            >
              {track.title}
            </p>
            <p className="text-[9px] font-mono text-white/45 uppercase tracking-[0.1em] truncate mt-0.5">
              {[track.type, keyLabel].filter(Boolean).join(' · ')}
            </p>
          </div>

          {/* Price pill — accent tinted, shown when not free/sold */}
          {!track.exclusive_sold && !track.free_download_enabled && fromPrice != null && (
            <span
              className="shrink-0 text-[11px] font-bold tabular-nums px-2 py-0.5 rounded-lg text-black"
              style={{ backgroundColor: `${accentColor}E6` }}
            >
              ${fromPrice}
            </span>
          )}
        </div>
      </div>

      {/* ── Buy strip — the only element outside the cover ── */}
      <div
        data-card-action
        onClick={(e) => e.stopPropagation()}
        className="bg-[#0e0c08] border-t border-white/[0.06]"
      >
        {track.exclusive_sold ? (
          <div className="flex items-center justify-center h-9 text-[#D4BFA0]/40 text-[9px] font-mono uppercase tracking-wider">
            Exclusive sold
          </div>
        ) : track.free_download_enabled ? (
          <button
            onClick={stop(onFreeDownload)}
            className="flex items-center justify-center gap-1.5 w-full h-9 text-[#6DC6A4] text-[9px] font-mono font-bold uppercase tracking-wider hover:bg-[#6DC6A4]/5 transition-colors"
          >
            <Download size={10} />
            Free download
          </button>
        ) : (
          <div className="flex items-stretch divide-x divide-white/[0.06] h-9">
            <button
              onClick={stop(onAddLease)}
              disabled={priceLease == null}
              className="flex-1 flex flex-col items-center justify-center hover:bg-white/[0.04] transition-colors disabled:opacity-25 disabled:cursor-not-allowed gap-px"
            >
              <span className="text-[7px] font-mono uppercase tracking-[0.18em] text-white/25 leading-none">Lease</span>
              <span className="text-[12px] font-bold text-[#E8DCC8] tabular-nums leading-none">
                {priceLease != null ? `$${priceLease}` : '—'}
              </span>
            </button>
            <button
              onClick={stop(onAddExclusive)}
              disabled={priceExclusive == null}
              className="flex-1 flex flex-col items-center justify-center transition-colors disabled:opacity-25 disabled:cursor-not-allowed gap-px hover:opacity-90"
              style={{ backgroundColor: `${accentColor}18` }}
            >
              <span className="text-[7px] font-mono uppercase tracking-[0.18em] text-white/25 leading-none">Excl.</span>
              <span className="text-[12px] font-bold tabular-nums leading-none" style={{ color: accentColor }}>
                {priceExclusive != null ? `$${priceExclusive}` : '—'}
              </span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
