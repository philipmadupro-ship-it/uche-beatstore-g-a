'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, Square, Loader2, Trash2, Play, Pause, AudioLines } from 'lucide-react';
import { toast } from '@/hooks/useToast';
import { cn } from '@/lib/utils';
import { useReducedMotion } from '@/hooks/useReducedMotion';

/**
 * Topline recorder — a quick voice-memo session inside the Lyrics Studio
 * notes. Producers/writers hum or sing a melody idea over the beat and it's
 * captured straight from the mic (MediaRecorder), uploaded, and kept attached
 * to the track.
 *
 * Reuses the track_stem_files table/API (migration 080) with category
 * 'topline', so these never appear as deliverable stems or leak to shares —
 * they're idea scratch, listed + playable + deletable here only.
 */

interface Topline {
  id: string;
  label: string;
  url: string;
  created_at: string;
}

interface StemFile extends Topline {
  category?: string | null;
}

function isToplineFile(file: unknown): file is StemFile {
  return typeof file === 'object' &&
    file !== null &&
    'category' in file &&
    (file as { category?: unknown }).category === 'topline' &&
    typeof (file as { id?: unknown }).id === 'string' &&
    typeof (file as { label?: unknown }).label === 'string' &&
    typeof (file as { url?: unknown }).url === 'string' &&
    typeof (file as { created_at?: unknown }).created_at === 'string';
}

function pickMime(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  const prefs = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
  return prefs.find((m) => MediaRecorder.isTypeSupported?.(m)) ?? '';
}
function extFor(mime: string): string {
  if (mime.includes('mp4')) return 'm4a';
  if (mime.includes('ogg')) return 'ogg';
  return 'webm';
}

export function ToplineRecorder({ trackId }: { trackId: string }) {
  const reducedMotion = useReducedMotion();
  const [items, setItems] = useState<Topline[]>([]);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/tracks/${trackId}/stem-files`, { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      const files = Array.isArray(data.files) ? data.files : [];
      setItems(files.filter(isToplineFile));
    } catch {
      // best-effort
    }
  }, [trackId]);

  useEffect(() => { load(); }, [load]);

  // Clean up mic + timer if the component unmounts mid-record.
  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  const upload = async (blob: Blob, mime: string) => {
    setUploading(true);
    try {
      const ext = extFor(mime);
      const label = `Topline ${new Date().toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
      const file = new File([blob], `topline-${Date.now()}.${ext}`, { type: mime || 'audio/webm' });
      const fd = new FormData();
      fd.append('file', file);
      fd.append('label', label);
      fd.append('category', 'topline');
      const res = await fetch(`/api/tracks/${trackId}/stem-files`, { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      toast.success('Topline saved');
      load();
    } catch (err) {
      toast.error('Couldn’t save topline', err instanceof Error ? err.message : 'Try again');
    } finally {
      setUploading(false);
    }
  };

  const start = async () => {
    if (recording || uploading) return;
    if (typeof MediaRecorder === 'undefined') {
      toast.error('Recording not supported', 'This browser has no MediaRecorder.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = pickMime();
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        const type = rec.mimeType || mime || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type });
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        if (blob.size > 0) upload(blob, type);
      };
      recorderRef.current = rec;
      rec.start();
      setRecording(true);
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
    } catch {
      toast.error('Mic access denied', 'Allow microphone access to record a topline.');
    }
  };

  const stop = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    recorderRef.current?.stop();
    setRecording(false);
  };

  const togglePlay = (t: Topline) => {
    if (playingId === t.id) {
      audioRef.current?.pause();
      setPlayingId(null);
      return;
    }
    if (!audioRef.current) audioRef.current = new Audio();
    audioRef.current.src = `/api/audio?src=${encodeURIComponent(t.url)}`;
    audioRef.current.onended = () => setPlayingId(null);
    audioRef.current.play().then(() => setPlayingId(t.id)).catch(() => setPlayingId(null));
  };

  const remove = async (t: Topline) => {
    try {
      const res = await fetch(`/api/tracks/${trackId}/stem-files?file_id=${t.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (playingId === t.id) { audioRef.current?.pause(); setPlayingId(null); }
      load();
    } catch (err) {
      toast.error('Couldn’t delete', err instanceof Error ? err.message : 'Try again');
    }
  };

  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
      <div className="flex items-center gap-2 mb-2.5">
        <AudioLines size={11} className="text-white/80" />
        <span className="text-[9px] font-mono uppercase tracking-[0.2em] text-white/60">Topline</span>
        {items.length > 0 && <span className="text-[9px] font-mono text-white/30">· {items.length}</span>}
        <div className="flex-1" />
        {recording ? (
          <button
            onClick={stop}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-[#e88a8a]/15 border border-[#e88a8a]/40 text-[#e88a8a] text-[10px] font-medium hover:bg-[#e88a8a]/25 transition-colors"
          >
            <Square size={11} fill="currentColor" />
            Stop · {mmss(elapsed)}
            <span className={`w-1.5 h-1.5 rounded-full bg-[#e88a8a] ml-0.5 ${reducedMotion ? '' : 'animate-pulse'}`} />
          </button>
        ) : (
          <button
            onClick={start}
            disabled={uploading}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-white/10 border border-white/20 text-white text-[10px] font-medium hover:bg-[#332b1d] transition-colors disabled:opacity-50"
          >
            {uploading ? <Loader2 size={11} className="animate-spin" /> : <Mic size={11} />}
            {uploading ? 'Saving…' : 'Record topline'}
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <p className="text-[10px] text-white/40 leading-relaxed">
          Hum or sing a melody idea over the beat — it records from your mic and stays attached to this track. Not a deliverable stem.
        </p>
      ) : (
        <div className="space-y-1.5">
          {items.map((t) => (
            <div key={t.id} className="flex items-center gap-2.5 px-2.5 py-2 rounded-md bg-white/[0.04] border border-white/10">
              <button
                onClick={() => togglePlay(t)}
                className={cn('w-7 h-7 rounded-full flex items-center justify-center shrink-0 transition-colors',
                  playingId === t.id ? 'glass-play-surface' : 'bg-white/[0.05] text-white/80 hover:text-white')}
                aria-label={playingId === t.id ? 'Pause' : 'Play'}
              >
                {playingId === t.id ? <Pause size={12} fill="currentColor" /> : <Play size={12} fill="currentColor" className="ml-0.5" />}
              </button>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] text-white truncate">{t.label}</p>
              </div>
              <button onClick={() => remove(t)} className="text-white/40 hover:text-red-400 transition-colors shrink-0" aria-label="Delete topline">
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
