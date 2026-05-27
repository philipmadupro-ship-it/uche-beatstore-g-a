'use client';

/**
 * "Beat Match" — buyer (rapper, vocalist) drops a 30s vocal clip or
 * records one directly, and the server returns the producer's beats
 * that match the clip's tempo. Server-side BPM extraction via
 * audio-decode + music-tempo, scored against tracks.bpm with
 * half-time / double-time forgiveness.
 *
 * Two input paths:
 *   • Upload — <input type="file">
 *   • Record — MediaRecorder + getUserMedia (max 30s), Chromium / FF
 *              / Safari (recent) supported.
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Wand2, X, Loader2, Mic, Upload, Music, ShoppingBag, Square,
} from 'lucide-react';
import { toast } from '@/hooks/useToast';

interface MatchTrack {
  id: string;
  title: string;
  cover_url: string | null;
  bpm: number | null;
  key: string | null;
  scale: string | null;
  type: string | null;
  lease_price_usd: number | null;
  exclusive_price_usd: number | null;
  free_download_enabled: boolean | null;
}

interface MatchResult {
  bpm: number;
  duration?: number;
  matches: Array<{ track: MatchTrack; score: number; reasons: string[] }>;
}

const MAX_RECORD_SECS = 30;

export function BeatMatchModal({
  accentColor = '#D4BFA0',
}: { accentColor?: string }) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'analyzing' | 'done' | 'error'>('idle');
  const [result, setResult] = useState<MatchResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Recording state
  const [recording, setRecording] = useState(false);
  const [recordSecs, setRecordSecs] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const router = useRouter();

  const reset = () => {
    setPhase('idle');
    setResult(null);
    setErrorMsg(null);
  };

  useEffect(() => {
    if (!open) {
      reset();
      stopRecording(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /* ── Submit a blob to the server for matching ── */
  const submitClip = async (file: File | Blob) => {
    setPhase('analyzing');
    setResult(null);
    setErrorMsg(null);
    try {
      const formData = new FormData();
      const namedFile = file instanceof File
        ? file
        : new File([file], 'recording.webm', { type: file.type || 'audio/webm' });
      formData.append('clip', namedFile);
      const res = await fetch('/api/store/beat-match', {
        method: 'POST',
        body: formData,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setResult(json as MatchResult);
      setPhase('done');
    } catch (err) {
      setErrorMsg((err as Error)?.message ?? 'Match failed');
      setPhase('error');
      toast.error('Could not match', (err as Error)?.message ?? 'Try a different clip');
    }
  };

  /* ── File upload ── */
  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    submitClip(f);
    e.target.value = '';
  };

  /* ── Recording ── */
  const startRecording = async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices) {
      toast.error('Microphone unavailable');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';
      const rec = new MediaRecorder(stream, { mimeType: mime });
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: mime });
        submitClip(blob);
      };
      mediaRecorderRef.current = rec;
      rec.start();
      setRecording(true);
      setRecordSecs(0);
      recordTimerRef.current = setInterval(() => {
        setRecordSecs((s) => {
          const next = s + 1;
          if (next >= MAX_RECORD_SECS) stopRecording(false);
          return next;
        });
      }, 1000);
    } catch (err) {
      toast.error('Mic permission denied', (err as Error)?.message ?? '');
    }
  };

  const stopRecording = (cancel: boolean) => {
    const rec = mediaRecorderRef.current;
    if (recordTimerRef.current) clearInterval(recordTimerRef.current);
    recordTimerRef.current = null;
    setRecording(false);
    if (!rec) return;
    if (cancel) {
      try { rec.ondataavailable = null as any; rec.onstop = null as any; rec.stop(); } catch {/* noop */}
    } else if (rec.state === 'recording') {
      rec.stop();
    }
    mediaRecorderRef.current = null;
  };

  /* ── Render ── */
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Find beats that match your vocal"
        className="flex items-center gap-1.5 px-3 py-2 rounded-full border border-white/[0.10] text-[#E8DCC8] text-[11px] font-mono uppercase tracking-[0.18em] hover:bg-white/[0.04] transition-colors"
        style={{ boxShadow: `0 0 0 1px ${accentColor}33` }}
      >
        <Wand2 size={11} style={{ color: accentColor }} />
        Beat match
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="relative bg-[#14110d] border border-white/[0.10] rounded-2xl p-5 max-w-md w-full max-h-[90vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="absolute top-3 right-3 w-8 h-8 rounded-full flex items-center justify-center text-white/45 hover:text-white hover:bg-white/[0.06] transition-colors"
              aria-label="Close"
            >
              <X size={14} />
            </button>

            <p className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.25em] text-white/40 mb-2">
              <Wand2 size={11} style={{ color: accentColor }} />
              Beat match
            </p>
            <h3 className="text-[16px] font-semibold text-[#E8DCC8] pr-8">
              Drop a vocal — find beats that fit
            </h3>
            <p className="mt-1.5 text-[12px] text-white/55 leading-relaxed">
              Record a 30-second a cappella or upload a vocal clip. We'll match the tempo against every beat in this catalogue and rank the best fits — half-time / double-time aware.
            </p>

            {/* Idle state — input options */}
            {phase === 'idle' && (
              <div className="mt-5 grid grid-cols-2 gap-2">
                {recording ? (
                  <button
                    type="button"
                    onClick={() => stopRecording(false)}
                    className="col-span-2 flex items-center justify-center gap-2 py-3 rounded-xl bg-red-500/15 border border-red-500/40 text-red-300 text-[12px] font-bold uppercase tracking-wider hover:bg-red-500/20 transition-colors"
                  >
                    <Square size={12} fill="currentColor" />
                    Stop ({recordSecs}s / {MAX_RECORD_SECS}s)
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={startRecording}
                      className="flex flex-col items-center justify-center gap-1.5 py-5 rounded-xl bg-white/[0.04] border border-white/[0.10] text-[#E8DCC8] hover:bg-white/[0.08] transition-colors"
                    >
                      <Mic size={18} style={{ color: accentColor }} />
                      <span className="text-[11px] font-mono uppercase tracking-wider">Record</span>
                      <span className="text-[9px] text-white/45 font-mono">30s max</span>
                    </button>
                    <label className="flex flex-col items-center justify-center gap-1.5 py-5 rounded-xl bg-white/[0.04] border border-white/[0.10] text-[#E8DCC8] hover:bg-white/[0.08] transition-colors cursor-pointer">
                      <Upload size={18} style={{ color: accentColor }} />
                      <span className="text-[11px] font-mono uppercase tracking-wider">Upload</span>
                      <span className="text-[9px] text-white/45 font-mono">MP3 / WAV / M4A</span>
                      <input type="file" accept="audio/*" className="hidden" onChange={onFile} />
                    </label>
                  </>
                )}
              </div>
            )}

            {/* Analyzing */}
            {phase === 'analyzing' && (
              <div className="mt-6 flex flex-col items-center gap-3 py-6">
                <Loader2 size={28} className="animate-spin" style={{ color: accentColor }} />
                <p className="text-[12px] text-white/65">Analyzing your clip…</p>
                <p className="text-[10px] font-mono text-white/35">
                  Decoding audio · estimating BPM · scoring catalogue
                </p>
              </div>
            )}

            {/* Done */}
            {phase === 'done' && result && (
              <div className="mt-5">
                <p className="text-[11px] text-white/55 mb-3">
                  Your clip clocked at <span className="font-bold text-white">{result.bpm} BPM</span>
                  {result.duration ? ` · ${result.duration.toFixed(1)}s` : ''}.
                  {result.matches.length === 0 ? ' No tempo-matched beats yet.' : ' Best fits:'}
                </p>
                <ul className="space-y-2">
                  {result.matches.map((m) => (
                    <li key={m.track.id} className="rounded-xl bg-white/[0.03] border border-[#1f1a13] p-3 flex items-center gap-3">
                      <div className="w-12 h-12 rounded-md overflow-hidden bg-[#0a0907] border border-white/[0.08] shrink-0">
                        {m.track.cover_url
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={m.track.cover_url} alt="" className="w-full h-full object-cover" />
                          : <div className="w-full h-full flex items-center justify-center text-white/30"><Music size={14} /></div>}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-medium text-[#E8DCC8] truncate">{m.track.title}</p>
                        <p className="text-[10px] font-mono text-white/45 truncate">
                          {m.reasons.join(' · ')}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setOpen(false);
                          router.push(`/store/${m.track.id}`);
                        }}
                        className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-md text-black text-[10px] font-bold uppercase tracking-wider hover:opacity-90"
                        style={{ backgroundColor: accentColor }}
                      >
                        <ShoppingBag size={10} />
                        Open
                      </button>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={reset}
                  className="mt-4 text-[11px] font-mono text-white/40 hover:text-white transition-colors"
                >
                  Try another clip ↻
                </button>
              </div>
            )}

            {/* Error */}
            {phase === 'error' && (
              <div className="mt-5">
                <p className="text-[12px] text-red-300 mb-3">{errorMsg ?? 'Match failed'}</p>
                <button
                  type="button"
                  onClick={reset}
                  className="px-3 py-2 rounded-md bg-white/[0.06] border border-white/[0.10] text-white text-[11px] font-mono uppercase tracking-wider hover:bg-white/[0.10] transition-colors"
                >
                  Try again
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
