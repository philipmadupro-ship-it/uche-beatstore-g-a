'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ExternalLink, Music, ChevronRight, ShoppingBag, Play, Pause, X,
} from 'lucide-react';
import { LicenseSelector } from '@/components/store/LicenseSelector';
import { ProgressBar } from '@/components/player/ProgressBar';
import { Drawer } from '@/components/ui/Drawer';
import { usePlayer } from '@/hooks/usePlayer';
import { fmtDur, getSimilarTracks } from './helpers';
import { TagChips } from './TagChips';
import type { StoreTrack, LicenseTier } from './types';

interface Props {
  track: StoreTrack;
  allTracks: StoreTrack[];
  licenses: LicenseTier[];
  priceLease: number | null;
  priceExclusive: number | null;
  isCurrent: boolean;
  isPlaying: boolean;
  progress: number;
  onPlay: () => void;
  onAddLease: () => void;
  onAddExclusive: () => void;
  onAddLicense: (license: LicenseTier) => void;
  onFreeDownload: () => void;
  onClose: () => void;
  onSelectTrack: (t: StoreTrack) => void;
  accentColor: string;
}

export function BeatPreviewDrawer({
  track, allTracks, licenses, priceLease, priceExclusive, isCurrent, isPlaying, progress,
  onPlay, onAddLease, onAddExclusive, onAddLicense, onFreeDownload, onClose, onSelectTrack, accentColor,
}: Props) {
  const seekTo = usePlayer((s) => s.seekTo);
  const defaultLicenseId = priceLease != null ? 'lease' : priceExclusive != null ? 'exclusive' : licenses[0]?.id ?? 'lease';
  const [selectedLicense, setSelectedLicense] = useState<string>(defaultLicenseId);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setSelectedLicense(priceLease != null ? 'lease' : priceExclusive != null ? 'exclusive' : licenses[0]?.id ?? 'lease');
    });
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track.id]);

  const similar = useMemo(() => getSimilarTracks(track, allTracks, 5), [track, allTracks]);

  const dur = track.duration_seconds ?? 0;
  const fmt = (s: number) => {
    if (!isFinite(s) || s < 0) return '0:00';
    return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
  };
  const currentSec = isCurrent ? progress * dur : 0;

  const activeLicenses: LicenseTier[] = licenses.length > 0
    ? [...licenses].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    : [
      priceLease != null
        ? { id: 'lease', name: 'Lease', price_usd: priceLease, file_types: ['MP3', 'WAV'], is_exclusive: false }
        : null,
      priceExclusive != null
        ? { id: 'exclusive', name: 'Exclusive', price_usd: priceExclusive, file_types: ['MP3', 'WAV', 'STEMS'], is_exclusive: true }
        : null,
    ].filter(Boolean) as LicenseTier[];
  const selectedTier = activeLicenses.find((license) => license.id === selectedLicense) ?? activeLicenses[0] ?? null;

  const handleAddSelectedLicense = () => {
    if (!selectedTier) return;
    if (selectedTier.id === 'lease') {
      onAddLease();
      return;
    }
    if (selectedTier.id === 'exclusive') {
      onAddExclusive();
      return;
    }
    onAddLicense(selectedTier);
  };

  const buyBar = !track.free_download_enabled ? (
    <div className="flex items-center gap-2">
      {selectedTier ? (
        <button
          onClick={handleAddSelectedLicense}
          className="tap flex flex-1 flex-col items-center justify-center gap-0.5 rounded-xl py-3 text-[11px] font-bold uppercase tracking-widest text-black transition-all hover:opacity-90 active:scale-[0.99]"
          style={{ background: `linear-gradient(to right, ${accentColor}, #c5a880)` }}
        >
          <span className="font-mono text-[9px] tracking-wider text-black/60">
            {selectedTier.name}
          </span>
          <span className="flex items-center gap-1">
            <ShoppingBag size={12} />
            {selectedTier.is_free ? 'Free' : `$${Number(selectedTier.price_usd).toLocaleString()}`}
          </span>
        </button>
      ) : (
        <div className="w-full rounded-xl border border-white/[0.06] bg-white/[0.03] py-3 text-center">
          <p className="text-[11px] text-[#9B9282]">Not available for purchase</p>
        </div>
      )}
    </div>
  ) : undefined;

  return (
    <Drawer
      open
      onClose={onClose}
      title="Preview"
      description={track.title}
      icon={<Music size={16} aria-hidden="true" />}
      side="right"
      size="lg"
      className="sm:!w-[480px] bg-[#090907]"
      contentClassName="p-0"
      footer={buyBar}
      showHeader={false}
    >
        {/* Full-bleed cover hero */}
        <div className="relative h-[260px] shrink-0 overflow-hidden bg-[#090907]">
          {track.cover_url ? (
            <img src={track.cover_url} alt="" className="absolute inset-0 w-full h-full object-cover" />
          ) : (
            <div className="absolute inset-0" style={{ background: `radial-gradient(ellipse at 40% 50%, ${accentColor}22 0%, transparent 70%), #090907` }} />
          )}
          <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-black/20 to-[#090907]" />

          <div className="absolute top-0 inset-x-0 z-20 flex items-start justify-between p-4">
            <span className="rounded-full border border-white/[0.08] bg-black/25 px-3 py-1.5 font-mono text-[9px] uppercase tracking-[0.25em] text-white/55 backdrop-blur-md">
              Preview
            </span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close beat preview"
              className="tap grid size-11 place-items-center rounded-full border border-white/[0.08] bg-black/25 text-white/65 backdrop-blur-md transition-[transform,background-color,color,border-color] duration-[var(--dur-fast)] ease-[var(--ease-spring)] hover:border-white/20 hover:bg-white/[0.10] hover:text-white active:scale-[0.98]"
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>

          {/* Title + type overlay at bottom */}
          <div className="absolute bottom-0 inset-x-0 p-5 z-10">
            <p className="text-[11px] font-mono uppercase tracking-[0.2em] mb-1.5" style={{ color: accentColor }}>
              {track.type}
            </p>
            <div className="flex items-start justify-between gap-3">
              <p
                className="text-[22px] font-bold text-white leading-tight truncate flex-1"
                style={isCurrent ? { color: accentColor } : {}}
              >
                {track.title}
              </p>
              {/* Open full page CTA — prominent, easy to tap */}
              <Link
                href={`/store/${track.id}`}
                className="tap flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-full px-3 py-2 text-[10px] font-mono uppercase tracking-wider transition-all hover:opacity-90"
                style={{ backgroundColor: `${accentColor}22`, color: accentColor, border: `1px solid ${accentColor}40` }}
                title="View full page"
              >
                <ExternalLink size={11} />
                <span className="hidden sm:inline">Full page</span>
              </Link>
            </div>
            <TagChips tags={track.tags ?? []} max={3} accentGenre />
          </div>

          {/* Play button — centred circle, always visible */}
          <button
            onClick={onPlay}
            aria-label={isCurrent && isPlaying ? 'Pause' : 'Play'}
            className="absolute inset-0 flex items-center justify-center z-[5]"
          >
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center shadow-[0_8px_32px_rgba(0,0,0,0.6)]"
              style={{
                backgroundColor: accentColor,
                transition: 'transform 300ms cubic-bezier(0.32,0.72,0,1), opacity 200ms',
              }}
            >
              {isCurrent && isPlaying
                ? <Pause size={22} fill="black" className="text-black" />
                : <Play size={22} fill="black" className="text-black ml-1" />}
            </div>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* ── Simple progress line + time ── */}
          <div className="px-5 pt-4 pb-3 border-b border-white/[0.05]">
            <ProgressBar
              progress={isCurrent ? progress : 0}
              onSeek={(f) => { if (isCurrent) seekTo(f); else onPlay(); }}
              accent={accentColor}
            />
            <div className="flex justify-between mt-1.5">
              <span className="text-[9px] font-mono text-[#9B9282] tabular-nums">
                {isCurrent ? fmt(currentSec) : '0:00'}
              </span>
              <span className="text-[9px] font-mono text-[#9B9282] tabular-nums">
                {dur ? fmt(dur) : '—'}
              </span>
            </div>
          </div>

          {/* ── Studio specs ── */}
          <div className="px-5 py-4 border-b border-white/[0.05]">
            <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#6E685B] mb-3">Studio specs</p>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: 'Tempo', value: track.bpm ? `${track.bpm} BPM` : '—' },
                { label: 'Key', value: track.key ? `${track.key}${track.scale === 'minor' ? 'm' : ''}` : '—' },
                { label: 'Duration', value: fmtDur(track.duration_seconds) },
                { label: 'Type', value: track.type?.toUpperCase() ?? '—' },
                { label: 'Stems', value: track.stems_status === 'done' ? 'Available' : 'Not included' },
                { label: 'WAV', value: (track as { has_wav?: boolean }).has_wav ? 'Uploaded' : 'On request' },
              ].map(({ label, value }) => (
                <div key={label} className="flex flex-col gap-0.5 rounded-xl px-3 py-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <span className="text-[8px] font-mono uppercase tracking-[0.18em] text-white/25">{label}</span>
                  <span className={`text-[12px] font-semibold ${label === 'Stems' && track.stems_status === 'done' ? 'text-[#6DC6A4]' : 'text-[#F7EBDD]'}`}>{value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* ── Similar beats ── */}
          {similar.length > 0 && (
            <div className="px-5 py-4 border-b border-white/[0.05]">
              <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#6E685B] mb-3">Similar beats</p>
              <div className="space-y-1.5">
                {similar.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => onSelectTrack(s)}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[#1A1813] border border-transparent hover:border-white/[0.05] transition-all text-left group"
                  >
                    <div className="w-8 h-8 rounded-md overflow-hidden bg-[#090907] shrink-0">
                      {s.cover_url
                        ? <img src={s.cover_url} alt="" className="w-full h-full object-cover" />
                        : <div className="w-full h-full flex items-center justify-center text-[#6E685B]"><Music size={12} /></div>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-medium text-[#F7EBDD] truncate group-hover:text-[#E7D7BE] transition-colors">{s.title}</p>
                      <p className="text-[9px] font-mono text-[#9B9282] uppercase">
                        {s.bpm ? `${s.bpm} BPM` : ''}{s.key ? ` · ${s.key}` : ''}
                      </p>
                    </div>
                    <ChevronRight size={12} className="text-[#6E685B] group-hover:text-[#B4AA99] shrink-0 transition-colors" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── License selector ── */}
          <div className="px-5 py-4 pb-8">
            <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#6E685B] mb-3">License</p>
            <LicenseSelector
              tiers={activeLicenses}
              selectedId={selectedLicense}
              onSelect={setSelectedLicense}
              accentColor={accentColor}
              isFreeDownload={track.free_download_enabled ?? false}
              onFreeDownload={onFreeDownload}
            />

            {/* Open full page — bottom of scrollable area, very visible */}
            <Link
              href={`/store/${track.id}`}
              className="mt-6 flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-[11px] font-mono uppercase tracking-wider transition-colors border border-[#3B372F] text-[#B4AA99] hover:text-[#F7EBDD] hover:border-[#6E685B]"
            >
              <ExternalLink size={12} />
              View full beat page
            </Link>
          </div>
        </div>
    </Drawer>
  );
}
