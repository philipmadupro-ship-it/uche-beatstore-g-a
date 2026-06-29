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

import { Download, Heart } from 'lucide-react';
import { seededGradient } from '@/lib/ui/cover-gradient';
import { PlayGlyph, PauseGlyph } from '@/components/player/TransportIcons';
import { CoverImage } from '@/components/ui/CoverImage';
import type { Track } from '@/lib/types';

export type BandcampRemixTrack = Track;

interface BandcampRemixCardProps {
  track: BandcampRemixTrack;
  creatorName?: string | null;
  priceLease: number | null;
  priceExclusive: number | null;
  licenseCount?: number;
  lowestLicensePrice?: number | null;
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

export default function BandcampRemixCard({
  track,
  creatorName,
  priceLease,
  priceExclusive,
  licenseCount = 0,
  lowestLicensePrice = null,
  isCurrent,
  isPlaying,
  isPreview,
  onPreview,
  onAddLease,
  onAddExclusive,
  onFreeDownload,
  accentColor,
  isWishlisted,
  onToggleWishlist,
}: BandcampRemixCardProps) {
  const hasLicenseTiers = licenseCount > 0;
  const buyPrice = hasLicenseTiers ? lowestLicensePrice : priceLease ?? priceExclusive;

  // Border treatment mirrors BeatCard's "active" affordances so a remix card
  // visually responds to play / preview state in the same vocabulary.
  const borderClass = isPreview
    ? 'border-[#E7D7BE]/50 shadow-lg shadow-[#E7D7BE]/5'
    : isPlaying
      ? 'shadow-md'
      : isCurrent
        ? 'border-[#E7D7BE]/30'
        : 'border-[#2B2821] hover:border-[#3B372F]';

  const borderStyle = isPreview
    ? { borderColor: `${accentColor}80` }
    : isPlaying
      ? { borderColor: `${accentColor}66`, boxShadow: `0 0 0 1px ${accentColor}33` }
      : isCurrent
        ? { borderColor: `${accentColor}4D` }
        : {};

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
      aria-label={creatorName ? `Preview ${track.title} by ${creatorName}` : `Preview ${track.title}`}
      onClick={onPreview}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPreview(); } }}
      className="group cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)]/40 rounded-[14px] p-[1.5px]"
      style={{ background: bezelBg }}
    >
    <div className={`relative rounded-[13px] overflow-hidden flex flex-col bg-[#171511] ${borderClass}`} style={borderStyle}>
      {/* Cover — clicking opens preview drawer; play circle inside plays */}
      <div
        className="relative w-full aspect-square shrink-0 overflow-hidden bg-[#090907]"
      >
        {track.cover_url ? (
          <CoverImage
            src={track.cover_url}
            alt={track.title}
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 280px"
            className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.04]"
          />
        ) : (
          <div className="absolute inset-0" style={seededGradient(track.id)} />
        )}

        {/* Gradient scrim */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/15 to-black/10" />

        {/* Top: Remix badge + wishlist */}
        <div className="absolute top-0 inset-x-0 flex items-start justify-between p-2.5">
          <span
            className="text-[9px] font-mono font-bold uppercase tracking-[0.2em] px-1.5 py-0.5 rounded"
            style={{ backgroundColor: `${accentColor}22`, color: accentColor, border: `1px solid ${accentColor}40` }}
          >
            Remix
          </span>
          {onToggleWishlist && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onToggleWishlist(); }}
              aria-pressed={!!isWishlisted}
              aria-label={isWishlisted ? `Remove ${track.title} from favorites` : `Add ${track.title} to favorites`}
              className={`w-7 h-7 rounded-full flex items-center justify-center backdrop-blur-sm transition-colors ${
                isWishlisted ? 'bg-[#D6BE7A]/30 text-[#D6BE7A]' : 'bg-black/30 text-white/50 hover:text-white'
              }`}
            >
              <Heart size={12} fill={isWishlisted ? 'currentColor' : 'none'} />
            </button>
          )}
        </div>

        {/* Centre: play button (hover). Interactive — starts playback in the
            bottom player (click-to-play); clicking elsewhere opens the drawer.
            Wrapper stays pointer-events-none so only the button intercepts. */}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onPlay(); }}
            aria-label={`${isPlaying ? 'Pause' : 'Play'} ${track.title}`}
            className="pointer-events-auto w-11 h-11 rounded-full flex items-center justify-center shadow-[0_4px_20px_rgba(0,0,0,0.5)] transition-transform hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            style={{ backgroundColor: accentColor }}
          >
            {isPlaying ? <PauseGlyph size={16} /> : <PlayGlyph size={16} className="ml-0.5 text-black" />}
          </button>
        </div>

        {/* Bottom: title + producer + price */}
        <div className="absolute bottom-0 inset-x-0 p-2.5 flex items-end justify-between gap-2">
          <div className="min-w-0 flex-1">
            {isCurrent && <span className="block w-1.5 h-1.5 rounded-full bg-[#6DC6A4] shadow-[0_0_6px_#6DC6A4] animate-pulse mb-1.5" />}
            <p
              className="text-[12px] sm:text-[14px] font-semibold text-white truncate leading-tight"
              style={isCurrent ? { color: accentColor } : {}}
            >
              {track.title}
            </p>
            {creatorName && (
              <p className="text-[9px] font-mono text-white/40 truncate mt-0.5">{creatorName}</p>
            )}
          </div>
          {!track.free_download_enabled && buyPrice != null && (
            <span
              className="shrink-0 text-[11px] font-bold tabular-nums px-2 py-0.5 rounded-lg text-black"
              style={{ backgroundColor: `${accentColor}E6` }}
            >
              {hasLicenseTiers ? 'from ' : ''}${buyPrice}
            </span>
          )}
        </div>
      </div>

      {/* Buy strip */}
      <div className="bg-[#11100D] border-t border-white/[0.06]" onClick={(e) => e.stopPropagation()}>
        {track.free_download_enabled ? (
          <button
            onClick={(e) => { e.stopPropagation(); onFreeDownload(); }}
            aria-label={`Free download ${track.title}`}
            className="flex items-center justify-center gap-1.5 w-full h-9 text-[#6DC6A4] text-[9px] font-mono font-bold uppercase tracking-wider hover:bg-[#6DC6A4]/5 transition-colors"
          >
            <Download size={10} />
            Free download
          </button>
        ) : hasLicenseTiers ? (
          <button
            onClick={(e) => { e.stopPropagation(); onPreview(); }}
            className="flex h-9 w-full items-center justify-center gap-2 text-[9px] font-mono font-bold uppercase tracking-wider text-[#F7EBDD] transition-colors hover:bg-white/[0.04]"
          >
            Choose license
            {buyPrice != null && <span className="text-[#B4AA99]">from ${buyPrice}</span>}
          </button>
        ) : (
          <div className="flex items-stretch divide-x divide-white/[0.06] h-9">
            <button
              onClick={(e) => { e.stopPropagation(); onAddLease(); }}
              disabled={priceLease == null}
              aria-label={priceLease != null ? `Add ${track.title} lease license to cart, $${priceLease}` : `Lease unavailable for ${track.title}`}
              className="flex-1 flex flex-col items-center justify-center hover:bg-white/[0.04] transition-colors disabled:opacity-25 disabled:cursor-not-allowed gap-px"
            >
              <span className="text-[7px] font-mono uppercase tracking-[0.18em] text-white/25 leading-none">Lease</span>
              <span className="text-[12px] font-bold text-[#F7EBDD] tabular-nums leading-none">
                {priceLease != null ? `$${priceLease}` : '—'}
              </span>
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onAddExclusive(); }}
              disabled={priceExclusive == null}
              aria-label={priceExclusive != null ? `Add ${track.title} exclusive license to cart, $${priceExclusive}` : `Exclusive unavailable for ${track.title}`}
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
    </div>{/* /inner card */}
    </div>
  );
}
