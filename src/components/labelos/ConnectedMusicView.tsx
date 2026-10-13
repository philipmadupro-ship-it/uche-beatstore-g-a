'use client';

/**
 * The music a connected artist org shares with this label (LABEL-41), as a
 * member of the label sees it: shared projects, and in each the recordings
 * THIS member may hear (D4 runs with their own permissions on the server, so
 * a marketing member simply sees fewer). Read-only: everything plays through
 * the persistent PlayerBar from `/api/org/<label>/audio/<track>`, and the
 * only thing that leaves the artist org is a copy the artist allowed
 * ("Use in a label song", D6) — a new track in this label, with its source
 * noted, that never changes the original.
 */
import { useState } from 'react';
import { Copy, Music, Pause, Play } from 'lucide-react';
import { usePlayer } from '@/hooks/usePlayer';
import { toast } from '@/hooks/useToast';
import { connectedRecordingPlayerTrack, type ConnectedMusic, type ConnectedRecording } from '@/lib/labelos/connections';

const LABEL = 'text-[10px] font-mono uppercase tracking-[0.2em] text-white/40';

function duration(seconds: number | null): string | null {
  if (!seconds || seconds <= 0) return null;
  return `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;
}

function facts(rec: ConnectedRecording): string {
  return [rec.type, rec.bpm ? `${Math.round(rec.bpm)} BPM` : null, rec.key ? `${rec.key}${rec.scale ? ` ${rec.scale}` : ''}` : null, duration(rec.durationSeconds)]
    .filter(Boolean)
    .join(' · ');
}

export function ConnectedMusicView({ orgId, music }: { orgId: string; music: ConnectedMusic }) {
  const currentId = usePlayer((s) => s.currentTrack?.id ?? null);
  const isPlaying = usePlayer((s) => s.isPlaying);
  const [copying, setCopying] = useState<string | null>(null);
  const [copied, setCopied] = useState<Set<string>>(new Set());

  const toggle = (rec: ConnectedRecording, projectName: string) => {
    if (currentId === rec.id) {
      usePlayer.getState().togglePlay();
      return;
    }
    usePlayer.getState().setTrack(connectedRecordingPlayerTrack(orgId, rec, projectName));
  };

  const copy = async (rec: ConnectedRecording) => {
    setCopying(rec.id);
    try {
      const res = await fetch(`/api/org/${orgId}/tracks/copy`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source: { kind: 'connection', track_id: rec.id } }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error('Could not copy', body.error);
        return;
      }
      setCopied((cur) => new Set(cur).add(rec.id));
      toast.success('Copied into your label', 'It keeps a note of where it came from. The original is unchanged.');
    } catch {
      toast.error('Could not reach the server');
    } finally {
      setCopying(null);
    }
  };

  if (music.projects.length === 0) {
    return <p className="rounded-xl border border-white/10 bg-[#0D0D0A] px-4 py-5 text-center text-[11px] text-white/40">Nothing is shared with you yet.</p>;
  }

  return (
    <div className="space-y-8">
      {music.projects.map((p) => (
        <section key={p.id} aria-label={p.name} data-testid={`connected-project-${p.id}`}>
          <h2 className={`${LABEL} mb-3`}>{p.isInbox ? `${p.name} · inbox` : p.name}</h2>
          {p.recordings.length === 0 ? (
            <p className="text-[11px] text-white/40">No recordings you can hear in this project.</p>
          ) : (
            <ul className="divide-y divide-white/10 overflow-hidden rounded-xl border border-white/10 bg-[#0D0D0A]">
              {p.recordings.map((rec) => {
                const active = currentId === rec.id;
                return (
                  <li key={rec.id} className="flex items-center gap-3 px-4 py-3" data-testid={`connected-recording-${rec.id}`}>
                    <button
                      type="button"
                      onClick={() => toggle(rec, p.name)}
                      aria-label={active && isPlaying ? `Pause ${rec.title}` : `Play ${rec.title}`}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 text-white/80 transition-colors hover:border-white/20 hover:bg-white/[0.10]"
                    >
                      {active && isPlaying ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
                    </button>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 truncate text-[13px] text-white/80">
                        <Music size={12} aria-hidden="true" className="shrink-0 text-white/30" />
                        <span className="truncate">{rec.title}</span>
                      </span>
                      <span className="mt-1 block truncate text-[11px] text-white/40">{facts(rec)}</span>
                    </span>
                    {rec.canCopy && (
                      <button
                        type="button"
                        onClick={() => void copy(rec)}
                        disabled={copying === rec.id || copied.has(rec.id)}
                        className="inline-flex min-h-9 shrink-0 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.06] px-3 text-[10px] text-white/80 transition-colors hover:border-white/20 hover:bg-white/[0.10] disabled:opacity-40"
                      >
                        <Copy size={12} aria-hidden="true" />
                        {copied.has(rec.id) ? 'Copied' : 'Use in a label song'}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
