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
  track, priceLease, priceExclusive, isCurrent, isPlaying, isPreview,
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

  // Double-bezel outer shell — the card sits inside a gradient "tray"
  // that creates physical depth without a border. The inner card has its
  // own surface, producing the machined-hardware look from the design system.
  const bezelBg = isPreview
    ? `linear-gradient(135deg, ${accentColor}55, ${accentColor}22)`
    : isPlaying
      ? `linear-gradient(135deg, ${accentColor}33, ${accentColor}11)`
      : 'linear-gradient(135deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.02) 100%)';

  return (
    <div
      id={`beat-${track.id}`}
      role="button"
      tabIndex={0}
      aria-label={`Preview ${track.title}`}
      onClick={onPreview}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPreview(); } }}
      className="group cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)]/40 rounded-[14px] p-[1.5px]"
      style={{
        background: bezelBg,
        ...ringStyle,
        transition: 'transform 400ms cubic-bezier(0.32,0.72,0,1)',
      }}
    >
    {/* Inner card — the actual surface */}
    <div
      className="relative rounded-[13px] overflow-hidden flex flex-col bg-[#171511] group-hover:shadow-[0_20px_50px_rgba(0,0,0,0.6)]"
      style={{ transition: 'box-shadow 400ms cubic-bezier(0.32,0.72,0,1)' }}
    >
      {/* ── Cover — clicking anywhere on cover opens the preview drawer.
           The play button circle inside gets pointer-events-auto so
           clicking it specifically plays without opening preview. */}
      <div
        className="relative w-full aspect-square overflow-hidden"
      >
        {/* Art or seeded gradient fallback */}
        {track.cover_url ? (
          <CoverImage
            src={track.cover_url}
            alt=""
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 280px"
            className="absolute inset-0 w-full h-full object-cover group-hover:scale-[1.05] [transition:transform_700ms_cubic-bezier(0.32,0.72,0,1)]"
          />
        ) : (
          <div
            className="absolute inset-0"
            style={seededGradient(track.id)}
          />
        )}

        {/* Gradient scrim — heavy at bottom for text legibility */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-black/5" />

        {/* ── Top row: BPM · wishlist ── */}
        <div className="absolute top-0 inset-x-0 flex items-start justify-between p-2.5 gap-2">
          {/* BPM or status chip */}
          {track.exclusive_sold ? (
            <span className="text-[9px] font-mono font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-black/60 text-[#E7D7BE]/80 border border-[#E7D7BE]/25 backdrop-blur-sm">
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
              aria-label={isWishlisted ? 'Remove from favorites' : 'Add to favorites'}
              aria-pressed={!!isWishlisted}
              className={`tap -mr-2 -mt-2 flex size-11 shrink-0 items-center justify-center rounded-full backdrop-blur-sm transition-colors ${
                isWishlisted
                  ? 'bg-[#D6BE7A]/30 text-[#D6BE7A]'
                  : 'bg-black/30 text-white/50 hover:text-white'
              }`}
            >
              <Heart size={12} fill={isWishlisted ? 'currentColor' : 'none'} />
            </button>
          ) : <span />}
        </div>

        {/* ── Centre: play button (hover). Interactive — clicking it starts
             playback in the bottom player (click-to-play); clicking anywhere
             else on the card still opens the preview/buy drawer. The wrapper
             stays pointer-events-none so only the button intercepts. ── */}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 pointer-events-none" style={{ transition: 'opacity 300ms cubic-bezier(0.22,1,0.36,1)' }}>
          <button
            type="button"
            onClick={stop(onPlay)}
            aria-label={`${isCurrent && isPlaying ? 'Pause' : 'Play'} ${track.title}`}
            className="pointer-events-auto w-11 h-11 rounded-full flex items-center justify-center shadow-[0_4px_20px_rgba(0,0,0,0.5)] transition-transform hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            style={{ backgroundColor: accentColor }}
          >
            {isCurrent && isPlaying
              ? <PauseGlyph size={16} />
              : <PlayGlyph size={16} className="ml-0.5 text-black" />}
          </button>
        </div>

        {/* ── Bottom overlay: title + key + price ── */}
        <div className="absolute bottom-0 inset-x-0 p-2.5 flex items-end justify-between gap-2">
          <div className="min-w-0 flex-1">
            {/* Playing indicator */}
            {isCurrent && (
              <span className="block w-1.5 h-1.5 rounded-full bg-[#6DC6A4] shadow-[0_0_6px_#6DC6A4] animate-pulse mb-1.5" />
            )}
            <p
              className="text-[13px] sm:text-[14px] font-bold text-white leading-tight truncate"
              style={isCurrent ? { color: accentColor } : {}}
            >
              {track.title}
            </p>
            <p className="text-[9px] font-mono text-white/45 uppercase tracking-[0.1em] truncate mt-0.5 flex items-center gap-1.5">
              <span className="truncate">{[track.type, keyLabel].filter(Boolean).join(' · ')}</span>
              {track.has_wav && (
                <span className="shrink-0 rounded-sm bg-white/10 px-1 py-px text-[8px] tracking-[0.15em] text-white/70">
                  WAV
                </span>
              )}
            </p>
          </div>

          {/* Price pill — accent tinted, shown when not free/sold */}
          {!track.exclusive_sold && !track.free_download_enabled && fromPrice != null && (
            <span
              className="shrink-0 text-[12px] font-bold tabular-nums px-2.5 py-1 rounded-lg text-black shadow-[0_2px_8px_rgba(0,0,0,0.4)]"
              style={{ backgroundColor: accentColor }}
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
        className="bg-[#11100D] border-t border-white/[0.06]"
      >
        {track.exclusive_sold ? (
          <div className="flex min-h-11 items-center justify-center text-[#E7D7BE]/40 text-[9px] font-mono uppercase tracking-wider">
            Exclusive sold
          </div>
        ) : track.free_download_enabled ? (
          <button
            onClick={stop(onFreeDownload)}
            aria-label={`Free download ${track.title}`}
            className="tap flex min-h-11 w-full items-center justify-center gap-1.5 text-[#6DC6A4] text-[9px] font-mono font-bold uppercase tracking-wider hover:bg-[#6DC6A4]/5 transition-colors"
          >
            <Download size={10} />
            Free download
          </button>
        ) : (
          <div className="flex min-h-11 items-stretch divide-x divide-white/[0.06]">
            <button
              onClick={stop(onAddLease)}
              disabled={priceLease == null}
              aria-label={priceLease != null ? `Add ${track.title} lease license to cart, $${priceLease}` : `Lease unavailable for ${track.title}`}
              className="tap flex flex-1 flex-col items-center justify-center gap-px transition-colors hover:bg-white/[0.04] disabled:cursor-not-allowed disabled:opacity-25"
            >
              <span className="text-[7px] font-mono uppercase tracking-[0.18em] text-white/25 leading-none">Lease</span>
              <span className="text-[12px] font-bold text-[#F7EBDD] tabular-nums leading-none">
                {priceLease != null ? `$${priceLease}` : '—'}
              </span>
            </button>
            <button
              onClick={stop(onAddExclusive)}
              disabled={priceExclusive == null}
              aria-label={priceExclusive != null ? `Add ${track.title} exclusive license to cart, $${priceExclusive}` : `Exclusive unavailable for ${track.title}`}
              className="tap flex flex-1 flex-col items-center justify-center gap-px transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-25"
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
    </div>{/* /inner card */}
    </div>
  );
}
