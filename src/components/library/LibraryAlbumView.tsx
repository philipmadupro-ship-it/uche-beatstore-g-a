"use client";

import React from 'react';
import { Track } from '@/lib/types';
import { MoreHorizontal } from 'lucide-react';

const MoreOptionsIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M5 10C3.9 10 3 10.9 3 12C3 13.1 3.9 14 5 14C6.1 14 7 13.1 7 12C7 10.9 6.1 10 5 10ZM19 10C17.9 10 17 10.9 17 12C17 13.1 17.9 14 19 14C20.1 14 21 13.1 21 12C21 10.9 20.1 10 19 10ZM12 10C10.9 10 10 10.9 10 12C10 13.1 10.9 14 12 14C13.1 14 14 13.1 14 12C14 10.9 13.1 10 12 10Z" fill="white"/>
  </svg>
);

interface LibraryAlbumViewProps {
    tracks: Track[];
    currentTrackId: string | null;
    isPlaying: boolean;
    onPlayTrack: (track: Track) => void;
    onClickDetails: (track: Track) => void;
}

function formatDuration(seconds: number | undefined | null) {
    if (!seconds) return '--:--';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

export function LibraryAlbumView({ tracks, currentTrackId, isPlaying, onPlayTrack, onClickDetails }: LibraryAlbumViewProps) {
    // Determine the main cover art to show. Defaults to the first track with a cover, or a placeholder.
    const heroCoverUrl = tracks.find(t => t.cover_url)?.cover_url || "https://ca-times.brightspotcdn.com/dims4/default/d5f6173/2147483647/strip/true/crop/4436x4403+0+0/resize/1200x1191!/quality/75/?url=https%3A%2F%2Fcalifornia-times-brightspot.s3.amazonaws.com%2F5b%2F8d%2F9918bf924c09ae2ff707b58a9484%2Fcowboy-carter-press-03.jpg";
    
    // Genres from track tags would go here, we'll just show 'Beats' for now if not available easily.
    const typeLabel = tracks.length > 0 ? (tracks[0].type || 'Music') : 'Music';
    
    return (
        <div className="w-full h-full flex flex-col md:flex-row gap-8 md:gap-12 relative z-10 pt-4">
            {/* Left side: Photo wrapper */}
            <div className="w-full md:w-[350px] shrink-0 relative flex justify-center md:justify-start">
                <div className="relative w-full max-w-[350px] aspect-square rounded-[32px] overflow-hidden">
                    <img 
                        className="absolute inset-0 w-full h-full object-cover z-10" 
                        src={heroCoverUrl} 
                        alt="Album cover"
                    />
                    <img 
                        className="absolute inset-0 w-full h-full object-cover z-0 blur-[48px] saturate-150 brightness-150 transform scale-110" 
                        src={heroCoverUrl} 
                        alt=""
                        aria-hidden="true"
                    />
                </div>
            </div>

            {/* Right side: Main info and track list */}
            <div className="flex-1 flex flex-col min-w-0">
                <div className="mb-8">
                    <h1 className="text-[32px] md:text-[48px] font-bold text-white font-heading leading-tight mb-3">
                        Your Library
                    </h1>
                    <div className="flex items-center gap-3 text-[13px] font-mono text-[#9B9282] uppercase tracking-wider">
                        <span className="text-[#E7D7BE]">{typeLabel}</span>
                        <div className="w-1 h-1 rounded-full bg-[#3B372F]" />
                        <span>{tracks.length} tracks</span>
                        <div className="w-1 h-1 rounded-full bg-[#3B372F]" />
                        <span>{new Date().getFullYear()}</span>
                    </div>
                </div>

                <div className="flex flex-col gap-1 w-full max-w-[600px]">
                    {tracks.map((track) => (
                        <div 
                            key={track.id}
                            onClick={() => onClickDetails(track)}
                            className="group flex items-center justify-between p-3 rounded-2xl hover:bg-white/[0.04] transition-colors cursor-pointer border border-transparent hover:border-white/[0.04]"
                        >
                            <p className={`text-[15px] font-bold truncate pr-4 ${currentTrackId === track.id ? 'text-[#E7D7BE]' : 'text-[#F7EBDD]'}`}>
                                {track.title || 'Untitled Track'}
                            </p>
                            
                            <div className="flex items-center gap-3 shrink-0 text-[#9B9282] group-hover:text-[#D0C3AF] transition-colors">
                                <div 
                                    className="p-1 rounded-full hover:bg-white/[0.1] transition-colors opacity-0 group-hover:opacity-100"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onClickDetails(track);
                                    }}
                                >
                                    <MoreOptionsIcon />
                                </div>
                                <p className="text-[13px] font-mono w-12 text-right">
                                    {formatDuration(track.duration_seconds)}
                                </p>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
