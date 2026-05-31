'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  ListMusic, ChevronRight, X, Music, ShoppingBag,
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
}

export function FeaturedPlaylistsStrip({
  label = 'Featured Playlists',
  playlists, currentTrack, isPlaying, onPlay, priceFor, onAddToCart,
  onAddAllToCart, detailHrefBase, onBuyProject,
}: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="max-w-[1400px] mx-auto px-4 md:px-8 pt-8 pb-2">
      <p className="text-[9px] font-mono uppercase tracking-[0.3em] text-[#3a3328] mb-4">{label}</p>
      <div className="flex gap-4 overflow-x-auto pb-2 no-scrollbar">
        {playlists.map((pl) => (
          <button
            key={pl.id}
            onClick={() => setExpandedId((id) => (id === pl.id ? null : pl.id))}
            className={`shrink-0 w-[120px] sm:w-[140px] text-left group transition-all ${expandedId === pl.id ? 'opacity-100' : ''}`}
          >
            <div className={`w-full aspect-square rounded-xl bg-[#14110d] border overflow-hidden mb-2 flex items-center justify-center transition-all ${expandedId === pl.id ? 'border-[#D4BFA0]/40 shadow-lg shadow-[#D4BFA0]/5' : 'border-[#1f1a13] group-hover:border-[#2d2620]'}`}>
              {pl.cover_url
                ? <img src={pl.cover_url} alt="" className="w-full h-full object-cover" />
                : <ListMusic size={24} className="text-[#2d2620]" />}
            </div>
            <p className="text-[11px] font-medium text-[#E8DCC8] truncate">{pl.name}</p>
            <p className="text-[9px] font-mono text-[#5a5142] mt-0.5">{pl.tracks?.length ?? 0} tracks</p>
          </button>
        ))}
      </div>

      {expandedId && (() => {
        const pl = playlists.find((p) => p.id === expandedId);
        if (!pl) return null;
        if (!pl.tracks?.length) return (
          <div className="mt-4 rounded-xl border border-[#1f1a13] bg-[#14110d] px-5 py-8 text-center">
            <ListMusic size={20} className="text-[#2d2620] mx-auto mb-2" />
            <p className="text-[11px] text-[#5a5142]">No tracks in this playlist yet.</p>
          </div>
        );
        return (
          <div className="mt-4 rounded-xl border border-[#1f1a13] bg-[#14110d] overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#1a160f]">
              <p className="text-[11px] font-semibold text-[#E8DCC8]">{pl.name}</p>
              <div className="flex items-center gap-2">
                {detailHrefBase && (
                  <Link
                    href={`${detailHrefBase}/${pl.id}`}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-white/[0.08] text-[#a08a6a] text-[9px] font-mono uppercase tracking-widest hover:text-[#E8DCC8] hover:border-white/[0.16] transition-colors"
                  >
                    Open
                    <ChevronRight size={11} />
                  </Link>
                )}
                {onBuyProject && (pl as any).price_usd != null && Number((pl as any).price_usd) > 0 && (
                  <button
                    onClick={() => onBuyProject(pl as any)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#D4BFA0] text-black text-[9px] font-mono uppercase tracking-widest hover:bg-[#E8D8B8] transition-colors"
                  >
                    <ShoppingBag size={11} />
                    Buy project — ${(pl as any).price_usd}
                  </button>
                )}
                {onAddAllToCart && pl.tracks.some((t) => priceFor(t, 'lease') != null) && (
                  <button
                    onClick={() => onAddAllToCart(pl.tracks, 'lease')}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[#D4BFA0]/30 text-[#D4BFA0] text-[9px] font-mono uppercase tracking-widest hover:bg-[#D4BFA0]/10 transition-colors"
                  >
                    <ShoppingBag size={11} />
                    Add All — Lease
                  </button>
                )}
                {onAddAllToCart && pl.tracks.some((t) => priceFor(t, 'exclusive') != null) && (
                  <button
                    onClick={() => onAddAllToCart(pl.tracks, 'exclusive')}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#D4BFA0] text-black text-[9px] font-mono uppercase tracking-widest hover:bg-[#E8D8B8] transition-colors"
                  >
                    <ShoppingBag size={11} />
                    Add All — Exclusive
                  </button>
                )}
                <button onClick={() => setExpandedId(null)} className="text-[#3a3328] hover:text-[#a08a6a] transition-colors">
                  <X size={13} />
                </button>
              </div>
            </div>
            <div className="divide-y divide-[#1a160f]">
              {pl.tracks.map((t) => {
                const isCur = currentTrack?.id === t.id;
                const lp = priceFor(t, 'lease');
                const ep = priceFor(t, 'exclusive');
                return (
                  <div key={t.id} className={`flex items-center gap-3 px-4 py-2.5 hover:bg-[#16130e] transition-colors ${isCur ? 'bg-[#16130e]' : ''}`}>
                    <button
                      onClick={() => { if (pl) onPlay(t, pl); }}
                      className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 transition-colors ${isCur ? 'bg-[#D4BFA0] text-black' : 'bg-white/[0.06] text-[#a08a6a] hover:bg-white/[0.12] hover:text-white'}`}
                    >
                      {isCur && isPlaying
                        ? <PauseGlyph size={11} />
                        : <PlayGlyph size={11} className="ml-0.5" />}
                    </button>
                    <div className="w-8 h-8 rounded shrink-0 bg-[#0a0907] overflow-hidden">
                      {t.cover_url
                        ? <img src={t.cover_url} alt="" className="w-full h-full object-cover" />
                        : <div className="w-full h-full flex items-center justify-center text-[#3a3328]"><Music size={12} /></div>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-[12px] font-medium truncate ${isCur ? 'text-[#D4BFA0]' : 'text-[#E8DCC8]'}`}>{t.title}</p>
                      <p className="text-[9px] font-mono text-[#5a5142] uppercase tracking-wider">
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
                              className="px-2 py-1 rounded bg-white/[0.06] border border-white/[0.08] text-[#E8DCC8] text-[10px] font-bold hover:bg-white/[0.12] transition-colors">
                              ${lp}
                            </button>
                          )}
                          {ep != null && (
                            <button onClick={() => onAddToCart(t, 'exclusive')}
                              className="px-2 py-1 rounded bg-[#D4BFA0] text-black text-[10px] font-bold hover:bg-[#E8D8B8] transition-colors">
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
