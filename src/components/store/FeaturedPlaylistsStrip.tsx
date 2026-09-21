'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  ListMusic, ChevronRight, X, Music, ShoppingBag, Layers,
} from 'lucide-react';
import { PlayGlyph, PauseGlyph } from '@/components/player/TransportIcons';
import type { Track } from '@/lib/types';
import type { FeaturedPlaylist, PlaylistTrackItem } from './types';
import { ArtworkFallback } from '@/components/ui/ArtworkFallback';

interface Props {
  label?: string;
  playlists: FeaturedPlaylist[];
  currentTrack: Track | null;
  isPlaying: boolean;
  onPlay: (t: PlaylistTrackItem, playlist: FeaturedPlaylist) => void;
  priceFor: (t: PlaylistTrackItem, type: 'lease' | 'exclusive') => number | null;
  onAddToCart: (t: PlaylistTrackItem, type: 'lease' | 'exclusive') => void;
  onAddAllToCart?: (tracks: PlaylistTrackItem[], type: 'lease' | 'exclusive') => void;
  detailHrefBase?: string;
  onBuyProject?: (proj: FeaturedPlaylist & { price_usd?: number | null }) => void;
  /** Project mode: larger album-style cards, direct navigation to detail page */
  projectMode?: boolean;
}

export function FeaturedPlaylistsStrip({
  label = 'Featured Playlists',
  playlists, currentTrack, isPlaying, onPlay, priceFor, onAddToCart,
  onAddAllToCart, detailHrefBase, onBuyProject, projectMode = false,
}: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  /* ── Project mode: large album cards, direct link ── */
  if (projectMode) {
    return (
      <div className="max-w-[1400px] mx-auto px-4 md:px-8 pt-8 pb-2">
        <p className="text-[9px] font-mono uppercase tracking-[0.3em] text-white/40 mb-4">{label}</p>
        <div className="flex gap-4 overflow-x-auto pb-3 no-scrollbar snap-x snap-mandatory">
          {playlists.map((pl, index) => {
            const href = detailHrefBase ? `${detailHrefBase}/${pl.id}` : '#';
            const projectPrice = pl.price_usd;
            return (
              <Link
                key={pl.id}
                href={href}
                className="group shrink-0 w-[180px] sm:w-[200px] md:w-[220px] snap-start"
              >
                {/* Flat hairline instead of a gradient bezel tray — same
                    reduction applied to BeatCard and the store detail page. */}
                <div className="mb-3 aspect-square w-full overflow-hidden rounded-xl bg-white/[0.06] p-px">
                  <div className="relative w-full h-full rounded-xl overflow-hidden bg-white/[0.04]">
                    {/* A featured collection with no cover of its own borrows
                        the first track's art before the brand default, so the
                        strip shows what is inside rather than a glyph. */}
                    <ArtworkFallback
                      src={pl.cover_url ?? pl.tracks?.find((t) => t.cover_url)?.cover_url ?? null}
                      seed={pl.id}
                      kind="project"
                      sizes="(max-width: 640px) 45vw, 180px"
                      priority={index === 0}
                      className="object-cover group-hover:scale-[1.04] transition-transform duration-500 ease-out"
                    >
                      <Layers size={28} aria-hidden="true" />
                    </ArtworkFallback>
                    {/* Hover overlay */}
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <ChevronRight size={22} className="text-white" />
                    </div>
                    {/* Price badge */}
                    {projectPrice != null && Number(projectPrice) > 0 && (
                      <div className="absolute top-2 right-2 px-2 py-0.5 rounded-lg bg-black/70 backdrop-blur-sm text-[10px] font-bold text-white">
                        ${projectPrice}
                      </div>
                    )}
                  </div>
                </div>
                <p className="text-[11px] font-semibold text-white truncate group-hover:text-white transition-colors leading-tight">
                  {pl.name}
                </p>
                <p className="text-[9px] font-mono text-white/40 mt-1">
                  {pl.tracks?.length ?? 0} track{(pl.tracks?.length ?? 0) === 1 ? '' : 's'}
                </p>
              </Link>
            );
          })}
        </div>
      </div>
    );
  }

  /* ── Playlist mode: compact thumbnail strip, expand on click ── */
  return (
    <div className="max-w-[1400px] mx-auto px-4 md:px-8 pt-8 pb-2">
      <p className="text-[9px] font-mono uppercase tracking-[0.3em] text-white/40 mb-4">{label}</p>
      <div className="flex gap-4 overflow-x-auto pb-2 no-scrollbar">
        {playlists.map((pl, index) => (
          <button
            key={pl.id}
            onClick={() => setExpandedId((id) => (id === pl.id ? null : pl.id))}
            className={`shrink-0 w-[120px] sm:w-[140px] text-left group transition-all ${expandedId === pl.id ? 'opacity-100' : ''}`}
          >
            <div className={`relative w-full aspect-square rounded-xl bg-white/[0.04] border overflow-hidden mb-2 flex items-center justify-center transition-all ${expandedId === pl.id ? 'border-white/20 shadow-lg shadow-white/10' : 'border-white/10 group-hover:border-white/20'}`}>
              <ArtworkFallback
                src={pl.cover_url ?? pl.tracks?.find((t) => t.cover_url)?.cover_url ?? null}
                seed={pl.id}
                kind="playlist"
                sizes="140px"
                priority={index === 0}
                className="object-cover"
              >
                <ListMusic size={24} aria-hidden="true" />
              </ArtworkFallback>
            </div>
            <p className="text-[11px] font-medium text-white truncate">{pl.name}</p>
            <p className="text-[9px] font-mono text-white/40 mt-0.5">{pl.tracks?.length ?? 0} tracks</p>
          </button>
        ))}
      </div>

      {expandedId && (() => {
        const pl = playlists.find((p) => p.id === expandedId);
        if (!pl) return null;
        if (!pl.tracks?.length) return (
          <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.04] px-5 py-8 text-center">
            <ListMusic size={20} className="text-white/30 mx-auto mb-2" />
            <p className="text-[11px] text-white/40">No tracks in this playlist yet.</p>
          </div>
        );
        return (
          <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.04] overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
              <p className="text-[11px] font-semibold text-white">{pl.name}</p>
              <div className="flex items-center gap-2">
                {detailHrefBase && (
                  <Link
                    href={`${detailHrefBase}/${pl.id}`}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-white/[0.08] text-white/80 text-[9px] font-mono uppercase tracking-widest hover:text-white hover:border-white/[0.16] transition-colors"
                  >
                    Open
                    <ChevronRight size={11} />
                  </Link>
                )}
                {onBuyProject && pl.price_usd != null && Number(pl.price_usd) > 0 && (
                  <button
                    onClick={() => onBuyProject(pl)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white text-black text-[9px] font-mono uppercase tracking-widest hover:bg-white/90 transition-colors"
                  >
                    <ShoppingBag size={11} />
                    Buy project — ${pl.price_usd}
                  </button>
                )}
                {onAddAllToCart && pl.tracks.some((t) => priceFor(t, 'lease') != null) && (
                  <button
                    onClick={() => onAddAllToCart(pl.tracks, 'lease')}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-white/20 text-white text-[9px] font-mono uppercase tracking-widest hover:bg-white/10 transition-colors"
                  >
                    <ShoppingBag size={11} />
                    Add All — Lease
                  </button>
                )}
                {onAddAllToCart && pl.tracks.some((t) => priceFor(t, 'exclusive') != null) && (
                  <button
                    onClick={() => onAddAllToCart(pl.tracks, 'exclusive')}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white text-black text-[9px] font-mono uppercase tracking-widest hover:bg-white/90 transition-colors"
                  >
                    <ShoppingBag size={11} />
                    Add All — Exclusive
                  </button>
                )}
                <button onClick={() => setExpandedId(null)} className="text-white/40 hover:text-white/80 transition-colors">
                  <X size={13} />
                </button>
              </div>
            </div>
            <div className="divide-y divide-white/10">
              {pl.tracks.map((t) => {
                const isCur = currentTrack?.id === t.id;
                const lp = priceFor(t, 'lease');
                const ep = priceFor(t, 'exclusive');
                return (
                  <div key={t.id} className={`flex items-center gap-3 px-4 py-2.5 hover:bg-[#0D0D0A] transition-colors ${isCur ? 'bg-[#0D0D0A]' : ''}`}>
                    <button
                      onClick={() => { if (pl) onPlay(t, pl); }}
                      className="glass-play-surface w-6 h-6 rounded-full flex items-center justify-center shrink-0"
                      data-playing={isCur && isPlaying ? 'true' : 'false'}
                    >
                      {isCur && isPlaying
                        ? <PauseGlyph size={11} />
                        : <PlayGlyph size={11} className="ml-0.5" />}
                    </button>
                    <div className="relative w-8 h-8 rounded shrink-0 bg-[#090907] overflow-hidden">
                      <ArtworkFallback src={t.cover_url} seed={t.id} kind="track" sizes="32px" className="object-cover">
                        <Music size={12} aria-hidden="true" />
                      </ArtworkFallback>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-[11px] font-medium truncate ${isCur ? 'text-white' : 'text-white'}`}>{t.title}</p>
                      <p className="text-[9px] font-mono text-white/40 uppercase tracking-wider">
                        {t.type}{t.bpm ? ` · ${t.bpm}` : ''}{t.key ? ` · ${t.key}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {t.free_download_enabled ? (
                        <span className="text-[10px] font-mono text-[#6DC6A4] uppercase tracking-wider">Free</span>
                      ) : (
                        <>
                          {lp != null && (
                            <button onClick={() => onAddToCart(t, 'lease')}
                              className="px-2 py-1 rounded bg-white/[0.06] border border-white/[0.08] text-white text-[10px] font-bold hover:bg-white/[0.12] transition-colors">
                              ${lp}
                            </button>
                          )}
                          {ep != null && (
                            <button onClick={() => onAddToCart(t, 'exclusive')}
                              className="px-2 py-1 rounded bg-white text-black text-[10px] font-bold hover:bg-white/90 transition-colors">
                              ${ep}
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
