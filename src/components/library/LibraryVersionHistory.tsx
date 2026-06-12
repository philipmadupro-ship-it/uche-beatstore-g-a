import { History, Download } from 'lucide-react';
import type { Track } from '@/lib/types';
import { fmtBpm, fmtKey, fmtDuration } from '@/lib/audio/format';

export interface TrackVersion {
  id: string;
  version_number: number;
  version_label?: string | null;
  audio_url: string;
  bpm?: number | null;
  key?: string | null;
  scale?: string | null;
  loudness?: number | null;
  duration_seconds?: number | null;
  notes?: string | null;
  created_at: string;
}

interface Props {
  track: Track;
  versions: TrackVersion[];
}

/**
 * Version history list for the library detail page — extracted from
 * `library/[id]/page.tsx`. Pure presentation:
 *
 *   - Active "Live" row at the top with the current master metadata
 *   - One row per archived version, newest first (parent sorts)
 *   - Per-row download via the standard <a download> attribute (this
 *     is owner-side so cross-origin Content-Disposition isn't an
 *     issue — the user already has authenticated access)
 *
 * Versions array is provided by the parent. We don't refetch — that's
 * the parent's job + `useRealtimeTable('track_versions')` keeps it
 * fresh elsewhere.
 */
export function LibraryVersionHistory({ track, versions }: Props) {
  return (
    <div className="mb-10">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <History size={14} className="text-[#E7D7BE]" />
          <h2 className="text-[11px] font-mono uppercase tracking-[0.2em] text-[#F7EBDD]">Version history</h2>
          <span className="text-[10px] font-mono text-white bg-[#342F27] border border-[#C9BCA8]/40 rounded px-2 py-0.5">
            {versions.length}
          </span>
        </div>
        <p className="text-[10px] text-[#9B9282] font-mono">
          Current → <span className="text-[#F3E6D1]">v{(versions[0]?.version_number ?? 0) + 1}</span>
        </p>
      </div>

      {versions.length === 0 ? (
        <div className="bg-gradient-to-b from-[#11100D] to-[#090907] border border-[#211F1A] rounded-xl py-10 text-center">
          <History size={20} className="mx-auto text-[#3B372F] mb-3" />
          <p className="text-[12px] text-[#D0C3AF] mb-1">No prior versions yet</p>
          <p className="text-[10px] text-[#9B9282] font-mono uppercase tracking-wider">
            Replacing the audio will snapshot the current file as v1
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2">
          {/* Live row */}
          <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-gradient-to-r from-[#342F27] to-[#0f0f1a] border border-[#C9BCA8]/40">
            <span className="text-[10px] font-mono uppercase tracking-widest text-[#F3E6D1] w-14 text-center bg-[#090907] border border-[#C9BCA8]/40 rounded py-1 px-1">
              Live
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-medium text-white truncate">{track.title}</p>
              <p className="text-[10px] font-mono text-[#D0C3AF]">
                {new Date(track.created_at || Date.now()).toLocaleString()} · current master
              </p>
            </div>
            <span className="text-[10px] font-mono text-[#F3E6D1] w-16 text-right">{fmtBpm(track.bpm)}</span>
            <span className="text-[10px] font-mono text-[#F3E6D1] w-16 text-right">{fmtKey(track.key, track.scale)}</span>
            <span className="text-[10px] font-mono text-[#F3E6D1] w-14 text-right">{fmtDuration(track.duration_seconds)}</span>
            <div className="w-6" />
          </div>

          {/* Historic snapshots */}
          {versions.map((v) => (
            <div
              key={v.id}
              className="flex items-center gap-3 px-4 py-3 rounded-lg bg-[#11100D] border border-[#211F1A] hover:border-[#3B372F] hover:bg-[#1A1813] transition-colors group"
            >
              <span className="text-[10px] font-mono uppercase tracking-widest text-[#D0C3AF] w-14 text-center bg-[#090907] border border-[#211F1A] rounded py-1 px-1">
                {v.version_label || `v${v.version_number}`}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-[12px] text-[#F7EBDD] truncate">
                  {new Date(v.created_at).toLocaleDateString('en-US', {
                    month: 'short', day: 'numeric', year: 'numeric',
                    hour: 'numeric', minute: '2-digit',
                  })}
                </p>
                {v.notes && <p className="text-[10px] text-[#B4AA99] truncate font-mono">{v.notes}</p>}
              </div>
              <span className="text-[10px] font-mono text-[#B4AA99] w-16 text-right">{fmtBpm(v.bpm)}</span>
              <span className="text-[10px] font-mono text-[#B4AA99] w-16 text-right">{fmtKey(v.key, v.scale)}</span>
              <span className="text-[10px] font-mono text-[#B4AA99] w-14 text-right">{fmtDuration(v.duration_seconds)}</span>
              {v.audio_url ? (
                <a
                  href={v.audio_url}
                  download
                  className="text-[#9B9282] hover:text-[#F3E6D1] transition-colors p-1.5 rounded border border-transparent hover:border-[#211F1A]"
                  title="Download version"
                >
                  <Download size={12} />
                </a>
              ) : (
                <div className="w-6" />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
