'use client';

import { useMemo } from 'react';
import { Music, Play, Heart, Download, ShoppingBag } from 'lucide-react';
import { PlayGlyph, PauseGlyph } from '@/components/player/TransportIcons';
import { MiniWaveform } from '@/components/player/MiniWaveform';
import { AudioGradient } from '@/components/ui/AudioGradient';
import { DitherShader, type DitherColorMode, type DitherMode, type DitherTexture } from '@/components/ui/dither-shader';
import { getSimilarTracks } from './helpers';
import { TagChips } from './TagChips';
import type { StoreTrack } from './types';

interface Props {
  track: StoreTrack;
  allTracks: StoreTrack[];
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
  analyserNode?: AnalyserNode | null;
  /** Producer's chosen dither style — passed from store page, not editable by viewers. */
  ditherMode?: DitherMode;
  ditherColorMode?: DitherColorMode;
  ditherTexture?: DitherTexture;
  isWishlisted?: boolean;
  onToggleWishlist?: () => void;
}

export function BeatCard({
  track, allTracks, priceLease, priceExclusive, isCurrent, isPlaying, isPreview,
  onPlay, onPreview, onAddLease, onAddExclusive, onFreeDownload, accentColor,
  analyserNode, ditherMode = 'bayer', ditherColorMode = 'original', ditherTexture = 'paper',
  isWishlisted, onToggleWishlist,
}: Props) {
  // Similar tracks render as small chips at the bottom — bounded so the
  // useMemo cost is trivial.
  const similar = useMemo(() => getSimilarTracks(track, allTracks, 4), [track, allTracks]);

  // Helper to wire any inner control without bubbling up to the card-level
  // onPreview handler.
  const stop = (fn: () => void) => (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    fn();
  };

  // Whole-card open-preview surface. Hits anywhere except the cover, action
  // buttons, and wishlist toggle.
  const handleCardClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-card-action]')) return;
    onPreview();
  };
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onPreview();
    }
  };

  // Glass-tinted shell, accent border on active/preview, luxury hover lift.
  const shellStyle: React.CSSProperties = isPreview
    ? { borderColor: `${accentColor}99`, boxShadow: `0 18px 50px ${accentColor}1a, 0 0 0 1px ${accentColor}26` }
    : isPlaying
      ? { borderColor: `${accentColor}66`, boxShadow: `0 0 0 1px ${accentColor}33` }
      : isCurrent
        ? { borderColor: `${accentColor}4D` }
        : {};

  return (
    <div
      id={`beat-${track.id}`}
      role="button"
      tabIndex={0}
      onClick={handleCardClick}
      onKeyDown={handleKeyDown}
      className={`group relative rounded-2xl border bg-[#14110d]/85 backdrop-blur-xl overflow-hidden transition-all flex flex-col cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-[#D4BFA0]/40
        ${isPreview
          ? ''
          : 'border-white/[0.06] hover:border-white/[0.14] hover:-translate-y-0.5 hover:shadow-[0_18px_44px_rgba(0,0,0,0.55)]'}`}
      style={shellStyle}
    >
      {/* Cover area — hover overlay surfaces a big play button. Clicking
          the cover plays (and does not bubble to the card onPreview). */}
      <div
        data-card-action
        onClick={stop(onPlay)}
        className="relative w-full aspect-square cursor-pointer"
      >
        {track.cover_url ? (
          <div className="relative h-full w-full overflow-hidden bg-[#0a0907]">
            <DitherShader
              src={track.cover_url}
              alt={track.title}
              mode={ditherMode}
              colorMode={ditherColorMode}
              texture={ditherTexture}
              reactivity={1.25}
              detail={1.55}
              analyserNode={isCurrent ? analyserNode ?? null : null}
              className="block h-full w-full transition-transform duration-500 group-hover:scale-[1.04]"
            />
            <AudioGradient
              analyserNode={isCurrent ? analyserNode ?? null : null}
              accentColor={accentColor}
              className="pointer-events-none"
            />
          </div>
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-[#2A2418] to-[#0a0907] flex items-center justify-center text-[#a08a6a]">
            <Music size={36} />
          </div>
        )}

        {/* Always a subtle bottom-vignette so the inset chips stay readable */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-transparent" />

        {/* Hover-only big play overlay */}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center text-black shadow-[0_8px_24px_rgba(0,0,0,0.55)]"
            style={{ backgroundColor: accentColor }}
          >
            {isCurrent && isPlaying
              ? <PauseGlyph size={20} />
              : <PlayGlyph size={20} className="ml-1" />}
          </div>
        </div>

        {/* Exclusive sold — corner ribbon, takes priority over the Free/BPM chip */}
        {track.exclusive_sold && (
          <div className="absolute top-2.5 left-2.5 z-30 px-2 py-0.5 rounded-md text-[9px] font-mono font-bold uppercase tracking-wider bg-black/75 text-[#D4BFA0] border border-[#D4BFA0]/40 backdrop-blur-sm pointer-events-none">
            Exclusive Sold
          </div>
        )}

        {/* Top-left chip — BPM or Free badge (hidden once sold) */}
        {track.exclusive_sold ? null : track.free_download_enabled ? (
          <div className="absolute top-2.5 left-2.5 z-20 px-2 py-0.5 rounded-md text-[9px] font-mono font-bold uppercase tracking-wider bg-[#6DC6A4] text-black">
            Free
          </div>
        ) : track.bpm ? (
          <div className="absolute top-2.5 left-2.5 z-20 text-[9px] font-mono bg-black/65 text-white px-2 py-0.5 rounded-md border border-white/[0.10] backdrop-blur-sm pointer-events-none">
            {track.bpm} BPM
          </div>
        ) : null}

        {/* Top-right chip — Key */}
        {track.key && (
          <div
            className="absolute top-2.5 right-2.5 z-20 text-[9px] font-mono font-semibold px-2 py-0.5 rounded-md backdrop-blur-sm pointer-events-none"
            style={{ backgroundColor: `${accentColor}D9`, color: '#0a0907' }}
          >
            {track.key}{track.scale === 'minor' ? 'm' : ''}
          </div>
        )}

        {/* Wishlist heart — top-right corner area (offset below the key chip
            when present) */}
        {onToggleWishlist && (
          <button
            data-card-action
            type="button"
            onClick={stop(onToggleWishlist)}
            aria-pressed={!!isWishlisted}
            title={isWishlisted ? 'Remove from favorites' : 'Add to favorites'}
            className={`absolute z-30 w-8 h-8 rounded-full flex items-center justify-center backdrop-blur-sm transition-colors ${track.key ? 'top-10 right-2.5' : 'top-2.5 right-2.5'} ${
              isWishlisted
                ? 'bg-[#c8a84b]/20 border border-[#c8a84b]/50 text-[#c8a84b]'
                : 'bg-black/40 border border-white/[0.10] text-white/80 hover:text-white hover:bg-black/60'
            }`}
          >
            <Heart size={13} fill={isWishlisted ? 'currentColor' : 'none'} />
          </button>
        )}

        {/* Currently-playing pulse dot */}
        {isCurrent && (
          <div className="absolute bottom-2.5 left-2.5 z-20 flex items-center gap-1.5 pointer-events-none">
            <span className="w-1.5 h-1.5 rounded-full bg-[#6DC6A4] shadow-[0_0_6px_#6DC6A4] animate-pulse" />
            <span className="text-[9px] font-mono uppercase tracking-wider text-white/85">Playing</span>
          </div>
        )}
      </div>

      {/* Body */}
      <div className="px-4 pt-4 pb-3 flex flex-col flex-1">
        {/* Dither style is set by the producer in their store editor.
            Viewers see the chosen aesthetic — no selector shown here. */}

        <div>
          <p
            className="text-[15px] font-medium tracking-tight text-[#E8DCC8] truncate transition-colors group-hover:text-white"
            style={isPreview || isCurrent ? { color: accentColor } : {}}
          >
            {track.title}
          </p>
          <p className="mt-0.5 text-[11px] text-white/45 truncate uppercase tracking-[0.15em] font-mono">
            {track.type}
          </p>
        </div>

        <TagChips tags={track.tags ?? []} max={3} accentGenre />

        {/* Compact, more-accurate waveform */}
        <div className="mt-3 px-0.5">
          <MiniWaveform
            trackId={track.id}
            peaksUrl={track.peaks_url}
            height={40}
            isActive={isCurrent}
            onPlay={!isCurrent ? onPlay : undefined}
          />
        </div>

        {track.description && (
          <p className="text-[11px] text-[#a08a6a] mt-2 line-clamp-2 leading-relaxed">{track.description}</p>
        )}

        {/* Buy strip — explicit, luxurious. Lease + Exclusive side-by-side
            with their own labels and visible separator. */}
        <div className="mt-auto pt-4">
          {track.exclusive_sold ? (
            <div
              data-card-action
              className="flex items-center justify-center gap-2 w-full px-3 py-3 rounded-xl bg-white/[0.03] border border-[#D4BFA0]/25 text-[#D4BFA0] text-[12px] font-bold uppercase tracking-[0.18em] cursor-default"
              title="This beat's exclusive rights have been sold"
            >
              Exclusive Sold
            </div>
          ) : track.free_download_enabled ? (
            <button
              data-card-action
              onClick={stop(onFreeDownload)}
              className="flex items-center justify-center gap-2 w-full px-3 py-3 rounded-xl bg-[#6DC6A4]/10 border border-[#6DC6A4]/30 hover:bg-[#6DC6A4]/20 text-[#6DC6A4] text-[12px] font-bold uppercase tracking-[0.18em] transition-colors"
            >
              <Download size={13} />
              Free Download
            </button>
          ) : (
            <div className="flex items-stretch gap-2">
              <button
                data-card-action
                onClick={stop(onAddLease)}
                disabled={priceLease == null}
                className="flex-1 flex flex-col items-center justify-center px-3 py-2.5 rounded-xl bg-white/[0.05] border border-white/[0.10] hover:bg-white/[0.10] hover:border-white/[0.18] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <span className="text-[8px] font-mono uppercase tracking-[0.22em] text-white/40">Lease</span>
                <span className="text-[16px] font-bold text-[#E8DCC8] tabular-nums leading-tight mt-0.5">
                  {priceLease != null ? `$${priceLease.toLocaleString()}` : '—'}
                </span>
              </button>
              <button
                data-card-action
                onClick={stop(onAddExclusive)}
                disabled={priceExclusive == null}
                className="flex-1 flex flex-col items-center justify-center px-3 py-2.5 rounded-xl transition-opacity disabled:opacity-30 disabled:cursor-not-allowed hover:opacity-95"
                style={{ backgroundColor: accentColor }}
              >
                <span className="text-[8px] font-mono uppercase tracking-[0.22em] text-black/55">Exclusive</span>
                <span className="text-[16px] font-bold text-black tabular-nums leading-tight mt-0.5">
                  {priceExclusive != null ? `$${priceExclusive.toLocaleString()}` : '—'}
                </span>
              </button>
              <button
                data-card-action
                onClick={stop(onPreview)}
                title="Open beat"
                className="w-11 shrink-0 flex items-center justify-center rounded-xl bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.08] text-white/55 hover:text-white transition-colors"
              >
                <ShoppingBag size={14} />
              </button>
            </div>
          )}
        </div>

        {/* Similar beats — small, low-noise */}
        {similar.length > 0 && (
          <div className="mt-4 pt-3 border-t border-white/[0.05]">
            <p className="text-[9px] font-mono uppercase tracking-[0.25em] text-white/35 mb-2">Similar</p>
            <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
              {similar.map((s) => (
                <button
                  data-card-action
                  key={s.id}
                  onClick={stop(() => {
                    document.getElementById(`beat-${s.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  })}
                  className="shrink-0 flex items-center gap-1.5 px-2 py-1 rounded-full bg-white/[0.04] border border-white/[0.06] hover:border-white/[0.14] transition-colors"
                >
                  <Play size={8} className="text-white/45 shrink-0" />
                  <p className="text-[10px] text-white/75 font-medium whitespace-nowrap max-w-[80px] truncate">{s.title}</p>
                  {s.bpm && <span className="text-[9px] font-mono text-white/40 shrink-0">{s.bpm}</span>}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
