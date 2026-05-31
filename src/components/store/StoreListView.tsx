'use client';

/**
 * StoreListView — list-mode renderer for /store, replacing the
 * embedded MusicPortfolio. Apple-UI row pattern (40px cover with
 * hover-play overlay, accent tag chip, BPM/key meta, full Lease +
 * Exclusive price buttons, heart, three-dot menu) plus the
 * portfolio mode's cinematic feature: the hovered row's cover
 * fades in as a blurred background image behind the whole panel.
 *
 * Wider rows than the previous MusicPortfolio embedded variant —
 * the user complained that the old list was "too small to show all
 * the features." Filters keep their own sticky sidebar on the
 * parent.
 */

import { useMemo, useState } from 'react';
import {
  Music, Heart, MoreHorizontal, ShoppingBag, Copy,
  Plus, Download, Clock,
} from 'lucide-react';
import { PlayGlyph, PauseGlyph } from '@/components/player/TransportIcons';
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
  onFreeDownload: (t: StoreTrack) => void;
  isWishlisted: (id: string) => boolean;
  onToggleWishlist: (id: string) => void;
}

export function StoreListView({
  tracks, accentColor, currentTrackId, isPlaying, isPreviewId,
  priceFor, onPlay, onPreview, onAddLease, onAddExclusive, onFreeDownload,
  isWishlisted, onToggleWishlist,
}: Props) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);

  const hoveredCover = useMemo(() => {
    if (!hovered) return null;
    const t = tracks.find((x) => x.id === hovered);
    return t?.cover_url ?? null;
  }, [hovered, tracks]);

  return (
    <div className="relative rounded-[28px] overflow-hidden border border-white/[0.08] bg-[#14110d]/70 backdrop-blur-2xl shadow-[0_20px_60px_rgba(0,0,0,0.55)]">
      {/* Cover backdrop — fades in when a row is hovered. Cinematic
          carryover from the deprecated portfolio embedded variant. */}
      <div
        aria-hidden
        className="absolute inset-0 -z-0 bg-cover bg-center transition-opacity duration-500 pointer-events-none"
        style={{
          backgroundImage: hoveredCover ? `url(${hoveredCover})` : undefined,
          opacity: hoveredCover ? 0.18 : 0,
          filter: 'blur(28px) saturate(1.1)',
          transform: 'scale(1.12)',
        }}
      />
      <div
        aria-hidden
        className="absolute inset-0 -z-0 pointer-events-none"
        style={{
          background: `linear-gradient(180deg, rgba(10,9,7,0.55) 0%, rgba(10,9,7,0.78) 70%, rgba(10,9,7,0.92) 100%)`,
        }}
      />

      {/* Header row */}
      <div className="relative hidden md:grid grid-cols-[36px_minmax(0,1.5fr)_minmax(0,1fr)_64px_220px_24px_24px] gap-4 px-4 md:px-6 py-2.5 border-b border-white/[0.05] text-[10px] font-mono uppercase tracking-[0.18em] text-white/40">
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
              className={`relative grid grid-cols-[36px_minmax(0,1fr)_auto] md:grid-cols-[36px_minmax(0,1.5fr)_minmax(0,1fr)_64px_220px_24px_24px] gap-3 md:gap-4 items-center px-4 md:px-6 py-2 cursor-pointer transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-[#D4BFA0]/40 ${isPreview ? 'bg-white/[0.07]' : isCur ? 'bg-white/[0.05]' : 'hover:bg-white/[0.04]'}`}
              style={isPreview ? { boxShadow: `inset 2px 0 0 ${accentColor}` } : isCur ? { boxShadow: `inset 2px 0 0 ${accentColor}80` } : {}}
            >
              {/* Cover w/ hover-play */}
              <div
                data-row-action
                onClick={(e) => { e.stopPropagation(); onPlay(t); }}
                className="relative w-9 h-9 rounded-md overflow-hidden bg-[#0a0907] border border-white/[0.06] shrink-0 cursor-pointer"
              >
                {t.cover_url
                  ? <img src={t.cover_url} alt="" className="w-full h-full object-cover" />
                  : <div className="w-full h-full flex items-center justify-center text-[#3a3328]"><Music size={13} /></div>}
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
                  className="text-[14px] truncate font-medium"
                  style={isCur || isPreview ? { color: accentColor } : { color: '#E8DCC8' }}
                >
                  {t.title}
                </p>
                {(t.bpm != null || t.key) && (
                  <p className="text-[10px] text-white/45 truncate uppercase tracking-[0.15em] font-mono">
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
                      className="text-[11px] truncate font-medium"
                      style={{ color: tag.category === 'genre' ? accentColor : 'rgba(255,255,255,0.55)' }}
                    >
                      #{tag.tag}
                    </span>
                  ))}
                {(t.tags ?? []).filter((x) => x.category === 'genre' || x.category === 'mood').length === 0 && (
                  <span className="text-[10px] font-mono text-white/35 truncate">—</span>
                )}
                {t.rating != null && Number(t.rating) > 0 && (
                  <span className="flex items-center gap-0.5 text-[11px] font-mono text-[#c8a84b] shrink-0 ml-auto">
                    ★ {Number(t.rating).toFixed(1)}
                  </span>
                )}
              </div>

              {/* Duration */}
              <div className="hidden md:flex items-center gap-1 justify-end text-[11px] font-mono text-white/45 tabular-nums">
                <Clock size={11} />
                {fmtDur(t.duration_seconds)}
              </div>

              {/* Per-track price buttons */}
              <div className="flex items-center gap-1.5 justify-end shrink-0">
                {t.free_download_enabled ? (
                  <button
                    data-row-action
                    onClick={(e) => { e.stopPropagation(); onFreeDownload(t); }}
                    className="flex items-center gap-1 px-3 py-2 rounded-md text-[11px] font-mono uppercase tracking-wider text-[#6DC6A4] bg-[#6DC6A4]/10 border border-[#6DC6A4]/30 hover:bg-[#6DC6A4]/20 transition-colors"
                  >
                    <Download size={11} />
                    Free
                  </button>
                ) : (
                  <>
                    <button
                      data-row-action
                      onClick={(e) => { e.stopPropagation(); onAddLease(t); }}
                      disabled={lp == null}
                      className="flex flex-col items-center px-2.5 py-1.5 rounded-md bg-white/[0.05] border border-white/[0.10] text-white text-[12px] font-bold hover:bg-white/[0.10] hover:border-white/[0.18] transition-colors disabled:opacity-30 leading-none"
                    >
                      <span className="tabular-nums">{lp != null ? `$${lp}` : '—'}</span>
                      <span className="text-[7px] font-mono text-white/45 mt-0.5 uppercase tracking-wider">Lease</span>
                    </button>
                    <button
                      data-row-action
                      onClick={(e) => { e.stopPropagation(); onAddExclusive(t); }}
                      disabled={ep == null}
                      className="flex flex-col items-center px-2.5 py-1.5 rounded-md text-black text-[12px] font-bold hover:opacity-90 transition-opacity disabled:opacity-30 leading-none"
                      style={{ backgroundColor: accentColor }}
                    >
                      <span className="tabular-nums">{ep != null ? `$${ep}` : '—'}</span>
                      <span className="text-[7px] font-mono text-black/60 mt-0.5 uppercase tracking-wider">Excl.</span>
                    </button>
                  </>
                )}
              </div>

              {/* Heart */}
              <button
                data-row-action
                onClick={(e) => { e.stopPropagation(); onToggleWishlist(t.id); }}
                aria-pressed={wishlisted}
                title={wishlisted ? 'Remove from favorites' : 'Add to favorites'}
                className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-white/[0.06] transition-colors"
                style={wishlisted ? { color: '#c8a84b' } : { color: 'rgba(255,255,255,0.45)' }}
              >
                <Heart size={13} fill={wishlisted ? 'currentColor' : 'none'} />
              </button>

              {/* Menu */}
              <div className="relative">
                <button
                  data-row-action
                  onClick={(e) => { e.stopPropagation(); setMenuFor(menuFor === t.id ? null : t.id); }}
                  className="w-7 h-7 rounded-full flex items-center justify-center text-white/45 hover:text-white hover:bg-white/[0.06] transition-colors"
                  title="More"
                >
                  <MoreHorizontal size={14} />
                </button>
                {menuFor === t.id && (
                  <div
                    data-row-action
                    onClick={(e) => e.stopPropagation()}
                    className="absolute right-0 top-9 z-30 w-48 rounded-xl bg-[#14110d]/95 backdrop-blur-xl border border-white/[0.10] shadow-[0_24px_60px_rgba(0,0,0,0.6)] py-1.5"
                  >
                    <button
                      onClick={() => { onPreview(t); setMenuFor(null); }}
                      className="flex items-center gap-2 px-3 py-2 text-[12px] text-[#E8DCC8] hover:bg-white/[0.06] w-full text-left"
                    >
                      <ShoppingBag size={12} className="text-white/60" />
                      Open beat
                    </button>
                    {!t.free_download_enabled && lp != null && (
                      <button
                        onClick={() => { onAddLease(t); setMenuFor(null); }}
                        className="flex items-center gap-2 px-3 py-2 text-[12px] text-[#E8DCC8] hover:bg-white/[0.06] w-full text-left"
                      >
                        <Plus size={12} className="text-white/60" />
                        Add lease (${lp})
                      </button>
                    )}
                    {!t.free_download_enabled && ep != null && (
                      <button
                        onClick={() => { onAddExclusive(t); setMenuFor(null); }}
                        className="flex items-center gap-2 px-3 py-2 text-[12px] text-[#E8DCC8] hover:bg-white/[0.06] w-full text-left"
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
                      className="flex items-center gap-2 px-3 py-2 text-[12px] text-[#E8DCC8] hover:bg-white/[0.06] w-full text-left"
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
