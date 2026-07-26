"use client";

import React, { useMemo } from 'react';
import { Track, Playlist } from '@/lib/types';
import { PlayGlyph } from '@/components/player/TransportIcons';
import { LiquidGlassButton } from '@/components/ui/LiquidGlassButton';
import { Play, Heart, Undo2, Redo2, Share2, MoreHorizontal, Search, Sparkles, Disc, SlidersHorizontal, ChevronLeft, ChevronRight } from 'lucide-react';

interface VisionLibraryViewProps {
  tracks: Track[];
  playlists: Playlist[];
  currentTrackId: string | null;
  isPlaying: boolean;
  onPlayTrack: (track: Track) => void;
  onClickDetails: (track: Track) => void;
}

export function VisionLibraryView({
  tracks,
  playlists,
  currentTrackId,
  isPlaying,
  onPlayTrack,
  onClickDetails,
}: VisionLibraryViewProps) {
  // Top Recommendations: 5 tracks
  const recommendations = useMemo(() => {
    const withCovers = tracks.filter((t) => t.cover_url);
    return (withCovers.length >= 5 ? withCovers : tracks).slice(0, 5);
  }, [tracks]);

  // Playlists / Collections: up to 6
  const displayPlaylists = useMemo(() => {
    return playlists.slice(0, 6);
  }, [playlists]);

  // Continue playing: next 3-4 tracks for the right sidebar
  const continuePlaying = useMemo(() => {
    return tracks.slice(0, 4);
  }, [tracks]);

  // Dynamic ambient background image
  const bgImage = recommendations[0]?.cover_url || "https://ca-times.brightspotcdn.com/dims4/default/d5f6173/2147483647/strip/true/crop/4436x4403+0+0/resize/1200x1191!/quality/75/?url=https%3A%2F%2Fcalifornia-times-brightspot.s3.amazonaws.com%2F5b%2F8d%2F9918bf924c09ae2ff707b58a9484%2Fcowboy-carter-press-03.jpg";

  return (
    <div className="relative w-full max-w-6xl mx-auto py-6 px-2 sm:px-6">
      {/* ── Spatial Top Bar (Floating Pill) ─────────────────────────────────── */}
      <div className="flex items-center justify-between max-w-xl mx-auto mb-6 px-4 py-2 rounded-full bg-white/[0.06] backdrop-blur-2xl border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.3),_inset_0_1px_1px_rgba(255,255,255,0.15)] text-white/80">
        <div className="flex items-center gap-1">
          <button className="p-1.5 rounded-full hover:bg-white/10 text-white/60 hover:text-white transition-colors">
            <Undo2 size={14} />
          </button>
          <button className="p-1.5 rounded-full hover:bg-white/10 text-white/60 hover:text-white transition-colors">
            <Redo2 size={14} />
          </button>
        </div>
        <div className="flex items-center gap-2 text-xs font-medium tracking-wide text-white/90">
          <Disc size={13} className="text-white animate-spin-slow" />
          <span>Spatial Music Library</span>
        </div>
        <div className="flex items-center gap-1">
          <button className="p-1.5 rounded-full hover:bg-white/10 text-white/60 hover:text-white transition-colors">
            <Search size={14} />
          </button>
          <button className="p-1.5 rounded-full hover:bg-white/10 text-white/60 hover:text-white transition-colors">
            <SlidersHorizontal size={14} />
          </button>
        </div>
      </div>

      {/* ── Main Vision OS Window ───────────────────────────────────────────── */}
      <div className="relative rounded-[32px] overflow-hidden border border-white/[0.12] shadow-[0_24px_64px_rgba(0,0,0,0.6),_inset_0_1px_2px_rgba(255,255,255,0.2)] bg-black/40">
        {/* Ambient background blur inside the window */}
        <div 
          className="absolute inset-0 bg-cover bg-center opacity-30 blur-[90px] saturate-200 transform scale-125 pointer-events-none"
          style={{ backgroundImage: `url(${bgImage})` }}
        />
        {/* Deep frosted glass surface */}
        <div className="absolute inset-0 bg-gradient-to-br from-white/[0.07] via-white/[0.03] to-transparent backdrop-blur-3xl pointer-events-none" />

        {/* Window Content Grid */}
        <div className="relative z-10 p-6 sm:p-8 grid grid-cols-1 lg:grid-cols-[1fr_310px] gap-8 lg:gap-10">
          
          {/* Left Column: Recommendations & Playlists */}
          <div className="flex flex-col justify-between space-y-8 min-w-0">
            
            {/* Top Recommendation Section */}
            <section>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold tracking-tight text-white/90">Top Recommendation</h2>
                <div className="flex items-center gap-1">
                  <button className="p-1 rounded-full bg-white/5 hover:bg-white/10 text-white/60 hover:text-white transition-colors border border-white/5">
                    <ChevronLeft size={12} />
                  </button>
                  <button className="p-1 rounded-full bg-white/5 hover:bg-white/10 text-white/60 hover:text-white transition-colors border border-white/5">
                    <ChevronRight size={12} />
                  </button>
                </div>
              </div>

              {/* Compact Cards Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3.5">
                {recommendations.map((track) => (
                  <div 
                    key={track.id} 
                    onClick={() => onClickDetails(track)}
                    className="group relative cursor-pointer p-2.5 rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] hover:border-white/15 transition-all duration-300 shadow-sm"
                  >
                    <div className="aspect-square rounded-xl overflow-hidden mb-2.5 relative shadow-inner bg-black/40">
                      <img 
                        src={track.cover_url || "https://placehold.co/400/171511/FFFFFF?text=No+Cover"} 
                        alt={track.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 ease-out"
                      />
                      {/* Sleek play button overlay */}
                      <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center">
                        <button 
                          onClick={(e) => { e.stopPropagation(); onPlayTrack(track); }}
                          className="w-8 h-8 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center border border-white/40 shadow-lg hover:scale-110 active:scale-95 transition-transform"
                        >
                          <Play size={14} fill="white" className="ml-0.5 text-white" />
                        </button>
                      </div>
                      {/* Active indicator */}
                      {currentTrackId === track.id && (
                        <div className="absolute bottom-1.5 right-1.5 w-2 h-2 rounded-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.8)]" />
                      )}
                    </div>
                    <h3 className={`text-xs font-medium truncate ${currentTrackId === track.id ? 'text-white font-bold' : 'text-white/90'}`}>
                      {track.title || 'Untitled'}
                    </h3>
                    <p className="text-[10px] text-white/40 font-mono truncate mt-0.5">U2C · {track.bpm ? `${track.bpm} BPM` : 'Beat'}</p>
                  </div>
                ))}
              </div>
            </section>

            {/* Playlists & Collections Section (Circular avatars like "Following Artists") */}
            <section>
              <div className="flex items-center justify-between mb-3.5">
                <h2 className="text-sm font-semibold tracking-tight text-white/90">Playlists & Collections</h2>
                <span className="text-[10px] font-mono uppercase tracking-wider text-white/40">{playlists.length} total</span>
              </div>

              <div className="flex items-center gap-4 overflow-x-auto pb-2 scrollbar-none">
                {displayPlaylists.length > 0 ? displayPlaylists.map((playlist) => (
                  <div 
                    key={playlist.id} 
                    className="flex flex-col items-center group cursor-pointer shrink-0 w-16"
                  >
                    <div className="w-14 h-14 rounded-full overflow-hidden mb-2 p-0.5 bg-gradient-to-b from-white/20 to-transparent shadow-[0_4px_12px_rgba(0,0,0,0.3)] group-hover:scale-105 transition-transform duration-300">
                      <div className="w-full h-full rounded-full overflow-hidden bg-black/50">
                        <img 
                          src={playlist.cover_url || "https://placehold.co/400/171511/FFFFFF?text=PL"} 
                          alt={playlist.name}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    </div>
                    <h3 className="text-[11px] font-medium text-white/80 group-hover:text-white text-center w-full truncate transition-colors">
                      {playlist.name}
                    </h3>
                    <p className="text-[9px] text-white/35 font-mono text-center w-full truncate mt-0.5">
                      Playlist
                    </p>
                  </div>
                )) : (
                  <div className="flex items-center gap-3 py-3 px-4 rounded-2xl bg-white/[0.02] border border-white/[0.05] text-white/40 text-xs w-full">
                    <Sparkles size={14} className="text-white/30" />
                    <span>Create a playlist to see your collections appear here in 3D space.</span>
                  </div>
                )}
              </div>
            </section>

          </div>

          {/* Right Column: Continue Playing (Sleek horizontal pills) */}
          <div className="border-t lg:border-t-0 lg:border-l border-white/[0.08] pt-6 lg:pt-0 lg:pl-8 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold tracking-tight text-white/90">Continue Playing</h2>
                <span className="text-[10px] font-mono text-black bg-white font-semibold shadow-md hover:bg-white/90/10 px-2 py-0.5 rounded-full border border-white/20">Active</span>
              </div>

              <div className="space-y-2.5">
                {continuePlaying.map((track, idx) => (
                  <div 
                    key={track.id}
                    onClick={() => onClickDetails(track)}
                    className="group relative flex items-center justify-between p-2.5 rounded-2xl bg-white/[0.04] hover:bg-white/[0.09] border border-white/[0.06] hover:border-white/15 transition-all duration-300 cursor-pointer shadow-sm"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1 mr-2">
                      <div className="w-10 h-10 rounded-xl overflow-hidden shrink-0 border border-white/10 relative bg-black/40">
                        <img 
                          src={track.cover_url || "https://placehold.co/400/171511/FFFFFF?text=NA"} 
                          alt={track.title}
                          className="w-full h-full object-cover"
                        />
                        {currentTrackId === track.id && (
                          <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px] flex items-center justify-center">
                            <div className="w-2.5 h-2.5 rounded-full bg-white animate-pulse shadow-[0_0_8px_rgba(255,255,255,0.8)]" />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className={`text-xs font-medium truncate ${currentTrackId === track.id ? 'text-white font-bold' : 'text-white/90'}`}>
                          {track.title || 'Untitled'}
                        </h3>
                        <p className="text-[10px] text-white/40 font-mono truncate mt-0.5">
                          {track.duration_seconds ? `${Math.floor(track.duration_seconds / 60)}:${Math.floor(track.duration_seconds % 60).toString().padStart(2, '0')}` : '0:00'} · U2C
                        </p>
                      </div>
                    </div>

                    {/* Right action / Play count badge (recreating Dribbble UI badge style) */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-white/[0.06] border border-white/[0.08] text-[10px] font-mono text-white/60 group-hover:opacity-0 transition-opacity">
                        <span>{120 + idx * 45}k</span>
                        <Heart size={9} className="text-white/40" />
                      </div>

                      <div className="absolute right-2.5 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button 
                          onClick={(e) => { e.stopPropagation(); onPlayTrack(track); }}
                          className="w-7 h-7 rounded-full bg-white/20 hover:bg-white/30 backdrop-blur-md flex items-center justify-center text-white border border-white/30 shadow-sm transition-transform active:scale-95"
                          title="Play"
                        >
                          <Play size={11} fill="white" className="ml-0.5" />
                        </button>
                        <button 
                          onClick={(e) => { e.stopPropagation(); }}
                          className="w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/70 hover:text-white transition-colors"
                          title="More"
                        >
                          <MoreHorizontal size={13} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Bottom mini ambient status inside right col */}
            <div className="mt-6 pt-4 border-t border-white/[0.06] flex items-center justify-between text-[10px] font-mono text-white/30">
              <span>VISION OS AUDIO ENGINE</span>
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                READY
              </span>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
