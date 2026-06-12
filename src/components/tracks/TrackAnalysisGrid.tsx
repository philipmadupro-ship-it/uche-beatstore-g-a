'use client';

import { Loader2, RefreshCw } from 'lucide-react';
import { toast } from '@/hooks/useToast';
import { useState } from 'react';
import type { Track } from '@/lib/types';
import { errorMessage } from '@/lib/errors';

/**
 * The "Sound DNA" grid in the track drawer — BPM / Scale / Energy /
 * Groove, plus a "Re-analyze" button that re-runs the server analysis.
 *
 * Lifted out of TrackDetailsDrawer because it was ~60 lines of inline
 * grid + handler logic, and the same surface is plausibly useful in the
 * track-detail page outside the drawer too.
 *
 * Stays self-contained: parent passes the track and a callback that fires
 * when the re-analysis lands (to re-fetch the parent's data).
 */
interface Props {
  track: Track;
  onAnalyzed?: () => void;
}

export function TrackAnalysisGrid({ track, onAnalyzed }: Props) {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const canAnalyze = Boolean(track.audio_url);

  const reAnalyze = async () => {
    if (!track.audio_url) {
      toast.error('No audio file', 'Upload or replace this track’s source audio before running analysis.');
      return;
    }
    setIsAnalyzing(true);
    try {
      const res = await fetch(`/api/tracks/${track.id}/analyze`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        toast.error('Re-analyze failed', data?.error || `HTTP ${res.status}`);
        return;
      }
      const patched = data.track ?? track;
      const summary = [
        patched.bpm ? `${patched.bpm} BPM` : null,
        patched.key ? `${patched.key}${patched.scale ? ' ' + patched.scale : ''}` : null,
        patched.energy != null ? `${Math.round(patched.energy * 100)}% energy` : null,
      ].filter(Boolean).join(' · ');
      toast.success('Track re-analyzed', summary || undefined);
      onAnalyzed?.();
    } catch (err) {
      toast.error('Re-analyze failed', errorMessage(err) || 'Network error');
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="px-8 py-5 border-b border-[#2B2821]">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-[#D0C3AF]">Sound DNA</h3>
        <button
          onClick={reAnalyze}
          disabled={isAnalyzing || !canAnalyze}
          title={canAnalyze ? 'Re-analyze this track' : 'Upload source audio before analyzing'}
          className="tap flex min-h-11 items-center gap-1.5 rounded border border-[#2B2821] bg-[#101010] px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-[#D0C3AF] transition-colors hover:border-[#C9BCA8]/40 hover:bg-[#342F27] hover:text-[#F3E6D1] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isAnalyzing ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
          {isAnalyzing ? 'Analyzing…' : 'Re-analyze'}
        </button>
      </div>
      {/* BPM + Scale only. Energy/Groove removed from the surface per
          user preference — values still live on the track row and feed
          the auto-tag suggestions, just not visible here. */}
      <div className="grid grid-cols-2 gap-6">
        <Cell label="BPM" value={track.bpm != null ? String(track.bpm) : '--'} />
        <Cell label="Scale" value={track.key ? `${track.key} ${track.scale || ''}` : '--'} />
      </div>
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <span className="text-[9px] font-bold text-[#837B6D] uppercase tracking-widest">{label}</span>
      <p className="text-sm font-black text-white font-mono">{value}</p>
    </div>
  );
}
