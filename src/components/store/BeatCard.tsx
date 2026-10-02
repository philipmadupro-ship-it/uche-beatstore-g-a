'use client';

/**
 * BeatCard — the store's grid card.
 *
 * Same anatomy as the library's grid card (`tracks/TrackGridCard`): a square
 * cover with a hairline border, the play button and BPM / key badges appearing
 * on hover, then the title and a type line BELOW the art. The title used to sit
 * on a scrim over the cover, which made the storefront read as a different
 * product from the library the producer curates it in.
 *
 * What the store adds, and the library has no use for: the wishlist heart, the
 * Sold / Free tag, and the buy strip beneath the title. Playing / previewing
 * borrows the storefront accent on the cover's edge and the title, once.
 */

import { memo } from 'react';
import { Heart, Download } from 'lucide-react';
import { PlayGlyph, PauseGlyph } from '@/components/player/TransportIcons';
import { ArtworkFallback } from '@/components/ui/ArtworkFallback';
import { artworkTagsOf } from '@/lib/artwork/artwork-tags';
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

/**
 * Memoised — the store grid re-renders every card on ANY interaction
 * (previewing one track, toggling a wishlist heart, "load more" appending
 * more rows) unless the parent hands each card stable callback references.
 * `/src/app/store/page.tsx` builds these through `lib/ui/stable-row-callbacks.ts`
 * rather than a fresh arrow per render.
 */
function BeatCardImpl({
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
      className="group relative flex cursor-pointer flex-col focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60 rounded-xl"
    >
      {/* ── Cover — clicking anywhere opens the preview drawer ── */}
      <div
        className={`relative mb-2.5 aspect-square w-full overflow-hidden rounded-xl border ${
          isActive ? '' : 'border-white/10 group-hover:border-white/20'
        }`}
        style={{
          ...(isActive ? { borderColor: accentColor } : {}),
          transition: 'border-color 400ms cubic-bezier(0.32,0.72,0,1)',
        }}
      >
        {/* A coverless beat gets the default artwork set in Settings, tinted
            per beat, so a buyer sees the same picture the library shows. */}
        <ArtworkFallback
          src={track.cover_url}
          seed={track.id}
          kind="track"
          tags={artworkTagsOf(track.tags)}
          alt={track.title}
          sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 280px"
          className="object-cover transition-transform duration-500 group-hover:scale-105"
        />

        {/* ── Top row: status · wishlist ── */}
        <div className="absolute top-0 inset-x-0 flex items-start justify-between p-2.5 gap-2">
          {track.exclusive_sold ? (
            <span className="rounded bg-black/60 px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-[0.1em] text-white/70 backdrop-blur-sm">
              Sold
            </span>
          ) : track.free_download_enabled ? (
            <span className="rounded bg-black/60 px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-[0.1em] text-[#6DC6A4] backdrop-blur-sm">
              Free
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
                isWishlisted ? 'text-[#c8a84b]' : 'text-white/60 hover:text-white'
              }`}
            >
              <Heart size={13} fill={isWishlisted ? 'currentColor' : 'none'} />
            </button>
          ) : <span />}
        </div>

        {/* ── Hover: play affordance (pointer-events-none so the click falls
             through to the card's onPreview). ── */}
        <div
          className={`pointer-events-none absolute inset-0 flex items-center justify-center bg-black/50 transition-opacity duration-200 ${
            isCurrent ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          }`}
        >
          <div className="glass-play glass-play-surface flex h-14 w-14 items-center justify-center rounded-full">
            {isCurrent && isPlaying
              ? <PauseGlyph size={20} />
              : <PlayGlyph size={20} className="ml-0.5" />}
          </div>
        </div>

        {/* ── BPM + key, bottom left on hover — as in the library card ── */}
        <div className="absolute bottom-2 left-2 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          {track.bpm ? (
            <span className="rounded bg-black/70 px-1.5 py-0.5 text-[8px] font-mono font-bold tabular-nums text-white backdrop-blur-sm">
              {track.bpm}
            </span>
          ) : null}
          {keyLabel ? (
            <span className="rounded border border-[#3d3020]/40 bg-[#1f1a10]/80 px-1.5 py-0.5 text-[8px] font-mono font-bold text-[#c8a47a] backdrop-blur-sm">
              {keyLabel}
            </span>
          ) : null}
        </div>
      </div>

      {/* ── Meta below the art ── */}
      <div className="px-0.5">
        <p
          className="mb-1 truncate text-[13px] font-semibold leading-tight text-white"
          style={isActive ? { color: accentColor } : {}}
        >
          {track.title}
        </p>
        <p className="truncate text-[9px] font-mono uppercase tracking-wider text-white/60">
          {[track.type, keyLabel].filter(Boolean).join(' · ')}
        </p>
        {(recentSales ?? 0) >= MOMENTUM_THRESHOLD && (
          <p className="mt-1 truncate text-[9px] font-mono uppercase tracking-[0.14em] text-[#6DC6A4]">
            {recentSales} sold this week
          </p>
        )}
      </div>

      {/* ── Buy strip ── */}
      <div
        data-card-action
        onClick={(e) => e.stopPropagation()}
        className="mt-2.5 overflow-hidden rounded-lg border border-white/[0.06] bg-white/[0.02]"
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

export const BeatCard = memo(BeatCardImpl);
