import type { Track } from '@/lib/types';
import { fmtBpm, fmtKey, fmtLUFS, fmtDuration } from '@/lib/audio/format';
import { camelotOf } from '@/lib/audio/harmonic';

interface Props {
  track: Track;
}

/**
 * Compact analysis grid for the track workspace. Pared back to the five
 * concrete, decision-useful metrics — BPM, Key, Camelot keypoint (for
 * harmonic matching), Loudness, Duration. The vibe estimates (energy /
 * danceability / valence / acousticness) were noisy and were removed in
 * favour of the discovery + matching tools below.
 */

interface CellDef {
  label: string;
  value: string;
  accent?: string;
  large?: boolean;
}

export function LibraryMetadataGrid({ track }: Props) {
  const isMinor = track.scale === 'minor';
  const camelot = camelotOf({ id: track.id, key: track.key, scale: track.scale });

  const cells: CellDef[] = [
    {
      label: 'BPM',
      value: fmtBpm(track.bpm),
      accent: 'text-white',
      large: true,
    },
    {
      label: 'Key',
      value: fmtKey(track.key, track.scale),
      accent: isMinor ? 'text-[#c8a47a]' : 'text-[#c8a47a]',
      large: true,
    },
    {
      // Camelot "keypoint" — the harmonic-mixing code used by the matching
      // tools to find compatible beats/instrumentals.
      label: 'Keypoint',
      value: camelot ?? '—',
      accent: 'text-white',
    },
    {
      label: 'Loudness',
      value: fmtLUFS(track.loudness),
      accent: 'text-white/80',
    },
    {
      label: 'Duration',
      value: fmtDuration(track.duration_seconds),
      accent: 'text-white',
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-10">
      {cells.map((cell) => (
        <div
          key={cell.label}
          className="relative overflow-hidden bg-white/[0.02] border border-white/10 rounded-xl px-4 py-4"
        >

          <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-white/40 mb-2">
            {cell.label}
          </p>
          <p className={`font-mono font-bold leading-none ${cell.accent ?? 'text-white'} ${
            cell.large ? 'text-[22px]' : 'text-[16px]'
          }`}>
            {cell.value}
          </p>

          {/* Key scale badge */}
          {cell.label === 'Key' && track.key && (
            <span className={`mt-2 inline-block text-[8px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded ${
              isMinor
                ? 'text-[#c8a47a] bg-[#1f1a10]/60 border border-[#3d3020]/25'
                : 'text-[#c8a47a] bg-[#1f1a10]/60 border border-[#3d3020]/30'
            }`}>
              {isMinor ? 'Minor' : 'Major'}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
