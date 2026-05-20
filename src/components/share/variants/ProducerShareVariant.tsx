'use client';

import { useState } from 'react';
import { Music, Play, Pause, SkipBack, SkipForward, Copy, Check, ChevronDown, ChevronUp } from 'lucide-react';
import { ShareWaveformVinyl } from '@/components/share/ShareWaveformVinyl';

/**
 * Producer / loop-pack collab variant.
 *
 * Audience: another producer, beatmaker, or engineer receiving a loop pack or
 * reference bundle. Priorities:
 *   1. Hear the track immediately (vinyl + waveform)
 *   2. Get the exact BPM + key for DAW alignment
 *   3. See compatible keys (circle of fifths) for layering
 *   4. Flip through all tracks in the pack
 */

const CIRCLE_OF_FIFTHS_MAJOR = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#', 'G#', 'D#', 'A#', 'F'];
const RELATIVE_MINORS: Record<string, string> = {
  C: 'Am', G: 'Em', D: 'Bm', A: 'F#m', E: 'C#m', B: 'G#m',
  'F#': 'D#m', 'C#': 'A#m', 'G#': 'Fm', 'D#': 'Cm', 'A#': 'Gm', F: 'Dm',
};

function getCompatibleKeys(key: string | null | undefined, scale: string | null | undefined): string[] {
  if (!key) return [];
  // Normalize to major root for circle lookup
  const majorKey = scale === 'minor'
    ? Object.entries(RELATIVE_MINORS).find(([, v]) => v === `${key}m` || v.replace('m', '') === key)?.[0] ?? key
    : key;
  const idx = CIRCLE_OF_FIFTHS_MAJOR.indexOf(majorKey);
  if (idx === -1) return [];
  // Adjacent keys in the circle (perfect 4th and 5th), plus relative major/minor
  const prev = CIRCLE_OF_FIFTHS_MAJOR[(idx - 1 + 12) % 12];
  const next = CIRCLE_OF_FIFTHS_MAJOR[(idx + 1) % 12];
  const parallel = scale === 'minor' ? majorKey : `${majorKey}m`;
  return [prev, majorKey, next, parallel].filter(Boolean);
}

interface CreatorProfile {
  display_name?: string | null;
  bio?: string | null;
}

interface Track {
  id: string;
  title: string;
  type: string;
  audio_url: string;
  peaks_url?: string | null;
  cover_url?: string | null;
  duration_seconds?: number | null;
  bpm?: number | null;
  key?: string | null;
  scale?: string | null;
  description?: string | null;
}

interface Project {
  id: string;
  name: string;
  cover_url?: string | null;
  description?: string | null;
}

interface Props {
  project: Project;
  tracks: Track[];
  creator: CreatorProfile | null;
  onPlay: (track: Track) => void;
  playingId?: string | null;
  isPlaying?: boolean;
}

