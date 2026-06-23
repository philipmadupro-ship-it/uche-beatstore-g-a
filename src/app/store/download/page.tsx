'use client';

import { useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  Download, Music, Loader2, CheckCircle2, ShieldCheck,
  ArrowLeft, Play, Pause, FileAudio, Package,
  AlertTriangle, ExternalLink, Waves, Disc3,
} from 'lucide-react';
import { usePlayer } from '@/hooks/usePlayer';
import type { Track } from '@/lib/types';

/* ─── Types ────────────────────────────────────────────────── */

interface PurchaseInfo {
  id: string;
  buyer_email: string;
  amount_usd: number;
  created_at: string;
  status: string;
}

interface DownloadFile {
  format: string;
  label: string;
  proxied_url: string;
}

interface DeliveryTrack extends Omit<Track, 'audio_url' | 'wav_url'> {
  license_type: 'lease' | 'exclusive';
  file_types: string[];
  downloads: DownloadFile[];
}

/* ─── Helpers ───────────────────────────────────────────────── */

function fmt(s: number | null | undefined) {
  if (!s) return '—';
  return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
}

const FORMAT_META: Record<string, { icon: React.ReactNode; accent: string; bg: string; border: string }> = {
  mp3:      { icon: <Music size={12} />,  accent: 'text-[#E7D7BE]', bg: 'bg-[#342F27]',      border: 'border-[#E7D7BE]/20' },
  'wav-main': { icon: <Disc3 size={12} />, accent: 'text-[#F7EBDD]', bg: 'bg-[#2B2821]',      border: 'border-[#D0C3AF]/30' },
  wav:      { icon: <Disc3 size={12} />,  accent: 'text-[#F7EBDD]', bg: 'bg-[#2B2821]',      border: 'border-[#D0C3AF]/30' },
  vocals:   { icon: <Waves size={12} />,  accent: 'text-[#9d95e8]', bg: 'bg-[#1a1833]/60',   border: 'border-[#534AB7]/20' },
  drums:    { icon: <Waves size={12} />,  accent: 'text-[#e87a5a]', bg: 'bg-[#1f1010]/60',   border: 'border-[#8B3A2A]/20' },
  bass:     { icon: <Waves size={12} />,  accent: 'text-[#8ecf9f]', bg: 'bg-[#0d1f14]/60',   border: 'border-[#3A7A50]/20' },
  other:    { icon: <Waves size={12} />,  accent: 'text-[#E7D7BE]', bg: 'bg-[#342F27]/60',   border: 'border-[#C9BCA8]/20' },
};

function getFormatMeta(format: string) {
  return FORMAT_META[format] ?? FORMAT_META.mp3;
}

/* ─── Page wrapper for Suspense ─────────────────────────────── */

export default function DownloadPortalWrapper() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <DownloadPortal />
    </Suspense>
  );
}

function LoadingScreen() {
  return (
    <div className="min-h-screen bg-[#090907] flex items-center justify-center">
      <Loader2 size={24} className="animate-spin text-[#9B9282]" />
    </div>
  );
}

/* ─── Main portal ───────────────────────────────────────────── */

