'use client';

/**
 * BandcampRemixCard — a release-style card for `type === 'remix'` tracks.
 *
 * Visual identity is intentionally minimal/text-heavy, mirroring Bandcamp:
 *   - Large square cover with a thin border on top
 *   - Big heading-font title + producer name underneath
 *   - Inline "REMIX" badge in accent color
 *   - Mono meta row: BPM · KEY · DURATION
 *   - Full-width primary Buy button with price (or Free Download when toggled)
 *
 * Props mirror what BeatCard consumes in src/app/store/page.tsx so the grid
 * render can branch on track.type without rewiring callbacks.
 */

import { Play, Pause, Download, ShoppingBag, Heart } from 'lucide-react';
import type { Track } from '@/lib/types';

export type BandcampRemixTrack = Track;

interface BandcampRemixCardProps {
  track: BandcampRemixTrack;
  creatorName?: string | null;
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
  // Optional so other call sites that don't have a wishlist still work.
  isWishlisted?: boolean;
  onToggleWishlist?: () => void;
}

function fmtDuration(s: number | null | undefined): string {
  if (!s) return '—';
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60).toString().padStart(2, '0');
  return `${m}:${r}`;
}

export default function BandcampRemixCard({
  track,
  creatorName,
  priceLease,
  priceExclusive,
  isCurrent,
  isPlaying,
  isPreview,
  onPlay,
  onPreview,
  onAddLease,
  onAddExclusive,
  onFreeDownload,
  accentColor,
  isWishlisted,
  onToggleWishlist,
}: BandcampRemixCardProps) {
  const buyPrice = priceLease ?? priceExclusive;
  const keyLabel = track.key ? `${track.key}${track.scale === 'minor' ? 'm' : ''}` : null;

  // Border treatment mirrors BeatCard's "active" affordances so a remix card
  // visually responds to play / preview state in the same vocabulary.
  const borderClass = isPreview
    ? 'border-[#D4BFA0]/50 shadow-lg shadow-[#D4BFA0]/5'
    : isPlaying
      ? 'shadow-md'
      : isCurrent
        ? 'border-[#D4BFA0]/30'
        : 'border-[#1f1a13] hover:border-[#2d2620]';

  const borderStyle = isPreview
    ? { borderColor: `${accentColor}80` }
    : isPlaying
      ? { borderColor: `${accentColor}66`, boxShadow: `0 0 0 1px ${accentColor}33` }
      : isCurrent
        ? { borderColor: `${accentColor}4D` }
        : {};

  return (
    <div
      id={`beat-${track.id}`}
      className={`group rounded-2xl border bg-[#14110d] overflow-hidden transition-all flex flex-col ${borderClass}`}
      style={borderStyle}
    >
      {/* Square cover — Bandcamp's defining shape. Click opens preview drawer.
          A floating play button overlay triggers playback directly. */}
      <div
        className="relative w-full aspect-square shrink-0 cursor-pointer border-b border-[#1f1a13] bg-[#0a0907]"
        onClick={onPreview}
      >
        {track.cover_url ? (
          <img
            loading="lazy"
            src={track.cover_url}
            alt={track.title}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-[#2A2418] to-[#0a0907]" />
        )}

        {/* Subtle gradient at bottom so the play button stays legible over
            any cover artwork. */}
        <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/60 to-transparent pointer-events-none" />

        {/* Play / pause overlay */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onPlay();
          }}
          className="absolute bottom-3 right-3 w-11 h-11 rounded-full flex items-center justify-center text-black shadow-lg transition-transform hover:scale-105"
          style={{ backgroundColor: accentColor }}
          aria-label={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" className="ml-0.5" />}
        </button>

        {isCurrent && (
          <div className="absolute top-3 left-3 w-1.5 h-1.5 rounded-full bg-[#6DC6A4] shadow-[0_0_6px_#6DC6A4] animate-pulse" />
        )}

        {/* Wishlist heart — only renders when the parent provides a toggle.
            Top-right, stopPropagation so the cover's preview-click is preserved.
            Gold fill matches the existing star-rating color (#c8a84b). */}
        {onToggleWishlist && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onToggleWishlist(); }}
            aria-pressed={!!isWishlisted}
            title={isWishlisted ? 'Remove from favorites' : 'Add to favorites'}
            className={`absolute top-3 right-3 w-8 h-8 rounded-full flex items-center justify-center backdrop-blur transition-colors ${
              isWishlisted
                ? 'bg-[#c8a84b]/20 border border-[#c8a84b]/50 text-[#c8a84b]'
                : 'bg-black/40 border border-white/10 text-white/80 hover:text-white hover:bg-black/60'
            }`}
          >
            <Heart size={13} fill={isWishlisted ? 'currentColor' : 'none'} />
          </button>
        )}
      </div>

      {/* Text block — heading title, producer, meta row */}
      <div className="p-5 flex flex-col gap-3 flex-1">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-start gap-2">
            <button onClick={onPreview} className="text-left flex-1 min-w-0">
              <h3
                className="font-heading text-[20px] leading-tight text-[#E8DCC8] truncate hover:opacity-80 transition-opacity"
                style={isPreview || isCurrent ? { color: accentColor } : {}}
                title={track.title}
              >
                {track.title}
              </h3>
            </button>
            <span
              className="shrink-0 mt-1 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase tracking-[0.2em]"
              style={{
                backgroundColor: `${accentColor}1A`,
                color: accentColor,
                border: `1px solid ${accentColor}40`,
              }}
            >
              Remix
            </span>
          </div>

          {creatorName && (
            <p className="text-[12px] text-[#a08a6a] truncate">
              by <span className="text-[#E8DCC8]">{creatorName}</span>
            </p>
          )}
        </div>

        {/* Meta row — Bandcamp's mono "release info" line */}
        <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.18em] text-[#6a5d4a]">
          {track.bpm && <span>{track.bpm} BPM</span>}
          {track.bpm && keyLabel && <span className="text-[#3a3328]">·</span>}
          {keyLabel && <span>{keyLabel}</span>}
          {(track.bpm || keyLabel) && track.duration_seconds && <span className="text-[#3a3328]">·</span>}
          {track.duration_seconds && <span>{fmtDuration(track.duration_seconds)}</span>}
        </div>

        {track.description && (
          <p className="text-[11px] text-[#a08a6a] line-clamp-2 leading-relaxed">{track.description}</p>
        )}

        {/* Primary action — full-width Buy, or Free Download when toggled. */}
        <div className="mt-auto pt-2 flex flex-col gap-2">
          {track.free_download_enabled ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onFreeDownload();
              }}
              className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-md bg-[#6DC6A4]/10 border border-[#6DC6A4]/30 hover:bg-[#6DC6A4]/20 text-[#6DC6A4] text-[11px] font-mono font-bold uppercase tracking-[0.18em] transition-colors"
            >
              <Download size={13} />
              Free Download
            </button>
          ) : (
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (priceLease != null) {
                  onAddLease();
                } else if (priceExclusive != null) {
                  onAddExclusive();
                } else {
                  onPreview();
                }
              }}
              disabled={buyPrice == null}
              className="flex items-center justify-between gap-2 w-full px-4 py-2.5 rounded-md text-black text-[11px] font-mono font-bold uppercase tracking-[0.18em] transition-opacity hover:opacity-90 disabled:opacity-30"
              style={{ backgroundColor: accentColor }}
            >
              <span className="flex items-center gap-2">
                <ShoppingBag size={13} />
                Buy
              </span>
              <span className="tabular-nums">
                {buyPrice != null ? `$${buyPrice.toLocaleString()}` : '—'}
              </span>
            </button>
          )}

          {/* Secondary: open the preview drawer for license picker / details */}
          {!track.free_download_enabled && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onPreview();
              }}
              className="w-full text-center px-3 py-1.5 rounded-md text-[10px] font-mono uppercase tracking-[0.18em] text-[#6a5d4a] hover:text-[#E8DCC8] transition-colors"
            >
              More licenses
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
