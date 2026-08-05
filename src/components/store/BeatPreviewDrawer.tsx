'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ExternalLink, Music, ChevronRight, ShoppingBag, Play, Pause, X,
} from 'lucide-react';
import { LicenseSelector } from '@/components/store/LicenseSelector';
import { SpectralWaveform } from '@/components/player/SpectralWaveform';
import { AsciiCoverArt } from '@/components/player/AsciiCoverArt';
import { useAudioReactivity } from '@/hooks/useAudioReactivity';
import { bandsUrlFromPeaksUrl } from '@/lib/audio/sidecar-url';
import { Drawer } from '@/components/ui/Drawer';
import { CoverImage } from '@/components/ui/CoverImage';
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

  // Same analysis the waveform consumes (module-cached per track, so this is a
  // cache hit rather than a second decode). Sampled at the playhead so the
  // cover art and the waveform react to the same instant in the track. Gated on
  // `isCurrent`: this drawer can show a track that isn't the one playing.
  const {
    level: audioLevel, bass: audioBass,
  } = useAudioReactivity(
    track.id, track.audio_url, progress, isCurrent,
    bandsUrlFromPeaksUrl(track.peaks_url),
  );

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
          className="tap flex flex-1 items-center justify-center gap-2 rounded-xl py-3.5 text-[11px] font-semibold text-black transition-opacity hover:opacity-90 active:scale-[0.99]"
          style={{ backgroundColor: accentColor }}
        >
          <ShoppingBag size={13} />
          <span>{selectedTier.name}</span>
          <span className="tabular-nums text-black/55">
            {selectedTier.is_free ? 'Free' : `$${Number(selectedTier.price_usd).toLocaleString()}`}
          </span>
        </button>
      ) : (
        <div className="w-full rounded-xl border border-white/[0.06] bg-white/[0.03] py-3 text-center">
          <p className="text-[11px] text-white/40">Not available for purchase</p>
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
            <CoverImage src={track.cover_url} sizes="(max-width: 640px) 100vw, 480px" priority className="object-cover" />
          ) : (
            <div className="absolute inset-0" style={{ background: `radial-gradient(ellipse at 40% 50%, ${accentColor}22 0%, transparent 70%), #090907` }} />
          )}
          {/* Audio-reactive ASCII layer, only where there is artwork to react
              over. Without a cover the hero is already a plain gradient and the
              effect would read as noise on nothing. */}
          {track.cover_url && (
          <AsciiCoverArt
            src={track.cover_url}
            level={audioLevel}
            bass={audioBass}
            playing={isCurrent && isPlaying}
            className="absolute inset-0 h-full w-full mix-blend-screen opacity-80"
          />
          )}
          <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-black/20 to-[#090907]" />

          <div className="absolute top-0 inset-x-0 z-20 flex items-start justify-between p-4">
            <span />
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
            <p className="mb-1.5 text-[9px] font-mono uppercase tracking-[0.2em] text-white/45">
              {track.type}
            </p>
            <p
              className="truncate text-[20px] font-semibold leading-tight text-white"
              style={isCurrent ? { color: accentColor } : {}}
            >
              {track.title}
            </p>
            <TagChips tags={track.tags ?? []} max={3} accentGenre />
          </div>

          {/* Play button — centred, plain icon, no filled disc. Prominence
              comes from glyph size + hover wash (design-direction.md's
              "beat preview player" section), not a solid fill. */}
          <button
            onClick={onPlay}
            aria-label={isCurrent && isPlaying ? 'Pause' : 'Play'}
            className="absolute inset-0 flex items-center justify-center z-[5]"
          >
            <div
              className="flex h-14 w-14 items-center justify-center rounded-full transition-colors hover:bg-white/[0.08]"
              style={{ color: accentColor, transition: 'transform 300ms cubic-bezier(0.32,0.72,0,1), background-color 200ms' }}
            >
              {isCurrent && isPlaying
                ? <Pause size={30} />
                : <Play size={30} className="ml-1" />}
            </div>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* ── Spectral waveform + time ──
              The buyer's actual audition surface, so it gets the same
              DAW-style low/mid/high colouring as the Now Playing card rather
              than a flat progress line: you can see where the 808 and the hats
              sit before committing to a licence. Interaction is unchanged —
              seeking on the current track, starting playback on any other. */}
          <div className="px-5 pt-4 pb-3 border-b border-white/[0.05]">
            <SpectralWaveform
              trackId={track.id}
              audioUrl={track.audio_url}
              peaksUrl={track.peaks_url}
              progress={isCurrent ? progress : 0}
              isPlaying={isCurrent && isPlaying}
              canSeek={dur > 0}
              onSeek={(f) => { if (isCurrent) seekTo(f); else onPlay(); }}
              label={track.title}
              durationSeconds={dur}
            />
            {/* No time row here — SpectralWaveform renders its own
                elapsed/remaining pair. Keeping this one produced two stacked
                rows showing the same elapsed value with different right-hand
                figures (remaining vs total). */}
          </div>

          {/* ── License selector — keep the buying decision adjacent to preview ── */}
          <div className="px-5 py-4 border-b border-white/[0.05]">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-white/40">License</p>
              {selectedTier && !track.free_download_enabled && (
                <p className="text-[11px] font-semibold tabular-nums text-white">
                  {selectedTier.is_free ? 'Free' : `$${Number(selectedTier.price_usd).toLocaleString()}`}
                </p>
              )}
            </div>
            <LicenseSelector
              tiers={activeLicenses}
              selectedId={selectedLicense}
              onSelect={setSelectedLicense}
              accentColor={accentColor}
              isFreeDownload={track.free_download_enabled ?? false}
              onFreeDownload={onFreeDownload}
            />
          </div>

          {/* ── Studio specs ── */}
          <div className="px-5 py-4 border-b border-white/[0.05]">
            <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-white/40 mb-3">Studio specs</p>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: 'Tempo', value: track.bpm ? `${track.bpm} BPM` : '—' },
                { label: 'Key', value: track.key ? `${track.key}${track.scale === 'minor' ? 'm' : ''}` : '—' },
                { label: 'Duration', value: fmtDur(track.duration_seconds) },
                { label: 'Type', value: track.type?.toUpperCase() ?? '—' },
                { label: 'Stems', value: track.stems_status === 'done' ? 'Available' : 'Not included' },
                { label: 'WAV', value: (track as { has_wav?: boolean }).has_wav ? 'Uploaded' : 'On request' },
              ].map(({ label, value }) => (
                <div key={label} className="flex flex-col gap-1 rounded-xl border border-white/[0.06] px-3 py-3">
                  <span className="text-[9px] font-mono uppercase tracking-[0.18em] text-white/35">{label}</span>
                  <span className={`text-[11px] font-semibold ${label === 'Stems' && track.stems_status === 'done' ? 'text-[#6DC6A4]' : 'text-white'}`}>{value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* ── Similar beats ── */}
          {similar.length > 0 && (
            <div className="px-5 py-4 border-b border-white/[0.05]">
              <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-white/40 mb-3">Similar beats</p>
              <div className="space-y-1.5">
                {similar.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => onSelectTrack(s)}
                    className="group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-white/[0.03]"
                  >
                    <div className="relative h-8 w-8 shrink-0 overflow-hidden rounded-lg bg-[#090907]">
                      {s.cover_url
                        ? <CoverImage src={s.cover_url} sizes="32px" className="object-cover" />
                        : <div className="w-full h-full flex items-center justify-center text-white/40"><Music size={12} /></div>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-[11px] font-medium text-white transition-colors group-hover:text-white">{s.title}</p>
                      <p className="text-[9px] font-mono text-white/40 uppercase">
                        {s.bpm ? `${s.bpm} BPM` : ''}{s.key ? ` · ${s.key}` : ''}
                      </p>
                    </div>
                    <ChevronRight size={12} className="text-white/40 group-hover:text-white/60 shrink-0 transition-colors" />
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="px-5 py-4 pb-8">
            {/* Open full page — bottom of scrollable area, very visible */}
            <Link
              href={`/store/${track.id}`}
              className="mt-6 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-white/[0.08] text-[11px] font-medium text-white/60 transition-colors hover:border-white/[0.16] hover:text-white"
            >
              <ExternalLink size={12} />
              View full beat page
            </Link>
          </div>
        </div>
    </Drawer>
  );
}
