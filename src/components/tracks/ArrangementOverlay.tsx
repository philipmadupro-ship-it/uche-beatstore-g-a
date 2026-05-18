'use client';

import { useEffect, useMemo, useState } from 'react';
import { Map as MapIcon } from 'lucide-react';

/**
 * Lightweight read-only arrangement strip.
 *
 * Renders a horizontal row of colored segment blocks (Intro / Verse /
 * Chorus / Bridge / Outro etc.) proportional to a track's duration,
 * driven by the per-(track, user) arrangement state stored in the
 * `arrangements` table. Click a block to seek the player to that
 * segment's start.
 *
 * This is the visual companion to /studio's StudioArrangement editor —
 * same data, no editing. Mounts on the library detail page and the
 * share-page DAW canvas so collaborators see the song's structure
 * without dragging onto the studio surface.
 *
 * If no arrangement exists yet (fresh track, owner never opened the
 * editor) the component renders nothing — better silence than a
 * placeholder strip that adds visual noise.
 */

const SEGMENT_TONES: Record<string, { bg: string; ring: string; text: string }> = {
  intro:   { bg: 'bg-[#2a3a5a]/40', ring: 'ring-[#7aa8e8]/40',  text: 'text-[#a8c4e8]' },
  verse:   { bg: 'bg-[#2A2418]/50', ring: 'ring-[#8A7A5C]/40',  text: 'text-[#E8D8B8]' },
  chorus:  { bg: 'bg-[#3a2a5a]/50', ring: 'ring-[#a89adc]/40',  text: 'text-[#cbb8f0]' },
  bridge:  { bg: 'bg-[#5a3a2a]/40', ring: 'ring-[#e8a86a]/40',  text: 'text-[#f0c498]' },
  drop:    { bg: 'bg-[#5a2a4a]/50', ring: 'ring-[#e88abc]/40',  text: 'text-[#f0a8c8]' },
  hook:    { bg: 'bg-[#3a4a2a]/40', ring: 'ring-[#a8c46a]/40',  text: 'text-[#c8e090]' },
  outro:   { bg: 'bg-[#1f5a4a]/40', ring: 'ring-[#6DC6A4]/40',  text: 'text-[#94d9bc]' },
  default: { bg: 'bg-white/[0.03]', ring: 'ring-white/[0.08]',  text: 'text-[#a08a6a]' },
};

function toneFor(label: string) {
  const key = label.toLowerCase().replace(/[^a-z]/g, '');
  // Substring match so "Pre-Chorus", "Chorus 2" etc. all map to chorus.
  for (const k of Object.keys(SEGMENT_TONES)) {
    if (k !== 'default' && key.includes(k)) return SEGMENT_TONES[k];
  }
  return SEGMENT_TONES.default;
}

interface Props {
  trackId: string;
  durationSeconds: number;
  /** Seek the parent player to the segment's start. Omit to render
   *  a non-interactive map. */
  onSeek?: (seconds: number) => void;
  /** Current playhead — used to highlight the segment the player is
   *  currently inside. */
  currentTime?: number;
}

function fmtTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function ArrangementOverlay({ trackId, durationSeconds, onSeek, currentTime = 0 }: Props) {
  const [markers, setMarkers] = useState<number[] | null>(null);
  const [ordering, setOrdering] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/tracks/${trackId}/arrangement`);
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setMarkers(Array.isArray(data.markers) ? data.markers : []);
        setOrdering(Array.isArray(data.ordering) ? data.ordering : []);
      } catch {
        // Silent — read-only overlay should never make noise.
      }
    })();
    return () => { cancelled = true; };
  }, [trackId]);

  // Derive segment ranges from markers + ordering. Markers are cut
  // points (in seconds); the ordering array has one label per
  // segment between (and bookending) them. Segment N starts at
  // markers[N-1] (or 0 for the first) and ends at markers[N] (or
  // durationSeconds for the last).
  const segments = useMemo(() => {
    if (!markers || ordering.length === 0 || durationSeconds <= 0) return [];
    const cuts = [0, ...markers.filter((m) => m > 0 && m < durationSeconds).sort((a, b) => a - b), durationSeconds];
    const out: { start: number; end: number; label: string }[] = [];
    for (let i = 0; i < cuts.length - 1; i++) {
      out.push({
        start: cuts[i],
        end: cuts[i + 1],
        label: ordering[i] ?? 'Section',
      });
    }
    return out;
  }, [markers, ordering, durationSeconds]);

  // Render nothing when the producer hasn't laid out an arrangement
  // yet. Empty strip would be visual noise.
  if (!segments.length) return null;

  return (
    <div className="mb-3">
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#5a5142] flex items-center gap-1.5">
          <MapIcon size={10} />
          Arrangement
        </p>
        <p className="text-[9px] font-mono text-[#3a3328]">
          {segments.length} section{segments.length === 1 ? '' : 's'}
        </p>
      </div>

      <div className="flex w-full gap-0.5 h-7 rounded-md overflow-hidden">
        {segments.map((seg, i) => {
          const widthPct = ((seg.end - seg.start) / durationSeconds) * 100;
          const tone = toneFor(seg.label);
          const isActive = currentTime >= seg.start && currentTime < seg.end;
          const isInteractive = !!onSeek;
          const Comp: 'button' | 'div' = isInteractive ? 'button' : 'div';
          return (
            <Comp
              key={i}
              onClick={isInteractive ? () => onSeek(seg.start) : undefined}
              style={{ width: `${widthPct}%` }}
              title={`${seg.label} · ${fmtTime(seg.start)} – ${fmtTime(seg.end)}`}
              className={`relative ring-1 ring-inset ${tone.ring} ${tone.bg} ${isInteractive ? 'cursor-pointer hover:brightness-150 transition-all' : ''} ${
                isActive ? 'brightness-150 ring-2' : ''
              } flex items-center justify-center px-1 overflow-hidden`}
            >
              <span className={`text-[9px] font-mono uppercase tracking-wider truncate ${tone.text}`}>
                {seg.label}
              </span>
            </Comp>
          );
        })}
      </div>
    </div>
  );
}
