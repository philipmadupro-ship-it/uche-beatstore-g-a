'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Loader2, Music } from 'lucide-react';
import { toast } from '@/hooks/useToast';
import type { Mp3Status } from '@/lib/audio/mp3-status';

interface Props {
  trackId: string;
  /** Re-checked when the master changes (a version revert swaps it). */
  audioUrl: string | null | undefined;
}

const H3 = 'mb-3 text-[9px] font-black uppercase tracking-[0.25em] text-white/40';

/**
 * Delivery — is the MP3 a lease on this track hands over ready?
 *
 * A lease tier promises MP3; when the master is a WAV the MP3 is made from it
 * (lib/audio/mp3-deliverable). Nothing stores that state, so this asks the
 * server (one storage lookup — which is why it lives in the drawer, for one
 * track, and not on every row of a long list). "Make MP3 now" does the work a
 * buyer's first download would otherwise do, so the first buyer never waits and
 * a broken ffmpeg is found by the producer, not by a customer.
 */
export function TrackDeliverySection({ trackId, audioUrl }: Props) {
  const [status, setStatus] = useState<Mp3Status | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ok' | 'failed' | 'unavailable'>('loading');
  const [making, setMaking] = useState(false);

  const load = useCallback(async () => {
    setLoadState('loading');
    try {
      const res = await fetch(`/api/tracks/${trackId}/mp3`, { cache: 'no-store' });
      // 501: no Supabase (local mode) — there is nothing to deliver, so no section.
      if (res.status === 501) { setStatus(null); setLoadState('unavailable'); return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus((await res.json()) as Mp3Status);
      setLoadState('ok');
    } catch {
      setStatus(null);
      setLoadState('failed');
    }
  }, [trackId]);

  // `audioUrl` is a dependency on purpose: a new master means a new MP3.
  useEffect(() => { void load(); }, [load, audioUrl]);

  const make = async () => {
    if (making) return;
    setMaking(true);
    try {
      const res = await fetch(`/api/tracks/${trackId}/mp3`, { method: 'POST' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error('MP3 not made', typeof json.error === 'string' ? json.error : `HTTP ${res.status}`);
        return;
      }
      setStatus(json as Mp3Status);
      setLoadState('ok');
      toast.success('MP3 ready', 'Lease buyers will download it straight away.');
    } catch {
      toast.error('MP3 not made', 'Network error. Try again.');
    } finally {
      setMaking(false);
    }
  };

  if (loadState === 'unavailable') return null;

  const ready = status?.state === 'master' || status?.state === 'ready';

  return (
    <div className="border-b border-white/10 px-6 py-5" data-testid="track-delivery">
      <h3 className={H3}>Delivery</h3>

      {loadState === 'loading' && !status ? (
        <p className="flex items-center gap-2 text-[11px] text-white/40">
          <Loader2 size={11} className="animate-spin" aria-hidden="true" /> Checking the MP3…
        </p>
      ) : loadState === 'failed' ? (
        <div className="flex items-center gap-3 text-[11px] text-white/40">
          <span>Could not check the MP3.</span>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-lg border border-white/10 bg-white/[0.06] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.15em] text-white/80 transition-colors hover:border-white/20 hover:bg-white/[0.10]"
          >
            Retry
          </button>
        </div>
      ) : status ? (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span
              data-testid="mp3-state"
              data-state={status.state}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.15em] ${
                ready
                  ? 'border-[#6DC6A4]/30 bg-[#6DC6A4]/10 text-[#6DC6A4]'
                  : 'border-white/10 bg-white/[0.06] text-white/60'
              }`}
            >
              {ready ? <CheckCircle2 size={10} aria-hidden="true" /> : <Music size={10} aria-hidden="true" />}
              {status.label}
            </span>
            {status.canMake && (
              <button
                type="button"
                disabled={making}
                onClick={() => void make()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.06] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.15em] text-white/80 transition-colors hover:border-white/20 hover:bg-white/[0.10] disabled:cursor-wait disabled:opacity-40"
              >
                {making && <Loader2 size={10} className="animate-spin" aria-hidden="true" />}
                {making ? 'Making…' : 'Make MP3 now'}
              </button>
            )}
          </div>
          <p className="text-[11px] leading-relaxed text-white/40">{status.detail}</p>
        </>
      ) : null}
    </div>
  );
}
