'use client';

import { use, useEffect, useMemo, useRef, useState } from 'react';
import { Play, Pause, Music, ExternalLink, Check, Copy } from 'lucide-react';
import { ArtworkFallback } from '@/components/ui/ArtworkFallback';
import { ArtworkThemeProvider } from '@/components/providers/ArtworkThemeProvider';
import type { PublicArtworkTheme } from '@/lib/artwork/public-theme';

/**
 * /embed/[id] — public, chrome-free, embeddable beat player.
 *
 * Each embed is a viral distribution node: a producer pastes the generated
 * <iframe> snippet on any blog / forum / link-in-bio and visitors can preview
 * the beat and click through to buy. No auth, no cookies, no nav.
 *
 * Framing is allowed cross-origin: X-Frame-Options is dropped for /embed in
 * next.config.ts and the CSP frame-ancestors is widened in src/proxy.ts.
 *
 * The copy-the-snippet box only renders when the page is viewed top-level
 * (window.self === window.top) — inside an iframe it's hidden so it never
 * appears in the embedded card itself.
 */

interface EmbedTrack {
  id: string;
  title: string;
  type?: string | null;
  bpm?: number | null;
  key?: string | null;
  scale?: string | null;
  cover_url?: string | null;
  audio_url?: string | null;
  peaks_url?: string | null;
}

/**
 * The embed is PUBLIC — it renders in a stranger's page (CSP frame-ancestors
 * `*`) with no session at all.
 *
 * It used to wrap every absolute URL in `/api/audio`, which is the producer's
 * authenticated proxy: an anonymous viewer got a 401 and silent audio, and the
 * only reason it ever appeared to work was a signed-in producer previewing
 * their own embed. What arrives here is already public — `/api/store/[id]`
 * runs `redactPublicTrackMedia`, which replaces `audio_url` with the public
 * preview derivative (a CDN URL when one is configured, otherwise
 * `/api/store/preview/[id]`) — so it is used exactly as given.
 */
function publicMedia(src: string | null | undefined): string | null {
  return src || null;
}

function getTopLevelWindowState(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.self === window.top;
  } catch {
    return false;
  }
}