function fmt(s: number) {
  if (!s || !isFinite(s)) return '—';
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

export function ProducerShareVariant({ project, tracks, creator, onPlay, playingId, isPlaying }: Props) {
  const currentTrack = tracks.find((t) => t.id === playingId) ?? tracks[0];
  const displayName = creator?.display_name || project.name;
  const [bpmCopied, setBpmCopied] = useState(false);
  const [keyCopied, setKeyCopied] = useState(false);
  const [trackListExpanded, setTrackListExpanded] = useState(false);

  const isMinor = currentTrack?.scale === 'minor';
  const compatibleKeys = getCompatibleKeys(currentTrack?.key, currentTrack?.scale);

  const handleCopyBpm = async () => {
    if (!currentTrack?.bpm) return;
    await navigator.clipboard.writeText(String(currentTrack.bpm)).catch(() => {});
    setBpmCopied(true);
    setTimeout(() => setBpmCopied(false), 1500);
  };

  const handleCopyKey = async () => {
    if (!currentTrack?.key) return;
    const label = `${currentTrack.key} ${currentTrack.scale || 'major'}`;
    await navigator.clipboard.writeText(label).catch(() => {});
    setKeyCopied(true);
    setTimeout(() => setKeyCopied(false), 1500);
  };

  const handlePrev = () => {
    const idx = tracks.findIndex((t) => t.id === playingId);
    if (idx > 0) onPlay(tracks[idx - 1]);
  };

  const handleNext = () => {
    const idx = tracks.findIndex((t) => t.id === playingId);
    if (idx >= 0 && idx < tracks.length - 1) onPlay(tracks[idx + 1]);
  };

  const visibleTracks = trackListExpanded ? tracks : tracks.slice(0, 6);

  return (
    <div className="min-h-screen bg-[#0a0907] text-[#E8DCC8] font-sans flex flex-col relative overflow-hidden">
      {/* Ambient glow */}
      <div
        className="absolute w-[900px] h-[900px] rounded-full pointer-events-none opacity-[0.025] blur-[180px]"
        style={{ background: 'radial-gradient(circle, #7F77DD 0%, transparent 70%)', top: '-20%', left: '-15%' }}
      />

      <div className="max-w-5xl mx-auto w-full px-5 md:px-10 pt-12 pb-32 z-10">

        {/* Header */}
        <div className="mb-10">
          <p className="text-[9px] font-mono uppercase tracking-[0.35em] text-[#6a5d4a] mb-1">
            Producer pack · {tracks.length} loop{tracks.length !== 1 ? 's' : ''}
          </p>
          <h1 className="text-3xl md:text-4xl font-bold uppercase tracking-tight text-white leading-none">
            {displayName}
          </h1>
          {creator?.bio && (
            <p className="mt-3 text-[12px] text-[#a08a6a] max-w-lg leading-relaxed">{creator.bio}</p>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-8">

          {/* ── Left: player + tech spec + key chart ── */}
          <div className="flex flex-col gap-6">

            {/* Vinyl player */}
            {currentTrack && (
              <div className="flex flex-col items-center">
                <ShareWaveformVinyl
                  track={currentTrack as any}
                  projectCover={project.cover_url}
                  caption={null}
                  isPlaying={isPlaying}
                  playingId={playingId ?? null}
                  onTogglePlay={onPlay}
                  size="large"
                />
                {/* Prev / Next */}
                {tracks.length > 1 && (
                  <div className="flex items-center gap-4 mt-5">
                    <button
                      onClick={handlePrev}
                      disabled={!playingId || tracks.findIndex((t) => t.id === playingId) <= 0}
                      className="w-9 h-9 rounded-full border border-[#1f1a13] bg-[#14110d] flex items-center justify-center text-[#6a5d4a] hover:text-white disabled:opacity-30 transition-colors"
                    >
                      <SkipBack size={14} fill="currentColor" />
                    </button>
                    <span className="text-[10px] font-mono text-[#5a5142]">
                      {tracks.findIndex((t) => t.id === playingId) + 1} / {tracks.length}
                    </span>
                    <button
                      onClick={handleNext}
                      disabled={!playingId || tracks.findIndex((t) => t.id === playingId) >= tracks.length - 1}
                      className="w-9 h-9 rounded-full border border-[#1f1a13] bg-[#14110d] flex items-center justify-center text-[#6a5d4a] hover:text-white disabled:opacity-30 transition-colors"
                    >
                      <SkipForward size={14} fill="currentColor" />
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Tech spec — BPM + Key as large click-to-copy cards */}
            {currentTrack && (
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={handleCopyBpm}
                  disabled={!currentTrack.bpm}
                  className="relative group bg-[#14110d] border border-[#1f1a13] hover:border-[#2d2620] rounded-2xl p-5 text-left transition-colors disabled:pointer-events-none"
                >
                  <p className="text-[9px] font-mono uppercase tracking-[0.25em] text-[#6a5d4a] mb-1">BPM</p>
                  <p className="text-[48px] font-mono font-bold text-white leading-none tabular-nums">
                    {currentTrack.bpm ?? '—'}
                  </p>
                  <p className="text-[9px] font-mono text-[#3a3328] mt-2 uppercase tracking-wider">
                    {currentTrack.bpm ? 'Click to copy' : 'Not analyzed'}
                  </p>
                  <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                    {bpmCopied ? <Check size={12} className="text-[#6DC6A4]" /> : <Copy size={12} className="text-[#5a5142]" />}
                  </div>
                </button>

                <button
                  onClick={handleCopyKey}
                  disabled={!currentTrack.key}
                  className={`relative group border rounded-2xl p-5 text-left transition-colors disabled:pointer-events-none ${
                    isMinor
                      ? 'bg-[#1a1833]/50 border-[#534AB7]/30 hover:border-[#534AB7]/60'
                      : 'bg-[#1a1610]/50 border-[#3d3020]/40 hover:border-[#5a4a2a]/60'
                  }`}
                >
                  <p className="text-[9px] font-mono uppercase tracking-[0.25em] text-[#6a5d4a] mb-1">
                    Key · Scale
                  </p>
                  <p className={`text-[48px] font-mono font-bold leading-none ${
                    isMinor ? 'text-[#9d95e8]' : 'text-[#c8a47a]'
                  }`}>
                    {currentTrack.key ?? '—'}
                  </p>
                  <p className={`text-[11px] font-mono mt-1 uppercase tracking-wider ${
                    isMinor ? 'text-[#534AB7]/70' : 'text-[#3d3020]/80'
                  }`}>
                    {currentTrack.scale ?? 'major'}
                  </p>
                  <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                    {keyCopied ? <Check size={12} className="text-[#6DC6A4]" /> : <Copy size={12} className="text-[#5a5142]" />}
                  </div>
                </button>
              </div>
            )}

            {/* Compatible keys — circle-of-fifths strip */}
            {compatibleKeys.length > 0 && (
              <div className="bg-[#0e0c09] border border-[#1f1a13] rounded-xl p-4">
                <p className="text-[9px] font-mono uppercase tracking-[0.25em] text-[#6a5d4a] mb-3">
                  Compatible keys (circle of 5ths)
                </p>
                <div className="flex flex-wrap gap-2">
                  {CIRCLE_OF_FIFTHS_MAJOR.map((k) => {
                    const isCurrent = k === (isMinor
                      ? Object.entries(RELATIVE_MINORS).find(([, v]) => v.replace('m', '') === currentTrack?.key)?.[0]
                      : currentTrack?.key);
                    const isCompat = compatibleKeys.some((ck) => ck.replace('m', '') === k || ck === k);
                    return (
                      <div key={k} className="flex flex-col items-center gap-1">
                        <span className={`text-[10px] font-mono font-bold px-2 py-1 rounded-lg border transition-colors ${
                          isCurrent
                            ? isMinor
                              ? 'text-[#9d95e8] bg-[#1a1833] border-[#534AB7]/60'
                              : 'text-[#c8a47a] bg-[#1f1a10] border-[#5a4a2a]/60'
                            : isCompat
                              ? 'text-[#E8DCC8]/70 bg-[#14110d] border-[#2d2620]'
                              : 'text-[#2d2620] bg-transparent border-[#1a160f]'
                        }`}>
                          {k}
                        </span>
                        <span className={`text-[8px] font-mono ${isCompat || isCurrent ? 'text-[#3a3328]' : 'text-[#1f1a13]'}`}>
                          {RELATIVE_MINORS[k]?.replace('m', '') ?? ''}m
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Description / producer notes */}
            {(currentTrack?.description || project.description) && (
              <div className="bg-[#0e0c09] border border-[#1f1a13] rounded-xl p-4 space-y-1">
                <p className="text-[9px] font-mono uppercase tracking-[0.25em] text-[#6a5d4a]">
                  Notes from the producer
                </p>
                <p className="text-[12px] text-[#a08a6a] leading-relaxed whitespace-pre-wrap">
                  {currentTrack?.description || project.description}
                </p>
              </div>
            )}
          </div>

          {/* ── Right: track directory ── */}
          <div className="flex flex-col gap-4">
            <div className="bg-[#0e0c09] border border-[#1f1a13] rounded-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-[#1f1a13] flex items-center justify-between">
                <p className="text-[9px] font-mono uppercase tracking-[0.25em] text-[#6a5d4a]">
                  Pack · {tracks.length}
                </p>
              </div>
              <div className="divide-y divide-[#0e0c09]">
                {visibleTracks.map((t, i) => {
                  const active = playingId === t.id;
                  const tIsMinor = t.scale === 'minor';
                  return (
                    <button
                      key={t.id}
                      onClick={() => onPlay(t)}
                      className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-[#14110d] transition-colors text-left group ${
                        active ? 'bg-[#14110d]' : ''
                      }`}
                    >
                      <div className="relative w-9 h-9 rounded-lg overflow-hidden bg-[#0a0907] border border-[#1f1a13] shrink-0">
                        {t.cover_url ? (
                          <img loading="lazy" src={t.cover_url} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-[#2d2620]">
                            <Music size={12} />
                          </div>
                        )}
                        {active && (
                          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                            {isPlaying ? (
                              <Pause size={10} fill="currentColor" className="text-[#D4BFA0]" />
                            ) : (
                              <Play size={10} fill="currentColor" className="text-[#D4BFA0] ml-0.5" />
                            )}
                          </div>
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <p className={`text-[12px] font-medium truncate ${active ? 'text-[#D4BFA0]' : 'text-white/85 group-hover:text-white'}`}>
                          {t.title}
                        </p>
                        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                          {t.bpm && (
                            <span className="text-[9px] font-mono text-[#5a5142]">{t.bpm} bpm</span>
                          )}
                          {t.key && (
                            <span className={`text-[8px] font-mono font-bold px-1 py-0.5 rounded uppercase tracking-wider leading-none ${
                              tIsMinor
                                ? 'text-[#9d95e8] bg-[#1a1833]/50'
                                : 'text-[#c8a47a] bg-[#1f1a10]/50'
                            }`}>
                              {t.key}{tIsMinor ? 'm' : ''}
                            </span>
                          )}
                          {t.duration_seconds && (
                            <span className="text-[9px] font-mono text-[#3a3328]">{fmt(t.duration_seconds)}</span>
                          )}
                        </div>
                      </div>

                      <span className="text-[10px] font-mono text-[#2d2620] tabular-nums shrink-0">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                    </button>
                  );
                })}
              </div>

              {tracks.length > 6 && (
                <button
                  onClick={() => setTrackListExpanded((v) => !v)}
                  className="w-full flex items-center justify-center gap-2 py-3 text-[10px] font-mono text-[#6a5d4a] hover:text-[#E8DCC8] border-t border-[#1f1a13] transition-colors"
                >
                  {trackListExpanded ? (
                    <><ChevronUp size={12} /> Show less</>
                  ) : (
                    <><ChevronDown size={12} /> {tracks.length - 6} more loops</>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
