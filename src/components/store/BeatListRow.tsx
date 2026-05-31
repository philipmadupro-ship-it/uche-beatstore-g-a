'use client';

import { Music, Play, Pause, ExternalLink } from 'lucide-react';
import { fmtDur } from './helpers';
import type { StoreTrack } from './types';

interface Props {
  track: StoreTrack;
  index: number;
  priceLease: number | null;
  priceExclusive: number | null;
  isCurrent: boolean;
  isPlaying: boolean;
  isPreview: boolean;
  onPlay: () => void;
  onPreview: () => void;
  onAddLease: () => void;
  onAddExclusive: () => void;
  onFreeDownload: () => void;
  accentColor: string;
}

export function BeatListRow({
  track, index, priceLease, priceExclusive, isCurrent, isPlaying, isPreview,
  onPlay, onPreview, onAddLease, onAddExclusive, onFreeDownload, accentColor,
}: Props) {
  void index;

  return (
    <div
      id={`beat-${track.id}`}
      className={`rounded-xl border transition-all ${isPreview
          ? 'border-[#D4BFA0]/40 bg-[#16130e]'
          : isCurrent
            ? 'border-[#D4BFA0]/20 bg-[#16130e]'
            : 'border-[#1a160f] bg-[#14110d] hover:border-[#1f1a13]'
        }`}
      style={isPreview ? { borderColor: `${accentColor}66` } : isCurrent ? { borderColor: `${accentColor}33` } : {}}
    >
      <div className="flex items-center gap-3 px-3 py-2.5">
        <button
          onClick={onPlay}
          className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors shrink-0 ${isCurrent ? 'text-black' : 'bg-white/[0.06] text-[#a08a6a] hover:bg-white/[0.12] hover:text-white'}`}
          style={isCurrent ? { backgroundColor: accentColor } : {}}
        >
          {isCurrent && isPlaying
            ? <Pause size={11} fill="currentColor" />
            : <Play size={11} fill="currentColor" className="ml-0.5" />}
        </button>

        <button
          onClick={onPreview}
          className="w-10 h-10 rounded-lg overflow-hidden shrink-0 bg-[#0a0907] cursor-pointer relative group"
        >
          {track.cover_url
            ? <img src={track.cover_url} alt="" className="w-full h-full object-cover" />
            : <div className="w-full h-full flex items-center justify-center text-[#3a3328]"><Music size={14} /></div>}
          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
            <ExternalLink size={10} className="text-white" />
          </div>
        </button>

        <div className="flex-1 min-w-0">
          <button onClick={onPreview} className="text-left w-full" title={track.title}>
            <p className={`text-[13px] font-medium truncate transition-colors ${isPreview || isCurrent ? '' : 'text-[#E8DCC8] hover:text-[#D4BFA0]'}`}
              style={isPreview || isCurrent ? { color: accentColor } : {}}
            >
              {track.title}
            </p>
          </button>
          <p className="text-[10px] font-mono text-[#5a5142] uppercase tracking-wider truncate">
            {track.type}
            {track.duration_seconds ? ` · ${fmtDur(track.duration_seconds)}` : ''}
          </p>
          {(track.tags ?? []).length > 0 && (
            <div className="hidden sm:flex items-center gap-1 mt-1 h-[18px] overflow-hidden">
              {(track.tags ?? [])
                .filter((t) => t.category === 'genre' || t.category === 'mood')
                .slice(0, 3)
                .map((t) => (
                  <span key={t.tag} className={`px-1.5 py-0.5 rounded text-[8px] font-mono uppercase tracking-wider border shrink-0 ${t.category === 'genre'
                      ? 'bg-[#D4BFA0]/10 text-[#D4BFA0] border-[#D4BFA0]/20'
                      : 'bg-[#1f1a13] text-[#6a5d4a] border-[#1f1a13]'}`}>
                    {t.tag}
                  </span>
                ))}
            </div>
          )}
        </div>

        {track.bpm && (
          <div className="hidden md:block text-right shrink-0">
            <p className="text-[8px] font-mono uppercase text-[#5a5142]">BPM</p>
            <p className="text-[11px] font-mono text-white tabular-nums">{track.bpm}</p>
          </div>
        )}

        {track.key && (
          <div className="hidden md:block text-right shrink-0">
            <p className="text-[8px] font-mono uppercase text-[#5a5142]">Key</p>
            <p className="text-[11px] font-mono font-semibold tabular-nums" style={{ color: accentColor }}>
              {track.key}{track.scale === 'minor' ? 'm' : ''}
            </p>
          </div>
        )}

        <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
          {track.exclusive_sold ? (
            <span className="px-3 py-2 rounded-md bg-white/[0.03] border border-[#D4BFA0]/25 text-[#D4BFA0] text-[10px] font-bold uppercase tracking-wider">
              Exclusive Sold
            </span>
          ) : track.free_download_enabled ? (
            <button
              onClick={onFreeDownload}
              className="px-3 py-2 rounded-md bg-[#6DC6A4]/10 border border-[#6DC6A4]/20 text-[#6DC6A4] text-[10px] font-bold uppercase tracking-wider hover:bg-[#6DC6A4]/20 transition-colors"
            >
              Free Download
            </button>
          ) : (
            <>
              <button
                onClick={onAddLease}
                disabled={priceLease == null}
                className="px-3 py-2 rounded-md bg-white/[0.06] border border-white/[0.10] text-[#E8DCC8] text-[11px] font-bold hover:bg-white/[0.12] hover:border-white/[0.18] transition-colors disabled:opacity-30 flex flex-col items-center leading-none"
              >
                <span>{priceLease != null ? `$${priceLease}` : '—'}</span>
                <span className="text-[7px] font-mono text-[#6a5d4a] mt-0.5 uppercase tracking-wider">Lease</span>
              </button>
              <button
                onClick={onAddExclusive}
                disabled={priceExclusive == null}
                className="px-3 py-2 rounded-md text-black text-[11px] font-bold hover:opacity-90 transition-opacity disabled:opacity-30 flex flex-col items-center leading-none"
                style={{ backgroundColor: accentColor }}
              >
                <span>{priceExclusive != null ? `$${priceExclusive}` : '—'}</span>
                <span className="text-[7px] font-mono text-black/60 mt-0.5 uppercase tracking-wider">Excl.</span>
              </button>
            </>
          )}
          <button
            onClick={onPreview}
            className="w-8 h-8 rounded-md flex items-center justify-center text-[#4a4338] hover:text-[#E8DCC8] bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.04] transition-all"
            title="Preview"
          >
            <ExternalLink size={11} />
          </button>
        </div>
      </div>
    </div>
  );
}
