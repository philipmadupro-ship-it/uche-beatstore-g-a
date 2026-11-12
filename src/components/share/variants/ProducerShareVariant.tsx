'use client';

import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import type { ShareRowDownload } from '@/components/share/ShareTrackList';
import { SharePageFrame, type ShareFrameOptions } from '@/components/share/SharePageFrame';

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
  /** Share options the producer set (downloads, playback, collaboration), for the header. */
  options: ShareFrameOptions;
  /** The page's one audio engine renders its waveform here, under the vinyl. */
  waveRef?: React.RefObject<HTMLDivElement | null>;
  /** Download on the row itself, beside the beat it belongs to. */
  rowDownload?: ShareRowDownload;
}

/** Rows carry the type column up front: loops and stems are what a producer scans for. */
const PRODUCER_COLUMNS = ['title', 'tags', 'waveform', 'type', 'duration'];

export function ProducerShareVariant({ project, tracks, creator, onPlay, playingId, isPlaying, options, waveRef, rowDownload }: Props) {
  const currentTrack = tracks.find((t) => t.id === playingId) ?? tracks[0];
  const [bpmCopied, setBpmCopied] = useState(false);
  const [keyCopied, setKeyCopied] = useState(false);

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

  return (
    <SharePageFrame
      project={project}
      producerName={creator?.display_name || null}
      tracks={tracks}
      options={options}
      playingId={playingId}
      isPlaying={isPlaying}
      onPlay={onPlay}
      waveRef={waveRef}
      rowDownload={rowDownload}
      columnIds={PRODUCER_COLUMNS}
    >
      {/* What a producer reaches for: tempo and key of the track on the engine,
          click to copy, and the keys that mix with it. */}
      <section aria-label="Track reference" className="mt-12 flex flex-col gap-6">
            {/* Tech spec — BPM + Key as large click-to-copy cards */}
            {currentTrack && (
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={handleCopyBpm}
                  disabled={!currentTrack.bpm}
                  className="relative group bg-white/[0.04] border border-white/10 hover:border-white/20 rounded-2xl p-5 text-left transition-colors disabled:pointer-events-none"
                >
                  <p className="text-[9px] font-mono uppercase tracking-[0.25em] text-white/60 mb-1">BPM</p>
                  <p className="text-[48px] font-mono font-bold text-white leading-none tabular-nums">
                    {currentTrack.bpm ?? '—'}
                  </p>
                  <p className="text-[9px] font-mono text-white/30 mt-2 uppercase tracking-wider">
                    {currentTrack.bpm ? 'Click to copy' : 'Not analyzed'}
                  </p>
                  <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                    {bpmCopied ? <Check size={12} className="text-[#6DC6A4]" /> : <Copy size={12} className="text-white/40" />}
                  </div>
                </button>

                <button
                  onClick={handleCopyKey}
                  disabled={!currentTrack.key}
                  className={`relative group border rounded-2xl p-5 text-left transition-colors disabled:pointer-events-none ${
                    isMinor
                      ? 'bg-[#1f1a10]/50 border-[#3d3020]/30 hover:border-[#3d3020]/60'
                      : 'bg-[#1a1610]/50 border-[#3d3020]/40 hover:border-[#5a4a2a]/60'
                  }`}
                >
                  <p className="text-[9px] font-mono uppercase tracking-[0.25em] text-white/60 mb-1">
                    Key · Scale
                  </p>
                  <p className={`text-[48px] font-mono font-bold leading-none ${
                    isMinor ? 'text-[#c8a47a]' : 'text-[#c8a47a]'
                  }`}>
                    {currentTrack.key ?? '—'}
                  </p>
                  <p className={`text-[11px] font-mono mt-1 uppercase tracking-wider ${
                    isMinor ? 'text-[#3d3020]/70' : 'text-[#3d3020]/80'
                  }`}>
                    {currentTrack.scale ?? 'major'}
                  </p>
                  <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                    {keyCopied ? <Check size={12} className="text-[#6DC6A4]" /> : <Copy size={12} className="text-white/40" />}
                  </div>
                </button>
              </div>
            )}

            {/* Compatible keys — circle-of-fifths strip */}
            {compatibleKeys.length > 0 && (
              <div className="bg-[#0e0c09] border border-white/10 rounded-xl p-4">
                <p className="text-[9px] font-mono uppercase tracking-[0.25em] text-white/60 mb-3">
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
                              ? 'text-[#c8a47a] bg-[#1f1a10] border-[#3d3020]/60'
                              : 'text-[#c8a47a] bg-[#1f1a10] border-[#5a4a2a]/60'
                            : isCompat
                              ? 'text-white/70 bg-white/[0.04] border-white/20'
                              : 'text-white/30 bg-transparent border-white/10'
                        }`}>
                          {k}
                        </span>
                        <span className={`text-[8px] font-mono ${isCompat || isCurrent ? 'text-white/30' : 'text-white/20'}`}>
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
              <div className="bg-[#0e0c09] border border-white/10 rounded-xl p-4 space-y-1">
                <p className="text-[9px] font-mono uppercase tracking-[0.25em] text-white/60">
                  Notes from the producer
                </p>
                <p className="text-[11px] text-white/80 leading-relaxed whitespace-pre-wrap">
                  {currentTrack?.description || project.description}
                </p>
              </div>
            )}
      </section>
    </SharePageFrame>
  );
}
