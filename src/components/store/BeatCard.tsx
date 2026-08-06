'use client';

/**
 * BeatCard — the store's grid card.
 *
 * Quiet-luxury architecture (see docs/design-direction.md): the cover IS the
 * card. One surface, one hairline edge, one accent. Title and metadata sit on
 * a soft scrim; the single action lives in a quiet strip beneath.
 *
 * Deliberate reductions from the previous revision: the gradient "bezel" tray,
 * the stacked ring shadow, the duplicated price pill (price already lives in
 * the buy strip), the pulsing playing dot, and the heavy title text-shadow.
 * Playing state is now communicated once, by the accent edge.
 */

import { Heart, Download } from 'lucide-react';
import { PlayGlyph, PauseGlyph } from '@/components/player/TransportIcons';
import { CoverImage } from '@/components/ui/CoverImage';
import { seededGradient } from '@/lib/ui/cover-gradient';
import type { StoreTrack } from './types';

// A single recent sale reads as a fluke, not momentum — the whole point of a
// social-proof signal is that it's true, so this is the bar for "worth saying".
const MOMENTUM_THRESHOLD = 2;

interface Props {
  track: StoreTrack;
  allTracks: StoreTrack[];
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
  isWishlisted?: boolean;
  onToggleWishlist?: () => void;
  /** Paid sales for this track in the last 7 days. Only rendered once it
   *  clears MOMENTUM_THRESHOLD below — a single sale reads as a fluke,
   *  not momentum. */
  recentSales?: number;
}

