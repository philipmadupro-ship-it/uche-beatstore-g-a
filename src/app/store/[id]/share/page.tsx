'use client';

/**
 * /store/[id]/share — vertical 9:16 share preview optimised for screen
 * recording on a phone. Producers + fans hit this page, tap Play, then
 * use their phone's built-in screen recorder to capture a clean
 * 1080×1920-style video they can drop straight onto TikTok / Reels.
 *
 * Why not generate the video server-side? ffmpeg in serverless adds a
 * heavy native binary + 30+s function executions. Screen-recording on
 * phone is free, instant, and the framing here is hand-tuned to look
 * good in that workflow.
 *
 * On Chromium browsers we also expose a Record button that uses
 * MediaRecorder + canvas.captureStream to capture this exact view as
 * WebM client-side. Safari (iOS) doesn't support that, so on iOS the
 * button hides and the screen-record path is the recommended flow.
 */

import { useEffect, useRef, useState, use, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import {
  Play, Pause, Loader2, ArrowLeft, ScanLine, Video, Copy, Music,
} from 'lucide-react';
import { toast } from '@/hooks/useToast';
import { asVideoStyle } from '@/lib/share/styles';
import { normalizeThemeColor } from '@/lib/theme/colors';

interface TrackShape {
  id: string;
  title: string;
  audio_url: string | null;
  cover_url: string | null;
  bpm: number | null;
  key: string | null;
  scale: string | null;
}

interface CreatorShape {
  display_name?: string | null;
  accent_color?: string | null;
  share_video_style?: string | null;
}

const BARS = 48;

export default function VerticalSharePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#090907] flex items-center justify-center">
        <Loader2 size={20} className="animate-spin text-[#9B9282]" />
      </div>
    }>
      <VerticalShareContent params={params} />
    </Suspense>
  );
}

