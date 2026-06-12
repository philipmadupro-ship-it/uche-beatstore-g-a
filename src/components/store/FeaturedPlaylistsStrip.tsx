'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  ListMusic, ChevronRight, X, Music, ShoppingBag, Layers,
} from 'lucide-react';
import { PlayGlyph, PauseGlyph } from '@/components/player/TransportIcons';
import type { Track } from '@/lib/types';
import type { FeaturedPlaylist, PlaylistTrackItem } from './types';

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
        <p className="text-[9px] font-mono uppercase tracking-[0.3em] text-[#6E685B] mb-4">{label}</p>
        <div className="flex gap-4 overflow-x-auto pb-3 no-scrollbar snap-x snap-mandatory">
          {playlists.map((pl) => {
            const href = detailHrefBase ? `${detailHrefBase}/${pl.id}` : '#';
            const projectPrice = (pl as any).price_usd as number | null | undefined;
            return (
              <Link
                key={pl.id}
                href={href}
                className="group shrink-0 w-[180px] sm:w-[200px] md:w-[220px] snap-start"
              >
                {/* Cover — double-bezel */}
                <div
                  className="w-full aspect-square rounded-[14px] p-[1.5px] mb-3 overflow-hidden"
                  style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.02) 100%)' }}
                >
                  <div className="relative w-full h-full rounded-[13px] overflow-hidden bg-[#171511]">
                    {pl.cover_url ? (
                      <img
                        src={pl.cover_url}
                        alt=""
                        loading="lazy"
                        className="w-full h-full object-cover group-hover:scale-[1.04] transition-transform duration-500 ease-out"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-[#2B2821] to-[#090907]">
                        <Layers size={28} className="text-[#3B372F]" />
                      </div>
                    )}
                    {/* Hover overlay */}
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <ChevronRight size={22} className="text-white" />
                    </div>
                    {/* Price badge */}
                    {projectPrice != null && Number(projectPrice) > 0 && (
                      <div className="absolute top-2 right-2 px-2 py-0.5 rounded-lg bg-black/70 backdrop-blur-sm text-[10px] font-bold text-[#E7D7BE]">
                        ${projectPrice}
                      </div>
                    )}
                  </div>
                </div>
                <p className="text-[12px] font-semibold text-[#F7EBDD] truncate group-hover:text-[#E7D7BE] transition-colors leading-tight">
                  {pl.name}
                </p>
                <p className="text-[9px] font-mono text-[#9B9282] mt-1">
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
      <p className="text-[9px] font-mono uppercase tracking-[0.3em] text-[#6E685B] mb-4">{label}</p>
      <div className="flex gap-4 overflow-x-auto pb-2 no-scrollbar">
        {playlists.map((pl) => (
          <button
            key={pl.id}
            onClick={() => setExpandedId((id) => (id === pl.id ? null : pl.id))}
            className={`shrink-0 w-[120px] sm:w-[140px] text-left group transition-all ${expandedId === pl.id ? 'opacity-100' : ''}`}
          >
            <div className={`w-full aspect-square rounded-xl bg-[#171511] border overflow-hidden mb-2 flex items-center justify-center transition-all ${expandedId === pl.id ? 'border-[#E7D7BE]/40 shadow-lg shadow-[#E7D7BE]/5' : 'border-[#2B2821] group-hover:border-[#3B372F]'}`}>
              {pl.cover_url
                ? <img src={pl.cover_url} alt="" className="w-full h-full object-cover" />
                : <ListMusic size={24} className="text-[#3B372F]" />}
            </div>
            <p className="text-[11px] font-medium text-[#F7EBDD] truncate">{pl.name}</p>
            <p className="text-[9px] font-mono text-[#9B9282] mt-0.5">{pl.tracks?.length ?? 0} tracks</p>
          </button>
        ))}
      </div>

      {expandedId && (() => {
        const pl = playlists.find((p) => p.id === expandedId);
        if (!pl) return null;
        if (!pl.tracks?.length) return (
          <div className="mt-4 rounded-xl border border-[#2B2821] bg-[#171511] px-5 py-8 text-center">
            <ListMusic size={20} className="text-[#3B372F] mx-auto mb-2" />
            <p className="text-[11px] text-[#9B9282]">No tracks in this playlist yet.</p>
          </div>
        );
        return (
          <div className="mt-4 rounded-xl border border-[#2B2821] bg-[#171511] overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#211F1A]">
              <p className="text-[11px] font-semibold text-[#F7EBDD]">{pl.name}</p>
              <div className="flex items-center gap-2">
                {detailHrefBase && (
                  <Link
                    href={`${detailHrefBase}/${pl.id}`}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-white/[0.08] text-[#D0C3AF] text-[9px] font-mono uppercase tracking-widest hover:text-[#F7EBDD] hover:border-white/[0.16] transition-colors"
                  >
                    Open
                    <ChevronRight size={11} />
                  </Link>
                )}
                {onBuyProject && (pl as any).price_usd != null && Number((pl as any).price_usd) > 0 && (
                  <button
                    onClick={() => onBuyProject(pl as any)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#E7D7BE] text-black text-[9px] font-mono uppercase tracking-widest hover:bg-[#F3E6D1] transition-colors"
                  >
                    <ShoppingBag size={11} />
                    Buy project — ${(pl as any).price_usd}
                  </button>
                )}
                {onAddAllToCart && pl.tracks.some((t) => priceFor(t, 'lease') != null) && (
                  <button
                    onClick={() => onAddAllToCart(pl.tracks, 'lease')}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[#E7D7BE]/30 text-[#E7D7BE] text-[9px] font-mono uppercase tracking-widest hover:bg-[#E7D7BE]/10 transition-colors"
                  >
                    <ShoppingBag size={11} />
                    Add All — Lease
                  </button>
                )}
                {onAddAllToCart && pl.tracks.some((t) => priceFor(t, 'exclusive') != null) && (
                  <button
                    onClick={() => onAddAllToCart(pl.tracks, 'exclusive')}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#E7D7BE] text-black text-[9px] font-mono uppercase tracking-widest hover:bg-[#F3E6D1] transition-colors"
                  >
                    <ShoppingBag size={11} />
                    Add All — Exclusive
                  </button>
                )}
                <button onClick={() => setExpandedId(null)} className="text-[#6E685B] hover:text-[#D0C3AF] transition-colors">
                  <X size={13} />
                </button>
              </div>
            </div>
            <div className="divide-y divide-[#211F1A]">
              {pl.tracks.map((t) => {
                const isCur = currentTrack?.id === t.id;
                const lp = priceFor(t, 'lease');
                const ep = priceFor(t, 'exclusive');
                return (
                  <div key={t.id} className={`flex items-center gap-3 px-4 py-2.5 hover:bg-[#1A1813] transition-colors ${isCur ? 'bg-[#1A1813]' : ''}`}>
                    <button
                      onClick={() => { if (pl) onPlay(t, pl); }}
                      className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 transition-colors ${isCur ? 'bg-[#E7D7BE] text-black' : 'bg-white/[0.06] text-[#D0C3AF] hover:bg-white/[0.12] hover:text-white'}`}
                    >
                      {isCur && isPlaying
                        ? <PauseGlyph size={11} />
                        : <PlayGlyph size={11} className="ml-0.5" />}
                    </button>
                    <div className="w-8 h-8 rounded shrink-0 bg-[#090907] overflow-hidden">
                      {t.cover_url
                        ? <img src={t.cover_url} alt="" className="w-full h-full object-cover" />
                        : <div className="w-full h-full flex items-center justify-center text-[#6E685B]"><Music size={12} /></div>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-[12px] font-medium truncate ${isCur ? 'text-[#E7D7BE]' : 'text-[#F7EBDD]'}`}>{t.title}</p>
                      <p className="text-[9px] font-mono text-[#9B9282] uppercase tracking-wider">
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
                              className="px-2 py-1 rounded bg-white/[0.06] border border-white/[0.08] text-[#F7EBDD] text-[10px] font-bold hover:bg-white/[0.12] transition-colors">
                              ${lp}
                            </button>
                          )}
                          {ep != null && (
                            <button onClick={() => onAddToCart(t, 'exclusive')}
                              className="px-2 py-1 rounded bg-[#E7D7BE] text-black text-[10px] font-bold hover:bg-[#F3E6D1] transition-colors">
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
