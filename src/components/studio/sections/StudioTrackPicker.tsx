'use client';

import { Loader2, Music2, Search } from 'lucide-react';
import type { Track } from '@/lib/types';
import { audioSrc } from '@/lib/audio/url';

interface Props {
  tracks: Track[];
  loading: boolean;
  activeId: string | null;
  onPick: (id: string) => void;
  search: string;
  setSearch: (v: string) => void;
}

/**
 * Studio's left-rail track picker — extracted from StudioWorkstation.
 *
 * Lists every track with audio_url + a free-text search filter. The
 * parent owns the filtering logic (so it can also be used for things
 * like keyboard navigation) — we just render what gets handed in.
 *
 * Stems availability is surfaced via a small "Stems" pill on the right
 * of each row when the track has `stems_status === 'done'`. Lets the
 * user pick a stem-ready track for layered mixing without opening the
 * track first.
 */
export function StudioTrackPicker({
  tracks, loading, activeId, onPick, search, setSearch,
}: Props) {
  const activeTrack = activeId ? tracks.find((t) => t.id === activeId) : null;

  return (
    <aside className="flex max-h-[360px] flex-col overflow-hidden rounded-2xl border border-[#1A1813] bg-[#090907] lg:h-[calc(100vh-220px)] lg:max-h-none">
      <div className="p-3 border-b border-[#1A1813]">
        <div className="relative">
          <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#6E685B]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tracks"
            className="w-full bg-[#090907] border border-[#211F1A] rounded-md py-1.5 pl-7 pr-2 text-[11px] text-[#F7EBDD] placeholder:text-[#6E685B] focus:outline-none focus:border-[#3B372F]"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={14} className="animate-spin text-[#837B6D]" />
          </div>
        ) : search.trim().length === 0 ? (
          // Empty-by-default: studio is for *focus*, not browsing. The
          // user picks ONE track and works on it. Showing the whole
          // library on every studio mount is noise. They type → results
          // appear. The currently-loaded track stays visible at the top
          // so it doesn't feel like the picker "forgot" their session.
          <div className="px-3 py-8 text-center">
            {activeTrack ? (
              <>
                <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#6E685B] mb-3">Now loaded</p>
                <button
                  onClick={() => onPick(activeTrack.id)}
                  className="mb-4 flex w-full items-center gap-3 rounded-xl border border-[#C9BCA8]/20 bg-[#342F27] px-3 py-2 text-left"
                >
                  <TrackThumb track={activeTrack} active />
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] text-white truncate">
                      {activeTrack.title}
                    </p>
                    <p className="mt-0.5 text-[9px] font-mono uppercase tracking-wider text-[#B4AA99]">
                      {activeTrack.bpm ? `${activeTrack.bpm} BPM` : '-- BPM'} · {activeTrack.key || '--'}
                    </p>
                  </div>
                </button>
                <p className="text-[10px] leading-relaxed text-[#837B6D]">Type to swap tracks.</p>
              </>
            ) : (
              <>
                <div className="w-10 h-10 mx-auto mb-3 rounded-lg bg-[#171511] border border-[#211F1A] flex items-center justify-center">
                  <Search size={14} className="text-[#6E685B]" />
                </div>
                <p className="text-[11px] text-[#B4AA99] mb-1">Search to load a track</p>
                <p className="text-[10px] leading-relaxed text-[#6E685B]">Search or send from Library.</p>
              </>
            )}
          </div>
        ) : tracks.length === 0 ? (
          <p className="text-center text-[11px] text-[#9B9282] py-12">No matches</p>
        ) : (
          tracks.map((t) => (
            <button
              key={t.id}
              onClick={() => onPick(t.id)}
              className={`flex w-full items-center gap-3 border-b border-[#17130F] px-3 py-2.5 text-left transition-colors last:border-b-0 ${
                activeId === t.id ? 'bg-[#342F27]' : 'hover:bg-[#11100D]'
              }`}
            >
              <TrackThumb track={t} active={activeId === t.id} />
              <div className="min-w-0 flex-1">
                <p className={`text-[11px] truncate ${activeId === t.id ? 'text-white' : 'text-[#F7EBDD]'}`}>
                  {t.title}
                </p>
                <p className="text-[9px] font-mono text-[#9B9282] uppercase tracking-wider">
                  {t.bpm ? `${t.bpm} BPM` : '— BPM'} · {t.key || '—'}
                </p>
              </div>
              {t.stems_status === 'done' && (
                <span className="text-[8px] font-mono uppercase tracking-wider text-[#F3E6D1] bg-[#342F27] border border-[#C9BCA8]/40 rounded px-1.5 py-0.5">
                  Stems
                </span>
              )}
            </button>
          ))
        )}
      </div>
    </aside>
  );
}

function TrackThumb({ track, active = false }: { track: Track; active?: boolean }) {
  const cover = track.cover_url ? audioSrc(track.cover_url) || track.cover_url : null;

  if (cover) {
    return (
      <img
        loading="lazy"
        src={cover}
        alt=""
        className={`h-9 w-9 shrink-0 rounded-lg border object-cover ${
          active ? 'border-[#C9BCA8]/40' : 'border-[#211F1A]'
        }`}
      />
    );
  }

  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[#211F1A] bg-[#1A1813]">
      <Music2 size={12} className={active ? 'text-[#F3E6D1]' : 'text-[#9B9282]'} />
    </div>
  );
}
