'use client';

/**
 * StoreListView — list-mode renderer for /store.
 *
 * Quiet-luxury architecture (see docs/design-direction.md): one flat panel,
 * one hairline edge, one accent. Row anatomy matches BeatCard so the grid and
 * list modes read as the same product.
 *
 * Deliberate reductions from the previous revision: the blurred hovered-cover
 * backdrop and its gradient overlay (two stacked decorative layers), the
 * panel's backdrop-blur — which forced GPU repaints on a scrolling container —
 * and the heavy drop shadow. Price actions are single-line rather than stacked
 * number-over-microlabel, and the decorative accent tint on tags is gone so the
 * accent means "primary action or active row" only.
 */

import { useState } from 'react';
import {
  Music, Heart, MoreHorizontal, ShoppingBag, Copy,
  Plus, Download, Clock,
} from 'lucide-react';
import { PlayGlyph, PauseGlyph } from '@/components/player/TransportIcons';
import { CoverImage } from '@/components/ui/CoverImage';
import { fmtDur } from './helpers';
import type { StoreTrack } from './types';

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
}

export function StoreListView({
  tracks, accentColor, currentTrackId, isPlaying, isPreviewId,
  priceFor, onPlay, onPreview, onAddLease, onAddExclusive, onFreeDownload,
  licenseCount = 0, lowestLicensePrice = null, isWishlisted, onToggleWishlist,
}: Props) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);

  return (
    <div className="relative overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.04]">

      {/* Header row */}
      <div className="relative hidden md:grid grid-cols-[36px_minmax(0,1.5fr)_minmax(0,1fr)_64px_220px_32px_32px] gap-4 px-4 md:px-6 py-2.5 border-b border-white/[0.05] text-[9px] font-mono uppercase tracking-[0.18em] text-white/40">
        <span />
        <span>Title</span>
        <span>Tags · Rating</span>
        <span className="text-right">Time</span>
        <span className="text-right pr-1">Buy</span>
        <span />
        <span />
      </div>

      <ul className="relative">
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
              className={`relative grid grid-cols-[44px_minmax(0,1fr)_auto_32px] md:grid-cols-[44px_minmax(0,1.5fr)_minmax(0,1fr)_64px_220px_32px_32px] gap-3 md:gap-4 items-center px-4 md:px-6 py-3 cursor-pointer transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-white/30/40 ${isPreview ? 'bg-white/[0.07]' : isCur ? 'bg-white/[0.05]' : 'hover:bg-white/[0.04]'}`}
              style={isPreview ? { boxShadow: `inset 2px 0 0 ${accentColor}` } : isCur ? { boxShadow: `inset 2px 0 0 ${accentColor}80` } : {}}
            >
              {/* Cover w/ hover-play */}
              <div
                data-row-action
                onClick={(e) => { e.stopPropagation(); onPlay(t); }}
                className="relative size-11 shrink-0 cursor-pointer overflow-hidden rounded-lg bg-[#090907]"
              >
                {t.cover_url
                  ? <CoverImage src={t.cover_url} sizes="36px" className="object-cover" />
                  : <div className="w-full h-full flex items-center justify-center text-white/40"><Music size={13} /></div>}
                {(isHov || isCur) && (
                  <span
                    aria-hidden
                    className="absolute inset-0 flex items-center justify-center bg-black/55 text-white"
                  >
                    {isCurPlaying
                      ? <PauseGlyph size={13} />
                      : <PlayGlyph size={13} className="ml-0.5" />}
                  </span>
                )}
              </div>

              {/* Title — meta line shows BPM/key only (no type label) so the
                  visible info is title + tags + rating + price. */}
              <div className="min-w-0">
                <p
                  className="truncate text-[14px] font-semibold leading-snug"
                  style={isCur || isPreview ? { color: accentColor } : { color: '#FFFFFF' }}
                >
                  {t.title}
                </p>
                {(t.bpm != null || t.key) && (
                  <p className="truncate text-[9px] font-mono uppercase tracking-[0.14em] text-white/45">
                    {[t.bpm ? `${t.bpm} BPM` : null, t.key ? `${t.key}${t.scale === 'minor' ? 'm' : ''}` : null].filter(Boolean).join(' · ')}
                  </p>
                )}
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

              {/* Per-track price buttons */}
              <div className="flex items-center gap-1.5 justify-end shrink-0">
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

              {/* Menu */}
              <div className="relative">
                <button
                  data-row-action
                  onClick={(e) => { e.stopPropagation(); setMenuFor(menuFor === t.id ? null : t.id); }}
                  aria-label={`More options for ${t.title}`}
                  aria-expanded={menuFor === t.id}
                  className="-m-1.5 flex size-10 items-center justify-center rounded-full text-white/45 transition-colors hover:bg-white/[0.06] hover:text-white"
                  title="More"
                >
                  <MoreHorizontal size={14} />
                </button>
                {menuFor === t.id && (
                  <div
                    data-row-action
                    onClick={(e) => e.stopPropagation()}
                    className="absolute right-0 top-9 z-30 w-48 rounded-xl border border-white/[0.08] bg-[#0D0D0A] py-1.5 shadow-[0_16px_40px_rgba(0,0,0,0.5)]"
                  >
                    <button
                      onClick={() => { onPreview(t); setMenuFor(null); }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] text-white hover:bg-white/[0.04]"
                    >
                      <ShoppingBag size={12} className="text-white/60" />
                      Open beat
                    </button>
                    {!t.free_download_enabled && hasLicenseTiers && (
                      <button
                        onClick={() => { onPreview(t); setMenuFor(null); }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] text-white hover:bg-white/[0.04]"
                      >
                        <Plus size={12} style={{ color: accentColor }} />
                        Choose license{lowestLicensePrice != null ? ` from $${lowestLicensePrice}` : ''}
                      </button>
                    )}
                    {!t.free_download_enabled && !hasLicenseTiers && lp != null && (
                      <button
                        onClick={() => { onAddLease(t); setMenuFor(null); }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] text-white hover:bg-white/[0.04]"
                      >
                        <Plus size={12} className="text-white/60" />
                        Add lease (${lp})
                      </button>
                    )}
                    {!t.free_download_enabled && !hasLicenseTiers && ep != null && (
                      <button
                        onClick={() => { onAddExclusive(t); setMenuFor(null); }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] text-white hover:bg-white/[0.04]"
                      >
                        <Plus size={12} style={{ color: accentColor }} />
                        Add exclusive (${ep})
                      </button>
                    )}
                    <div className="my-1 mx-2 border-t border-white/[0.06]" />
                    <button
                      onClick={() => {
                        try { navigator.clipboard.writeText(`${window.location.origin}/store/${t.id}`); }
                        catch {/* noop */}
                        setMenuFor(null);
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] text-white hover:bg-white/[0.04]"
                    >
                      <Copy size={12} className="text-white/60" />
                      Copy link
                    </button>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