export function BeatCard({
  track, priceLease, priceExclusive, licenseCount = 0, lowestLicensePrice = null, isCurrent, isPlaying, isPreview,
  onPreview, onAddLease, onAddExclusive, onFreeDownload, accentColor,
  isWishlisted, onToggleWishlist, recentSales,
}: Props) {
  const stop = (fn: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); fn(); };

  const keyLabel = track.key ? `${track.key}${track.scale === 'minor' ? 'm' : ''}` : null;
  const hasLicenseTiers = licenseCount > 0;
  const fromPrice = hasLicenseTiers ? lowestLicensePrice : priceLease ?? priceExclusive;

  // One edge treatment. Active (preview or playing) borrows the accent; every
  // other state is a hairline that firms up slightly on hover.
  const isActive = isPreview || isCurrent;

  return (
    <div
      id={`beat-${track.id}`}
      role="button"
      tabIndex={0}
      onClick={onPreview}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPreview(); } }}
      className={`group relative flex cursor-pointer flex-col overflow-hidden rounded-xl border bg-white/[0.04] focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60 ${
        isActive ? '' : 'border-white/[0.06] hover:border-white/[0.12]'
      }`}
      style={{
        ...(isActive ? { borderColor: accentColor } : {}),
        transition: 'border-color 400ms cubic-bezier(0.32,0.72,0,1)',
      }}
    >
      {/* ── Cover — clicking anywhere opens the preview drawer ── */}
      <div className="relative w-full aspect-square overflow-hidden">
        {track.cover_url ? (
          <CoverImage
            src={track.cover_url}
            alt=""
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 280px"
            className="absolute inset-0 w-full h-full object-cover group-hover:scale-[1.03] [transition:transform_700ms_cubic-bezier(0.32,0.72,0,1)]"
          />
        ) : (
          <div className="absolute inset-0" style={seededGradient(track.id)} />
        )}

        {/* Single scrim — carries the title legibility on its own. */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent" />

        {/* ── Top row: status/BPM · wishlist ── */}
        <div className="absolute top-0 inset-x-0 flex items-start justify-between p-2.5 gap-2">
          {track.exclusive_sold ? (
            <span className="rounded bg-black/50 px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-[0.1em] text-white/70 backdrop-blur-sm">
              Sold
            </span>
          ) : track.free_download_enabled ? (
            <span className="rounded bg-black/50 px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-[0.1em] text-[#6DC6A4] backdrop-blur-sm">
              Free
            </span>
          ) : track.bpm ? (
            <span className="rounded bg-black/50 px-1.5 py-0.5 text-[9px] font-mono tracking-[0.1em] text-white/70 backdrop-blur-sm">
              {track.bpm}
            </span>
          ) : <span />}

          {onToggleWishlist ? (
            <button
              data-card-action
              type="button"
              onClick={stop(onToggleWishlist)}
              aria-label={isWishlisted ? 'Remove from favorites' : 'Add to favorites'}
              aria-pressed={!!isWishlisted}
              className={`tap -mr-2 -mt-2 flex size-11 shrink-0 items-center justify-center rounded-full transition-colors ${
                isWishlisted ? 'text-[#c8a84b]' : 'text-white/50 hover:text-white'
              }`}
            >
              <Heart size={13} fill={isWishlisted ? 'currentColor' : 'none'} />
            </button>
          ) : <span />}
        </div>

        {/* ── Centre: play affordance on hover (pointer-events-none so the
             click falls through to the card's onPreview). ── */}
        <div
          className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 pointer-events-none"
          style={{ transition: 'opacity 300ms cubic-bezier(0.32,0.72,0,1)' }}
        >
          <div
            className="flex h-11 w-11 items-center justify-center rounded-full"
            style={{ backgroundColor: accentColor }}
          >
            {isCurrent && isPlaying
              ? <PauseGlyph size={16} />
              : <PlayGlyph size={16} className="ml-0.5 text-black" />}
          </div>
        </div>

        {/* ── Bottom: title + metadata. Price is intentionally not repeated
             here; it lives in the action strip below. ── */}
        <div className="absolute bottom-0 inset-x-0 p-3">
          <p
            className="truncate text-[14px] font-semibold leading-snug text-white"
            style={isActive ? { color: accentColor } : {}}
          >
            {track.title}
          </p>
          <p className="mt-1 truncate text-[9px] font-mono uppercase tracking-[0.14em] text-white/45">
            {[track.type, keyLabel].filter(Boolean).join(' · ')}
          </p>
          {(recentSales ?? 0) >= MOMENTUM_THRESHOLD && (
            <p className="mt-1 truncate text-[9px] font-mono uppercase tracking-[0.14em] text-[#6DC6A4]">
              {recentSales} sold this week
            </p>
          )}
        </div>
      </div>

      {/* ── Action strip ── */}
      <div
        data-card-action
        onClick={(e) => e.stopPropagation()}
        className="border-t border-white/[0.06]"
      >
        {track.exclusive_sold ? (
          <div className="flex min-h-11 items-center justify-center text-[11px] text-white/30">
            Exclusive sold
          </div>
        ) : track.free_download_enabled ? (
          <button
            onClick={stop(onFreeDownload)}
            className="tap flex min-h-11 w-full items-center justify-center gap-1.5 text-[11px] font-medium text-[#6DC6A4] transition-colors hover:bg-white/[0.03]"
          >
            <Download size={11} />
            Free download
          </button>
        ) : hasLicenseTiers ? (
          <button
            onClick={stop(onPreview)}
            className="tap flex min-h-11 w-full items-center justify-center gap-1.5 text-[11px] font-medium text-white transition-colors hover:bg-white/[0.03]"
          >
            Choose license
            {fromPrice != null && (
              <span className="tabular-nums text-white/45">from ${fromPrice}</span>
            )}
          </button>
        ) : (
          <div className="flex min-h-11 items-stretch">
            <button
              onClick={stop(onAddLease)}
              disabled={priceLease == null}
              className="tap flex flex-1 items-center justify-center gap-1.5 text-[11px] transition-colors hover:bg-white/[0.03] disabled:cursor-not-allowed disabled:opacity-25"
            >
              <span className="text-white/45">Lease</span>
              <span className="font-semibold tabular-nums text-white">
                {priceLease != null ? `$${priceLease}` : '—'}
              </span>
            </button>
            <span className="my-2.5 w-px bg-white/[0.06]" aria-hidden />
            <button
              onClick={stop(onAddExclusive)}
              disabled={priceExclusive == null}
              className="tap flex flex-1 items-center justify-center gap-1.5 text-[11px] transition-colors hover:bg-white/[0.03] disabled:cursor-not-allowed disabled:opacity-25"
            >
              <span className="text-white/45">Exclusive</span>
              <span className="font-semibold tabular-nums" style={{ color: accentColor }}>
                {priceExclusive != null ? `$${priceExclusive}` : '—'}
              </span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
