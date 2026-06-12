'use client';

import { useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { Track } from '@/lib/types';
import { toast } from '@/hooks/useToast';

interface Props {
  track: Track;
  /** Called after a successful re-analyze so the parent can refetch the
   *  full track row (the API response gives us a slice, but the parent
   *  may want the joined tags / stems shape). */
  onUpdate?: () => void;
}

/**
 * Asset Intelligence panel — extracted from TrackDetailsDrawer to keep
 * the drawer file under control. Self-contained around a track + an
 * optional onUpdate callback; no parent state coupling beyond that.
 *
 * Flow on Re-analyze:
 *   1. Run Essentia.js in the browser via analyzeAudioFromUrl. More
 *      accurate than server-side music-tempo + Krumhansl, and works
 *      anytime AudioContext.decodeAudioData can read the file.
 *   2. POST the features to /api/tracks/[id]/analyze. Server-side it
 *      runs through `mergeFeatures` with the same precedence rules as
 *      upload-time analysis (client wins for BPM/key; AudD wins for
 *      vibe fields when catalogued; server fallback otherwise).
 *   3. If both Essentia AND the server's audio-decode fail, the server
 *      now attempts ffmpeg→WAV conversion before giving up. Whichever
 *      path produced the values gets surfaced in the success toast so
 *      the user knows what ran.
 */
export function TrackAnalysisSection({ track, onUpdate }: Props) {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const canAnalyze = Boolean(track.audio_url);

  const handleAnalyze = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isAnalyzing) return;
    if (!track.audio_url) {
      toast.error('No audio file', 'Upload or replace this track’s source audio before running analysis.');
      return;
    }
    setIsAnalyzing(true);
    const tid = toast.info('Re-analyzing track…', 'Running Essentia.js in your browser');
    try {
      const { analyzeAudioFromUrl } = await import('@/lib/audio/analyze.client');
      const features = await analyzeAudioFromUrl(track.audio_url);

      const res = await fetch(`/api/tracks/${track.id}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ features }),
      });
      const json = await res.json().catch(() => ({}));
      toast.dismiss(tid);
      if (!res.ok) {
        toast.error('Re-analyze failed', json.error || `HTTP ${res.status}`);
        return;
      }
      onUpdate?.();
      const patched = json?.track || {};
      const bits = [
        patched.bpm ? `${patched.bpm} BPM` : null,
        patched.key ? `${patched.key}${patched.scale ? ' ' + patched.scale : ''}` : null,
      ].filter(Boolean);

      if (bits.length === 0) {
        // Pick the most accurate explanation based on what actually ran.
        // Diagnostic fields propagate from analyzeAudio() so the toast
        // can show the real reason (e.g. "audio-decode: invalid header
        // → ffmpeg not on PATH") instead of guessing.
        const source = json?.source;                     // 'client' | 'server'
        const decoded = json?.decoded;                   // server-side
        const ffmpegUsed = json?.ffmpegUsed;             // server-side
        const ffmpegAvailable = json?.ffmpegAvailable;   // server-side
        const reason: string | null = json?.reason ?? null;
        const bytes: number | null = json?.bytes ?? null;

        let detail: string;
        if (source === 'client') {
          detail = 'Essentia.js in the browser couldn’t lock onto a BPM or key. Try a longer or louder section of the track, or re-export the audio as a standard 44.1 kHz WAV/MP3.';
        } else if (decoded === false) {
          // Show the real reason. Common forms:
          //   "audio-decode: ... → ffmpeg not available on PATH"
          //   "audio-decode: ... → after ffmpeg: ..."
          const base = ffmpegAvailable === false
            ? 'Install ffmpeg (`brew install ffmpeg`) and restart the dev server to enable the conversion fallback.'
            : 'ffmpeg ran but the file is unreadable — re-export as a standard 44.1 kHz WAV/MP3.';
          detail = reason
            ? `${base}\n\nDetails: ${reason}${bytes ? ` (${bytes} bytes)` : ''}`
            : base;
        } else if (ffmpegUsed) {
          detail = 'Decoded via ffmpeg fallback, but the BPM and key extractors couldn’t find a confident signal. Try a longer or louder section, or a clearer mix.';
        } else {
          detail = 'Audio decoded but the BPM and key extractors couldn’t find a confident signal. Common causes: very short clip, ambient/atonal material, or extremely quiet input.';
        }
        toast.error('Couldn’t detect BPM or Scale', detail);
      } else {
        const sourceLabel = json?.source === 'client' ? 'via Essentia' : 'via server';
        toast.success('Track re-analyzed', `${bits.join(' · ')} (${sourceLabel})`);
      }
    } catch (err: unknown) {
      toast.error('Re-analyze failed', err instanceof Error ? err.message : 'Network error');
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="p-8 border-b border-[#2B2821] space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-[#837B6D]">Asset Intelligence</h3>
        <button
          disabled={isAnalyzing || !canAnalyze}
          onClick={handleAnalyze}
          title={canAnalyze ? 'Re-analyze this track' : 'Upload source audio before analyzing'}
          className="tap flex min-h-11 items-center gap-1.5 rounded border border-[#2B2821] bg-[#101010] px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-[#D0C3AF] transition-colors hover:border-[#C9BCA8]/40 hover:bg-[#342F27] hover:text-[#F3E6D1] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isAnalyzing ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
          {isAnalyzing ? 'Analyzing…' : 'Re-analyze'}
        </button>
      </div>

      {/* Pared down per user request: BPM + Scale only. Energy / Groove
          (danceability) were noisy and rarely accurate enough to act on
          — kept in the DB and the auto-tag pipeline, just not surfaced
          in the drawer header. */}
      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-1">
          <span className="text-[9px] font-bold text-[#837B6D] uppercase tracking-widest">BPM</span>
          <p className="text-sm font-black text-white font-mono">{track.bpm != null ? track.bpm : '--'}</p>
        </div>
        <div className="space-y-1">
          <span className="text-[9px] font-bold text-[#837B6D] uppercase tracking-widest">Scale</span>
          <p className="text-sm font-black text-white font-mono">{track.key ? `${track.key} ${track.scale || ''}` : '--'}</p>
        </div>
      </div>
    </div>
  );
}
