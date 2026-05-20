'use client';

import { Track } from '@/lib/types';
import {
  X, Share, BarChart2, RefreshCw,
  Scissors, PlusSquare, Download, FolderInput, Copy, Trash2,
  Loader2, Mic2, ExternalLink, Sliders,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ShareModal } from '@/components/share/ShareModal';
import { usePlayer } from '@/hooks/usePlayer';
import { WavePlayer } from '@/components/player/WavePlayer';
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
  const { addToQueue, setTrack } = usePlayer();
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
      <div className="fixed right-0 top-0 bottom-0 w-[420px] bg-[#0c0a08] border-l border-white/[0.04] z-50 flex flex-col shadow-[0_0_50px_-12px_rgba(0,0,0,0.8)] animate-in slide-in-from-right duration-500">
        {/* Glass header — backdrop-blur + radial gradient highlight so the
            top of the drawer reads as a lifted surface, not just another
            dark block stacked on dark. The accent dot in the corner is
            a faint #D4BFA0 wash bleeding from top-left. */}
        <div className="relative p-8 border-b border-white/[0.04] bg-gradient-to-b from-[#161520]/80 via-[#0e0e10]/80 to-[#0a0907]/90 backdrop-blur-xl overflow-hidden">
          <div
            className="absolute -top-12 -left-12 w-40 h-40 rounded-full pointer-events-none opacity-30"
            style={{ background: 'radial-gradient(circle, #D4BFA0 0%, transparent 70%)' }}
          />
          {/* Inner wrap pinned above the gradient so content reads cleanly. */}
          <div className="relative z-10 flex items-center justify-between w-full">
          <div className="min-w-0">
             <div className="flex items-center gap-2 mb-2">
                <button 
                  onClick={() => setView('details')}
                  className={`text-[9px] font-black uppercase tracking-[0.2em] px-3 py-1 rounded-md transition-all ${view === 'details' ? 'bg-[#D4BFA0] text-white shadow-lg shadow-[#D4BFA0]/20' : 'bg-[#1a160f] text-[#4a4338] hover:text-[#a08a6a]'}`}
                >
                  Project
                </button>
                <button 
                  onClick={() => setView('insights')}
                  className={`text-[9px] font-black uppercase tracking-[0.2em] px-3 py-1 rounded-md transition-all ${view === 'insights' ? 'bg-[#D4BFA0] text-white shadow-lg shadow-[#D4BFA0]/20' : 'bg-[#1a160f] text-[#4a4338] hover:text-[#a08a6a]'}`}
                >
                  Insights
                </button>
             </div>
            <h2 className="text-2xl font-black text-white uppercase tracking-tighter truncate leading-none">{track.title}</h2>
          </div>
          <button onClick={onClose} className="text-[#4a4338] hover:text-[#E8DCC8] transition-colors p-2 bg-white/[0.04] rounded-xl border border-white/[0.06] hover:border-white/20 backdrop-blur-sm">
            <X size={20} />
          </button>
          </div> {/* end inner wrap */}
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {view === 'insights' ? (
            <div className="p-8 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div>
                <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-[#4a4338] mb-6">Audio Intelligence</h3>
                <div className="grid grid-cols-2 gap-4">
                  {[
                    { label: 'BPM', value: track.bpm ?? '--' },
                    { label: 'Key', value: track.key ? `${track.key} ${track.scale || ''}`.trim() : '--' },
                    { label: 'Energy', value: track.energy != null ? `${Math.round(track.energy * 100)}%` : '--' },
                    { label: 'Groove', value: track.danceability != null ? `${Math.round(track.danceability * 100)}%` : '--' },
                    { label: 'Valence', value: track.valence != null ? `${Math.round(track.valence * 100)}%` : '--' },
                    { label: 'Loudness', value: track.loudness != null ? `${track.loudness} LUFS` : '--' },
                  ].map(({ label, value }) => (
                    <div key={label} className="bg-[#0a0907] border border-[#1f1a13] rounded-2xl p-5">
                      <span className="text-[9px] font-black text-[#4a4338] uppercase tracking-widest block mb-2">{label}</span>
                      <p className="text-2xl font-black text-white leading-none font-mono">{value}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-[#4a4338] mb-4">File Info</h3>
                <div className="space-y-3 text-[11px] font-mono">
                  {[
                    { label: 'Type', value: track.type?.toUpperCase() ?? '--' },
                    { label: 'Duration', value: track.duration_seconds ? `${Math.floor(track.duration_seconds / 60)}:${String(Math.floor(track.duration_seconds % 60)).padStart(2, '0')}` : '--' },
                    { label: 'Rating', value: track.rating ? `${track.rating} / 5` : 'Unrated' },
                    { label: 'Added', value: new Date(track.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex justify-between text-[#a08a6a]">
                      <span className="text-[#4a4338] uppercase tracking-widest text-[9px] font-black">{label}</span>
                      <span className="text-[#E8DCC8]">{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* Waveform Player */}
              <div className="p-8 border-b border-[#1f1a13] bg-[#0a0907] relative group">
                {track.audio_url ? (
                  <WavePlayer
                    url={track.audio_url}
                    trackId={track.id}
                    track={track}
                    peaksUrl={track.peaks_url ?? null}
                    height={60}
                    onFinish={() => {}}
                  />
                ) : (
                  <div className="w-full h-[60px] bg-[#1a160f] rounded flex items-center justify-center text-[10px] font-mono uppercase text-[#4a4338] tracking-widest">
                    No audio source
                  </div>
                )}
                {isReplacing && (
                  <div className="absolute inset-0 bg-[#0a0907]/80 backdrop-blur-sm flex flex-col items-center justify-center p-8 animate-in fade-in">
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
        <ShareModal
          onClose={() => setShowShareModal(false)}
          title={track.title}
          trackIds={[track.id]}
          coverUrl={track.cover_url}
          kind="track"
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