export default function EmbedPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [track, setTrack] = useState<EmbedTrack | null>(null);
  const [error, setError] = useState(false);
  const [artworkTheme, setArtworkTheme] = useState<PublicArtworkTheme | null>(null);
  const [topLevel] = useState(getTopLevelWindowState);

  useEffect(() => {
    let alive = true;
    fetch(`/api/store/${id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('not found'))))
      .then((json) => {
        if (alive) {
          setTrack(json.track as EmbedTrack);
          setArtworkTheme((json.artworkTheme ?? null) as PublicArtworkTheme | null);
        }
      })
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, [id]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#090907] text-white/60 text-[13px] font-mono">
        Track unavailable.
      </div>
    );
  }

  return (
    <ArtworkThemeProvider theme={artworkTheme}>
      <div className="min-h-screen bg-[#090907] flex flex-col items-center justify-center p-3">
        {track ? <EmbedCard track={track} /> : <CardSkeleton />}
        {topLevel && track && <EmbedSnippet id={id} />}
      </div>
    </ArtworkThemeProvider>
  );
}

function CardSkeleton() {
  return (
    <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/[0.04] p-4 animate-pulse">
      <div className="flex gap-4">
        <div className="w-20 h-20 rounded-xl bg-white/20 shrink-0" />
        <div className="flex-1 space-y-2 py-1">
          <div className="h-4 bg-white/20 rounded w-2/3" />
          <div className="h-3 bg-white/20 rounded w-1/3" />
          <div className="h-8 bg-white/20 rounded w-full mt-3" />
        </div>
      </div>
    </div>
  );
}

function EmbedCard({ track }: { track: EmbedTrack }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0); // 0..1
  const [peaks, setPeaks] = useState<number[] | null>(null);

  const src = publicMedia(track.audio_url);
  const storeUrl = `/store/${track.id}`;

  // Pull the precomputed peaks sidecar for a static waveform preview.
  useEffect(() => {
    if (!track.peaks_url) return;
    let alive = true;
    fetch(publicMedia(track.peaks_url)!)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!alive || !data) return;
        const arr: number[] | null = Array.isArray(data) ? data : Array.isArray(data?.peaks) ? data.peaks : null;
        if (arr && arr.length) {
          // Downsample to ~64 bars for a compact preview.
          const bars = 64;
          const step = Math.max(1, Math.floor(arr.length / bars));
          const reduced: number[] = [];
          for (let i = 0; i < arr.length; i += step) reduced.push(Math.abs(arr[i]) || 0);
          const max = Math.max(...reduced, 0.0001);
          setPeaks(reduced.map((v) => v / max));
        }
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [track.peaks_url]);

  const toggle = () => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) {
      el.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    } else {
      el.pause();
      setPlaying(false);
    }
  };

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = audioRef.current;
    if (!el || !el.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    el.currentTime = ratio * el.duration;
    setProgress(ratio);
  };

  const meta = [
    track.bpm ? `${track.bpm} BPM` : null,
    track.key ? `${track.key}${track.scale === 'minor' ? 'm' : ''}` : null,
    track.type || null,
  ].filter(Boolean);

  return (
    <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/[0.04] p-4 shadow-[0_18px_44px_rgba(0,0,0,0.55)]">
      <div className="flex gap-4">
        {/* Cover + play */}
        <button
          onClick={toggle}
          className="relative w-20 h-20 rounded-xl overflow-hidden shrink-0 group"
          aria-label={playing ? 'Pause' : 'Play'}
        >
          <ArtworkFallback src={track.cover_url} seed={track.id} kind="track" sizes="96px" className="object-cover">
            <Music size={24} aria-hidden="true" />
          </ArtworkFallback>
          <div className="absolute inset-0 flex items-center justify-center bg-black/35 group-hover:bg-black/45 transition-colors">
            <div className="w-9 h-9 rounded-full bg-white flex items-center justify-center text-black">
              {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" className="ml-0.5" />}
            </div>
          </div>
        </button>

        {/* Title + meta + waveform */}
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-semibold text-white truncate">{track.title}</p>
          {meta.length > 0 && (
            <p className="text-[10px] font-mono uppercase tracking-[0.15em] text-white/60 mt-0.5 truncate">
              {meta.join(' · ')}
            </p>
          )}

          {/* Waveform / progress */}
          <div
            onClick={seek}
            className="mt-2.5 h-9 flex items-end gap-px cursor-pointer"
            role="slider"
            aria-label="Seek"
            aria-valuenow={Math.round(progress * 100)}
            tabIndex={0}
          >
            {(peaks ?? Array.from({ length: 64 }, () => 0.25)).map((h, i) => {
              const played = i / (peaks?.length ?? 64) <= progress;
              return (
                <span
                  key={i}
                  className="flex-1 rounded-full"
                  style={{
                    height: `${Math.max(8, h * 100)}%`,
                    backgroundColor: played ? '#FFFFFF' : 'rgba(255,255,255,0.3)',
                  }}
                />
              );
            })}
          </div>
        </div>
      </div>

      {/* CTA */}
      <a
        href={storeUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-4 flex items-center justify-center gap-2 w-full px-3 py-2.5 rounded-xl bg-white text-black text-[11px] font-bold uppercase tracking-[0.18em] hover:opacity-90 transition-opacity"
      >
        Buy on U2C Beatstore
        <ExternalLink size={13} />
      </a>

      {src && (
        <audio
          ref={audioRef}
          src={src}
          preload="none"
          onTimeUpdate={(e) => {
            const el = e.currentTarget;
            if (el.duration) setProgress(el.currentTime / el.duration);
          }}
          onEnded={() => {
            setPlaying(false);
            setProgress(0);
          }}
        />
      )}
    </div>
  );
}

function EmbedSnippet({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  const [origin] = useState(() => (typeof window === 'undefined' ? '' : window.location.origin));

  const snippet = useMemo(
    () => `<iframe src="${origin}/embed/${id}" width="100%" height="180" frameborder="0" loading="lazy" style="border-radius:16px;max-width:480px" allow="autoplay"></iframe>`,
    [origin, id],
  );

  const copy = () => {
    navigator.clipboard
      .writeText(snippet)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => undefined);
  };

  return (
    <div className="w-full max-w-md mt-4">
      <p className="text-[9px] font-mono uppercase tracking-[0.25em] text-white/40 mb-2">Embed this beat</p>
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
        <code className="block text-[10px] text-white/80 font-mono break-all leading-relaxed">{snippet}</code>
        <button
          onClick={copy}
          className="mt-2.5 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.05] border border-white/[0.10] text-white text-[10px] font-bold uppercase tracking-wider hover:bg-white/[0.10] transition-colors"
        >
          {copied ? <Check size={11} className="text-[#6DC6A4]" /> : <Copy size={11} />}
          {copied ? 'Copied' : 'Copy embed code'}
        </button>
      </div>
    </div>
  );
}
