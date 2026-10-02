'use client';

/**
 * StoreListView — list-mode renderer for /store.
 *
 * Rows are laid out like the library's All tracks list (`tracks/TrackCard`):
 * each beat is its own bordered row with a 48px cover that takes the play
 * glyph, a semibold title, and the BPM | key | type line beneath it. The store
 * adds what the library has no use for — the buy buttons, the heart and the
 * ⋯ menu — in the columns on the right.
 *
 * Kept from the earlier revision: no blurred backdrop or panel backdrop-blur
 * (they forced GPU repaints on a scrolling container), single-line price
 * actions, and the accent meaning only "the previewed beat".
 */

import { useState } from 'react';
import { Music, Heart, Download, Clock, ShoppingBag } from 'lucide-react';
import { ActionMenu } from '@/components/ui/ActionMenu';
import { PlayGlyph, PauseGlyph } from '@/components/player/TransportIcons';
import { fmtDur } from './helpers';
import type { StoreTrack } from './types';
import { ArtworkFallback } from '@/components/ui/ArtworkFallback';
import { artworkTagsOf } from '@/lib/artwork/artwork-tags';

interface Props {
  tracks: StoreTrack[];
  accentColor: string;
  currentTrackId: string | null;
  isPlaying: boolean;
  isPreviewId?: string | null;
  priceFor: (t: StoreTrack, k: 'lease' | 'exclusive') => number | null;
  onPlay: (t: StoreTrack) => void;
  onPreview: (t: StoreTrack) => void;
  onAddLease: (t: StoreTrack) => void;
  onAddExclusive: (t: StoreTrack) => void;
  licenseCount?: number;
  lowestLicensePrice?: number | null;
  onFreeDownload: (t: StoreTrack) => void;
  isWishlisted: (id: string) => boolean;
  onToggleWishlist: (id: string) => void;
  /** trackId → paid sales in the last 7 days. Only shown once a track
   *  clears MOMENTUM_THRESHOLD — a single sale reads as a fluke. */
  momentumByTrack?: Record<string, number>;
}

const MOMENTUM_THRESHOLD = 2;