function DownloadPortal() {
  const searchParams = useSearchParams();
  const sessionId = searchParams?.get('session_id');

  const [purchase, setPurchase] = useState<PurchaseInfo | null>(null);
  const [tracks, setTracks] = useState<DeliveryTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Key: `${trackId}-${format}` → true while downloading
  const [downloading, setDownloading] = useState<Record<string, boolean>>({});

  const { currentTrack, isPlaying, setTrack, togglePlay, setQueue } = usePlayer();

  useEffect(() => {
    if (!sessionId) {
      setError('No session ID found. Check your purchase confirmation email for the download link.');
      setLoading(false);
      return;
    }

    (async () => {
      try {
        const res = await fetch(`/api/store/delivery?session_id=${encodeURIComponent(sessionId)}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        setPurchase(data.purchase);
        setTracks(data.tracks ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load your delivery link.');
      } finally {
        setLoading(false);
      }
    })();
  }, [sessionId]);

  /**
   * Trigger a file download using a same-origin proxied URL.
   * Because proxied_url points to /api/audio (same-origin) and the server
   * sets Content-Disposition: attachment, the browser saves the file
   * instead of navigating — no redirect chain, no "opens a page" issue.
   */
  const triggerDownload = (trackId: string, file: DownloadFile) => {
    const key = `${trackId}-${file.format}`;
    setDownloading((d) => ({ ...d, [key]: true }));

    const a = document.createElement('a');
    a.href = file.proxied_url;
    // Extract filename from the proxied_url for the download attribute
    const filenameParam = new URL(file.proxied_url, window.location.origin).searchParams.get('filename');
    a.download = filenameParam ? decodeURIComponent(filenameParam) : file.label;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    setTimeout(() => setDownloading((d) => ({ ...d, [key]: false })), 3000);
  };

  const handlePlay = (track: DeliveryTrack) => {
    // Cast: audio_url is absent but player only needs it for WaveSurfer init,
    // and the download page doesn't mount WaveSurfer — it uses the global bar.
    const castTrack = { ...track, audio_url: '' } as unknown as Track;
    if (currentTrack?.id === track.id) { togglePlay(); return; }
    setQueue(tracks.map((t) => ({ ...t, audio_url: '' })) as unknown as Track[]);
    setTrack(castTrack);
  };

  /* ── Loading ── */
  if (loading) return <LoadingScreen />;

  /* ── Error / not found ── */
  if (error || !purchase) {
    return (
      <div className="min-h-screen bg-[#090907] px-4 py-10 text-[#F7EBDD]">
        <div className="mx-auto flex min-h-[78vh] max-w-xl flex-col items-center justify-center gap-6 text-center">
          <div className="grid size-20 place-items-center rounded-[24px] border border-amber-400/20 bg-amber-400/8">
            <AlertTriangle size={34} className="text-amber-400" />
          </div>
          <div>
            <p className="mb-3 text-[10px] font-mono uppercase tracking-[0.24em] text-[#6E685B]">Delivery</p>
            <h1 className="mb-2 text-[28px] font-bold leading-tight text-white">Download not available</h1>
            <p className="mx-auto max-w-md text-[13px] leading-relaxed text-[#B4AA99]">
            {error ?? 'This download link is invalid or has expired.'}
            </p>
          </div>
          <Link
            href="/store"
            className="inline-flex min-h-11 items-center gap-2 rounded-full bg-[#E7D7BE] px-5 py-3 text-[11px] font-bold uppercase tracking-wider text-black transition-all hover:bg-[#F3E6D1] active:scale-[0.98]"
          >
            <ArrowLeft size={13} />
            Back to store
          </Link>
        </div>
      </div>
    );
  }

  const purchaseDate = new Date(purchase.created_at).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
  const totalFiles = tracks.reduce((sum, track) => sum + (track.downloads?.length ?? 0), 0);

  return (
    <div className="min-h-screen bg-[#090907] text-[#F7EBDD]">
      <div className="mx-auto max-w-4xl px-4 pb-24 pt-10 md:px-6">

        {/* Back link */}
        <Link
          href="/store"
          className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-[#9B9282] hover:text-[#D0C3AF] transition-colors mb-8"
        >
          <ArrowLeft size={10} />
          Back to store
        </Link>

        {/* ── Success banner ───────────────────────────────────── */}
        <div className="mb-5 rounded-[26px] border border-[#6DC6A4]/20 bg-[#0e1f17]/55 p-5 shadow-[0_30px_90px_rgba(0,0,0,0.35)] md:p-6">
          <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
            <div className="flex items-start gap-4">
              <div className="grid size-12 shrink-0 place-items-center rounded-[18px] border border-[#6DC6A4]/20 bg-[#6DC6A4]/10">
                <CheckCircle2 size={24} className="text-[#6DC6A4]" />
              </div>
              <div>
                <p className="mb-2 text-[10px] font-mono uppercase tracking-[0.24em] text-[#6DC6A4]">Purchase confirmed</p>
                <h1 className="text-[28px] font-bold leading-tight text-white md:text-[34px]">Your files are ready</h1>
                <p className="mt-2 max-w-xl text-[12px] leading-relaxed text-[#B4AA99]">
                  Receipt sent to <span className="text-[#D0C3AF]">{purchase.buyer_email}</span>. Keep this private link for future downloads.
                </p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 md:min-w-[280px]">
              {[
                { label: 'Paid', value: `$${Number(purchase.amount_usd).toFixed(2)}` },
                { label: 'Tracks', value: String(tracks.length) },
                { label: 'Files', value: String(totalFiles) },
              ].map((item) => (
                <div key={item.label} className="rounded-xl border border-white/[0.06] bg-white/[0.04] px-3 py-2">
                  <p className="text-[8px] font-mono uppercase tracking-[0.18em] text-[#6DC6A4]/70">{item.label}</p>
                  <p className="mt-1 text-[13px] font-bold tabular-nums text-white">{item.value}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Security note */}
        <div className="mb-7 flex flex-wrap items-center gap-2 text-[10px] font-mono text-[#6E685B]">
          <ShieldCheck size={11} />
          <span>Confirmed {purchaseDate}. Download links are private to this session.</span>
        </div>

        {/* ── Track list ───────────────────────────────────────── */}
        <div className="space-y-5">
          {tracks.length === 0 && (
            <div className="rounded-xl border border-dashed border-[#2B2821] py-12 text-center text-[#9B9282] text-[13px]">
              No tracks found in this purchase.
            </div>
          )}

          {tracks.map((track) => {
            const isCurrent = currentTrack?.id === track.id;
            const isTrackPlaying = isCurrent && isPlaying;
            const stems = (track.downloads ?? []).filter((d) =>
              ['vocals', 'drums', 'bass', 'other'].includes(d.format),
            );
            const nonStems = (track.downloads ?? []).filter((d) =>
              !['vocals', 'drums', 'bass', 'other'].includes(d.format),
            );

            return (
              <div
                key={track.id}
                className={`overflow-hidden rounded-[22px] border transition-all ${
                  isCurrent
                    ? 'border-[#E7D7BE]/30 bg-[#171511]'
                    : 'border-[#2B2821] bg-[#171511]/60'
                }`}
              >
                {/* Track header */}
                <div className="flex items-center gap-4 px-5 pt-5 pb-4">
                  {/* Cover + play */}
                  <button
                    onClick={() => handlePlay(track)}
                    className="relative w-16 h-16 rounded-xl overflow-hidden bg-[#090907] border border-[#2B2821] shrink-0 group"
                  >
                    {track.cover_url ? (
                      <img src={track.cover_url} alt={track.title} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-[#6E685B]">
                        <Music size={20} />
                      </div>
                    )}
                    <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity">
                      {isTrackPlaying
                        ? <Pause size={16} fill="currentColor" className="text-white" />
                        : <Play size={16} fill="currentColor" className="text-white ml-0.5" />}
                    </div>
                    {isCurrent && (
                      <div className="absolute top-1.5 left-1.5 w-1.5 h-1.5 rounded-full bg-[#6DC6A4] animate-pulse" />
                    )}
                  </button>

                  {/* Meta */}
                  <div className="flex-1 min-w-0">
                    <p className="text-[15px] font-semibold text-white truncate">{track.title}</p>
                    <div className="flex items-center flex-wrap gap-2 mt-1.5">
                      <span className={`text-[9px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                        track.license_type === 'exclusive'
                          ? 'text-[#E7D7BE] bg-[#E7D7BE]/10 border-[#E7D7BE]/20'
                          : 'text-[#B4AA99] bg-white/[0.03] border-[#2B2821]'
                      }`}>
                        {track.license_type === 'exclusive' ? 'Exclusive' : 'Lease'}
                      </span>
                      {track.bpm && (
                        <span className="text-[10px] font-mono text-[#9B9282]">{track.bpm} BPM</span>
                      )}
                      {track.key && (
                        <span className="text-[10px] font-mono text-[#9B9282]">
                          {track.key}{track.scale ? ` ${track.scale}` : ''}
                        </span>
                      )}
                      {track.duration_seconds != null && (
                        <span className="text-[10px] font-mono text-[#9B9282]">{fmt(track.duration_seconds)}</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* ── Downloads section ─────────────────────────── */}
                <div className="border-t border-[#211F1A] px-5 py-4 space-y-3">
                  <p className="text-[9px] font-mono uppercase tracking-[0.25em] text-[#6E685B] flex items-center gap-1.5">
                    <FileAudio size={9} />
                    Included files
                  </p>

                  {/* Main audio files (MP3, WAV) */}
                  {nonStems.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {nonStems.map((file) => (
                        <FileDownloadRow
                          key={file.format}
                          file={file}
                          downloading={downloading[`${track.id}-${file.format}`] ?? false}
                          onDownload={() => triggerDownload(track.id, file)}
                        />
                      ))}
                    </div>
                  )}

                  {/* Stems section */}
                  {stems.length > 0 && (
                    <div>
                      <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#534AB7]/80 mb-2 flex items-center gap-1.5">
                        <Waves size={9} />
                        Stems
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {stems.map((file) => (
                          <FileDownloadRow
                            key={file.format}
                            file={file}
                            downloading={downloading[`${track.id}-${file.format}`] ?? false}
                            onDownload={() => triggerDownload(track.id, file)}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {(!track.downloads || track.downloads.length === 0) && (
                    <p className="text-[11px] text-[#9B9282] py-2">No files available for download.</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Footer ───────────────────────────────────────────── */}
        <div className="mt-10 pt-6 border-t border-[#211F1A] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-[10px] font-mono text-[#6E685B]">
            <Package size={11} />
            <span>All files licensed to {purchase.buyer_email}</span>
          </div>
          <div className="flex items-center gap-4">
            <Link
              href="/store/account"
              className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-[#D0C3AF] hover:text-[#F7EBDD] transition-colors"
            >
              View my account
              <ExternalLink size={9} />
            </Link>
            <Link
              href="/store"
              className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-[#9B9282] hover:text-[#D0C3AF] transition-colors"
            >
              Browse more beats
              <ExternalLink size={9} />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── File download row ─────────────────────────────────────── */

function FileDownloadRow({
  file,
  downloading,
  onDownload,
}: {
  file: DownloadFile;
  downloading: boolean;
  onDownload: () => void;
}) {
  const meta = getFormatMeta(file.format);

  return (
    <div className="flex items-center justify-between py-2.5 px-3 rounded-xl bg-[#090907] border border-[#211F1A] hover:border-[#3B372F] transition-colors">
      <div className="flex items-center gap-2.5">
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${meta.bg} border ${meta.border}`}>
          <span className={meta.accent}>{meta.icon}</span>
        </div>
        <div>
          <p className="text-[12px] font-medium text-[#F7EBDD]">{file.label}</p>
          <p className="text-[9px] font-mono text-[#9B9282] uppercase tracking-wider">
            {['vocals', 'drums', 'bass', 'other'].includes(file.format) ? 'Stem · WAV' : file.format.replace('-main', '').toUpperCase()}
          </p>
        </div>
      </div>

      <button
        onClick={onDownload}
        disabled={downloading}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all shrink-0 ${
          downloading
            ? 'bg-[#E7D7BE]/10 text-[#E7D7BE] cursor-wait'
            : 'bg-[#E7D7BE] text-black hover:bg-[#F3E6D1] active:scale-95'
        }`}
      >
        {downloading ? (
          <><Loader2 size={11} className="animate-spin" /> Saving…</>
        ) : (
          <><Download size={11} /> Download</>
        )}
      </button>
    </div>
  );
}
