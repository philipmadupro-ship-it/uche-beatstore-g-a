'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Play, Pause, SkipBack, SkipForward, Download, Volume2, VolumeX, Music, Lock, Loader2, Shield } from 'lucide-react';
import { Track } from '@/lib/types';
// Type-only import — runtime import is deferred to the load effect so
// the ~150 KB WaveSurfer bundle doesn't ship in this page's initial JS.
import type WaveSurferType from 'wavesurfer.js';
import React from 'react';
import { audioSrc } from '@/lib/audio/url';
import { ClientShareVariant } from '@/components/share/variants/ClientShareVariant';
import { ProducerShareVariant } from '@/components/share/variants/ProducerShareVariant';
import { RapperShareVariant } from '@/components/share/variants/RapperShareVariant';
import { FriendShareVariant } from '@/components/share/variants/FriendShareVariant';

export default function PublicSharePage({ params: paramsPromise }: { params: Promise<{ token: string }> }) {
  const params = React.use(paramsPromise);

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

  const waveRef = useRef<HTMLDivElement>(null);
  const ws = useRef<WaveSurferType | null>(null);
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
        waveColor: '#1f1a13',
        progressColor: '#D4BFA0',
        cursorColor: '#8A7A5C',
        barWidth: 3,
        barGap: 2,
        barRadius: 2,
        height: 80,
        normalize: true,
      });
      ws.current = w;

      w.load(audioSrc(activeTrack.audio_url));
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

  const togglePlay = () => setIsPlaying((p) => !p);
  const prevTrack = () => { if (activeIndex > 0) { setActiveIndex(activeIndex - 1); setIsPlaying(true); } };
  const nextTrack = () => { if (activeIndex < tracks.length - 1) { setActiveIndex(activeIndex + 1); setIsPlaying(true); } };
  const selectTrack = (i: number) => {
    if (i === activeIndex) { togglePlay(); return; }
    setActiveIndex(i);
    setIsPlaying(true);
  };
  const downloadTrack = (track: Track) => {
    // Route the download through our same-origin proxy so the response
    // carries Content-Disposition: attachment. Without that, browsers
    // ignore the <a download> attribute for cross-origin R2 URLs and just
    // navigate to the audio file — which the user perceives as "downloads
    // don't work."
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
  };
  const fmt = (s: number) => {
    if (!isFinite(s) || s < 0) return '0:00';
    return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
  };
  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;

  if (isLoading) return (
    <div className="min-h-screen bg-[#0a0907] flex items-center justify-center">
      <Loader2 size={20} className="animate-spin text-[#4a4338]" />
    </div>
  );

  if (requiresPassword) return (
    <div className="min-h-screen bg-[#0a0907] flex items-center justify-center p-6">
      <form onSubmit={handleUnlock} className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-[#14110d] border border-[#1a160f] flex items-center justify-center">
            <Lock size={16} className="text-[#5a5142]" />
          </div>
          <h1 className="text-[18px] font-medium text-white mb-1">Password required</h1>
          <p className="text-[12px] text-[#5a5142]">This link is protected</p>
        </div>
        <input
          type="password" value={password} onChange={(e) => setPassword(e.target.value)}
          placeholder="Enter password"
          className="w-full bg-[#14110d] border border-[#1a160f] rounded-lg px-4 py-3 text-[13px] text-white placeholder:text-[#4a4338] focus:outline-none focus:border-[#2d2620] mb-3"
          autoFocus
        />
        {passwordError && <p className="text-[11px] text-red-400 mb-3">{passwordError}</p>}
        <button type="submit" disabled={unlocking || !password}
          className="w-full bg-white text-black py-3 rounded-lg text-[12px] font-medium hover:bg-[#E8DCC8] disabled:opacity-40 transition-colors flex items-center justify-center gap-2"
        >
          {unlocking ? <Loader2 size={13} className="animate-spin" /> : null}
          Unlock
        </button>
      </form>
    </div>
  );

  if (error) return (
    <div className="min-h-screen bg-[#0a0907] flex items-center justify-center p-6">
      <div className="text-center max-w-sm">
        <Shield size={28} className="text-red-400 mx-auto mb-4" />
        <h1 className="text-[18px] font-medium text-white mb-2">Link unavailable</h1>
        <p className="text-[12px] text-[#5a5142]">{error}</p>
      </div>
    </div>
  );

  const projectMock = {
    id: 'flat-share',
    name: shareTitle,
    cover_url: activeTrack?.cover_url || null,
    description: null,
  };

  if (share?.recipient_kind === 'client') {
    return (
      <>
        <div ref={waveRef} className="hidden" />
        <ClientShareVariant
          project={projectMock}
          tracks={tracks}
          creator={creator}
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
        <div ref={waveRef} className="hidden" />
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
        <div ref={waveRef} className="hidden" />
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
        <div ref={waveRef} className="hidden" />
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
    <div className="min-h-screen bg-[#0a0907] text-[#E8DCC8] flex flex-col font-sans">
      {/* Header */}
      <header className="px-8 py-5 border-b border-[#16130e] flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-[5px] bg-white flex items-center justify-center">
            <span className="text-[9px] font-black text-black">AG</span>
          </div>
          <span className="text-[11px] font-medium tracking-[0.2em] uppercase text-[#a08a6a]">U2C Beatstore</span>
        </div>
        <span className="text-[10px] font-mono text-[#4a4338] uppercase tracking-wider truncate max-w-xs">{shareTitle}</span>
      </header>

      <main className="flex-1 max-w-2xl mx-auto w-full px-6 py-12 pb-20">
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
            <div className="flex gap-6 items-center mb-8">
              <div className="relative w-32 h-32 shrink-0">
                <div
                  className="absolute inset-0 rounded-full overflow-hidden bg-black animate-vinyl shadow-[0_8px_28px_rgba(0,0,0,0.6)]"
                  style={{ animationPlayState: isPlaying ? 'running' : 'paused' }}
                >
                  {activeTrack.cover_url ? (
                    <img loading="lazy" src={activeTrack.cover_url} alt="" className="w-full h-full object-cover" draggable={false} />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-4xl font-light text-[#1f1a13] bg-gradient-to-br from-[#161520] to-[#0a0907]">
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
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-gradient-to-br from-[#D4BFA0] to-[#3a2a8a] border border-black/40 shadow-[inset_0_0_8px_rgba(0,0,0,0.5)]" />
                  {/* Spindle hole — single dot in the dead center. */}
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-black" />
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-mono uppercase tracking-wider text-[#5a5142] mb-1.5">
                  {activeTrack.type}{activeTrack.bpm ? ` · ${activeTrack.bpm} bpm` : ''}{activeTrack.key ? ` · ${activeTrack.key}` : ''}
                </p>
                <h2 className="text-2xl font-medium tracking-tight text-white leading-tight truncate">{activeTrack.title}</h2>
                <p className="text-[11px] font-mono text-[#5a5142] mt-1">{activeIndex + 1} of {tracks.length}</p>
              </div>
            </div>

            {/* Waveform */}
            <div className="bg-[#0c0a08] border border-[#16130e] rounded-lg p-5 mb-4">
              <div ref={waveRef} className="w-full" />
              {!ready && (
                <div className="h-20 flex items-end gap-0.5 justify-center">
                  {Array.from({ length: 60 }).map((_, i) => (
                    <div key={i} className="w-[3px] bg-[#1f1a13] rounded-sm"
                      style={{ height: `${12 + Math.abs(Math.sin(i * 0.35) * 52)}px` }} />
                  ))}
                </div>
              )}
            </div>

            {/* Scrub bar */}
            <div className="flex items-center gap-3 mb-5">
              <span className="text-[10px] font-mono text-[#5a5142] tabular-nums">{fmt(currentTime)}</span>
              <div className="flex-1 h-px bg-[#1a160f] relative cursor-pointer group"
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  ws.current?.seekTo(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)));
                }}
              >
                <div className="h-full bg-[#D4BFA0] absolute left-0 top-0" style={{ width: `${progressPct}%` }} />
                <div className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-white opacity-0 group-hover:opacity-100 transition-opacity shadow-lg"
                  style={{ left: `${progressPct}%`, transform: 'translate(-50%, -50%)' }} />
              </div>
              <span className="text-[10px] font-mono text-[#5a5142] tabular-nums">{fmt(duration)}</span>
            </div>

            {/* Controls */}
            <div className="flex items-center gap-3">
              <button onClick={prevTrack} disabled={activeIndex === 0}
                className="w-8 h-8 flex items-center justify-center text-[#5a5142] hover:text-white disabled:opacity-20 transition-colors">
                <SkipBack size={16} fill="currentColor" />
              </button>
              <button onClick={togglePlay}
                className="w-10 h-10 bg-white text-black rounded-full flex items-center justify-center hover:scale-105 active:scale-95 transition-transform">
                {isPlaying ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" className="ml-0.5" />}
              </button>
              <button onClick={nextTrack} disabled={activeIndex === tracks.length - 1}
                className="w-8 h-8 flex items-center justify-center text-[#5a5142] hover:text-white disabled:opacity-20 transition-colors">
                <SkipForward size={16} fill="currentColor" />
              </button>

              <div className="flex items-center gap-2 ml-3">
                <button onClick={() => setMuted(!muted)} className="text-[#5a5142] hover:text-white transition-colors">
                  {muted || volume === 0 ? <VolumeX size={14} /> : <Volume2 size={14} />}
                </button>
                <input type="range" min="0" max="1" step="0.01" value={muted ? 0 : volume}
                  onChange={(e) => { setMuted(false); setVolume(parseFloat(e.target.value)); }}
                  className="w-20 cursor-pointer" />
              </div>

              <div className="flex-1" />

              {allowDownloads ? (
                <button onClick={() => downloadTrack(activeTrack)}
                  className="flex items-center gap-1.5 text-[11px] font-medium text-[#a08a6a] hover:text-white border border-[#1a160f] hover:border-[#2d2620] px-3 py-2 rounded-md transition-colors">
                  <Download size={12} />
                  Download
                </button>
              ) : (
                <div
                  title="The sender disabled downloads on this link."
                  className="flex items-center gap-1.5 text-[11px] font-medium text-[#4a4338] border border-[#161616] px-3 py-2 rounded-md cursor-not-allowed">
                  <Lock size={11} />
                  Downloads disabled
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tracklist */}
        <div>
          <p className="text-[10px] font-mono uppercase tracking-wider text-[#5a5142] mb-4">{tracks.length} track{tracks.length !== 1 ? 's' : ''}</p>
          <div className="border border-[#1a160f] rounded-lg divide-y divide-[#161310]">
            {tracks.map((track, i) => {
              const active = i === activeIndex;
              return (
                <div key={track.id} onClick={() => selectTrack(i)}
                  className={`group flex items-center gap-4 px-4 h-14 cursor-pointer transition-colors ${active ? 'bg-[#0e0c08]' : 'hover:bg-[#0c0a08]'}`}>
                  <div className="w-5 text-center shrink-0">
                    {active && isPlaying ? (
                      <div className="flex gap-0.5 items-end h-3 justify-center">
                        <div className="w-0.5 bg-[#D4BFA0] animate-pulse h-2" />
                        <div className="w-0.5 bg-[#D4BFA0] animate-pulse h-3" style={{ animationDelay: '150ms' }} />
                        <div className="w-0.5 bg-[#D4BFA0] animate-pulse h-1.5" style={{ animationDelay: '300ms' }} />
                      </div>
                    ) : (
                      <span className={`text-[11px] font-mono ${active ? 'text-[#D4BFA0]' : 'text-[#3a3328]'}`}>{i + 1}</span>
                    )}
                  </div>
                  <div className="w-8 h-8 bg-[#16130e] rounded border border-[#1a160f] overflow-hidden shrink-0">
                    {track.cover_url
                      ? <img loading="lazy" src={track.cover_url} alt="" className="w-full h-full object-cover" />
                      : <div className="w-full h-full flex items-center justify-center text-[#2d2620]"><Music size={11} /></div>
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-[13px] font-medium truncate ${active ? 'text-[#E8D8B8]' : 'text-[#E8DCC8]'}`}>{track.title}</p>
                    <p className="text-[10px] font-mono text-[#5a5142] mt-0.5">{track.type}{track.bpm ? ` · ${track.bpm}` : ''}</p>
                  </div>
                  {track.duration_seconds && (
                    <span className="text-[11px] font-mono text-[#5a5142] tabular-nums">{fmt(track.duration_seconds)}</span>
                  )}
                  {allowDownloads && (
                    <button onClick={(e) => { e.stopPropagation(); downloadTrack(track); }}
                      className="p-2 text-[#4a4338] hover:text-white transition-colors opacity-0 group-hover:opacity-100">
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
    <div className="mt-12 border-t border-[#1a160f] pt-8 space-y-4">
      <p className="text-[10px] font-mono uppercase tracking-wider text-[#5a5142]">Licensing</p>

      {creator?.license_notes && (
        <p className="text-[12px] text-[#a08a6a] leading-relaxed">{creator.license_notes}</p>
      )}

      <div className="space-y-2">
        {tiers.map(tier => (
          <div key={tier.key} className="border border-[#1a160f] rounded-lg overflow-hidden">
            <button
              onClick={() => setOpen(open === tier.key ? null : tier.key)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-[#0c0a08] transition-colors text-left"
            >
              <div className="flex items-center gap-3">
                <span className="text-[13px] font-medium text-[#E8DCC8]">{tier.label}</span>
                {tier.price && (
                  <span className="text-[11px] font-mono text-[#D4BFA0]">{tier.price}</span>
                )}
              </div>
              <span className="text-[10px] text-[#5a5142]">{open === tier.key ? '▲' : '▼'}</span>
            </button>
            {open === tier.key && (
              <div className="px-4 pb-4 space-y-2 border-t border-[#1a160f] pt-3">
                {tier.includes.map(item => (
                  <div key={item} className="flex items-center gap-2 text-[11px] text-[#a08a6a]">
                    <span className="text-green-400 shrink-0">✓</span> {item}
                  </div>
                ))}
                {tier.excludes.map(item => (
                  <div key={item} className="flex items-center gap-2 text-[11px] text-[#5a5142]">
                    <span className="text-[#3a3328] shrink-0">✗</span> {item}
                  </div>
                ))}
                {tier.key === 'exclusive' && creator?.license_agreement && (
                  <details className="mt-3">
                    <summary className="text-[10px] font-mono text-[#5a5142] cursor-pointer hover:text-[#a08a6a] transition-colors">
                      View full agreement
                    </summary>
                    <pre className="mt-2 text-[10px] text-[#5a5142] whitespace-pre-wrap leading-relaxed font-mono border border-[#1a160f] rounded p-3 bg-[#0a0907] max-h-48 overflow-y-auto">
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