export function StoreListView({
  tracks, accentColor, currentTrackId, isPlaying, isPreviewId,
  priceFor, onPlay, onPreview, onAddLease, onAddExclusive, onFreeDownload,
  licenseCount = 0, lowestLicensePrice = null, isWishlisted, onToggleWishlist,
  momentumByTrack = {},
}: Props) {
  const [hovered, setHovered] = useState<string | null>(null);

  return (
    <div className="relative">

      {/* Header row — same weight as the library's column heads */}
      <div className="relative hidden h-8 md:grid grid-cols-[48px_minmax(0,1.5fr)_minmax(0,1fr)_76px_272px_32px_32px] items-center gap-4 border border-transparent px-3 text-[9px] font-mono uppercase tracking-wider text-white/40">
        <span />
        <span>Title</span>
        <span>Tags · Rating</span>
        <span className="text-right">Time</span>
        <span className="text-right pr-1">Buy</span>
        <span />
        <span />
      </div>

      <ul className="relative space-y-2">
        {tracks.map((t) => {
          const isCur = currentTrackId === t.id;
          const isCurPlaying = isCur && isPlaying;
          const isHov = hovered === t.id;
          const isPreview = isPreviewId === t.id;
          const lp = priceFor(t, 'lease');
          const ep = priceFor(t, 'exclusive');
          const hasLicenseTiers = licenseCount > 0;
          const wishlisted = isWishlisted(t.id);
          return (
            <li
              key={t.id}
              id={`beat-${t.id}`}
              role="button"
              tabIndex={0}
              onClick={(e) => {
                if ((e.target as HTMLElement).closest('[data-row-action]')) return;
                onPreview(t);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onPreview(t);
                }
              }}
              onMouseEnter={() => setHovered(t.id)}
              onMouseLeave={() => setHovered((v) => (v === t.id ? null : v))}
              className={`relative grid min-h-[64px] grid-cols-[48px_minmax(0,1fr)_32px] md:grid-cols-[48px_minmax(0,1.5fr)_minmax(0,1fr)_76px_272px_32px_32px] gap-x-3 gap-y-2 md:gap-4 items-center rounded-xl border px-2 md:px-3 py-2 cursor-pointer transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-white/60 ${
                isCur || isPreview
                  ? 'border-white/30 bg-white/[0.08]'
                  : 'border-white/[0.06] bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.05]'
              }`}
              style={isPreview ? { boxShadow: `inset 2px 0 0 ${accentColor}` } : {}}
            >
              {/* Cover w/ hover-play */}
              <div
                data-row-action
                onClick={(e) => { e.stopPropagation(); onPlay(t); }}
                className="relative size-12 shrink-0 cursor-pointer overflow-hidden rounded-lg bg-[#090907] ring-1 ring-inset ring-white/[0.06]"
              >
                <ArtworkFallback
                  src={t.cover_url}
                  seed={t.id}
                  kind="track"
                  tags={artworkTagsOf(t.tags)}
                  sizes="48px"
                  className="object-cover"
                >
                  <Music size={13} aria-hidden="true" />
                </ArtworkFallback>
                {(isHov || isCur) && (
                  <span
                    aria-hidden
                    className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-[2px] text-white"
                  >
                    {isCurPlaying
                      ? <PauseGlyph size={13} />
                      : <PlayGlyph size={13} className="ml-0.5" />}
                  </span>
                )}
              </div>

              {/* Title + the library's BPM | key | type line. */}
              <div className="min-w-0">
                <p className="truncate text-[14px] font-semibold leading-tight tracking-[-0.01em] text-white">
                  {t.title}
                </p>
                <p className="mt-1 flex min-w-0 flex-nowrap items-center gap-1.5 overflow-hidden whitespace-nowrap text-[9px] font-mono uppercase tracking-[0.14em] text-white/40">
                  {[
                    t.bpm ? <span key="bpm" className="shrink-0 tabular-nums text-white/55">{t.bpm}<span className="text-white/30"> BPM</span></span> : null,
                    t.key ? <span key="key" className="shrink-0 text-white/55">{t.key}{t.scale === 'minor' ? 'm' : ''}</span> : null,
                    t.type ? <span key="type" className="truncate">{t.type}</span> : null,
                  ].filter(Boolean).flatMap((node, i) => (i === 0 ? [node] : [<span key={`d${i}`} aria-hidden className="h-2 w-px shrink-0 bg-white/15" />, node]))}
                  {!t.bpm && !t.key && !t.type ? <span>—</span> : null}
                </p>
              </div>

              {/* Tags + rating — surface the actual genre/mood tags (up to
                  two) so the buyer sees the vibe at a glance, and the
                  star rating next to them. Skip the bare track type
                  (e.g. "instrumental") — it's noise here. */}
              <div className="hidden md:flex items-center gap-2 min-w-0">
                {(t.tags ?? [])
                  .filter((x) => x.category === 'genre' || x.category === 'mood')
                  .slice(0, 2)
                  .map((tag) => (
                    <span
                      key={`${tag.category}-${tag.tag}`}
                      className="truncate text-[11px] text-white/55"
                    >
                      #{tag.tag}
                    </span>
                  ))}
                {(t.tags ?? []).filter((x) => x.category === 'genre' || x.category === 'mood').length === 0 && (
                  <span className="truncate text-[9px] font-mono text-white/35">—</span>
                )}
                {(momentumByTrack[t.id] ?? 0) >= MOMENTUM_THRESHOLD && (
                  <span className="shrink-0 text-[9px] font-mono uppercase tracking-[0.14em] text-[#6DC6A4]">
                    {momentumByTrack[t.id]} sold this week
                  </span>
                )}
                {t.rating != null && Number(t.rating) > 0 && (
                  <span className="ml-auto flex shrink-0 items-center gap-0.5 text-[11px] font-mono text-[#c8a84b]">
                    ★ {Number(t.rating).toFixed(1)}
                  </span>
                )}
              </div>

              {/* Duration */}
              <div className="hidden md:flex items-center justify-end gap-1 text-[9px] font-mono tabular-nums text-white/45">
                <Clock size={11} />
                {fmtDur(t.duration_seconds)}
              </div>

              {/* Per-track price buttons. Below md they drop to a second
                  row under the title: sharing row one with an `auto` column,
                  the two buttons claimed every free pixel and the title's
                  `minmax(0,1fr)` track collapsed to 0px at 390px — buyers saw
                  a thumbnail and two prices with no beat name. */}
              <div className="col-[2/4] row-start-2 flex items-center gap-1.5 justify-start md:col-auto md:row-auto md:justify-end shrink-0">
                {t.free_download_enabled ? (
                  <button
                    data-row-action
                    onClick={(e) => { e.stopPropagation(); onFreeDownload(t); }}
                    className="flex min-h-10 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-[11px] font-medium text-[#6DC6A4] transition-colors hover:bg-white/[0.04]"
                  >
                    <Download size={11} />
                    Free
                  </button>
                ) : hasLicenseTiers ? (
                  <button
                    data-row-action
                    onClick={(e) => { e.stopPropagation(); onPreview(t); }}
                    aria-label={`Choose a license for ${t.title}${lowestLicensePrice != null ? `, from $${lowestLicensePrice}` : ''}`}
                    className="flex min-h-10 items-center gap-1.5 whitespace-nowrap rounded-lg border border-white/[0.08] px-2.5 text-[11px] font-medium text-white transition-colors hover:bg-white/[0.04]"
                  >
                    <ShoppingBag size={11} className="sm:hidden" aria-hidden="true" />
                    {/* Label is hidden below sm and on the widest label ("Choose
                        license") the trailing "from" is dropped — Akira Expanded
                        is wide enough that the full phrase wraps inside the
                        fixed buy column. The aria-label carries the full
                        "from $X" phrasing for assistive tech. */}
                    <span className="hidden sm:inline">Choose license</span>
                    {lowestLicensePrice != null && (
                      <span className="tabular-nums text-white/45">${lowestLicensePrice}+</span>
                    )}
                  </button>
                ) : (
                  <>
                    <button
                      data-row-action
                      onClick={(e) => { e.stopPropagation(); onAddLease(t); }}
                      disabled={lp == null}
                      className="flex min-h-10 items-center gap-1.5 whitespace-nowrap rounded-lg border border-white/[0.08] px-2.5 text-[11px] transition-colors hover:bg-white/[0.04] disabled:opacity-30"
                    >
                      <span className="text-white/45">Lease</span>
                      <span className="font-semibold tabular-nums text-white">{lp != null ? `$${lp}` : '—'}</span>
                    </button>
                    <button
                      data-row-action
                      onClick={(e) => { e.stopPropagation(); onAddExclusive(t); }}
                      disabled={ep == null}
                      className="flex min-h-10 items-center gap-1.5 whitespace-nowrap rounded-lg border border-white/[0.08] px-2.5 text-[11px] transition-colors hover:bg-white/[0.04] disabled:opacity-30"
                    >
                      <span className="text-white/45">Exclusive</span>
                      <span className="font-semibold tabular-nums" style={{ color: accentColor }}>{ep != null ? `$${ep}` : '—'}</span>
                    </button>
                  </>
                )}
              </div>

              {/* Heart */}
              <button
                data-row-action
                onClick={(e) => { e.stopPropagation(); onToggleWishlist(t.id); }}
                aria-pressed={wishlisted}
                aria-label={wishlisted ? `Remove ${t.title} from favorites` : `Add ${t.title} to favorites`}
                title={wishlisted ? 'Remove from favorites' : 'Add to favorites'}
                className="-m-1.5 hidden size-10 items-center justify-center rounded-full transition-colors hover:bg-white/[0.06] md:flex"
                style={wishlisted ? { color: '#c8a84b' } : { color: 'rgba(255,255,255,0.45)' }}
              >
                <Heart size={13} fill={wishlisted ? 'currentColor' : 'none'} />
              </button>

              {/* Menu. `data-row-action` keeps the row's own click handler
                  from treating a press on the trigger as "open this beat" —
                  see the closest() guard on the <li>. */}
              <div className="relative col-start-3 row-start-1 md:col-auto md:row-auto" data-row-action>
                <ActionMenu
                  align="right"
                  width={208}
                  label={`More options for ${t.title}`}
                  triggerClassName="-m-1.5 flex size-10 items-center justify-center rounded-full text-white/45 transition-colors hover:bg-white/[0.06] hover:text-white"
                  sections={[
                    {
                      id: 'buy',
                      items: [
                        { id: 'open', label: 'Open beat', onSelect: () => onPreview(t) },
                        {
                          id: 'license',
                          label: `Choose license${lowestLicensePrice != null ? ` from $${lowestLicensePrice}` : ''}`,
                          hidden: !!t.free_download_enabled || !hasLicenseTiers,
                          onSelect: () => onPreview(t),
                        },
                        {
                          id: 'lease', label: `Add lease ($${lp})`,
                          hidden: !!t.free_download_enabled || hasLicenseTiers || lp == null,
                          onSelect: () => onAddLease(t),
                        },
                        {
                          id: 'exclusive', label: `Add exclusive ($${ep})`,
                          hidden: !!t.free_download_enabled || hasLicenseTiers || ep == null,
                          onSelect: () => onAddExclusive(t),
                        },
                      ],
                    },
                    {
                      id: 'share',
                      items: [
                        {
                          id: 'copy', label: 'Copy link',
                          onSelect: () => {
                            try { navigator.clipboard.writeText(`${window.location.origin}/store/${t.id}`); }
                            catch {/* noop */}
                          },
                        },
                      ],
                    },
                  ]}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
