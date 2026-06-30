'use client';

import { Music, ExternalLink } from 'lucide-react';
import { PlayGlyph, PauseGlyph } from '@/components/player/TransportIcons';
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
      className={`overflow-hidden rounded-xl border transition-all duration-200 ${isPreview
          ? 'border-[#E7D7BE]/40 bg-[#1A1813]'
          : isCurrent
            ? 'border-[#E7D7BE]/20 bg-[#1A1813]'
            : 'border-[#211F1A] bg-[#171511] hover:border-[#2B2821] hover:bg-[#1A1813]'
        }`}
      style={
        isPreview
          ? { borderColor: `${accentColor}66`, boxShadow: `inset 3px 0 0 ${accentColor}` }
          : isCurrent
            ? { borderColor: `${accentColor}33`, boxShadow: `inset 3px 0 0 ${accentColor}` }
            : {}
      }
    >
      <div className="flex items-center gap-3 px-3 py-2.5">
        <button
          onClick={onPlay}
          className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors shrink-0 ${isCurrent ? 'text-black' : 'bg-white/[0.06] text-[#D0C3AF] hover:bg-white/[0.12] hover:text-white'}`}
          style={isCurrent ? { backgroundColor: accentColor } : {}}
        >
          {isCurrent && isPlaying
            ? <PauseGlyph size={12} />
            : <PlayGlyph size={12} className="ml-0.5" />}
        </button>

        <button
          onClick={onPreview}
          className="w-10 h-10 rounded-lg overflow-hidden shrink-0 bg-[#090907] cursor-pointer relative group"
        >
          {track.cover_url
            ? <img src={track.cover_url} alt="" className="w-full h-full object-cover" />
            : <div className="w-full h-full flex items-center justify-center text-[#6E685B]"><Music size={14} /></div>}
          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
            <ExternalLink size={10} className="text-white" />
          </div>
        </button>

        <div className="flex-1 min-w-0">
          <button onClick={onPreview} className="text-left w-full" title={track.title}>
            <p className={`text-[13px] font-medium truncate transition-colors ${isPreview || isCurrent ? '' : 'text-[#F7EBDD] hover:text-[#E7D7BE]'}`}
              style={isPreview || isCurrent ? { color: accentColor } : {}}
            >
              {track.title}
            </p>
          </button>
          <p className="text-[10px] font-mono text-[#9B9282] uppercase tracking-wider truncate">
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
                      ? 'bg-[#E7D7BE]/10 text-[#E7D7BE] border-[#E7D7BE]/20'
                      : 'bg-[#2B2821] text-[#B4AA99] border-[#2B2821]'}`}>
                    {t.tag}
                  </span>
                ))}
            </div>
          )}
        </div>

        {track.bpm && (
          <div className="hidden md:block text-right shrink-0">
            <p className="text-[8px] font-mono uppercase text-[#9B9282]">BPM</p>
            <p className="text-[11px] font-mono text-white tabular-nums">{track.bpm}</p>
          </div>
        )}

        {track.key && (
          <div className="hidden md:block text-right shrink-0">
            <p className="text-[8px] font-mono uppercase text-[#9B9282]">Key</p>
            <p className="text-[11px] font-mono font-semibold tabular-nums" style={{ color: accentColor }}>
              {track.key}{track.scale === 'minor' ? 'm' : ''}
            </p>
          </div>
        )}

        {track.has_wav && (
          <div className="hidden md:flex shrink-0 items-center">
            <span className="rounded-sm bg-white/[0.06] border border-white/10 px-1.5 py-0.5 text-[8px] font-mono uppercase tracking-[0.15em] text-[#B4AA99]">
              WAV
            </span>
          </div>
        )}

        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
          {track.exclusive_sold ? (
            <span className="px-2 py-1.5 sm:px-3 sm:py-2 rounded-md bg-white/[0.03] border border-[#E7D7BE]/25 text-[#E7D7BE] text-[9px] sm:text-[10px] font-bold uppercase tracking-wider">
              <span className="sm:hidden">Sold</span>
              <span className="hidden sm:inline">Exclusive Sold</span>
            </span>
          ) : track.free_download_enabled ? (
            <button
              onClick={onFreeDownload}
              className="px-2 py-1.5 sm:px-3 sm:py-2 rounded-md bg-[#6DC6A4]/10 border border-[#6DC6A4]/20 text-[#6DC6A4] text-[9px] sm:text-[10px] font-bold uppercase tracking-wider hover:bg-[#6DC6A4]/20 transition-colors"
            >
              <span className="sm:hidden">Free</span>
              <span className="hidden sm:inline">Free Download</span>
            </button>
          ) : (
            <>
              {/* Mobile: one compact price chip → opens the preview drawer, where
                  the full lease/exclusive license picker lives. Keeps the title
                  readable on narrow screens. */}
              <button
                onClick={onPreview}
                className="sm:hidden px-2.5 py-1.5 rounded-md bg-white/[0.06] border border-white/[0.10] text-[#F7EBDD] text-[11px] font-bold leading-none whitespace-nowrap"
              >
                {priceLease != null ? `$${priceLease}` : priceExclusive != null ? `$${priceExclusive}` : 'Buy'}
              </button>
              {/* Desktop: full dual-price buttons. */}
              <button
                onClick={onAddLease}
                disabled={priceLease == null}
                className="hidden sm:flex px-3 py-2 rounded-md bg-white/[0.06] border border-white/[0.10] text-[#F7EBDD] text-[11px] font-bold hover:bg-white/[0.12] hover:border-white/[0.18] transition-colors disabled:opacity-30 flex-col items-center leading-none"
              >
                <span>{priceLease != null ? `$${priceLease}` : '—'}</span>
                <span className="text-[7px] font-mono text-[#B4AA99] mt-0.5 uppercase tracking-wider">Lease</span>
              </button>
              <button
                onClick={onAddExclusive}
                disabled={priceExclusive == null}
                className="hidden sm:flex px-3 py-2 rounded-md text-black text-[11px] font-bold hover:opacity-90 transition-opacity disabled:opacity-30 flex-col items-center leading-none"
                style={{ backgroundColor: accentColor }}
              >
                <span>{priceExclusive != null ? `$${priceExclusive}` : '—'}</span>
                <span className="text-[7px] font-mono text-black/60 mt-0.5 uppercase tracking-wider">Excl.</span>
              </button>
            </>
          )}
          <button
            onClick={onPreview}
            className="hidden sm:flex w-8 h-8 rounded-md items-center justify-center text-[#837B6D] hover:text-[#F7EBDD] bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.04] transition-all"
            title="Preview"
          >
            <ExternalLink size={11} />
          </button>
        </div>
      </div>
    </div>
  );
}
