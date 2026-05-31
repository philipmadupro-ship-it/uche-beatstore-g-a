'use client';

import { Track } from '@/lib/types';
import {
  X, Share, BarChart2, RefreshCw,
  Scissors, PlusSquare, Download, FolderInput, Copy, Trash2,
  Loader2, Mic2, ExternalLink, Sliders, Play, Pause,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ContentShareModal } from '@/components/share/ContentShareModal';
import { usePlayer } from '@/hooks/usePlayer';
import { MiniWaveform } from '@/components/player/MiniWaveform';
import { toast, confirmToast } from '@/hooks/useToast';
import { TrackVersionsPanel } from '@/components/tracks/TrackVersionsPanel';
import { ProjectCommentsPanel } from '@/components/projects/ProjectCommentsPanel';
import { TrackAnalysisSection } from '@/components/tracks/drawer/TrackAnalysisSection';
import { DrawerStemOverlay } from '@/components/tracks/drawer/DrawerStemOverlay';
import { TrackMetadataEditor } from '@/components/tracks/drawer/TrackMetadataEditor';
import { TrackNotesEditor } from '@/components/tracks/drawer/TrackNotesEditor';
import { DrawerActionList } from '@/components/tracks/drawer/DrawerActionList';

// Type/Status options moved into drawer/TrackMetadataEditor along with
// the editor UI itself.

interface TrackDetailsDrawerProps {
  track: Track | null;
  onClose: () => void;
  onUpdate?: () => void;
  /**
   * When the drawer is opened from a project context, pass the project's id
   * here. The drawer surfaces a Track Feedback section pinned to this track
   * inside that project — so reviewers' notes on a specific track show up
   * exactly where the owner is listening. Omitted in library / playlist
   * contexts where comments aren't scoped to a project.
   */
  projectId?: string | null;
}