function VerticalShareContent({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['shareVertical', id],
    queryFn: async () => {
      const res = await fetch(`/api/store/${id}`);
      if (!res.ok) throw new Error('Not found');
      const j = await res.json();
      return {
        track: j.track as TrackShape,
        creator: (j.creator ?? null) as CreatorShape | null,
      };
    },
    retry: false,
  });
  const track = data?.track ?? null;
  const creator = data?.creator ?? null;
  const accent = normalizeThemeColor(creator?.accent_color);

  const searchParams = useSearchParams();
  const styleOverride = searchParams?.get('style');
  const videoStyle = asVideoStyle(styleOverride ?? creator?.share_video_style ?? null);
  const isMono = videoStyle === 'mono';
  const isMinimal = videoStyle === 'minimal';
  const coverShapeClass = isMinimal || isMono ? 'rounded-2xl' : 'rounded-full';
  const coverFilter = isMono ? 'grayscale(0.85) contrast(1.05)' : undefined;
  const spinClass = videoStyle === 'vinyl' && !isMono && !isMinimal ? 'animate-[spin_8s_linear_infinite]' : '';

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => {
      if (audio.duration) {
        setProgress(audio.currentTime / audio.duration);
        setDuration(audio.duration);
      }
    };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onPause);
    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onPause);
    };
  }, [track?.audio_url]);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) audio.play().catch(() => undefined);
    else audio.pause();
  };

  // Deterministic per-track bar pattern so the synthetic waveform
  // stays consistent on repeat plays + matches what the buyer saw
  // on the storefront (same algo as MiniWaveform fallback).
  const baseBars = useRef<number[]>([]);
  if (track && baseBars.current.length === 0) {
    const seed = track.id.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
    baseBars.current = Array.from({ length: BARS }, (_, i) => {
      const s = (seed * (i + 1) * 2654435761) >>> 0;
      return Math.max(0.18, Math.min(0.96, (s % 70) / 100 + 0.2 + Math.sin(i * 0.5 + seed) * 0.12));
    });
  }

  /* ── Optional client-side record (Chromium-only) ───────── */
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [recording, setRecording] = useState(false);
  const [canRecord, setCanRecord] = useState(false);
  useEffect(() => {
    setCanRecord(
      typeof window !== 'undefined' &&
      typeof (window as any).MediaRecorder !== 'undefined' &&
      // Safari supports MediaRecorder but lacks captureStream on <div>
      // — feature-detect captureStream specifically.
      typeof (HTMLCanvasElement.prototype as any).captureStream === 'function',
    );
  }, []);

  const startRecord = async () => {
    if (recording || !track) return;
    // Render the stage to a canvas frame-by-frame via html2canvas isn't
    // available without a dep. Cleaner shortcut: capture the audio
    // element's MediaStream + a procedural canvas drawing the same
    // bars + cover so the recording is self-contained without HTML
    // raster. Limit to 15 seconds.
    const audio = audioRef.current;
    if (!audio) return;

    const canvas = document.createElement('canvas');
    canvas.width = 1080;
    canvas.height = 1920;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Lazy-load cover image as a CanvasImageSource
    let coverImg: HTMLImageElement | null = null;
    if (track.cover_url) {
      coverImg = new Image();
      coverImg.crossOrigin = 'anonymous';
      coverImg.src = track.cover_url;
      try {
        await new Promise<void>((resolve, reject) => {
          coverImg!.onload = () => resolve();
          coverImg!.onerror = () => reject(new Error('cover load failed'));
        });
      } catch {
        coverImg = null;
      }
    }

    const canvasStream = (canvas as any).captureStream(30) as MediaStream;
    // Pipe the audio into the stream so the recording has sound
    const audioStream = (audio as any).captureStream?.() as MediaStream | undefined;
    if (audioStream) {
      audioStream.getAudioTracks().forEach((t) => canvasStream.addTrack(t));
    }

    const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
      ? 'video/webm;codecs=vp9,opus'
      : 'video/webm';
    const rec = new MediaRecorder(canvasStream, { mimeType: mime, videoBitsPerSecond: 6_000_000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };
    rec.onstop = () => {
      const blob = new Blob(chunks, { type: mime });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${track.title.replace(/[^\w\d-]+/g, '_')}-vertical.webm`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    };

    audio.currentTime = 0;
    audio.play().catch(() => undefined);
    rec.start();
    setRecording(true);

    let frame = 0;
    const startMs = performance.now();
    const DURATION_MS = 15_000;
    const draw = () => {
      const elapsed = performance.now() - startMs;
      if (elapsed >= DURATION_MS) {
        rec.stop();
        audio.pause();
        setRecording(false);
        return;
      }
      // Background — accent gradient over dark
      ctx.fillStyle = '#090907';
      ctx.fillRect(0, 0, 1080, 1920);
      const gradient = ctx.createLinearGradient(0, 0, 0, 1920);
      gradient.addColorStop(0, `${accent}55`);
      gradient.addColorStop(0.55, 'rgba(10,9,7,0.92)');
      gradient.addColorStop(1, '#090907');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 1080, 1920);

      // Cover (centered, 600px square, spinning)
      ctx.save();
      ctx.translate(540, 700);
      ctx.rotate((frame / 720) * Math.PI);
      ctx.beginPath();
      ctx.arc(0, 0, 300, 0, Math.PI * 2);
      ctx.clip();
      if (coverImg) {
        ctx.drawImage(coverImg, -300, -300, 600, 600);
      } else {
        ctx.fillStyle = '#211F1A';
        ctx.fillRect(-300, -300, 600, 600);
      }
      ctx.restore();

      // Vinyl ring
      ctx.beginPath();
      ctx.arc(540, 700, 304, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 4;
      ctx.stroke();

      // Title
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 64px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const titleY = 1150;
      const safeTitle = (track.title || 'Untitled').slice(0, 28);
      ctx.fillText(safeTitle, 540, titleY);

      // Producer line
      ctx.font = '36px sans-serif';
      ctx.fillStyle = accent;
      ctx.fillText(`prod. ${creator?.display_name ?? 'producer'}`, 540, titleY + 80);

      // Animated bars driven by sine waves seeded by the per-track baseBars
      const barCount = BARS;
      const barWidth = 14;
      const barGap = 6;
      const totalWidth = barCount * (barWidth + barGap) - barGap;
      const barsStart = (1080 - totalWidth) / 2;
      const barsCenterY = 1500;
      const t = elapsed / 1000;
      for (let i = 0; i < barCount; i++) {
        const base = baseBars.current[i];
        const wave = Math.abs(Math.sin(t * 4 + i * 0.5));
        const h = (base * 0.5 + wave * 0.5) * 280;
        ctx.fillStyle = `${accent}E6`;
        const x = barsStart + i * (barWidth + barGap);
        ctx.fillRect(x, barsCenterY - h / 2, barWidth, h);
      }

      // Brand strip
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.font = '22px sans-serif';
      ctx.fillText('U2C BEATSTORE  ·  /store', 540, 1820);

      frame++;
      requestAnimationFrame(draw);
    };
    requestAnimationFrame(draw);
  };

  const copyLink = () => {
    if (typeof window === 'undefined') return;
    const url = `${window.location.origin}/store/${id}`;
    navigator.clipboard.writeText(url).then(
      () => toast.success('Link copied'),
      () => toast.error('Could not copy', 'Try long-press on the URL bar.'),
    );
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#090907] flex items-center justify-center">
        <Loader2 size={20} className="animate-spin text-[#9B9282]" />
      </div>
    );
  }
  if (isError || !track) {
    return (
      <div className="min-h-screen bg-[#090907] flex flex-col items-center justify-center gap-4 text-[#9B9282] px-6">
        <Music size={28} />
        <p className="text-[14px]">This share preview isn't available.</p>
        <Link href="/store" className="text-[11px] underline hover:text-[#F7EBDD]">Back to store</Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-[#F7EBDD] flex items-center justify-center p-4">
      {/* Floating controls (outside the stage so they don't appear in a
          screen-recorded frame) */}
      <div className="fixed top-3 left-3 right-3 z-20 flex items-center gap-2 justify-between">
        <Link
          href={`/store/${id}`}
          className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-[#171511]/80 backdrop-blur border border-white/[0.08] text-white/70 text-[11px] font-mono uppercase tracking-wider hover:text-white transition-colors"
        >
          <ArrowLeft size={11} />
          Exit
        </Link>
        <div className="flex items-center gap-2">
          {canRecord && (
            <button
              type="button"
              onClick={startRecord}
              disabled={recording}
              className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-[#171511]/80 backdrop-blur border border-white/[0.10] text-[#F7EBDD] text-[11px] font-mono uppercase tracking-wider hover:bg-[#211F1A]/90 transition-colors disabled:opacity-40"
              title="Capture a 15-second WebM (Chromium browsers only)"
            >
              {recording ? <Loader2 size={11} className="animate-spin" /> : <Video size={11} />}
              {recording ? 'Recording…' : 'Record 15s'}
            </button>
          )}
          <button
            type="button"
            onClick={copyLink}
            className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-[#171511]/80 backdrop-blur border border-white/[0.08] text-white/70 text-[11px] font-mono uppercase tracking-wider hover:text-white transition-colors"
          >
            <Copy size={11} />
            Copy link
          </button>
        </div>
      </div>

      {/* Vertical stage — 9:16 aspect, max-h fills viewport on phone */}
      <div
        ref={stageRef}
        className="relative w-full max-w-[min(420px,calc(100vh*9/16))] aspect-[9/16] rounded-3xl overflow-hidden cursor-pointer shadow-[0_30px_80px_rgba(0,0,0,0.7)]"
        onClick={toggle}
      >
        {/* Backdrop */}
        {track.cover_url && (
          <div
            aria-hidden
            className="absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: `url(${track.cover_url})`, filter: 'blur(40px)', opacity: 0.45, transform: 'scale(1.15)' }}
          />
        )}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background: `linear-gradient(180deg, ${accent}55 0%, rgba(10,9,7,0.85) 50%, #090907 100%)`,
          }}
        />

        {/* Mono accent strips */}
        {isMono && (
          <>
            <div className="absolute top-0 left-0 right-0 h-2" style={{ backgroundColor: accent }} />
            <div className="absolute bottom-0 left-0 right-0 h-2" style={{ backgroundColor: accent }} />
          </>
        )}

        {/* Spinning cover (vinyl style) */}
        <div className="absolute top-[18%] left-1/2 -translate-x-1/2">
          <div
            className={`w-[58vw] max-w-[300px] aspect-square ${coverShapeClass} overflow-hidden border-4 border-white/[0.06] shadow-[0_24px_60px_rgba(0,0,0,0.5)] ${isPlaying ? spinClass : ''}`}
          >
            {track.cover_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={track.cover_url} alt={track.title} className="w-full h-full object-cover" style={coverFilter ? { filter: coverFilter } : undefined} />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-[#342F27] to-[#090907] flex items-center justify-center text-white/40">
                <Music size={40} />
              </div>
            )}
          </div>
        </div>

        {/* Title + producer */}
        <div className="absolute left-0 right-0 top-[58%] px-6 text-center">
          <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-white/55 mb-2">
            Now playing
          </p>
          <h1 className="text-[6vw] sm:text-[28px] font-bold text-white leading-tight break-words">
            {track.title}
          </h1>
          <p className="mt-3 text-[14px] text-white/75">
            prod. <span style={{ color: accent, fontWeight: 600 }}>{creator?.display_name ?? 'producer'}</span>
          </p>
          {(track.bpm || track.key) && (
            <p className="mt-1.5 text-[11px] font-mono text-white/45 uppercase tracking-wider">
              {[track.bpm ? `${track.bpm} BPM` : null, track.key ? `${track.key}${track.scale === 'minor' ? 'm' : ''}` : null].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>

        {/* Animated waveform bars */}
        <div className="absolute bottom-[22%] left-0 right-0 flex items-center justify-center gap-[3px] px-6 h-[80px]">
          {baseBars.current.map((b, i) => {
            const wave = isPlaying ? Math.abs(Math.sin(Date.now() / 220 + i * 0.6)) : 0;
            const h = (b * 0.55 + wave * 0.45) * 100;
            return (
              <span
                key={i}
                className="rounded-sm transition-[height] duration-100"
                style={{
                  width: 6,
                  height: `${h}%`,
                  backgroundColor: accent,
                  opacity: 0.85,
                }}
              />
            );
          })}
        </div>

        {/* Play overlay */}
        {!isPlaying && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div
              className="w-20 h-20 rounded-full flex items-center justify-center text-black shadow-2xl"
              style={{ backgroundColor: accent }}
            >
              <Play size={32} fill="currentColor" className="ml-1" />
            </div>
          </div>
        )}

        {/* Pause overlay (smaller, top-right) */}
        {isPlaying && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); toggle(); }}
            aria-label="Pause"
            className="absolute top-4 right-4 w-10 h-10 rounded-full bg-black/55 backdrop-blur flex items-center justify-center text-white"
          >
            <Pause size={14} fill="currentColor" />
          </button>
        )}

        {/* Brand stripe */}
        <div className="absolute bottom-3 left-0 right-0 text-center text-[10px] font-mono uppercase tracking-[0.3em] text-white/45">
          <span className="inline-flex items-center gap-1.5">
            <ScanLine size={10} />
            U2C Beatstore
          </span>
        </div>

        {/* Hidden audio element */}
        <audio
          ref={audioRef}
          src={track.audio_url ?? undefined}
          preload="auto"
          // capture progress driven by the existing usePlayer would
          // require sharing — easier to play this audio standalone
          crossOrigin="anonymous"
        />

        {/* Bottom progress line */}
        <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-white/[0.08]">
          <div
            className="h-full transition-[width]"
            style={{ width: `${(progress * 100).toFixed(1)}%`, backgroundColor: accent }}
          />
        </div>
      </div>

      {/* Helper text below the stage on desktop */}
      <p className="hidden md:block fixed bottom-3 left-0 right-0 text-center text-[10px] font-mono text-white/30">
        Tip — open this URL on your phone and use screen recording for a clean vertical capture.
      </p>
      {duration > 0 && progress > 0.99 && (
        <p className="hidden">{duration.toFixed(1)}s</p>
      )}
    </div>
  );
}
