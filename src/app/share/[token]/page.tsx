'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Play, Pause, SkipBack, SkipForward, Download, Volume2, VolumeX, Music, Lock, Loader2, Shield } from 'lucide-react';
import { Track } from '@/lib/types';
// Type-only import — runtime import is deferred to the load effect so
// the ~150 KB WaveSurfer bundle doesn't ship in this page's initial JS.
import type WaveSurferType from 'wavesurfer.js';
import React from 'react';
import { createPortal } from 'react-dom';
import { Check, X as XIcon } from 'lucide-react';
import { audioSrc } from '@/lib/audio/url';
import { cdnAudioSrc } from '@/lib/audio/cdn';
import { ClientShareVariant } from '@/components/share/variants/ClientShareVariant';
import { ProducerShareVariant } from '@/components/share/variants/ProducerShareVariant';
import { RapperShareVariant } from '@/components/share/variants/RapperShareVariant';
import { FriendShareVariant } from '@/components/share/variants/FriendShareVariant';

export default function PublicSharePage({ params: paramsPromise }: { params: Promise<{ token: string }> }) {
  const params = React.use(paramsPromise);
  const token = params.token;

  // ── purchase state ──────────────────────────────────────────────────
  // Mirrors the modern share page. Stripe redirects here with
  // ?purchase=success&session_id=cs_xxx; we persist the session_id to
  // localStorage keyed by token so downloads remain unlocked across reloads.
  const [purchaseSessionId, setPurchaseSessionId] = useState<string | null>(null);
  const [purchaseBanner, setPurchaseBanner] = useState<'success' | 'cancelled' | null>(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    const purchase = url.searchParams.get('purchase');
    const sid = url.searchParams.get('session_id');
    if (purchase === 'success' && sid) {
      try { localStorage.setItem(`u2c-purchase-${token}`, sid); } catch {}
      setPurchaseSessionId(sid);
      setPurchaseBanner('success');
    } else if (purchase === 'cancelled') {
      setPurchaseBanner('cancelled');
    } else {
      try {
        const stored = localStorage.getItem(`u2c-purchase-${token}`);
        if (stored) setPurchaseSessionId(stored);
      } catch {}
    }
    if (purchase) {
      url.searchParams.delete('purchase');
      url.searchParams.delete('session_id');
      window.history.replaceState({}, '', url.toString());
    }
  }, [token]);

  const [tracks, setTracks] = useState<Track[]>([]);
  const [shareTitle, setShareTitle] = useState('');
  const [allowDownloads, setAllowDownloads] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requiresPassword, setRequiresPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const [share, setShare] = useState<any | null>(null);
  const [creator, setCreator] = useState<any | null>(null);
  const [stems, setStems] = useState<any[]>([]);

  const [activeIndex, setActiveIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [ready, setReady] = useState(false);
  const [volume, setVolume] = useState(0.8);
  const [muted, setMuted] = useState(false);
  // When WaveSurfer can't decode (no peaks + a CORS/decode hiccup on an
  // externally-opened link), the waveform dies — but the artist must still
  // hear the beat. This flag flips playback to a plain <audio> fallback.
  const [wsFailed, setWsFailed] = useState(false);

  const waveRef = useRef<HTMLDivElement>(null);
  const ws = useRef<WaveSurferType | null>(null);
  const fallbackAudioRef = useRef<HTMLAudioElement>(null);
  const tracksRef = useRef<Track[]>([]);
  const activeIndexRef = useRef(0);

  const activeTrack = tracks[activeIndex] ?? null;

  const fetchShare = useCallback(async (pw?: string) => {
    setIsLoading(true);
    setPasswordError('');
    try {
      const res = await fetch(`/api/share/${params.token}`, {
        headers: pw ? { 'x-share-password': pw } : {},
      });
      const data = await res.json();
      if (res.status === 401) {
        setRequiresPassword(true);
        if (pw) setPasswordError(data.error || 'Incorrect password');
        setIsLoading(false);
        return;
      }
      if (!res.ok) {
        setError(data.error || 'Link not found or expired.');
        setIsLoading(false);
        return;
      }
      const list = data.tracks || [];
      setTracks(list);
      tracksRef.current = list;
      setShareTitle(data.share?.title || 'Shared tracks');
      setShare(data.share || null);
      setCreator(data.creator || null);
      setStems(data.stems || []);
      setAllowDownloads(data.share?.allow_downloads !== false);
      setRequiresPassword(false);
    } catch {
      setError('Error loading shared tracks.');
    }
    setIsLoading(false);
  }, [params.token]);

  useEffect(() => { fetchShare(); }, [fetchShare]);

  // Log real-time listener playhead coordinates (heatmap)
  useEffect(() => {
    if (!isPlaying || !activeTrack?.id) return;
    
    const sendPing = async () => {
      try {
        await fetch(`/api/tracks/${activeTrack.id}/heatmap`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            position_seconds: currentTime,
            share_token: params.token,
          }),
        });
      } catch (err) {
        console.warn('Failed to send playhead coordinate ping:', err);
      }
    };

    // Ping every 3 seconds of active play
    const interval = setInterval(sendPing, 3000);
    return () => clearInterval(interval);
  }, [isPlaying, activeTrack?.id, currentTime, params.token]);

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setUnlocking(true);
    await fetchShare(password);
    setUnlocking(false);
  };

  useEffect(() => {
    if (!waveRef.current || !activeTrack?.audio_url) return;
    setReady(false);
    setCurrentTime(0);
    setDuration(0);
    setWsFailed(false);
    if (ws.current) { ws.current.destroy(); ws.current = null; }

    // Cancellation flag: if the user skips tracks faster than WaveSurfer's
    // ~150 KB module resolves, the late callback should be a no-op.
    let cancelled = false;

    (async () => {
      // Dynamic import keeps WaveSurfer out of the page's initial JS
      // payload — the compile cost for this route dropped substantially
      // once we stopped pulling it in at module level.
      const mod = await import('wavesurfer.js');
      if (cancelled || !waveRef.current) return;
      const WaveSurferLib = mod.default;

      const w = WaveSurferLib.create({
        container: waveRef.current,
        waveColor: '#2B2821',
        progressColor: '#E7D7BE',
        cursorColor: '#C9BCA8',
        barWidth: 3,
        barGap: 2,
        barRadius: 2,
        height: 80,
        normalize: true,
      });
      ws.current = w;

      // Decode failure (no peaks + CORS/network on an external open) → flip
      // to the plain-audio fallback so the artist still hears the beat.
      w.on('error', () => { if (!cancelled) setWsFailed(true); });
      try {
        w.load(audioSrc(activeTrack.audio_url));
      } catch {
        if (!cancelled) setWsFailed(true);
      }
      w.on('ready', () => {
        if (cancelled) return;
        setDuration(w.getDuration() || 0);
        setReady(true);
        w.setVolume(muted ? 0 : volume);
      });
      w.on('audioprocess', (t: number) => {
        if (!cancelled) setCurrentTime(t);
      });
      w.on('finish', () => {
        if (cancelled) return;
        setIsPlaying(false);
        const next = activeIndexRef.current + 1;
        if (next < tracksRef.current.length) {
          setActiveIndex(next);
          activeIndexRef.current = next;
          setIsPlaying(true);
        }
      });
      w.on('play', () => { if (!cancelled) setIsPlaying(true); });
      w.on('pause', () => { if (!cancelled) setIsPlaying(false); });
    })();

    return () => {
      cancelled = true;
      try { ws.current?.destroy(); } catch {}
      ws.current = null;
    };
  }, [activeTrack?.id, activeTrack?.audio_url]);

  useEffect(() => { activeIndexRef.current = activeIndex; }, [activeIndex]);

  useEffect(() => {
    if (!ws.current || !ready) return;
    if (isPlaying) ws.current.play().catch(() => {});
    else ws.current.pause();
  }, [isPlaying, ready]);

  useEffect(() => { ws.current?.setVolume(muted ? 0 : volume); }, [volume, muted]);

  // ── Plain-audio fallback (WaveSurfer decode failed) ─────────────────────
  // Drive the hidden <audio> from the same isPlaying / volume / track state so
  // the transport keeps working with no waveform. Streams direct from R2/CDN.
  useEffect(() => {
    const a = fallbackAudioRef.current;
    if (!a || !wsFailed) return;
    const want = cdnAudioSrc(activeTrack?.audio_url);
    if (want && a.getAttribute('src') !== want) { a.src = want; a.load(); }
    a.volume = muted ? 0 : volume;
    if (isPlaying) a.play().catch(() => {});
    else a.pause();
  }, [wsFailed, isPlaying, volume, muted, activeTrack?.audio_url]);

  const togglePlay = () => setIsPlaying((p) => !p);
  const prevTrack = () => { if (activeIndex > 0) { setActiveIndex(activeIndex - 1); setIsPlaying(true); } };
  const nextTrack = () => { if (activeIndex < tracks.length - 1) { setActiveIndex(activeIndex + 1); setIsPlaying(true); } };
  const selectTrack = (i: number) => {
    if (i === activeIndex) { togglePlay(); return; }
    setActiveIndex(i);
    setIsPlaying(true);
  };
  const downloadTrack = async (track: Track) => {
    // Route through /api/share/[token]/download — the endpoint grants
    // either via share.allow_downloads (free) or via a matching
    // license_purchases row keyed by purchaseSessionId (paid).
    const url = new URL(`/api/share/${token}/download`, window.location.origin);
    url.searchParams.set('track_id', track.id);
    if (purchaseSessionId) url.searchParams.set('session_id', purchaseSessionId);
    const ext = (track.audio_url.match(/\.(mp3|wav|flac|aiff|aif|m4a|ogg)(?:\?|$)/i)?.[1] || 'mp3').toLowerCase();
    const filename = `${track.title || 'track'}.${ext}`;
    try {
      const response = await fetch(url.toString(), {
        headers: password ? { 'x-share-password': password } : {},
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'Download unavailable');
      }
      const objectUrl = URL.createObjectURL(await response.blob());
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objectUrl);
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : 'Download unavailable');
    }
  };
  const fmt = (s: number) => {
    if (!isFinite(s) || s < 0) return '0:00';
    return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
  };
  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;

  if (isLoading) return (
    <div className="min-h-screen bg-[#090907] flex items-center justify-center">
      <Loader2 size={20} className="animate-spin text-[#837B6D]" />
    </div>
  );

  if (requiresPassword) return (
    <div className="min-h-screen bg-[#090907] flex items-center justify-center p-6">
      <form onSubmit={handleUnlock} className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-[#171511] border border-[#211F1A] flex items-center justify-center">
            <Lock size={16} className="text-[#9B9282]" />
          </div>
          <h1 className="text-[18px] font-medium text-white mb-1">Password required</h1>
          <p className="text-[12px] text-[#9B9282]">This link is protected</p>
        </div>
        <input
          type="password" value={password} onChange={(e) => setPassword(e.target.value)}
          placeholder="Enter password"
          className="w-full bg-[#171511] border border-[#211F1A] rounded-lg px-4 py-3 text-[13px] text-white placeholder:text-[#837B6D] focus:outline-none focus:border-[#3B372F] mb-3"
          autoFocus
        />
        {passwordError && <p className="text-[11px] text-red-400 mb-3">{passwordError}</p>}
        <button type="submit" disabled={unlocking || !password}
          className="w-full bg-white text-black py-3 rounded-lg text-[12px] font-medium hover:bg-[#F7EBDD] disabled:opacity-40 transition-colors flex items-center justify-center gap-2"
        >
          {unlocking ? <Loader2 size={13} className="animate-spin" /> : null}
          Unlock
        </button>
      </form>
    </div>
  );

  if (error) return (
    <div className="min-h-screen bg-[#090907] flex items-center justify-center p-6">
      <div className="text-center max-w-sm">
        <Shield size={28} className="text-red-400 mx-auto mb-4" />
        <h1 className="text-[18px] font-medium text-white mb-2">Link unavailable</h1>
        <p className="text-[12px] text-[#9B9282]">{error}</p>
      </div>
    </div>
  );

  const projectMock = {
    id: 'flat-share',
    name: shareTitle,
    cover_url: activeTrack?.cover_url || null,
    description: null,
  };

  // Portal the post-Stripe banner to <body> so it overlays whichever
  // variant renders. Mirrors the modern share page.
  const purchaseBannerNode = purchaseBanner && typeof document !== 'undefined'
    ? createPortal(
        <div
          className={`fixed top-4 left-1/2 -translate-x-1/2 z-[200] max-w-[90vw] sm:max-w-md px-5 py-3 rounded-full border backdrop-blur-xl shadow-[0_12px_40px_rgba(0,0,0,0.5)] flex items-center gap-3 animate-in slide-in-from-top-4 fade-in duration-300 ${
            purchaseBanner === 'success'
              ? 'bg-[#0e1f17]/95 border-[#6DC6A4]/30 text-[#9fe5c1]'
              : 'bg-[#1f1410]/95 border-[#C9BCA8]/30 text-[#F3E6D1]'
          }`}
        >
          {purchaseBanner === 'success' ? (
            <>
              <Check size={14} className="text-[#6DC6A4] shrink-0" />
              <span className="text-[12px] font-medium">
                Purchase complete — receipt + access sent to your email.
              </span>
            </>
          ) : (
            <>
              <XIcon size={14} className="text-[#D0C3AF] shrink-0" />
              <span className="text-[12px] font-medium">Checkout cancelled.</span>
            </>
          )}
          <button
            onClick={() => setPurchaseBanner(null)}
            className="ml-2 text-current opacity-60 hover:opacity-100 transition-opacity"
            aria-label="Dismiss"
          >
            <XIcon size={12} />
          </button>
        </div>,
        document.body,
      )
    : null;

  if (share?.recipient_kind === 'client') {
    return (
      <>
        {purchaseBannerNode}
        <div ref={waveRef} className="hidden" />
        <FallbackAudio
          refEl={fallbackAudioRef}
          active={wsFailed}
          onTime={(t, d) => { setCurrentTime(t); if (d && !duration) setDuration(d); }}
          onMeta={(d) => setDuration(d)}
          onEnd={() => {
            setIsPlaying(false);
            const next = activeIndexRef.current + 1;
            if (next < tracksRef.current.length) { setActiveIndex(next); activeIndexRef.current = next; setIsPlaying(true); }
          }}
        />
        <ClientShareVariant
          project={projectMock}
          tracks={tracks}
          creator={creator}
          licenses={[]}
          shareToken={share?.sales_enabled ? params.token : undefined}
          shareLeasePrice={share?.lease_price_usd ?? null}
          shareExclusivePrice={share?.exclusive_price_usd ?? null}
          shareDiscountPercent={share?.discount_percent ?? null}
          playingId={activeTrack?.id ?? null}
          isPlaying={isPlaying}
          onPlay={(t) => {
            const idx = tracks.findIndex((x) => x.id === t.id);
            if (idx >= 0) selectTrack(idx);
          }}
          currentTime={currentTime}
          duration={duration}
          progressPct={progressPct}
          waveRef={waveRef}
          onSeek={(seconds) => {
            if (ws.current && duration > 0) {
              ws.current.seekTo(seconds / duration);
            }
          }}
        />
      </>
    );
  }

  if (share?.recipient_kind === 'producer') {
    return (
      <>
        {purchaseBannerNode}
        <div ref={waveRef} className="hidden" />
        <FallbackAudio
          refEl={fallbackAudioRef}
          active={wsFailed}
          onTime={(t, d) => { setCurrentTime(t); if (d && !duration) setDuration(d); }}
          onMeta={(d) => setDuration(d)}
          onEnd={() => {
            setIsPlaying(false);
            const next = activeIndexRef.current + 1;
            if (next < tracksRef.current.length) { setActiveIndex(next); activeIndexRef.current = next; setIsPlaying(true); }
          }}
        />
        <ProducerShareVariant
          project={projectMock}
          tracks={tracks}
          creator={creator}
          playingId={activeTrack?.id ?? null}
          isPlaying={isPlaying}
          onPlay={(t) => {
            const idx = tracks.findIndex((x) => x.id === t.id);
            if (idx >= 0) selectTrack(idx);
          }}
        />
      </>
    );
  }

  if (share?.recipient_kind === 'rapper') {
    return (
      <>
        {purchaseBannerNode}
        <div ref={waveRef} className="hidden" />
        <FallbackAudio
          refEl={fallbackAudioRef}
          active={wsFailed}
          onTime={(t, d) => { setCurrentTime(t); if (d && !duration) setDuration(d); }}
          onMeta={(d) => setDuration(d)}
          onEnd={() => {
            setIsPlaying(false);
            const next = activeIndexRef.current + 1;
            if (next < tracksRef.current.length) { setActiveIndex(next); activeIndexRef.current = next; setIsPlaying(true); }
          }}
        />
        <RapperShareVariant
          project={projectMock}
          tracks={tracks}
          creator={creator}
          playingId={activeTrack?.id ?? null}
          isPlaying={isPlaying}
          onPlay={(t) => {
            const idx = tracks.findIndex((x) => x.id === t.id);
            if (idx >= 0) selectTrack(idx);
          }}
        />
      </>
    );
  }

  if (share?.recipient_kind === 'friend') {
    return (
      <>
        {purchaseBannerNode}
        <div ref={waveRef} className="hidden" />
        <FallbackAudio
          refEl={fallbackAudioRef}
          active={wsFailed}
          onTime={(t, d) => { setCurrentTime(t); if (d && !duration) setDuration(d); }}
          onMeta={(d) => setDuration(d)}
          onEnd={() => {
            setIsPlaying(false);
            const next = activeIndexRef.current + 1;
            if (next < tracksRef.current.length) { setActiveIndex(next); activeIndexRef.current = next; setIsPlaying(true); }
          }}
        />
        <FriendShareVariant
          project={projectMock}
          tracks={tracks}
          creator={creator}
          playingId={activeTrack?.id ?? null}
          isPlaying={isPlaying}
          onPlay={(t) => {
            const idx = tracks.findIndex((x) => x.id === t.id);
            if (idx >= 0) selectTrack(idx);
          }}
        />
      </>
    );
  }

  return (
    <>
    {purchaseBannerNode}
    <div className="min-h-screen bg-[#090907] text-[#F7EBDD] flex flex-col font-sans">
      {/* Header */}
      <header className="px-4 sm:px-8 py-5 border-b border-[#1A1813] flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-6 h-6 rounded-[5px] bg-white flex items-center justify-center shrink-0">
            <span className="text-[9px] font-black text-black">AG</span>
          </div>
          <span className="text-[11px] font-medium tracking-[0.2em] uppercase text-[#D0C3AF] truncate">U2C Beatstore</span>
        </div>
        <span className="text-[10px] font-mono text-[#837B6D] uppercase tracking-wider truncate max-w-[40%] sm:max-w-xs">{shareTitle}</span>
      </header>

      <main className="flex-1 max-w-2xl mx-auto w-full px-4 sm:px-6 py-8 sm:py-12 pb-24">
        {activeTrack && (
          <div className="mb-12">
            {/* Track hero — vinyl-style spinning cover. The disc itself
                is a stack:
                  1. Outer black ring (vinyl edge)
                  2. The cover artwork, masked to a circle
                  3. A small concentric "label" gradient near the center
                  4. A tiny center spindle hole
                The whole stack rotates via the `animate-vinyl` keyframe
                with animationPlayState toggled by `isPlaying`, so the
                disc only turns while audio is actually playing. */}
            <div className="flex gap-4 sm:gap-6 items-center mb-8">
              <div className="relative w-24 h-24 sm:w-32 sm:h-32 shrink-0">
                <div
                  className="absolute inset-0 rounded-full overflow-hidden bg-black animate-vinyl shadow-[0_8px_28px_rgba(0,0,0,0.6)]"
                  style={{ animationPlayState: isPlaying ? 'running' : 'paused' }}
                >
                  {activeTrack.cover_url ? (
                    <img loading="lazy" src={activeTrack.cover_url} alt="" className="w-full h-full object-cover" draggable={false} />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-4xl font-light text-[#2B2821] bg-gradient-to-br from-[#161520] to-[#090907]">
                      {activeTrack.title[0]}
                    </div>
                  )}
                  {/* Concentric grooves — radial gradient with tight stops
                      gives the look of pressed-vinyl rings without
                      stacking 20 individual rings. Sits ABOVE the
                      artwork at low opacity. */}
                  <div
                    className="absolute inset-0 rounded-full pointer-events-none mix-blend-overlay opacity-40"
                    style={{
                      background:
                        'repeating-radial-gradient(circle at center, rgba(0,0,0,0.6) 0 1px, transparent 1px 4px)',
                    }}
                  />
                  {/* Label — small circular disc in the center, slightly
                      lifted off the artwork to read as the printed
                      paper label on a real record. */}
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-gradient-to-br from-[#E7D7BE] to-[#3a2a8a] border border-black/40 shadow-[inset_0_0_8px_rgba(0,0,0,0.5)]" />
                  {/* Spindle hole — single dot in the dead center. */}
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-black" />
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-mono uppercase tracking-wider text-[#9B9282] mb-1.5">
                  {activeTrack.type}{activeTrack.bpm ? ` · ${activeTrack.bpm} bpm` : ''}{activeTrack.key ? ` · ${activeTrack.key}` : ''}
                </p>
                <h2 className="text-2xl font-medium tracking-tight text-white leading-tight truncate">{activeTrack.title}</h2>
                <p className="text-[11px] font-mono text-[#9B9282] mt-1">{activeIndex + 1} of {tracks.length}</p>
              </div>
            </div>

            {/* Waveform */}
            <div className="bg-[#11100D] border border-[#1A1813] rounded-lg p-5 mb-4">
              <div ref={waveRef} className="w-full" />
              <FallbackAudio
                refEl={fallbackAudioRef}
                active={wsFailed}
                onTime={(t, d) => { setCurrentTime(t); if (d && !duration) setDuration(d); }}
                onMeta={(d) => setDuration(d)}
                onEnd={() => {
                  setIsPlaying(false);
                  const next = activeIndexRef.current + 1;
                  if (next < tracksRef.current.length) { setActiveIndex(next); activeIndexRef.current = next; setIsPlaying(true); }
                }}
              />
              {!ready && (
                <div className="h-20 flex items-end gap-0.5 justify-center">
                  {Array.from({ length: 60 }).map((_, i) => (
                    <div key={i} className="w-[3px] bg-[#2B2821] rounded-sm"
                      style={{ height: `${12 + Math.abs(Math.sin(i * 0.35) * 52)}px` }} />
                  ))}
                </div>
              )}
            </div>

            {/* Scrub bar */}
            <div className="flex items-center gap-3 mb-5">
              <span className="text-[10px] font-mono text-[#9B9282] tabular-nums">{fmt(currentTime)}</span>
              <div className="flex-1 h-px bg-[#211F1A] relative cursor-pointer group"
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  ws.current?.seekTo(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)));
                }}
              >
                <div className="h-full bg-[#E7D7BE] absolute left-0 top-0" style={{ width: `${progressPct}%` }} />
                <div className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-white opacity-0 group-hover:opacity-100 transition-opacity shadow-lg"
                  style={{ left: `${progressPct}%`, transform: 'translate(-50%, -50%)' }} />
              </div>
              <span className="text-[10px] font-mono text-[#9B9282] tabular-nums">{fmt(duration)}</span>
            </div>

            {/* Controls */}
            <div className="flex items-center gap-3">
              <button onClick={prevTrack} disabled={activeIndex === 0}
                className="w-8 h-8 flex items-center justify-center text-[#9B9282] hover:text-white disabled:opacity-20 transition-colors shrink-0">
                <SkipBack size={16} fill="currentColor" />
              </button>
              <button onClick={togglePlay}
                className="w-10 h-10 bg-white text-black rounded-full flex items-center justify-center hover:scale-105 active:scale-95 transition-transform shrink-0">
                {isPlaying ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" className="ml-0.5" />}
              </button>
              <button onClick={nextTrack} disabled={activeIndex === tracks.length - 1}
                className="w-8 h-8 flex items-center justify-center text-[#9B9282] hover:text-white disabled:opacity-20 transition-colors shrink-0">
                <SkipForward size={16} fill="currentColor" />
              </button>

              <div className="flex items-center gap-2 ml-1 sm:ml-3 shrink-0">
                <button onClick={() => setMuted(!muted)} className="text-[#9B9282] hover:text-white transition-colors" aria-label={muted ? 'Unmute' : 'Mute'}>
                  {muted || volume === 0 ? <VolumeX size={14} /> : <Volume2 size={14} />}
                </button>
                <input type="range" min="0" max="1" step="0.01" value={muted ? 0 : volume}
                  onChange={(e) => { setMuted(false); setVolume(parseFloat(e.target.value)); }}
                  aria-label="Volume"
                  className="hidden sm:block w-20 cursor-pointer" />
              </div>

              <div className="flex-1" />

              {allowDownloads ? (
                <button onClick={() => downloadTrack(activeTrack)}
                  className="flex items-center gap-1.5 text-[11px] font-medium text-[#D0C3AF] hover:text-white border border-[#211F1A] hover:border-[#3B372F] px-3 py-2 rounded-md transition-colors shrink-0">
                  <Download size={12} />
                  <span className="hidden sm:inline">Download</span>
                </button>
              ) : (
                <div
                  title="The sender disabled downloads on this link."
                  className="flex items-center gap-1.5 text-[11px] font-medium text-[#837B6D] border border-[#161616] px-3 py-2 rounded-md cursor-not-allowed shrink-0">
                  <Lock size={11} />
                  <span className="hidden sm:inline">Downloads disabled</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tracklist */}
        <div>
          <p className="text-[10px] font-mono uppercase tracking-wider text-[#9B9282] mb-4">{tracks.length} track{tracks.length !== 1 ? 's' : ''}</p>
          <div className="border border-[#211F1A] rounded-lg divide-y divide-[#24211B]">
            {tracks.map((track, i) => {
              const active = i === activeIndex;
              return (
                <div key={track.id} onClick={() => selectTrack(i)}
                  className={`group flex items-center gap-4 px-4 h-14 cursor-pointer transition-colors ${active ? 'bg-[#11100D]' : 'hover:bg-[#11100D]'}`}>
                  <div className="w-5 text-center shrink-0">
                    {active && isPlaying ? (
                      <div className="flex gap-0.5 items-end h-3 justify-center">
                        <div className="w-0.5 bg-[#E7D7BE] animate-pulse h-2" />
                        <div className="w-0.5 bg-[#E7D7BE] animate-pulse h-3" style={{ animationDelay: '150ms' }} />
                        <div className="w-0.5 bg-[#E7D7BE] animate-pulse h-1.5" style={{ animationDelay: '300ms' }} />
                      </div>
                    ) : (
                      <span className={`text-[11px] font-mono ${active ? 'text-[#E7D7BE]' : 'text-[#6E685B]'}`}>{i + 1}</span>
                    )}
                  </div>
                  <div className="w-8 h-8 bg-[#1A1813] rounded border border-[#211F1A] overflow-hidden shrink-0">
                    {track.cover_url
                      ? <img loading="lazy" src={track.cover_url} alt="" className="w-full h-full object-cover" />
                      : <div className="w-full h-full flex items-center justify-center text-[#3B372F]"><Music size={11} /></div>
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-[13px] font-medium truncate ${active ? 'text-[#F3E6D1]' : 'text-[#F7EBDD]'}`}>{track.title}</p>
                    <p className="text-[10px] font-mono text-[#9B9282] mt-0.5">{track.type}{track.bpm ? ` · ${track.bpm}` : ''}</p>
                  </div>
                  {track.duration_seconds && (
                    <span className="text-[11px] font-mono text-[#9B9282] tabular-nums">{fmt(track.duration_seconds)}</span>
                  )}
                  {allowDownloads && (
                    <button onClick={(e) => { e.stopPropagation(); downloadTrack(track); }}
                      className="p-2 text-[#837B6D] hover:text-white transition-colors opacity-0 group-hover:opacity-100">
                      <Download size={12} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* License info section */}
        {(creator?.license_lease_price_usd != null || creator?.license_exclusive_price_usd != null || creator?.license_notes || creator?.license_agreement) && (
          <LicenseInfoSection creator={creator} />
        )}
      </main>
    </div>
    </>
  );
}

function LicenseInfoSection({ creator }: { creator: any }) {
  const [open, setOpen] = useState<'lease' | 'exclusive' | null>(null);

  const tiers = [
    {
      key: 'lease' as const,
      label: 'Lease License',
      price: creator?.license_lease_price_usd != null ? `$${creator.license_lease_price_usd}` : null,
      includes: [
        'WAV + MP3 delivery',
        'Up to 500K streams',
        'Up to 1 commercial release',
        'Must credit producer',
      ],
      excludes: ['Exclusive rights', 'Stems included'],
    },
    {
      key: 'exclusive' as const,
      label: 'Exclusive License',
      price: creator?.license_exclusive_price_usd != null ? `$${creator.license_exclusive_price_usd}` : null,
      includes: [
        'WAV + MP3 + stems delivery',
        'Unlimited streams',
        'Unlimited commercial releases',
        'Full exclusive rights',
        'Beat removed from store',
      ],
      excludes: [],
    },
  ].filter(t => t.price != null);

  if (tiers.length === 0 && !creator?.license_notes && !creator?.license_agreement) return null;

  return (
    <div className="mt-12 border-t border-[#211F1A] pt-8 space-y-4">
      <p className="text-[10px] font-mono uppercase tracking-wider text-[#9B9282]">Licensing</p>

      {creator?.license_notes && (
        <p className="text-[12px] text-[#D0C3AF] leading-relaxed">{creator.license_notes}</p>
      )}

      <div className="space-y-2">
        {tiers.map(tier => (
          <div key={tier.key} className="border border-[#211F1A] rounded-lg overflow-hidden">
            <button
              onClick={() => setOpen(open === tier.key ? null : tier.key)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-[#11100D] transition-colors text-left"
            >
              <div className="flex items-center gap-3">
                <span className="text-[13px] font-medium text-[#F7EBDD]">{tier.label}</span>
                {tier.price && (
                  <span className="text-[11px] font-mono text-[#E7D7BE]">{tier.price}</span>
                )}
              </div>
              <span className="text-[10px] text-[#9B9282]">{open === tier.key ? '▲' : '▼'}</span>
            </button>
            {open === tier.key && (
              <div className="px-4 pb-4 space-y-2 border-t border-[#211F1A] pt-3">
                {tier.includes.map(item => (
                  <div key={item} className="flex items-center gap-2 text-[11px] text-[#D0C3AF]">
                    <span className="text-green-400 shrink-0">✓</span> {item}
                  </div>
                ))}
                {tier.excludes.map(item => (
                  <div key={item} className="flex items-center gap-2 text-[11px] text-[#9B9282]">
                    <span className="text-[#6E685B] shrink-0">✗</span> {item}
                  </div>
                ))}
                {tier.key === 'exclusive' && creator?.license_agreement && (
                  <details className="mt-3">
                    <summary className="text-[10px] font-mono text-[#9B9282] cursor-pointer hover:text-[#D0C3AF] transition-colors">
                      View full agreement
                    </summary>
                    <pre className="mt-2 text-[10px] text-[#9B9282] whitespace-pre-wrap leading-relaxed font-mono border border-[#211F1A] rounded p-3 bg-[#090907] max-h-48 overflow-y-auto">
                      {creator.license_agreement}
                    </pre>
                  </details>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Fallback audio element ───────────────────────────────────────────────
 * Plain <audio> that takes over playback when WaveSurfer fails to decode on
 * an externally-opened share link. Co-located with each waveform container;
 * only the mounted variant binds the ref. Silent until `active` is true.
 */
function FallbackAudio({
  refEl, active, onTime, onMeta, onEnd,
}: {
  refEl: React.RefObject<HTMLAudioElement | null>;
  active: boolean;
  onTime: (currentTime: number, duration: number) => void;
  onMeta: (duration: number) => void;
  onEnd: () => void;
}) {
  return (
    <audio
      ref={refEl}
      hidden
      preload="none"
      onTimeUpdate={(e) => {
        if (!active) return;
        const a = e.currentTarget;
        onTime(a.currentTime, isFinite(a.duration) ? a.duration : 0);
      }}
      onLoadedMetadata={(e) => { if (active) onMeta(e.currentTarget.duration || 0); }}
      onEnded={() => { if (active) onEnd(); }}
    />
  );
}