export function TrackDetailsDrawer({ track: trackProp, onClose, onUpdate, projectId }: TrackDetailsDrawerProps) {
  const { addToQueue, setTrack, currentTrack, isPlaying, setPlaying, progress } = usePlayer();
  const router = useRouter();

  // Optimistic patch overlay. We merge it on top of the parent prop so
  // status/type/notes mutations feel instant. When `onUpdate` refetches and
  // the parent re-supplies a track with our patch already applied, the
  // overlay is naturally a no-op.
  const [optimistic, setOptimistic] = useState<Partial<Track>>({});

  // Reset overlay whenever the user opens a different track.
  useEffect(() => {
    setOptimistic({});
  }, [trackProp?.id]);

  const track = trackProp ? ({ ...trackProp, ...optimistic } as Track) : null;
  const [showStems, setShowStems] = useState(false);
  const [stemData, setStemData] = useState<any>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [stemStatus, setStemStatus] = useState<'idle' | 'processing' | 'ready'>('idle');
  const [stemProgress, setStemProgress] = useState<number>(0);
  const [showShareModal, setShowShareModal] = useState(false);
  const [versionsRefreshKey, setVersionsRefreshKey] = useState(0);

  // Holds the active stem-poll interval so we can clear it on unmount or when
  // the user closes the drawer mid-job. Without this, closing the drawer
  // leaves the poll running forever.
  const stemPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    return () => {
      if (stemPollRef.current) {
        clearInterval(stemPollRef.current);
        stemPollRef.current = null;
      }
    };
  }, []);

  // Notes editor (and its save/rollback) moved to drawer/TrackNotesEditor;
  // optimistic overlay sync still happens here via callbacks.

  // These three hooks were originally declared further down the file, AFTER
  // the `if (!track) return null` early-out. That violates the Rules of Hooks
  // — once `track` flipped to null mid-session, React saw fewer hooks than
  // the previous render and crashed with "Rendered fewer hooks than expected".
  // Move them up so the hook order is invariant regardless of which branch
  // we take below.
  const [view, setView] = useState<'details' | 'insights'>('details');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isReplacing, setIsReplacing] = useState(false);

  if (!track) return null;

  const patchTrack = async (patch: Record<string, any>) => {
    if (!track?.id) return;
    // Snapshot prior values so we can roll back on error
    const prior: Record<string, any> = {};
    for (const k of Object.keys(patch)) prior[k] = (track as any)[k];

    // Optimistic
    setOptimistic((o) => ({ ...o, ...patch }));

    try {
      const res = await fetch(`/api/tracks/${track.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        // Roll back the keys we changed
        setOptimistic((o) => {
          const next = { ...o };
          for (const k of Object.keys(patch)) delete (next as any)[k];
          return next;
        });
        toast.error('Update failed', j.error || `HTTP ${res.status}`);
        return;
      }
      if (onUpdate) onUpdate();
    } catch (err: any) {
      setOptimistic((o) => {
        const next = { ...o };
        for (const k of Object.keys(patch)) delete (next as any)[k];
        return next;
      });
      toast.error('Update failed', err?.message);
    }
  };

  const handleDelete = async () => {
    const ok = await confirmToast(
      `Delete "${track.title}"?`,
      'This permanently removes the track from your library.',
      { confirmLabel: 'Delete', cancelLabel: 'Keep', danger: true },
    );
    if (!ok) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/tracks/${track.id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        if (onUpdate) onUpdate();
        onClose();
      }
    } catch (err) {
      console.error('Delete track error:', err);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleAction = async (label: string) => {
    if (label === 'Split stems' && track.id) {
      if (!track.audio_url) {
        toast.error('No audio file', 'This track has no associated audio file.');
        return;
      }
      setStemStatus('processing');
      setStemProgress(0);
      setShowStems(true);

      try {
        // Submit job to Demucs service via Next.js API
        const res = await fetch('/api/stems', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ trackId: track.id, audioUrl: track.audio_url }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `Failed to start stem split (${res.status})`);
        }

        const { jobId } = await res.json();

        // Clear any prior poll (e.g. user retried before the previous one
        // finished) to avoid stacking duplicate intervals.
        if (stemPollRef.current) clearInterval(stemPollRef.current);

        const startedAt = Date.now();
        const MAX_POLL_MS = 10 * 60 * 1000; // give up after 10 minutes

        const stop = () => {
          if (stemPollRef.current) {
            clearInterval(stemPollRef.current);
            stemPollRef.current = null;
          }
        };

        // Poll every 4 seconds until done or error
        stemPollRef.current = setInterval(async () => {
          try {
            // Hard timeout — Demucs jobs that exceed 10 min are stuck;
            // stop polling so we don't burn requests forever.
            if (Date.now() - startedAt > MAX_POLL_MS) {
              stop();
              setStemStatus('idle');
              setShowStems(false);
              toast.error('Stem separation timed out', 'Job exceeded 10 minutes — try again or check the service logs.');
              return;
            }
            const statusRes = await fetch(`/api/stems/${jobId}`);
            const { job } = await statusRes.json();

            if (!job) return;

            if (typeof job.progress === 'number') {
              // Demucs reports 0..1 sometimes, 0..100 other times — normalize.
              const raw = job.progress;
              const pct = raw <= 1 ? Math.round(raw * 100) : Math.round(raw);
              setStemProgress(Math.max(0, Math.min(99, pct)));
            }

            if (job.status === 'completed' || job.status === 'done') {
              stop();
              setStemData({
                vocals_url: job.stems?.vocals || '',
                drums_url: job.stems?.drums || '',
                bass_url: job.stems?.bass || '',
                other_url: job.stems?.other || '',
              });
              setStemStatus('ready');
            } else if (job.status === 'error' || job.status === 'failed') {
              stop();
              setStemStatus('idle');
              setShowStems(false);
              toast.error('Stem separation failed', job.error || 'Unknown error');
            }
          } catch {
            stop();
            setStemStatus('idle');
          }
        }, 4000);

      } catch (err: any) {
        console.error('Stem split error:', err);
        setStemStatus('idle');
        setShowStems(false);
        // Dispatcher now bubbles a combined "Demucs + Moises" message —
        // surface that verbatim so the user knows which side to fix.
        toast.error(
          'Stem separation unavailable',
          err.message || 'Start the Demucs service or set MOISES_API_KEY.',
        );
      }
    }

    if (label === 'Add to queue' && track) {
      addToQueue(track);
    }

    if (label === 'Export' && track.audio_url) {
      // Route the download through /api/audio?download=1 so the response
      // carries Content-Disposition: attachment. Without that, the
      // browser ignores the <a download> attribute for cross-origin R2
      // URLs and just navigates to the audio file in a new tab — which
      // is what the user reported as "export opens a new page instead
      // of downloading."
      //
      // We sniff the real extension off the audio URL when possible so
      // the saved file matches the source format (wav stays wav, etc.).
      const ext = (track.audio_url.match(/\.(mp3|wav|flac|aiff|aif|m4a|ogg)(?:\?|$)/i)?.[1] || 'mp3').toLowerCase();
      const filename = `${track.title || 'track'}.${ext}`;
      const proxied =
        `/api/audio?src=${encodeURIComponent(track.audio_url)}` +
        `&download=1&filename=${encodeURIComponent(filename)}`;
      const a = document.createElement('a');
      a.href = proxied;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  };

  const handleReplaceAudio = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !track.id) return;

    setIsReplacing(true);
    const formData = new FormData();
    formData.append('file', file);
    formData.append('trackId', track.id);

    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error('Replace failed', json.error || `HTTP ${res.status}`);
        return;
      }
      // Don't close — keep the drawer open so the user can inspect new metadata
      // and navigate to the versions panel. Just refresh the parent list.
      if (onUpdate) onUpdate();
      setVersionsRefreshKey((k) => k + 1);
      toast.success('Replacement saved', 'Previous version archived in History.');
    } catch (err: any) {
      console.error(err);
      toast.error('Replace failed', err?.message);
    } finally {
      setIsReplacing(false);
    }
  };

  const actions = [
    { icon: Share, label: 'Share', color: 'text-blue-400', action: () => setShowShareModal(true) },
    { icon: BarChart2, label: 'Insights', color: 'text-[#E8DCC8]', action: () => setView('insights') },
    // Send to studio — deep-links /studio?track=ID. The studio reads the
    // param on mount via useSearchParams and auto-selects the track. We
    // close the drawer immediately because the destination page IS the
    // new context; leaving the drawer open behind it would be confusing.
    {
      icon: Sliders,
      label: 'Send to studio',
      color: 'text-[#E8D8B8]',
      action: () => {
        router.push(`/studio?track=${track.id}`);
        onClose();
      },
    },
    { icon: RefreshCw, label: 'Replace audio', color: 'text-[#E8DCC8]', action: () => fileInputRef.current?.click() },
    { icon: Scissors, label: 'Split stems', color: 'text-purple-400' },
    { icon: PlusSquare, label: 'Add to queue', color: 'text-[#E8DCC8]' },
    { icon: Download, label: 'Export', color: 'text-[#E8DCC8]' },
    { icon: FolderInput, label: 'Move', color: 'text-[#E8DCC8]' },
    { icon: Copy, label: 'Duplicate', color: 'text-[#E8DCC8]' },
    { icon: Trash2, label: 'Delete', color: 'text-red-500', action: handleDelete },
  ];

  return (
    <>
      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleReplaceAudio} 
        className="hidden" 
        accept="audio/*" 
      />
      
      <div 
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 animate-in fade-in" 
        onClick={onClose}
      />
      <div className="fixed right-0 top-0 bottom-0 w-full sm:w-[420px] bg-[#0c0a08] border-l border-white/[0.04] z-50 flex flex-col shadow-[0_0_50px_-12px_rgba(0,0,0,0.8)] animate-in slide-in-from-right duration-500">
        {/* Glass header — backdrop-blur + radial gradient highlight so the
            top of the drawer reads as a lifted surface, not just another
            dark block stacked on dark. The accent dot in the corner is
            a faint #D4BFA0 wash bleeding from top-left. */}
        <div className="relative p-6 border-b border-white/[0.04] bg-gradient-to-b from-[#161520]/80 via-[#0e0e10]/80 to-[#0a0907]/90 backdrop-blur-xl overflow-hidden">
          <div
            className="absolute -top-12 -left-12 w-40 h-40 rounded-full pointer-events-none opacity-30"
            style={{ background: 'radial-gradient(circle, #D4BFA0 0%, transparent 70%)' }}
          />
          <div className="relative z-10 flex items-start justify-between w-full gap-3">
            <div className="min-w-0 flex-1">
              {/* Tab switcher */}
              <div className="flex items-center gap-2 mb-3">
                <button
                  onClick={() => setView('details')}
                  className={`text-[9px] font-black uppercase tracking-[0.2em] px-3 py-1 rounded-md transition-all ${view === 'details' ? 'bg-[#D4BFA0] text-black shadow-lg shadow-[#D4BFA0]/20' : 'bg-[#1a160f] text-[#4a4338] hover:text-[#a08a6a]'}`}
                >
                  Details
                </button>
                <button
                  onClick={() => setView('insights')}
                  className={`text-[9px] font-black uppercase tracking-[0.2em] px-3 py-1 rounded-md transition-all ${view === 'insights' ? 'bg-[#D4BFA0] text-black shadow-lg shadow-[#D4BFA0]/20' : 'bg-[#1a160f] text-[#4a4338] hover:text-[#a08a6a]'}`}
                >
                  Insights
                </button>
              </div>
              {/* Title */}
              <h2 className="text-xl font-black text-white uppercase tracking-tighter truncate leading-none mb-2">{track.title}</h2>
              {/* Key / BPM / type meta strip */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[9px] font-mono uppercase tracking-widest text-[#6a5d4a] bg-[#1a160f] border border-[#2d2620] px-2 py-0.5 rounded">
                  {track.type}
                </span>
                {track.bpm && (
                  <span className="text-[9px] font-mono text-[#a08a6a] bg-[#1a160f] border border-[#2d2620] px-2 py-0.5 rounded tabular-nums">
                    {track.bpm} BPM
                  </span>
                )}
                {track.key && (
                  <span className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded ${
                    track.scale === 'minor'
                      ? 'text-[#9d95e8] bg-[#1a1833]/60 border border-[#534AB7]/30'
                      : 'text-[#c8a47a] bg-[#1f1a10]/60 border border-[#3d3020]/40'
                  }`}>
                    {track.key}{track.scale === 'minor' ? 'm' : ''}
                  </span>
                )}
                {track.duration_seconds != null && track.duration_seconds > 0 && (
                  <span className="text-[9px] font-mono text-[#4a4338] ml-auto tabular-nums">
                    {Math.floor(track.duration_seconds / 60)}:{String(Math.floor(track.duration_seconds % 60)).padStart(2, '0')}
                  </span>
                )}
              </div>
            </div>
            <button onClick={onClose} className="text-[#4a4338] hover:text-[#E8DCC8] transition-colors p-2 bg-white/[0.04] rounded-xl border border-white/[0.06] hover:border-white/20 backdrop-blur-sm shrink-0 mt-1">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {view === 'insights' ? (
            <div className="p-6 space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
              {/* Top stat cards — BPM + Key large */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-[#0a0907] border border-[#1f1a13] rounded-2xl p-4">
                  <span className="text-[9px] font-black text-[#4a4338] uppercase tracking-widest block mb-1">BPM</span>
                  <p className="text-3xl font-black text-white leading-none font-mono">{track.bpm ?? '—'}</p>
                </div>
                <div className={`rounded-2xl p-4 ${
                  track.scale === 'minor'
                    ? 'bg-[#1a1833]/40 border border-[#534AB7]/20'
                    : 'bg-[#1f1a10]/40 border border-[#3d3020]/30'
                }`}>
                  <span className="text-[9px] font-black text-[#4a4338] uppercase tracking-widest block mb-1">Key</span>
                  <p className={`text-3xl font-black leading-none font-mono ${
                    track.scale === 'minor' ? 'text-[#9d95e8]' : 'text-[#c8a47a]'
                  }`}>
                    {track.key ? `${track.key}${track.scale === 'minor' ? 'm' : ''}` : '—'}
                  </p>
                  {track.scale && (
                    <span className={`text-[8px] font-mono uppercase tracking-wider mt-1 block ${
                      track.scale === 'minor' ? 'text-[#534AB7]' : 'text-[#6a5a3a]'
                    }`}>{track.scale}</span>
                  )}
                </div>
              </div>

              {/* Chord progression (mig 078) — detect client-side, sync to playback */}
              <ChordSection
                track={track}
                isActive={currentTrack?.id === track.id}
                progress={progress}
                onSaved={(chords) => setOptimistic((o) => ({ ...o, chords }))}
              />

              {/* Percentage meters */}
              {(() => {
                const bars = [
                  { label: 'Energy', value: track.energy, color: '#e87a5a' },
                  { label: 'Groove', value: track.danceability, color: '#D4BFA0' },
                  { label: 'Mood', value: track.valence, color: '#9d95e8' },
                  { label: 'Acoustic', value: track.acousticness, color: '#8ecf9f' },
                ].filter((b) => b.value != null);
                if (!bars.length) return null;
                return (
                  <div className="bg-[#0a0907] border border-[#1f1a13] rounded-2xl p-4 space-y-3">
                    <h3 className="text-[9px] font-black uppercase tracking-[0.3em] text-[#4a4338] mb-3">Vibe Analysis</h3>
                    {bars.map(({ label, value, color }) => {
                      const pct = Math.round((value as number) * 100);
                      return (
                        <div key={label}>
                          <div className="flex justify-between items-baseline mb-1">
                            <span className="text-[9px] font-mono uppercase tracking-wider text-[#6a5d4a]">{label}</span>
                            <span className="text-[10px] font-mono font-bold tabular-nums" style={{ color }}>{pct}%</span>
                          </div>
                          <div className="h-1.5 bg-[#1a160f] rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-700"
                              style={{ width: `${pct}%`, backgroundColor: color, opacity: 0.85 }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}

              {/* Loudness */}
              {track.loudness != null && (
                <div className="bg-[#0a0907] border border-[#1f1a13] rounded-2xl p-4 flex items-center justify-between">
                  <span className="text-[9px] font-black text-[#4a4338] uppercase tracking-widest">Loudness</span>
                  <span className="text-[13px] font-mono font-bold text-[#E8DCC8] tabular-nums">{track.loudness} LUFS</span>
                </div>
              )}

              {/* File info */}
              <div className="bg-[#0a0907] border border-[#1f1a13] rounded-2xl p-4 space-y-2.5">
                <h3 className="text-[9px] font-black uppercase tracking-[0.3em] text-[#4a4338] mb-3">File Info</h3>
                {[
                  { label: 'Type', value: track.type?.toUpperCase() ?? '—' },
                  { label: 'Duration', value: track.duration_seconds ? `${Math.floor(track.duration_seconds / 60)}:${String(Math.floor(track.duration_seconds % 60)).padStart(2, '0')}` : '—' },
                  { label: 'Rating', value: track.rating ? `${track.rating} / 5 ★` : 'Unrated' },
                  { label: 'Added', value: new Date(track.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) },
                ].map(({ label, value }) => (
                  <div key={label} className="flex justify-between items-center">
                    <span className="text-[9px] font-black text-[#4a4338] uppercase tracking-widest">{label}</span>
                    <span className="text-[11px] font-mono text-[#E8DCC8]">{value}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <>
              {/* Waveform transport — visual only.
                  WavePlayer is intentionally NOT used here: mounting two
                  WaveSurfer instances for the same trackId (one here, one
                  in PlayerBar) both satisfy isActiveAudio = true and produce
                  double audio. MiniWaveform reads global progress from
                  Zustand and triggers seek via the store — zero extra audio. */}
              <div className="p-6 border-b border-[#1f1a13] bg-[#0a0907] relative">
                {track.audio_url ? (() => {
                  const isActive = currentTrack?.id === track.id;
                  const dur = track.duration_seconds ?? 0;
                  const currentSec = isActive ? progress * dur : 0;
                  const fmt = (s: number) =>
                    isFinite(s) && s >= 0
                      ? `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`
                      : '0:00';
                  return (
                    <div className="flex items-center gap-3">
                      {/* Play / pause button — controls global player */}
                      <button
                        type="button"
                        onClick={() => {
                          if (!isActive) {
                            setTrack(track);
                          } else {
                            setPlaying(!isPlaying);
                          }
                        }}
                        className="w-9 h-9 rounded-full bg-[#16130e] border border-[#1a160f] flex items-center justify-center text-[#E8DCC8] hover:border-[#D4BFA0]/50 hover:text-[#D4BFA0] transition-all shrink-0"
                      >
                        {isActive && isPlaying
                          ? <Pause size={14} fill="currentColor" />
                          : <Play size={14} fill="currentColor" className="ml-0.5" />}
                      </button>

                      <span className="text-[10px] font-mono text-[#5a5142] tabular-nums w-10 text-right shrink-0">
                        {fmt(currentSec)}
                      </span>

                      <div className="flex-1 min-w-0">
                        <MiniWaveform
                          trackId={track.id}
                          peaksUrl={track.peaks_url ?? null}
                          height={52}
                          isActive={isActive}
                          onPlay={() => setTrack(track)}
                        />
                      </div>

                      <span className="text-[10px] font-mono text-[#5a5142] tabular-nums w-10 shrink-0">
                        {fmt(dur)}
                      </span>
                    </div>
                  );
                })() : (
                  <div className="w-full h-[60px] bg-[#1a160f] rounded flex items-center justify-center text-[10px] font-mono uppercase text-[#4a4338] tracking-widest">
                    No audio source
                  </div>
                )}
                {isReplacing && (
                  <div className="absolute inset-0 bg-[#0a0907]/80 backdrop-blur-sm flex flex-col items-center justify-center p-6 animate-in fade-in">
                    <Loader2 size={32} className="animate-spin text-[#D4BFA0] mb-4" />
                    <p className="text-[10px] font-black uppercase tracking-[0.4em] text-white">Replacing Source Asset</p>
                  </div>
                )}
              </div>

              {/* Lyrics + word tools entry point */}
              <div className="px-8 pt-6 pb-4 border-b border-[#1f1a13]">
                <Link
                  href={`/library/${track.id}#lyrics`}
                  onClick={onClose}
                  className="group flex items-center gap-4 p-4 rounded-xl bg-gradient-to-r from-[#2A2418] to-[#0f0f1a] border border-[#8A7A5C]/30 hover:border-[#D4BFA0]/60 transition-all"
                >
                  <div className="w-10 h-10 rounded-lg bg-[#0a0907] border border-[#8A7A5C]/40 flex items-center justify-center text-[#E8D8B8]">
                    <Mic2 size={16} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-black uppercase tracking-[0.2em] text-white">Lyrics Studio</p>
                    <p className="text-[10px] text-[#a08a6a] mt-1 leading-tight">
                      Write with rhymes · synonyms · dictionary · syllable counter
                    </p>
                  </div>
                  <ExternalLink size={14} className="text-[#6a5d4a] group-hover:text-[#E8D8B8] transition-colors shrink-0" />
                </Link>
              </div>

              {/* Private notes — extracted to drawer/TrackNotesEditor.
                  Drives optimistic/rollback through the drawer's overlay
                  so the parent doesn't have to refetch on every blur. */}
              <TrackNotesEditor
                track={track}
                onOptimistic={(n) => setOptimistic((o) => ({ ...o, notes: n }))}
                onRollback={() => setOptimistic((o) => {
                  const { notes: _n, ...rest } = o;
                  return rest;
                })}
                onSaved={onUpdate}
              />

              {/* Type / Status / Rating — extracted to drawer/TrackMetadataEditor. */}
              <TrackMetadataEditor
                track={track}
                onPatch={patchTrack}
                onRatingChange={(newRating) => {
                  setOptimistic((o) => ({ ...o, rating: newRating }));
                  if (onUpdate) onUpdate();
                }}
              />

              {/* Asset Intelligence — extracted to drawer/TrackAnalysisSection. */}
              <TrackAnalysisSection track={track} onUpdate={onUpdate} />

              {/* Track feedback — only shows when the drawer is opened from
                  a project (projectId provided). Comments pinned to this
                  track inside that project surface here, so reviewers'
                  notes appear exactly where the owner is listening. */}
              {projectId && (
                <div className="border-b border-[#1f1a13] px-8 py-5">
                  <div className="flex items-center gap-2 mb-3">
                    <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-[#a08a6a]">
                      Track feedback
                    </h3>
                  </div>
                  <ProjectCommentsPanel
                    projectId={projectId}
                    pinnedTrackId={track.id}
                    compact
                  />
                </div>
              )}

              {/* Version history */}
              <TrackVersionsPanel
                trackId={track.id}
                trackTitle={track.title}
                refreshKey={versionsRefreshKey}
                onReverted={() => {
                  if (onUpdate) onUpdate();
                }}
              />

              {/* Actions — extracted to drawer/DrawerActionList. */}
              <DrawerActionList actions={actions} onAction={handleAction} disabled={isDeleting} />
            </>
          )}
        </div>
      </div>

      {/* Stem Player Overlay — extracted to drawer/DrawerStemOverlay.
          The drawer keeps the job-submission + poll loop; the overlay
          is purely presentational. */}
      <DrawerStemOverlay
        open={showStems}
        status={stemStatus}
        progress={stemProgress}
        data={stemData}
        onClose={() => { setShowStems(false); setStemData(null); setStemStatus('idle'); }}
      />

      {showShareModal && track && (
        <ContentShareModal
          onClose={() => setShowShareModal(false)}
          contentType="track"
          contentId={track.id}
          contentTitle={track.title}
          coverUrl={track.cover_url}
        />
      )}

      <style jsx>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 0px;
        }
      `}</style>
    </>
  );
}

/**
 * ChordSection — detect + display a chord timeline (mig 078, Task 8).
 *
 * "Detect chords" runs Essentia HPCP analysis in the browser, POSTs the result
 * to /api/tracks/[id]/analyze (chord-only path), and renders the progression
 * as chips. When the track is the active player track, the chip under the
 * current playback position highlights in real time.
 */
function ChordSection({
  track,
  isActive,
  progress,
  onSaved,
}: {
  track: Track;
  isActive: boolean;
  progress: number;
  onSaved: (chords: Array<{ time: number; chord: string }>) => void;
}) {
  const [detecting, setDetecting] = useState(false);
  const chords = track.chords ?? [];
  const dur = track.duration_seconds ?? 0;
  const currentSec = isActive ? progress * dur : 0;

  // Index of the chord segment currently playing (last segment whose start
  // time is <= currentSec).
  let activeIdx = -1;
  if (isActive && chords.length) {
    for (let i = 0; i < chords.length; i++) {
      if (chords[i].time <= currentSec) activeIdx = i;
      else break;
    }
  }

  const detect = async () => {
    if (detecting || !track.audio_url) return;
    setDetecting(true);
    try {
      const { detectChordsFromUrl } = await import('@/lib/audio/chords.client');
      const result = await detectChordsFromUrl(track.audio_url);
      if (!result.length) {
        toast.error('No chords detected', 'The track may be too quiet or percussive to analyze.');
        return;
      }
      const res = await fetch(`/api/tracks/${track.id}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chords: result }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      onSaved(result);
      toast.success('Chords detected', `${result.length} chord changes mapped.`);
    } catch (err: any) {
      toast.error('Chord detection failed', err?.message || 'Try again.');
    } finally {
      setDetecting(false);
    }
  };

  return (
    <div className="bg-[#0a0907] border border-[#1f1a13] rounded-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[9px] font-black uppercase tracking-[0.3em] text-[#4a4338]">Chords</h3>
        <button
          onClick={detect}
          disabled={detecting || !track.audio_url}
          className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-[0.2em] px-2.5 py-1 rounded-md bg-[#1a160f] text-[#a08a6a] hover:text-[#E8DCC8] hover:bg-[#241e15] transition-all disabled:opacity-40"
        >
          {detecting ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
          {detecting ? 'Detecting' : chords.length ? 'Re-detect' : 'Detect chords'}
        </button>
      </div>
      {chords.length ? (
        <div className="flex flex-wrap gap-1.5">
          {chords.map((c, i) => (
            <span
              key={`${c.time}-${i}`}
              title={`${Math.floor(c.time / 60)}:${String(Math.floor(c.time % 60)).padStart(2, '0')}`}
              className={`px-2 py-1 rounded-md text-[11px] font-mono font-bold tabular-nums transition-all duration-200 ${
                i === activeIdx
                  ? 'bg-[#D4BFA0] text-black scale-105 shadow-lg shadow-[#D4BFA0]/20'
                  : 'bg-[#14110d] text-[#a08a6a] border border-[#1f1a13]'
              }`}
            >
              {c.chord}
            </span>
          ))}
        </div>
      ) : (
        <p className="text-[10px] text-[#5a5142] leading-relaxed">
          {track.audio_url
            ? 'No chords yet. Detect the progression to render a timeline that follows playback.'
            : 'Upload audio to detect chords.'}
        </p>
      )}
    </div>
  );
}
